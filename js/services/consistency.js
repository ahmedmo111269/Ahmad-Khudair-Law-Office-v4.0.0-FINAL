import {AppError,ERR} from '../core/errors.js';

/**
 * Optimistic-concurrency guard.
 * expectedVersion is optional; when supplied, the row must still have that version.
 */
export function assertExpectedVersion(row, expectedVersion, label='السجل') {
  if (expectedVersion === undefined || expectedVersion === null || expectedVersion === '') return;
  const expected=Number(expectedVersion);
  const actual=Number(row?.version||0);
  if (!Number.isInteger(expected) || expected<0 || actual!==expected) {
    throw new AppError(ERR.CONFLICT,`تم تعديل ${label} من نافذة أو مستخدم آخر. أعد فتح السجل ثم حاول مرة أخرى.`,{expectedVersion:expected,actualVersion:actual});
  }
}

export function bumpVersion(row, now) {
  row.version=(Number(row.version)||0)+1;
  row.updatedAt=now;
  return row;
}
