const fs = require('fs');
const path = require('path');
const repl = require('repl');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const cliProgress = require('cli-progress');
const colors = require('ansi-colors');

const DATA_DIRECTORY = path.join(__dirname, 'data');
const EXPORTED_JSON_FILE = path.join(DATA_DIRECTORY, 'lever-export.json');
const CANDIDATE_CSV_FILE = path.join(DATA_DIRECTORY, 'candidates-for-greenhouse-import.csv');
const PROSPECT_CSV_FILE = path.join(DATA_DIRECTORY, 'prospects-for-greenhouse-import.csv');
const RESUMES_TEMP_DIRECTORY = path.join(DATA_DIRECTORY, 'delete_after_resumes_zipped');
const CANDIDATE_RESUMES_ZIP = path.join(DATA_DIRECTORY, 'candidate-resumes-for-greenhouse-import.zip');
const PROSPECT_RESUMES_ZIP = path.join(DATA_DIRECTORY, 'prospect-resumes-for-greenhouse-import.zip');
const ASSET_DIRECTORY = path.join(DATA_DIRECTORY, 'assetsByOpportunityId');

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

async function zipResumesForOpportunities(opportunities, zipPath, progressTitle) {
  await exec(`mkdir -p ${RESUMES_TEMP_DIRECTORY}`);

  const fileMoves = opportunities.reduce((moves, o) => {
    return moves.concat(o.resumes.map((r, resumeIndex) => ({
      origin: path.join(ASSET_DIRECTORY, o.id, 'resumes', r.file.name),
      destination: path.join(RESUMES_TEMP_DIRECTORY, `${o.contact.name}${resumeIndex > 0 ? ` ${resumeIndex}` : ''}${r.file.ext}`)
    })));
  }, []);

  const progressBar = new cliProgress.SingleBar({
      format: `${progressTitle} |` + colors.cyan('{bar}') + '| {percentage}% || {value}/{total} files moved || {duration_formatted}, ETA: {eta_formatted}',
      barCompleteChar: '\u2588',
      barIncompleteChar: '\u2591',
      hideCursor: true
  });

  progressBar.start(fileMoves.length);
  while (fileMoves.length > 0) {
    const { origin, destination } = fileMoves.shift();
    await exec(`cp "${origin}" "${destination}"`);
    progressBar.increment();
  }
  progressBar.stop();

  await exec(`cd ${RESUMES_TEMP_DIRECTORY} && zip -r ${zipPath} .`);
  console.log(`Aggregated resumes for active candidates in ${zipPath}`);

  await exec(`rm -rf ${RESUMES_TEMP_DIRECTORY}`);
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

  // CANDIDATES DATA GENERATION

  const greenhouseCandidates = active.map((o) => ({
    first: o.contact.name.trim().split(/\s+/)[0] || '(none specified)',
    last: o.contact.name.trim().split(/\s+/).slice(1).join(' ').replace(/^\s+$/, '') || '(none specified)',
    company: o.contact.headline || '(none specified)',
    notes: o.notes.map(n => transcribeNote(n, knownDraftUsers)).join(', ') ?? '',
    // All instances of multiple emails were observed to be duplicates of the
    // first email. Greenhouse only accepts one email, so just eliminate
    // duplicates.
    email: o.contact.emails[0] ?? '',
    phone: o.contact.phones.map(p => `${p.type}:${p.value}`).join(', ') ?? '',
    socialMedia: o.links.join(', ') ?? '',
    address: o.contact.location?.name ?? '',
    source: o.sources.join(', ') ?? '',
    job: o.applications[0].posting.text,
    milestone: mapStageTextToMilestone(o.stage.text)
  }));

  const candidateCsvRows = greenhouseCandidates.map(c => {
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
      return sanitizeForCsv(field);
    }).join('\t');
  });
  const candidateCsvData = [
    'First Name\tLast Name\tCompany\tTitle\tNotes\tEmail\tPhone\tSocial Media\tWebsite\tAddress\tSource\tWho gets credit\tJob\tMilestone',
    ...candidateCsvRows
  ].join('\n');

  fs.writeFileSync(CANDIDATE_CSV_FILE, candidateCsvData);
  console.log(`Wrote candidates to ${CANDIDATE_CSV_FILE}`);


  // PROSPECTS DATA GENERATION

  const greenhouseProspects = leads
    .filter((o) => !!o.contact.name.trim())
    .map((o) => ({
      first: o.contact.name.trim().split(/\s+/)[0] || '(none specified)',
      last: o.contact.name.trim().split(/\s+/).slice(1).join(' ').replace(/^\s+$/, '') || '(none specified)',
      company: o.contact.headline || '(none specified)',
      notes: o.notes.map(n => transcribeNote(n, knownDraftUsers)).join(', ') ?? '',
      // All instances of multiple emails were observed to be duplicates of the
      // first email. Greenhouse only accepts one email, so just eliminate
      // duplicates.
      email: o.contact.emails[0] ?? '',
      phone: o.contact.phones.map(p => `${p.type}:${p.value}`).join(', ') ?? '',
      socialMedia: o.links.join(', ') ?? '',
      address: o.contact.location?.name ?? '',
      source: o.sources.join(', ') ?? '',
    }));

  const prospectCsvRows = greenhouseProspects.map(p => {
    return [
      p.first, 
      p.last, 
      p.company, 
      '' /* title */, 
      p.notes,
      p.email, 
      p.phone, 
      p.socialMedia, 
      '' /* website */,
      p.address, 
      p.source, 
      '' /* who gets credit */, 
      '' /* job */,
      '' /* department */,
      '' /* pool */,
      '' /* prospect stage */
    ].map(field => {
      return sanitizeForCsv(field);
    }).join('\t');
  });
  const prospectCsvData = [
    'First Name\tLast Name\tCompany\tTitle\tNotes\tEmail\tPhone\tSocial Media\tWebsite\tAddress\tSource\tWho gets credit\tJob\tDepartment\tPool\tProspect Stage',
    ...prospectCsvRows
  ].join('\n');

  fs.writeFileSync(PROSPECT_CSV_FILE, prospectCsvData);
  console.log(`Wrote prospects to ${PROSPECT_CSV_FILE}`);

  await zipResumesForOpportunities(active, CANDIDATE_RESUMES_ZIP, 'Candidate Resume Zip'); 
  await zipResumesForOpportunities(leads, PROSPECT_RESUMES_ZIP, 'Prospect Resume Zip'); 

  process.exit(0);
}
  

main();
