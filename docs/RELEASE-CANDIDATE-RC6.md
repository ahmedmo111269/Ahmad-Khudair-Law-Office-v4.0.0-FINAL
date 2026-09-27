# v4.0.0-RC6 — Backup & Database Safety

## Changes
- Backup export now reads all stores through one IndexedDB readonly transaction, producing a single database snapshot instead of separate store transactions.
- Backup manifest now includes `totalRecords` and is validated against every store before restore.
- Restore remains atomic through one IndexedDB readwrite transaction.
- Restore-to-new remains the preferred recovery path; restore-in-place requires explicit confirmation and creates a pre-restore backup first.

## Verification
- Static JavaScript syntax check: required before packaging.
- Relative import audit: required before packaging.
- No schema change in this release.

## Known limitation
GitHub Pages + IndexedDB remains client-side storage. This release does not claim server-side security or transparent encryption of the local database.
