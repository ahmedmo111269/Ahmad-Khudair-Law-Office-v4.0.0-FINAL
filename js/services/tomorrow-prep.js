// ============================================================
// تحضير الغد — إشارة تشغيلية صغيرة، لا لوحة ثانية.
// تعرض فقط بعد الوقت المضبوط، مع عناصر غدٍ، وعند وجود فجوة واضحة قابلة للتصرف.
// الفجوات الحالية: جلسة غدٍ بلا ملف مرتبط أو بلا وقت محدد.
// ============================================================
const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);

export function tomorrowPrepCandidate(brief, {now = '00:00', after = '17:00'} = {}) {
  if (!validTime(now) || !validTime(after) || now < after) return null;
  const tomorrow = brief?.periods?.tomorrow;
  if (!tomorrow) return null;
  const items = [
    ...(brief.upcomingHearings || []),
    ...(brief.upcomingProcedures || []),
    ...(brief.appointmentsNext3 || [])
  ];
  if (!items.some(item => item.hearingDate === tomorrow || item.internalDueDate === tomorrow || item.date === tomorrow)) return null;
  const hearings = (brief.upcomingHearings || []).filter(item => item.hearingDate === tomorrow);
  const missingFile = hearings.find(item => !item.fileId);
  if (missingFile) return {kind: 'missingFile', item: missingFile, tomorrow};
  const missingTime = hearings.find(item => !String(item.hearingTime || '').trim());
  if (missingTime) return {kind: 'missingTime', item: missingTime, tomorrow};
  return null;
}
