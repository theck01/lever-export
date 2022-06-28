
# Lever Export Scripts

Collection of scripts to export Lever opportunity data and related files.

## Setup

Scripts require Node 16.

1. Install dependencies: `npm install`
2. Add `LEVER_API_KEY` to your environment: `LEVER_API_KEY="your-very-secret-api-key"`

## `export.js`

Exports all Lever API JSON data for all opportunties accessible to your
`$LEVER_API_KEY`. The data is saved as a file to `data/lever-export.json`.

### Usage

```
$ node export.js
```

### `lever-export.json` Format

`lever-export.json` contains an array of all Opportunity objects retrieved from
the Lever API. Each element matches type 
https://hire.lever.co/developer/documentation#opportunities, with all expandable
fields expanded. Each Opportunity additionally includes fields:

| Field | Type |
| ----- | ---- |
| `feedback` | An array of Feedback objects containing all interview feedback for the opportunity. Matches type https://hire.lever.co/developer/documentation#feedback |
| `panels` | An array of Panel objects containing interview schedules and panel information. Matches type https://hire.lever.co/developer/documentation#panels |
| `notes` | An array of Note objects containing miscellaneous notes captured during the opportunity lifecycle. Matches type https://hire.lever.co/developer/documentation#notes |
| `offers` | An array of Offer objects containing any offers made during the opportunity. Matches type https://hire.lever.co/developer/documentation#offers |
| `forms` | An array of Form objects containing any additional information provided by the opportunity candidate. Matches type https://hire.lever.co/developer/documentation#forms |
| `files` | An array of File objects containing any files generated during the opportunity lifecycle or interviews. Matches type https://hire.lever.co/developer/documentation#files |
| `resumes` | An array of Resume objects containing any resumes gathered during the opportunity lifecycles. Matches type https://hire.lever.co/developer/documentation#resumes |
| `archiveReason` | The object describing why an opportunity was completed, if it was compeleted. Matches type https://hire.lever.co/developer/documentation#archive-reasons |
| `application` | The Application object associated with the opportuntiy, with additional `post` data fully expanded. Matches type https://hire.lever.co/developer/documentation#applications with `post` expanded |

## `download-assets.js`

Downloads all files and resumes for all opportunties found in
`data/lever-export.json`. This script requires running `export.js` first, or
moving an existing export to the correct location.

All files are saved to `data/assetsByOpportuntiyId` with the format:

```
`data/assetsByOpportunityId/:opportunityId/{files,resumes}/:fileName`
```

Resumes are specifically saved to the `resumes` subdirectory. All other files
associated with the opportuntiy are saved to the `files` subdirectory.

### Usage

```
$ node download-assets.js
```

## generate-files-for-greenhouse.js

Generates a tab-separated CSV file with active candidate information found in
`data/lever-export.json`, and a ZIP file with all resumes of active candidates.

Also Generates a tab-separated CSV file with prospect information found in
`data/lever-export.json`, and a ZIP file with all resumes of prospects.

Generates files:

| File | Contains |
| --- | --- |
| `data/candidates-for-greenhouse-import.csv` | Tab separated CSV file containing active applications in a format for Greenhouse candidate bulk import. |
| `data/candidate-resumes-for-greenhouse-import.zip` | Zip file of all resumes for active candidates for Greenhouse candidate bulk import. |
| `data/prospects-for-greenhouse-import.csv` | Tab separated CSV file containing leads in a format for Greenhouse prospect bulk import. |
| `data/prospect-resumes-for-greenhouse-import.zip` | Zip file of all resumes for leads for Greenhouse prospect bulk import. |

This script requires running `export.js` and `download-assets.js` first.
Also generates a ZIP file containing all candidate resumes for Greenhouse
upload. Requires that `download-assets.js` script be run.

### Usage

```
$ node generate-files-for-greenhouse.js
```
