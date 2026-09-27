// Local calendar date (YYYY-MM-DD). toISOString() is UTC and returns the wrong day near midnight in Egypt (UTC+2/+3).
export function localDate(d=new Date()){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
export function addDays(day,n){const d=new Date(`${day}T00:00:00`);d.setDate(d.getDate()+n);return localDate(d)}
export const Clock={now:()=>new Date().toISOString(),today:()=>localDate()};
// Procedure/task statuses that still need work. The forms default to 'open'; older data used 'pending'.
export const ACTIVE_PROCEDURE_STATUSES=['open','pending'];
export const isActiveProcedure=x=>!x?.status||ACTIVE_PROCEDURE_STATUSES.includes(x.status);
