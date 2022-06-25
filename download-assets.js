const fs = require('fs');
const path = require('path');
const repl = require('repl');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

const PARALLEL_DOWNLOADS = 3;  
const DATA_DIRECTORY = path.join(__dirname, 'data');
const ASSET_DIRECTORY = path.join(DATA_DIRECTORY, 'assetsByOpportunityId');
const EXPORTED_JSON_FILE = path.join(DATA_DIRECTORY, 'lever-export.json');

const progressBar = new cliProgress.SingleBar({
    format: 'Lever File Download |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} downloads || {duration_formatted}, ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});

async function processDownload({ url, opportunityId, fileName, isResume }) {
  const downloadDirectory = path.join(
    ASSET_DIRECTORY, 
    opportunityId, 
    isResume ? 'resumes' : 'files'
  );
  const outputFile = path.join(downloadDirectory, fileName);
  return fs.existsSync(outputFile)
    ? Promise.resolve()
    : exec(`mkdir -p ${downloadDirectory} && curl -s -u "$LEVER_API_KEY:" ${url} --output "${outputFile}"`);
}

async function consumeDownloadQueue(queue) {
  const download = queue.shift();
  return download 
    ? processDownload(download).then(() => { 
      progressBar.increment(); 
      return consumeDownloadQueue(queue);
    }) : Promise.resove();
}

async function main() {
  await exec(`mkdir -p ${ASSET_DIRECTORY}`);
  const opportunities = JSON.parse(fs.readFileSync(EXPORTED_JSON_FILE));
  const downloadQueue = opportunities.reduce((downloads, o) =>
    downloads.concat(
      o.files?.map((f) => ({ 
        url: f.downloadUrl, 
        opportunityId: o.id, 
        fileName: f.name,
        isResume: false
      })) ?? [],
      o.resumes?.map((r) => ({ 
        url: r.file.downloadUrl, 
        opportunityId: o.id, 
        fileName: r.file.name,
        isResume: true
      })) ?? [],
    ),
    []
  );

  progressBar.start(downloadQueue.length);

  const pendingDownloadQueues = [];
  for (let i = 0; i < PARALLEL_DOWNLOADS; i++) {
    pendingDownloadQueues.push(consumeDownloadQueue(downloadQueue));
  }
  Promise.all(pendingDownloadQueues).then(() => {
    progressBar.stop();
    process.exit(0);
  });
}

main();
