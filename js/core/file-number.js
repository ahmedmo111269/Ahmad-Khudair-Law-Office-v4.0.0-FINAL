// =====================================================================
// تنسيق أرقام الملفات — المصدر الوحيد لعرض أرقام الملفات في كل التطبيق.
// =====================================================================
// قواعد العرض للمستخدم (لا تُغيّر المعرّفات التقنية المخزنة):
//   • الملف الرئيسي (ملف الموكل — كود تقني داخلي مثل CL-2026-000002)
//     يُعرض للمستخدم: «ملف رئيسي: 2/2026»
//   • الملف الفرعي (الملف القانوني — كود تقني داخلي مثل LF-2026-000001
//     أو الصيغة القديمة 2026/0001) يُعرض: «ملف فرعي: 1/2026»
//   • السنة في الرقم هي سنة إنشاء الملف، والترقيم يبدأ من 1 لكل سنة،
//     وعداد الملفات الرئيسية مستقل تمامًا عن عداد الملفات الفرعية.
//   • لا يُعرض الكود التقني (CL-/LF-) للمستخدم إلا كتلميح ثانوي عند الحاجة
//     (البحث يظل يعمل بالأكواد التقنية لأن الفهارس تحتفظ بالقيمة الأصلية).
// ملاحظة مهمة: هذا الرقم هو الرقم الداخلي للمكتب فقط، وهو منفصل كليًا عن
// رقم القضية / المحضر / الدعوى لدى الجهة الرسمية (caseNumber وما شابه).
const AR_DIGITS='٠١٢٣٤٥٦٧٨٩';
const toLatin=s=>String(s??'').replace(/[٠-٩]/g,d=>AR_DIGITS.indexOf(d)).trim();

/** تحليل أي صيغة رقم ملف إلى مكوناتها. يعيد {kind, year, seq, raw} أو null. */
export function parseFileNumber(value){
 const raw=String(value??'').trim();
 if(!raw)return null;
 const v=toLatin(raw);
 // أكواد تقنية: CL-2026-000002 (رئيسي) / LF-2026-000001 (فرعي) / SR-2026-000005 (إعلان)
 let m=/^(CL|LF|SR)-(\d{4})-(\d+)$/i.exec(v);
 if(m){const p=m[1].toUpperCase();return {kind:p==='CL'?'main':p==='LF'?'sub':'service',year:Number(m[2]),seq:Number(m[3]),raw}}
 // الصيغة القديمة للملفات: 2026/0001 أو 2026/1 (السنة أولًا وبداية معقولة فقط،
 // حتى لا يُفسَّر رقم قضية رسمي مثل 1545/2026 عن طريق الخطأ)
 m=/^((?:19|20)\d{2})\s*[\/\\]\s*(\d{1,6})$/.exec(v);
 if(m)return {kind:'sub',year:Number(m[1]),seq:Number(m[2]),raw};
 return null;
}

/** نوع سجل الملف: 'main' لملف الموكل، 'sub' للملف القانوني، 'service' للإعلانات. */
export function fileNumberKind(record){
 if(!record||typeof record!=='object')return null;
 if(record.clientCode!==undefined&&record.fileNumber===undefined&&record.clientId!==undefined)return 'main';
 const p=parseFileNumber(record.fileNumber??record.clientCode??record.internalNumber);
 return p?.kind||null;
}

/**
 * الدالة المركزية: تنسيق رقم ملف للعرض.
 * تقبل سجلًا (ملف قانوني بحقل fileNumber أو ملف موكل/موكل بحقل clientCode)
 * أو نصًا خامًا. الخيارات:
 *   withKind: سابقة «ملف رئيسي:» / «ملف فرعي:»
 *   labelOnly: نوع الملف فقط («رئيسي»/«فرعي») — مفيد للشارات الصغيرة.
 */
export function formatFileNumber(record,{withKind=false}={}){
 const value=record&&typeof record==='object'?(record.fileNumber??record.clientCode??record.internalNumber):record;
 const p=parseFileNumber(value);
 if(!p)return String(value??'').trim();
 const num=`${p.seq}/${p.year}`;
 if(!withKind)return num;
 const name=p.kind==='main'?'ملف رئيسي':p.kind==='sub'?'ملف فرعي':'إعلان';
 return `${name}: ${num}`;
}

/** تسمية النوع فقط: «رئيسي» أو «فرعي» أو ''. */
export function fileKindLabel(record){
 const kind=record&&typeof record==='object'?fileNumberKind(record):(parseFileNumber(record)?.kind||null);
 return kind==='main'?'رئيسي':kind==='sub'?'فرعي':'';
}
const KIND_NAMES={main:'ملف رئيسي',sub:'ملف فرعي',service:'إعلان'};

/** رقم الملف الداخلي / نوعه فقط. Never include the title or a person's name. */
export function formatLegalFile(record, {typeName = ''} = {}){
 if(!record)return '';
 const number=formatFileNumber(record);
 const type=String(typeName||record.fileType||record.typeSnapshot?.type||'').trim();
 return [number,type].filter(Boolean).join(' — ');
}

/** رقم القضية / المرحلة لدى الجهة الرسمية — منفصل تمامًا عن رقم الملف الداخلي. */
export function formatOfficialNumber(caseRow){
 if(!caseRow)return '';
 const n=String(caseRow.caseNumber??'').trim(),y=String(caseRow.caseYear??'').trim();
 if(!n&&!y)return '';
 return n&&y?`${n}/${y}`:(n||y);
}

/**
 * شارة موحدة لرقم الملف داخل البطاقات والعناوين (HTML).
 * تميّز بصريًا بين الرئيسي والفرعي مع تلميح بالكود التقني عند الحاجة.
 */
export function fileNumberChip(record,{withKind=true}={}){
 const value=record&&typeof record==='object'?(record.fileNumber??record.clientCode??record.internalNumber):record;
 const p=parseFileNumber(value);
 const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 if(!p){
  const t=String(value??'').trim();
  return t?`<span class="fno fno-plain" dir="ltr">${esc(t)}</span>`:'';
 }
 const kind=p.kind; // main | sub | service
 const kindName=KIND_NAMES[kind];
 const shortKind=kind==='main'?'رئيسي':kind==='sub'?'فرعي':'إعلان';
 return `<span class="fno fno-${kind}" title="${kindName} — ${p.seq}/${p.year}${p.raw!==`${p.seq}/${p.year}`?` (الكود الداخلي: ${esc(p.raw)})`:''}">${withKind?`<i class="fno-kind">${shortKind}</i>`:''}<b dir="ltr">${p.seq}/${p.year}</b></span>`;
}
