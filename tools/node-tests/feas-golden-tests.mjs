// FEAS Golden + Property tests — pure domain engine only (no DOM / IndexedDB).
// Run: cd tools/node-tests && node feas-golden-tests.mjs
// Writes a reviewable JSON result next to the docs: docs/feas-golden-results.json
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {
  resolveExecutionClaim, calculateFeasBalance, analyzeFeasValueChange, planFeasAllocation, recognitionPeriodKey, FEAS_MODEL
} from '../../js/domain/execution-feas.js';
import {periodStart, periodEnd, completedPeriods, runningPeriod, periodsInRange, addCivilDays} from '../../js/domain/execution-period-calendar.js';
import {toMinorUnits} from '../../js/domain/execution-money.js';

const results = [];
function test(name, fn) {
  try { const detail = fn(); results.push({name, status: 'PASS', detail: detail ?? null}); }
  catch (error) { results.push({name, status: 'FAIL', error: String(error?.stack || error)}); }
}
function eq(actual, expected, label = '') {
  if (actual !== expected) throw new Error(`${label}: expected ${expected} got ${actual}`);
  return actual;
}
const M = major => toMinorUnits(major, 'EGP');
const MONTHLY = {unit: 'MONTH', periodBasis: 'ANNIVERSARY', monthEndPolicy: 'CLAMP_TO_LAST_DAY'};

// ---------- fixtures ----------
function obligation(extra = {}) {
  return {id: 'obl_1', executionId: 'ex_1', obligationType: 'نفقة', frequency: 'monthly', currency: 'EGP',
    startDate: '2025-01-01', anchorDate: '2025-01-01', periodBasis: 'ANNIVERSARY', ...extra};
}
function slice(id, judgmentId, startDate, amountMajor, extra = {}) {
  return {id, obligationId: 'obl_1', judgmentId, startDate, amountMinor: M(amountMajor), currency: 'EGP', status: 'active', valueType: 'periodic', sequence: Number(id.replace(/\D/g, '')) || 0, ...extra};
}
let periodSeq = 0;
function recognize(obl, slices, fromDate, toDate) {
  const claim = resolveExecutionClaim({obligation: obl, valuePeriods: slices, fromDate, toDate});
  if (claim.decisions.length) throw new Error(`unexpected decisions ${JSON.stringify(claim.decisions)}`);
  return {
    id: `per_${++periodSeq}`, executionId: 'ex_1', obligationId: obl.id, status: 'RECOGNIZED',
    periodKey: `${obl.id}|${fromDate}|${toDate}`, fromDate, toDate, currency: 'EGP',
    recognizedAmountMinor: claim.recognizedAmountMinor, recognizedAt: '2026-01-01T00:00:00.000Z',
    sourceJudgmentIds: [...new Set(slices.map(s => s.judgmentId))], sourceValuePeriodIds: slices.map(s => s.id),
    unitCount: claim.periods.length
  };
}
function collection(id, amountMajor, date = '2025-12-01') {
  return {id: `led_${id}`, type: 'COLLECTION', receiptId: `rc_${id}`, amountMinor: M(amountMajor), currency: 'EGP', date};
}
function allocation(id, receiptId, periodKey, amountMinor) {
  return {id, receiptId, periodKey, amountMinor, currency: 'EGP', isActive: true, createdAt: '2026-01-01T00:00:00.000Z'};
}
function differencesFrom(analysis, status, settlementId = 'set_1', judgmentId = 'jB') {
  return analysis.rows.map((row, i) => ({
    id: `diff_${settlementId}_${i}`, accountingModel: FEAS_MODEL, status, settlementId, periodKey: row.periodKey,
    executionPeriodId: row.executionPeriodId, judgmentId, sourceJudgmentId: judgmentId, differenceAmountMinor: row.differenceMinor,
    currency: 'EGP', createdAt: '2026-02-01T00:00:00.000Z', decidedAt: status === 'APPROVED' ? '2026-02-02T00:00:00.000Z' : ''
  }));
}

