const fs = require('fs');
const path = require('path');
const repl = require('repl');
const util = require('util');
const exec = util.promisify(require('child_process').exec);

const DATA_DIRECTORY = path.join(__dirname, 'data');
const EXPORTED_JSON_FILE = path.join(DATA_DIRECTORY, 'lever-export.json');
const IMPORT_CSV_FILE = path.join(DATA_DIRECTORY, 'active-opportunity-import.csv');

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
  await exec(`mkdir -p ${DATA_DIRECTORY}`);

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

  const greenhouseCandidates = active.map((o) => ({
    first: o.contact.name.split(/\s+/)[0],
    last: o.contact.name.split(/\s+/).slice(1).join(' ') ?? '',
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

  const byMilestoneStats = greenhouseCandidates.reduce((stats, c) => ({
    ...stats,
    [c.milestone]: (stats[c.milestone] ?? 0) + 1
  }), {});

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
  console.log(`Candidates by milestone:`);
  console.log(JSON.stringify(byMilestoneStats, undefined, 2));
}

main();
