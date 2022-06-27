const fs = require('fs');
const path = require('path');
const repl = require('repl');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

const DATA_DIRECTORY = path.join(__dirname, 'data');
const EXPORTED_JSON_FILE = path.join(DATA_DIRECTORY, 'lever-export.json');
const IMPORT_CSV_FILE = path.join(DATA_DIRECTORY, 'candidates-for-greenhouse-import.csv');
const RESUMES_TEMP_DIRECTORY = path.join(DATA_DIRECTORY, 'delete_after_resumes_zipped');
const IMPORT_RESUMES_ZIP = path.join(DATA_DIRECTORY, 'resumes-for-greenhouse-import.zip');
const ASSET_DIRECTORY = path.join(DATA_DIRECTORY, 'assetsByOpportunityId');

const progressBar = new cliProgress.SingleBar({
    format: 'Resume Zip Assembly |' + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} files moved || {duration_formatted}, ETA: {eta_formatted}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
});

function mapStageTextToMilestone(stageText) {
  switch(stageText) {
    case 'Skills Assessment':
    case 'Recruiter Phone Screen':
    case 'Hiring Manager Phone Screen': {
      return 'Assessment';
    }
    case 'On-site interview': {
      return 'Face to Face';
    }
    case 'Offer':  {
      return 'Offer'
    }
    // All active opportunities at the very least have an application.
    default: {
      return 'Application'
    }
  }
}

// Convert all tabs to spaces, tabs is the reserved field separator
// Convert all newlines to double spaces, newline is reserved row separator
function sanitizeForCsv(str) {
  return str.replace(/\t+/g, ' ').replace(/\n+/g, '  ');
}

function transcribeNote(note, potentialAuthors) {
  const noteText = note.fields.map(f => f.value).join('\n');
  const noteAuthor = potentialAuthors[note.user]?.name ?? 'Unknown author';
  return `${noteText}\n --${noteAuthor}`;
}

async function main() {
  const opportunities = JSON.parse(fs.readFileSync(EXPORTED_JSON_FILE));

  const knownDraftUsers = opportunities.reduce(
    (knownDraftUsers, o) => {
      o.followers.concat(o.owner ? [o.owner] : []).forEach((user) => {
        knownDraftUsers[user.id] = user;
      });
      return knownDraftUsers;
    },
    {}
  );

  const { leads, active, archived } = opportunities.reduce(
    ({ leads, active, archived }, o) => {
      if (o.archived) {
        return { leads, active, archived: [ ...archived, o ] };
      }
      if (o.applications && o.applications.length > 0) {
        return { leads, archived, active: [ ...active, o ] };
      }
      return { active, archived, leads: [ ...leads, o ] };
    },
    { leads: [], active: [], archived: [] }
  );

  const sources = active;

  const greenhouseCandidates = sources.map((o) => ({
    first: o.contact.name.split(/\s+/)[0] ?? '(none)',
    last: o.contact.name.split(/\s+/).slice(1).join(' ') ?? '(none)',
    company: o.contact.headline ?? '',
    notes: o.notes.map(n => transcribeNote(n, knownDraftUsers)).join(', ') ?? '',
    email: o.contact.emails.join(', ') ?? '',
    phone: o.contact.phones.map(p => `${p.type}:${p.value}`).join(', ') ?? '',
    socialMedia: o.links.join(', ') ?? '',
    address: o.contact.location?.name ?? '',
    source: o.sources.join(', ') ?? '',
    job: o.applications[0].posting.text ?? '',
    milestone: mapStageTextToMilestone(o.stage.text)
  }));

  const csvRows = greenhouseCandidates.map(c => {
    return [
      c.first, 
      c.last, 
      c.company, 
      '' /* title */, 
      c.notes,
      c.email, 
      c.phone, 
      c.socialMedia, 
      '' /* website */,
      c.address, 
      c.source, 
      '' /* who gets credit */, 
      c.job,
      c.milestone
    ].map(field => {
      if (field === null || field === undefined) {
        console.log(c);
      }
      return sanitizeForCsv(field);
    }).join('\t');
  });
  const csvData = [
    'First Name\tLast Name\tCompany\tTitle\tNotes\tEmail\tPhone\tSocial Media\tWebsite\tAddress\tSource\tWho gets credit\tJob\tMilestone',
    ...csvRows
  ].join('\n');

  fs.writeFileSync(IMPORT_CSV_FILE, csvData);

  console.log(`Wrote candidates to ${IMPORT_CSV_FILE}`);

  await exec(`mkdir -p ${RESUMES_TEMP_DIRECTORY}`);

  console.log({
    sources: sources.map(s => s.contact),
  });

  const fileMovements = sources.reduce((moves, o) => {
    return moves.concat(o.resumes.map((r, resumeIndex) => ({
      origin: path.join(ASSET_DIRECTORY, o.id, 'resumes', r.file.name),
      destination: path.join(RESUMES_TEMP_DIRECTORY, `${o.contact.name}${resumeIndex > 0 ? ` ${resumeIndex}` : ''}${r.file.ext}`)
    })));
  }, []);

  progressBar.start(fileMovements.length);
  while (fileMovements.length > 0) {
    const { origin, destination } = fileMovements.shift();
    await exec(`cp "${origin}" "${destination}"`);
    progressBar.increment();
  }
  progressBar.stop();
  console.log(`Copied all resumes to ${RESUMES_TEMP_DIRECTORY}`);

  await exec(`cd ${RESUMES_TEMP_DIRECTORY} && zip -r ${IMPORT_RESUMES_ZIP} .`);
  console.log(`Aggregated resumes for active candidates in ${IMPORT_RESUMES_ZIP}`);

  await exec(`rm -rf ${RESUMES_TEMP_DIRECTORY}`);

  process.exit(0);
}
  

main();