// ---------- §35 Golden Example ----------
test('§35 GOLDEN: 27,000 + 30,000 − 10,000 = 47,000 → judgment B 4,000 from 01/06/2025 → 71,000 / 61,000 (never 75,000)', () => {
  const obl = obligation();
  const sA = slice('v1', 'jA', '2025-01-01', 3000);
  const p1 = recognize(obl, [sA], '2025-01-01', '2025-09-30');
  const p2 = recognize(obl, [sA], '2025-10-01', '2026-07-31');
  eq(p1.recognizedAmountMinor, M(27000), 'P1 recognized'); eq(p1.unitCount, 9, 'P1 units');
  eq(p2.recognizedAmountMinor, M(30000), 'P2 recognized'); eq(p2.unitCount, 10, 'P2 units');
  const led = [collection('a', 10000)];
  const alloc = [allocation('al1', 'rc_a', p1.periodKey, M(10000))];
  const before = calculateFeasBalance({executionPeriods: [p1, p2], allocations: alloc, ledger: led});
  eq(before.remainingMinor, M(47000), 'balance before B');

  // Judgment B: user-selected effective date 2025-06-01 (closes A at 2025-05-31 implicitly by next-start rule).
  const sB = slice('v2', 'jB', '2025-06-01', 4000);
  const analysis = analyzeFeasValueChange({obligation: obl, valuePeriods: [sA, sB], executionPeriods: [p1, p2], allocations: alloc, candidateValuePeriodId: 'v2'});
  const r1 = analysis.rows.find(r => r.executionPeriodId === p1.id), r2 = analysis.rows.find(r => r.executionPeriodId === p2.id);
  eq(r1.newValueMinor, M(31000), 'P1 correct'); eq(r1.differenceMinor, M(4000), 'P1 delta');
  eq(r2.newValueMinor, M(40000), 'P2 correct'); eq(r2.differenceMinor, M(10000), 'P2 delta');
  eq(analysis.totalsMinor.difference, M(14000), 'total delta');

  // Pending (REVIEWED) impact does NOT enter the approved balance.
  const pending = calculateFeasBalance({executionPeriods: [p1, p2], allocations: alloc, ledger: led, differences: differencesFrom(analysis, 'REVIEWED')});
  eq(pending.remainingMinor, M(47000), 'approved balance while pending');
  eq(pending.pendingDifferencesMinor, M(14000), 'pending impact');
  eq(pending.remainingMinor + pending.pendingDifferencesMinor, M(61000), 'projected');

  const approved = calculateFeasBalance({executionPeriods: [p1, p2], allocations: alloc, ledger: led, differences: differencesFrom(analysis, 'APPROVED')});
  eq(approved.finalEntitlementMinor, M(71000), 'effective entitlement');
  eq(approved.remainingMinor, M(61000), 'outstanding after approval');
  eq(approved.pendingDifferencesMinor, 0, 'no pending after approval');
  if (approved.remainingMinor === M(75000) || approved.remainingMinor === M(75000) - M(0)) throw new Error('double counting 75,000');

  // Re-analysis after approval must yield zero further delta (Difference never added twice).
  const again = analyzeFeasValueChange({obligation: obl, valuePeriods: [sA, sB], executionPeriods: [p1, p2], allocations: alloc, differences: differencesFrom(analysis, 'APPROVED'), candidateValuePeriodId: 'v2'});
  eq(again.rows.length, 0, 'second analysis rows'); eq(again.totalsMinor.difference, 0, 'second analysis delta');

  // Duplicate approved delta for same settlement+period must block, not double-count.
  let blocked = false;
  try { calculateFeasBalance({executionPeriods: [p1, p2], allocations: alloc, ledger: led, differences: [...differencesFrom(analysis, 'APPROVED'), ...differencesFrom(analysis, 'APPROVED')]}); }
  catch { blocked = true; }
  eq(blocked, true, 'duplicate delta blocked');
  return {before: before.remaining, pendingImpact: pending.differences.pending, effective: approved.finalEntitlement, outstanding: approved.remaining};
});

