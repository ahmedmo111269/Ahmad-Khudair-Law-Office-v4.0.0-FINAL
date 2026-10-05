// Pure-engine benchmark (no IndexedDB, no DOM). Measures calculateFeasBalance compute only.
import {calculateFeasBalance} from '../../js/domain/execution-feas.js';
import {performance} from 'node:perf_hooks';
const EXECUTIONS = Number(process.env.N || 5000), EVENTS = 200;
function build(e) {
  const periods = [], allocations = [], ledger = [];
  for (let k = 0; k < 100; k++) {
    const y = 2010 + Math.floor(k / 12), m = (k % 12) + 1, mm = String(m).padStart(2, '0');
    const key = `p${e}_${k}`;
    periods.push({id: key, periodKey: key, status: 'RECOGNIZED', fromDate: `${y}-${mm}-01`, toDate: `${y}-${mm}-28`, recognizedAmountMinor: 300000, currency: 'EGP'});
    ledger.push({id: `l${e}_${k}`, type: 'COLLECTION', receiptId: `r${e}_${k}`, amountMinor: 200000, currency: 'EGP', date: `${y}-${mm}-28`});
  }
  for (let k = 0; k < 100; k++) allocations.push({id: `a${e}_${k}`, receiptId: `r${e}_${k}`, periodKey: `p${e}_${k}`, amountMinor: 200000, currency: 'EGP', isActive: true});
  return {executionPeriods: periods, allocations: allocations.slice(0, 0).concat(allocations), ledger};
}
const t0 = performance.now(); const sets = Array.from({length: EXECUTIONS}, (_, e) => build(e)); const t1 = performance.now();
let total = 0, worst = 0;
for (const s of sets) { const a = performance.now(); const b = calculateFeasBalance(s); total += b.remainingMinor; worst = Math.max(worst, performance.now() - a); }
const t2 = performance.now();
console.log(JSON.stringify({executions: EXECUTIONS, recordsPerExecution: EVENTS + 100, totalRecords: EXECUTIONS * (EVENTS + 100), buildMs: +(t1 - t0).toFixed(1), allBalancesMs: +(t2 - t1).toFixed(1), avgPerExecutionMs: +((t2 - t1) / EXECUTIONS).toFixed(3), worstSingleMs: +worst.toFixed(2), checksumOutstandingMinor: total, expectedChecksum: EXECUTIONS * 100 * 100000, node: process.version}));
