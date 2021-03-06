const fs = require('fs');
const path = require('path');
// const repl = require('repl');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const axios = require('axios');
const axiosRetry = require('axios-retry');
const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

// Lever occasionally throws rate limit errors despite our best efforts to
// request at a threshold below their limiting. Add retries that also pause
// request queue processing to give Lever a momentary break before resuming.
axiosRetry(axios, {
  retries: 5,
  retryCondition: (error) => {
    if (error?.response?.status === 429) {
      pauseLaunchingRequests(5000);
      return true;
    }
    return axiosRetry.isNetworkOrIdempotentRequestError(error);
  },
  retryDelay: (retryCount) => retryCount * retryCount * 1000,
});


const API_ROOT = 'https://api.lever.co/v1'
const REQUEST_PER_SECOND = 10;  
const DATA_DIRECTORY = path.join(__dirname, 'data');
const OUTPUT_JSON_FILE = path.join(DATA_DIRECTORY, 'lever-export.json');

const stats = {
  total: 0,
  completed: 0,
};
const progressBar = new cliProgress.SingleBar({
    format: 'Lever Data Export |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} entries || {duration_formatted}, ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});
function addToStatsTotal(count) {
    stats.total += count;
    progressBar.setTotal(stats.total);
}
function addToStatsCompleted(count) {
  stats.completed += count;
  progressBar.update(stats.completed);
}

const launchQueue = [];
let launchAllowed = true;
let launchPauseTimeoutId;

function startLaunchingRequests() {
  // Start processing the request queue
  setInterval(() => {
    if (launchAllowed && launchQueue.length > 0) {
      launchQueue.shift().start();
    }
  }, 1000 / REQUEST_PER_SECOND);
}

function pauseLaunchingRequests(delayMs) {
  launchAllowed = false;
  // If the launch was already paused, then clear the prior delay so it doesn't
  // interfere with this most recent one.
  if (launchPauseTimeoutId) {
    clearTimeout(launchPauseTimeoutId);
  }
  launchPauseTimeoutId = setTimeout(() => {
    launchAllowed = true;
    launchPauseTimeoutId = undefined;
  }, delayMs);
}

async function queueRequest(path) {
  return new Promise((resolve, reject) => {
    launchQueue.push({ 
      start: () => { resolve(); }
    });
  }).then(() => {;
    return axios.get(
      `https://api.lever.co/v1${path}`, 
      { auth: { username: process.env.LEVER_API_KEY, password: '' }
    }).catch(error => console.log(error));;
  });
}

// Request remaining pages, optionally calling the observe method each time
// a page is successfully fetched.
async function requestRemainingPages(pathWithLimitParam, observePageData, offsetParam = '') {
  let resources = [];
  return queueRequest(`${pathWithLimitParam}${offsetParam}`)
    .then((response) => {
      resources = response.data.data;
      if (observePageData) {
        observePageData(resources);
      }
      return response.data.hasNext
        ? requestRemainingPages(pathWithLimitParam, observePageData, `&offset=${response.data.next}`)
        : [];
    })
    .then((remainingResources) => {
      return resources.concat(remainingResources);
    });
}

async function populateFullOpportunity(opportunity) {
  let fullOpportunity = { ...opportunity };
  const fetchPromises = [
    requestRemainingPages(`/opportunities/${opportunity.id}/feedback?limit=100`)
      .then((feedback) => {
        fullOpportunity = { ...fullOpportunity, feedback };
      }),
    requestRemainingPages(`/opportunities/${opportunity.id}/panels?limit=100`)
      .then((panels) => {
        fullOpportunity = { ...fullOpportunity, panels };
      }),
    requestRemainingPages(`/opportunities/${opportunity.id}/notes?limit=100`)
      .then((notes) => {
        fullOpportunity = { ...fullOpportunity, notes };
      }),
    requestRemainingPages(`/opportunities/${opportunity.id}/offers?expand=creator&limit=100`)
      .then((offers) => {
        fullOpportunity = { ...fullOpportunity, offers };
      }),
    requestRemainingPages(`/opportunities/${opportunity.id}/forms?limit=100`)
      .then((forms) => {
        fullOpportunity = { ...fullOpportunity, forms };
      }),
    requestRemainingPages(`/opportunities/${opportunity.id}/files`)
      .then((files) => {
        fullOpportunity = { ...fullOpportunity, files };
      }),
    requestRemainingPages(`/opportunities/${opportunity.id}/resumes`)
      .then((resumes) => {
        fullOpportunity = { ...fullOpportunity, resumes };
      }),
  ];

  if (opportunity.archived && opportunity.archived.reason) {
    fetchPromises.push(
      queueRequest(`/archive_reasons/${opportunity.archived.reason}`)
        .then((response) => {
          fullOpportunity = { 
            ...fullOpportunity, 
            archivedReason: response.data.data
          };
        })
    );
  }

  if (opportunity.applications && opportunity.applications.length > 0) {
    fetchPromises.push(
      queueRequest(`/opportunities/${opportunity.id}/applications/${opportunity.applications[0].id}?expand=posting`)
        .then((response) => {
          fullOpportunity = { 
            ...fullOpportunity, 
            applications: [
              response.data.data
            ]
          };
        })
    );
  }

  return Promise.all(fetchPromises).then(() => fullOpportunity);
}

async function main() {
  await exec(`mkdir -p ${DATA_DIRECTORY}`);
  progressBar.start(0, 0);
  
  requestRemainingPages(
    '/opportunities?expand=applications&expand=stage&expand=owner&expand=sourcedBy&expand=contact&expand=followers&limit=100',
    (page) => {
      addToStatsTotal(page.length);
    }
  ).then((partialOpportunities) => {
    return Promise.all(
      partialOpportunities.map(o => {
        return populateFullOpportunity(o).then(o => {
          addToStatsCompleted(1);
          return o;
        });
      })
    );
  }).then((opportunities) => {
    progressBar.stop();
    fs.writeFileSync(
      OUTPUT_JSON_FILE, 
      JSON.stringify(opportunities, undefined, 2)
    );
    
    process.exit(0);
  });

  startLaunchingRequests();
}

main();
