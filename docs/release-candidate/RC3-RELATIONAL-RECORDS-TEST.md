# v4.0.0-RC3 — Relational Records & Filters Test

## Automated checks
- JavaScript syntax check: required for all JS modules.
- Relative import audit: no missing local imports.
- Forbidden navigation reload audit: no `location.reload()` / `location.href` in application code.

## Functional checks
1. Clients: search/filter applies across the dataset through the IndexedDB cursor, not only the visible page.
2. Files: status, priority, date range, and search reset the cursor and return matching pages.
3. Cases: status/date/search filters reset pagination safely.
4. Client record: linked counts remain exact for supported indexed relationships.
5. File record: aggregate counts do not inherit the 500-row timeline fetch cap.
6. Case record: timeline remains bounded for UI responsiveness.
7. Back/Close buttons remain available on record pages and forms.

## Manual browser acceptance
Run on the deployed GitHub Pages site and test with a synthetic dataset large enough to span multiple pages. Confirm that changing a filter while on page 2 returns to page 1 and that the result set is not limited to the previously visible 25 rows.
