export class AppError extends Error{constructor(code,message,details=null){super(message);this.name='AppError';this.code=code;this.details=details}}
export const ERR={VALIDATION:'VAL_INVALID',REQUIRED:'VAL_REQUIRED_FIELD',NATIONAL_ID:'VAL_INVALID_NATIONAL_ID',DATE:'VAL_INVALID_DATE',NOT_FOUND:'DB_NOT_FOUND',CONFLICT:'DB_CONFLICT',STALE:'DB_CONTEXT_STALE',OPEN:'DB_OPEN_FAILED',BLOCKED:'DB_BLOCKED',QUOTA:'STO_QUOTA_EXCEEDED',TX:'TX_ROLLBACK',MIGRATION:'MIG_FAILED',UNKNOWN:'APP_UNKNOWN',OFFLINE:'APP_OFFLINE'};
export function normalizeError(e){
  if(e?.code)return e;
  const name=e?.name||'';
  if(name==='QuotaExceededError')return new AppError(ERR.QUOTA,'مساحة التخزين المحلية غير كافية. أنشئ نسخة احتياطية ثم حرر مساحة أو أنشئ قاعدة بيانات أرشيفية.',e);
  if(name==='InvalidStateError')return new AppError(ERR.STALE,'اتصال قاعدة البيانات الحالي غير صالح أو أُغلق. أعد فتح القاعدة ثم حاول مرة أخرى.',e);
  if(name==='TransactionInactiveError')return new AppError(ERR.TX,'انتهت معاملة قاعدة البيانات قبل اكتمال العملية. لم يتم اعتماد التغيير.',e);
  if(name==='ConstraintError')return new AppError(ERR.CONFLICT,'تعذر حفظ السجل بسبب تعارض في البيانات أو مفتاح مكرر.',e);
  if(name==='AbortError')return new AppError(ERR.TX,'تم إيقاف عملية قاعدة البيانات. لم يتم اعتماد التغيير.',e);
  return new AppError(ERR.UNKNOWN,'حدث خطأ غير متوقع. راجع وحدة التشخيص إذا تكرر الخطأ.',e);
}
export function userError(e){return normalizeError(e).message}