// ---------- G1..G12 ----------
test('G1 fixed 70,000 + collection 70,000 → outstanding 0', () => {
  const obl = obligation({id: 'obl_1', obligationType: 'متعة'});
  const fixed = slice('v1', 'jA', '2025-01-01', 70000, {valueType: 'fixed'});
  const p = recognize(obl, [fixed], '2025-01-01', '2025-01-31');
  eq(p.recognizedAmountMinor, M(70000), 'fixed recognized');
  const b = calculateFeasBalance({executionPeriods: [p], allocations: [allocation('a', 'rc_a', p.periodKey, M(70000))], ledger: [collection('a', 70000)]});
  eq(b.remainingMinor, 0, 'outstanding'); eq(b.creditMinor, 0, 'credit'); eq(b.unallocatedMinor, 0, 'unallocated');
});
test('G2 anchor 05/10/2026: at 05/10 nothing due, running 05/10→04/11', () => {
  eq(completedPeriods('2026-10-05', '2026-10-05', MONTHLY).length, 0, 'completed');
  const run = runningPeriod('2026-10-05', '2026-10-05', MONTHLY);
  eq(run.from, '2026-10-05', 'from'); eq(run.to, '2026-11-04', 'to');
  eq(periodStart('2026-10-05', 2, MONTHLY), '2026-12-05', 'k2'); eq(periodEnd('2026-10-05', 2, MONTHLY), '2027-01-04', 'k2 end');
});
test('G3 at 04/11/2026 → 1 completed period = 3,000', () => {
  const done = completedPeriods('2026-10-05', '2026-11-04', MONTHLY);
  eq(done.length, 1, 'completed');
  const obl = obligation({startDate: '2026-10-05', anchorDate: '2026-10-05'});
  const claim = resolveExecutionClaim({obligation: obl, valuePeriods: [slice('v1', 'jA', '2026-10-05', 3000)], fromDate: '2026-10-05', toDate: '2026-11-04'});
  eq(claim.recognizedAmountMinor, M(3000), 'value of one full period');
});
test('G4 9 × 3,000 = 27,000 then collection 27,000 → 0', () => {
  const obl = obligation(); const p = recognize(obl, [slice('v1', 'jA', '2025-01-01', 3000)], '2025-01-01', '2025-09-30');
  eq(p.recognizedAmountMinor, M(27000), '27,000');
  const plan = planFeasAllocation({periods: [{periodKey: p.periodKey, remainingMinor: p.recognizedAmountMinor, fromDate: p.fromDate}], amountMinor: M(27000), method: 'FIFO'});
  const b = calculateFeasBalance({executionPeriods: [p], allocations: plan.lines.map((l, i) => allocation(`a${i}`, 'rc_a', l.periodKey, l.amountMinor)), ledger: [collection('a', 27000)]});
  eq(b.remainingMinor, 0, 'outstanding');
});
test('G5 anchor 31/01 clamps without drift (31/01 → 28/02 → 31/03)', () => {
  eq(periodStart('2025-01-31', 1, MONTHLY), '2025-02-28', 'k1'); eq(periodStart('2025-01-31', 2, MONTHLY), '2025-03-31', 'k2 no drift');
  eq(periodStart('2024-01-31', 1, MONTHLY), '2024-02-29', 'leap'); eq(periodEnd('2025-01-31', 0, MONTHLY), '2025-02-27', 'k0 end');
  const obl = obligation({startDate: '2025-01-31', anchorDate: '2025-01-31'});
  const claim = resolveExecutionClaim({obligation: obl, valuePeriods: [slice('v1', 'jA', '2025-01-31', 3000)], fromDate: '2025-01-31', toDate: '2025-04-29'});
  eq(claim.periods.length, 3, 'three full periods'); eq(claim.recognizedAmountMinor, M(9000), 'not prorated by days');
});
test('G6/G7/G12 changes 3000→4000, 4000→3000 (credit candidate), 3000→4000→5000', () => {
  const obl = obligation(); const sA = slice('v1', 'jA', '2025-01-01', 3000);
  const p = recognize(obl, [sA], '2025-01-01', '2025-06-30'); // 6 × 3000 = 18000
  const sB = slice('v2', 'jB', '2025-04-01', 4000);
  const a1 = analyzeFeasValueChange({obligation: obl, valuePeriods: [sA, sB], executionPeriods: [p], candidateValuePeriodId: 'v2'});
  eq(a1.totalsMinor.difference, M(3000), 'G6 +3000');
  const d1 = differencesFrom(a1, 'APPROVED', 's1', 'jB');
  const sC = slice('v3', 'jC', '2025-05-01', 5000);
  const a2 = analyzeFeasValueChange({obligation: obl, valuePeriods: [sA, sB, sC], executionPeriods: [p], differences: d1, candidateValuePeriodId: 'v3'});
  eq(a2.totalsMinor.difference, M(2000), 'G12 incremental +2000 (May,Jun each +1000)');
  const b12 = calculateFeasBalance({executionPeriods: [p], ledger: [], differences: [...d1, ...differencesFrom(a2, 'APPROVED', 's2', 'jC')]});
  eq(b12.finalEntitlementMinor, M(3 * 3000 + 4000 + 2 * 5000), 'G12 effective 23,000');
  // G7: 4000 → 3000 reduction, with 24,000 already collected+allocated.
  const s4 = slice('v1', 'jA', '2025-01-01', 4000); const p4 = recognize(obl, [s4], '2025-01-01', '2025-06-30');
  const al = [allocation('x', 'rc_x', p4.periodKey, M(24000))];
  const s3 = slice('v2', 'jB', '2025-04-01', 3000);
  const a3 = analyzeFeasValueChange({obligation: obl, valuePeriods: [s4, s3], executionPeriods: [p4], allocations: al, candidateValuePeriodId: 'v2'});
  eq(a3.totalsMinor.difference, -M(3000), 'G7 −3000');
  const b7 = calculateFeasBalance({executionPeriods: [p4], allocations: al, ledger: [collection('x', 24000)], differences: differencesFrom(a3, 'APPROVED')});
  eq(b7.remainingMinor, 0, 'G7 outstanding not negative'); eq(b7.creditMinor, M(3000), 'G7 credit candidate visible');
  eq(b7.collectedMinor, M(24000), 'G7 receipt untouched');
});
test('G8 early payment: nothing recognized → due 0, receipt stays unallocated/prepaid', () => {
  const plan = planFeasAllocation({periods: [], amountMinor: M(3000), method: 'FIFO'});
  eq(plan.allocatedMinor, 0, 'no silent allocation'); eq(plan.unallocatedMinor, M(3000), 'unallocated');
  const b = calculateFeasBalance({executionPeriods: [], ledger: [collection('e', 3000, '2026-10-06')]});
  eq(b.remainingMinor, 0, 'due today 0'); eq(b.unallocatedMinor, M(3000), 'shown as unallocated (prepaid)');
});
test('G9 partial receipt 1,500 on 3,000 → remaining 1,500', () => {
  const obl = obligation(); const p = recognize(obl, [slice('v1', 'jA', '2025-01-01', 3000)], '2025-01-01', '2025-01-31');
  const b = calculateFeasBalance({executionPeriods: [p], allocations: [allocation('a', 'rc_a', p.periodKey, M(1500))], ledger: [collection('a', 1500)]});
  eq(b.remainingMinor, M(1500), 'remaining'); eq(b.periods[0].allocatedMinor, M(1500), 'allocated');
});
test('G10 overpayment: due 6,000 collected 8,000 → outstanding 0, credit 2,000, unallocated 2,000', () => {
  const obl = obligation(); const p = recognize(obl, [slice('v1', 'jA', '2025-01-01', 3000)], '2025-01-01', '2025-02-28');
  const plan = planFeasAllocation({periods: [{periodKey: p.periodKey, remainingMinor: p.recognizedAmountMinor, fromDate: p.fromDate}], amountMinor: M(8000), method: 'FIFO'});
  eq(plan.allocatedMinor, M(6000), 'allocation capped at period'); eq(plan.unallocatedMinor, M(2000), 'rest not allocated');
  const b = calculateFeasBalance({executionPeriods: [p], allocations: plan.lines.map((l, i) => allocation(`a${i}`, 'rc_a', l.periodKey, l.amountMinor)), ledger: [collection('a', 8000)]});
  eq(b.remainingMinor, 0, 'outstanding'); eq(b.creditMinor, M(2000), 'credit'); eq(b.unallocatedMinor, M(2000), 'unallocated');
});
test('G11 POA does not create debt: POA ledger/snapshot rows ignored by balance', () => {
  const obl = obligation(); const p = recognize(obl, [slice('v1', 'jA', '2025-01-01', 17000 / 1)], '2025-01-01', '2025-01-31');
  const base = calculateFeasBalance({executionPeriods: [p], ledger: []});
  const withPoa = calculateFeasBalance({executionPeriods: [p], ledger: [{id: 'poa_doc', type: 'POA_ISSUED', poaId: 'poa_1', amountMinor: M(17000), currency: 'EGP', date: '2025-02-01'}]});
  eq(base.remainingMinor, M(17000), 'before'); eq(withPoa.remainingMinor, M(17000), 'after POA (not 34,000)');
});
test('Allocation guards: over-period allocation rejected; over-receipt impossible', () => {
  let threw = false;
  try { planFeasAllocation({periods: [{periodKey: 'k', remainingMinor: 100}], amountMinor: 500, method: 'DIRECT', targets: [{periodKey: 'k', amountMinor: 200}]}); } catch { threw = true; }
  eq(threw, true, 'over period rejected');
});
test('Duration tool: partial boundary periods reported, never prorated', () => {
  const obl = obligation({startDate: '2026-10-05', anchorDate: '2026-10-05'});
  const claim = resolveExecutionClaim({obligation: obl, valuePeriods: [slice('v1', 'jA', '2026-10-05', 3000)], fromDate: '2026-10-20', toDate: '2027-01-10'});
  eq(claim.periods.length, 2, 'full periods inside'); eq(claim.recognizedAmountMinor, M(6000), 'only full');
  eq(claim.partials.length, 2, 'partials surfaced'); if (!claim.decisions.length) throw new Error('decision required');
  for (const v of [M(2612.90), M(5612.90), M(600)]) if (claim.recognizedAmountMinor === v) throw new Error('prorated value');
});
test('Period key is anchor + k (stable, not calendar month)', () => {
  eq(recognitionPeriodKey('obl_123', '2026-10-05', 2), 'feas::obl_123::2026-10-05::2', 'key');
});

