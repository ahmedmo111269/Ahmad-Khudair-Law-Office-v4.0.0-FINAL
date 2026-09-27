# RC9 — Data Safety / Aggregate Reads

## Scope
- Remove the remaining 1000-row payment cap from fee-payment validation.
- Use cursor-based IndexedDB aggregation for fee payments.
- Prefer the `fileId` index for file-scoped fee summaries.
- Keep bounded UI/report reads; no change to schema version.

## Verification
- JavaScript syntax check required before release packaging.
- Search for payment reads with `byIndex('feeId', ..., 1000)` and broad fee summaries using `all(1000)`.
- Release audit must report no failures.
