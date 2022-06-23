const fs = require('fs');
const path = require('path');
// const repl = require('repl');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const axios = require('axios');
const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

const apiKey = process.env.LEVER_API_KEY;

const API_ROOT = 'https://api.lever.co/v1'
const REQUEST_PER_SECOND = 10;
const DATA_DIRECTORY = path.join(__dirname, 'data');
const ASSET_DIRECTORY = path.join(DATA_DIRECTORY, 'assetsByOpportunityId');
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

async function queueDownload({ url, opportunityId, fileName, isResume }) {
  return new Promise((resolve, reject) => {
    launchQueue.push({
      start: () => { resolve(); }
    });
  }).then(() => {
    const downloadDirectory = path.join(
      ASSET_DIRECTORY, 
      opportunityId, 
      isResume ? 'resumes' : 'files'
    );
    const outputFile = path.join(downloadDirectory, fileName);
    return exec(`mkdir -p ${downloadDirectory} && curl -s -u $LEVER_API_KEY --pass '' ${url} --output "${outputFile}"`);
  });
}

async function queueRequest(path) {
  return new Promise((resolve, reject) => {
    launchQueue.push({ 
      start: () => { resolve(); }
    });
  }).then(() => {;
    return axios.get(
      `https://api.lever.co/v1${path}`, 
      { auth: { username: apiKey, password: '' }
    }).catch(error => console.log(error));;
  });
}

async function requestRemainingPages(pathWithLimitParam, offsetParam = '') {
  let resources = [];
  return queueRequest(`${pathWithLimitParam}${offsetParam}`)
    .then((response) => {
      resources = response.data.data;
      return response.data.hasNext
        ? requestRemainingPages(pathWithLimitParam, `&offset=${response.data.next}`)
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
        /*
        return Promise.all(
          resumes.map(r => queueDownload({
            url: r.file.downloadUrl,
            opportunityId: opportunity.id,
            fileName: r.file.name,
            isResume: true
          }))
        );
        */
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

  return Promise.all(fetchPromises).then(() => {
    addToStatsCompleted(1);
    return fullOpportunity;
  });
}

async function main() {
  await exec(`mkdir -p ${ASSET_DIRECTORY}`);

  const opportunities = [];
  progressBar.start(0, 0);
  queueRequest(`/opportunities?limit=10&expand=applications&expand=stage&expand=owner&expand=sourcedBy&expand=contact&expand=followers`)
    .then((response) => {
      addToStatsTotal(response.data.data.length);
      return Promise.all(
        response.data.data.map(o => {
          return populateFullOpportunity(o).then((full) => {
            opportunities.push(full);
          });
        })
      );
    })
    .then(() => {;
      progressBar.stop();
      fs.writeFileSync(
        OUTPUT_JSON_FILE, 
        JSON.stringify(opportunities, undefined, 2)
      );
      
      // repl.start().context.opportunities = opportunities;
      process.exit(0);
    });


  // Start processing the request queue
  setInterval(() => {
    if (launchQueue.length > 0) {
      launchQueue.shift().start();
    }
  }, 1000 / REQUEST_PER_SECOND);
}

main();
