# RC5 — Reports & Export Hardening Test

## Scope
- Relational reports: client files, client cases, case hearings, file procedures.
- Custom date range normalization.
- Arabic-normalized report conditions.
- Export UI remains compatible with the existing local/offline design.

## Automated/static checks
- JavaScript syntax: PASS for all source files.
- Relative import paths: PASS.
- No schema migration introduced.

## Required browser acceptance
1. Create a client and at least one file linked to that client.
2. Create a case linked to the file/client.
3. Create a hearing linked to the case.
4. Create a procedure linked to the file.
5. Run each relational report and verify only the selected relation is returned.
6. Run a custom report with reversed dates and verify the period is normalized.
7. Test Arabic conditions with common spelling variants and verify normalized matching.
8. Export TXT, Word-compatible DOC, Excel-compatible XLS and PDF/print and verify the output.
9. Test WhatsApp/Telegram sharing only on a device/browser that permits external navigation.

## Important limitation
The current Word/Excel exports are HTML-based compatible files (`.doc` / `.xls`), not native OOXML `.docx` / `.xlsx` packages. PDF uses the browser print workflow. This is intentional and must not be represented as native Office binary generation.
