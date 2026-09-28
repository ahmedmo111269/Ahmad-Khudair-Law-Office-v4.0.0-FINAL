// تنسيق موحّد للعرض في كل البرنامج: التاريخ دائمًا يوم/شهر/سنة (DD/MM/YYYY).
// التخزين يبقى ISO (YYYY-MM-DD) لضمان صحة الفرز وقابلية النقل إلى SQLite/Postgres.
const p2=n=>String(n).padStart(2,'0');
const ISO=/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/;
/** 2026-09-28 أو ISO كامل أو Date → 28/09/2026 */
export function formatDate(v){
 if(v===null||v===undefined||v==='')return '';
 if(typeof v==='string'){const m=ISO.exec(v);if(m&&!v.includes('T'))return `${m[3]}/${m[2]}/${m[1]}`}
 const d=v instanceof Date?v:new Date(v);if(isNaN(d))return String(v);
 return `${p2(d.getDate())}/${p2(d.getMonth()+1)}/${d.getFullYear()}`;
}
export function formatTime(v){if(!v)return '';if(/^\d{1,2}:\d{2}/.test(String(v)))return String(v).slice(0,5);const d=new Date(v);if(isNaN(d)||!String(v).includes('T'))return '';return `${p2(d.getHours())}:${p2(d.getMinutes())}`}
export function formatDateTime(v){if(!v)return '';const d=new Date(v);if(isNaN(d))return String(v);return `${formatDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}`}
/** 28/09/2026 أو 28-9-2026 أو 28.9.26 → 2026-09-28 (أو '' إن كان غير صالح) */
export function parseDisplayDate(s){
 const t=String(s||'').trim().replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d));if(!t)return '';
 if(ISO.test(t))return t.slice(0,10);
 const m=/^(\d{1,2})[\/\-.\s](\d{1,2})[\/\-.\s](\d{2}|\d{4})$/.exec(t);if(!m)return '';
 let [,d,mo,y]=m;if(y.length===2)y=(Number(y)>60?'19':'20')+y;
 const dt=new Date(Number(y),Number(mo)-1,Number(d));
 if(dt.getFullYear()!==Number(y)||dt.getMonth()!==Number(mo)-1||dt.getDate()!==Number(d))return '';
 return `${y}-${p2(mo)}-${p2(d)}`;
}
export const formatNumber=(n,opts)=>new Intl.NumberFormat('ar-EG',opts).format(Number(n)||0);
export const formatMoney=(n,cur='ج.م')=>`${formatNumber(n,{maximumFractionDigits:2})} ${cur}`.trim();
