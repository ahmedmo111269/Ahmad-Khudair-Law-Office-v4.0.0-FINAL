// Backward-compatible names for the shared pure execution-period calendar.
// New accounting code should import execution-period-calendar.js directly.
import {
  addCivilDays, addMonthsClamped, daysInCivilMonth, daysInclusive,
  enumerateExecutionUnits, executionPeriodEnd, executionPeriodStart,
  isCivilDate
} from './execution-period-calendar.js';

export {addCivilDays, daysInCivilMonth, enumerateExecutionUnits, executionPeriodEnd, executionPeriodStart, isCivilDate};
export const addCivilMonths = addMonthsClamped;
export const civilDaysInclusive = (fromDate, toDate) => isCivilDate(fromDate) && isCivilDate(toDate) ? daysInclusive(fromDate, toDate) : 0;
