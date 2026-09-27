# RC4 — End-to-End Relational Integrity Test

## Critical workflow
1. Create a client.
2. Create a file and associate the client.
3. Create one or more cases under the file and associate the client.
4. Add hearings, procedures, judgments and execution records.
5. Open the client record and verify linked file/case labels are human-readable and navigable.
6. Open the file record and verify counts are not limited to the rendered timeline subset.
7. Open the case record and navigate back to its parent file.
8. Archive and restore records; verify they remain relationally consistent.
9. Export a backup, restore into a separate database, and verify relations remain intact.
10. Switch database profiles and verify no cross-database records appear.

## Large-data checks
- Relationship displays are bounded for UI rendering.
- Counters use indexed counts rather than the display limit.
- Main lists continue to use cursor pagination.
- No UI workflow should call `getAll()` for an unbounded dataset.

## Acceptance note
Browser execution remains the authoritative final UI gate. Static syntax/import validation alone is not treated as a substitute for browser verification.