// ---------- Property-based ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
test('PROPERTY ×5000: period[k].end + 1 = period[k+1].start; full period value = unit value', () => {
  const r = rng(42); let checked = 0;
  for (let i = 0; i < 5000; i += 1) {
    const y = 2000 + Math.floor(r() * 60), m = 1 + Math.floor(r() * 12), d = 1 + Math.floor(r() * 31);
    const maxD = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const anchor = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, maxD)).padStart(2, '0')}`;
    const k = Math.floor(r() * 120);
    eq(addCivilDays(periodEnd(anchor, k, MONTHLY), 1), periodStart(anchor, k + 1, MONTHLY), `contiguity ${anchor} k${k}`);
    if (i % 25 === 0) {
      const unitMajor = 1 + Math.floor(r() * 9000);
      const obl = obligation({startDate: anchor, anchorDate: anchor});
      const claim = resolveExecutionClaim({obligation: obl, valuePeriods: [slice('v1', 'jA', anchor, unitMajor)], fromDate: periodStart(anchor, k, MONTHLY), toDate: periodEnd(anchor, k, MONTHLY)});
      eq(claim.recognizedAmountMinor, M(unitMajor), `unit value ${anchor} k${k}`);
    }
    checked += 1;
  }
  return {checked};
});
test('PROPERTY ×2000: allocations ≤ receipt and ≤ period for FIFO/PROPORTIONAL', () => {
  const r = rng(7);
  for (let i = 0; i < 2000; i += 1) {
    const periods = Array.from({length: 1 + Math.floor(r() * 12)}, (_, j) => ({periodKey: `p${j}`, fromDate: `2025-${String(1 + (j % 12)).padStart(2, '0')}-01`, remainingMinor: 1 + Math.floor(r() * 500000)}));
    const amountMinor = 1 + Math.floor(r() * 3000000);
    for (const method of ['FIFO', 'PROPORTIONAL']) {
      const plan = planFeasAllocation({periods, amountMinor, method});
      if (plan.allocatedMinor > amountMinor) throw new Error('over receipt');
      for (const line of plan.lines) if (line.amountMinor > periods.find(p => p.periodKey === line.periodKey).remainingMinor) throw new Error('over period');
      eq(plan.allocatedMinor + plan.unallocatedMinor, amountMinor, 'conservation');
    }
  }
});

const pass = results.filter(r => r.status === 'PASS').length;
for (const r of results) console.log(`${r.status === 'PASS' ? '✓' : '✗'} ${r.name}${r.error ? `\n   ${r.error.split('\n')[0]}` : ''}`);
console.log(`\n${pass}/${results.length} PASS`);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../docs/feas-golden-results.json');
writeFileSync(out, JSON.stringify({ranAt: new Date().toISOString(), node: process.version, pass, total: results.length, results}, null, 2));
process.exitCode = pass === results.length ? 0 : 1;
