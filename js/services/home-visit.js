// =====================================================================
// «منذ آخر زيارة» — وقت مغادرة مكتب اليوم، في التفضيلات الموجودة فقط.
// ---------------------------------------------------------------------
// • المفتاح: scopedPreferenceKey('ui:home:last-seen', scope) — لا Store ولا Schema جديد.
// • لا يكتب Activity Log ولا يُكتب عند كل رسم: يُكتب عند مغادرة الصفحة أو إخفاء التبويب فقط.
// • منع الاستبدال بقيمة أقدم عبر تبويبين: القراءة تتم من مرآة localStorage المشتركة
//   بين التبويبات (لا من الذاكرة المحلية للتبويب)، والكتابة تحدث فقط إذا كان الوقت الجديد أحدث.
// • أول تشغيل بلا قيمة: لا يوجد baseline ⇒ لا يظهر القسم.
// =====================================================================
import {prefs,scopedPreferenceKey,MIRROR_PREFIX} from '../core/preferences.js';
import {HOME_LIMITS} from './work-config.js';

export const HOME_SEEN_KEY='ui:home:last-seen';

const tsOf=v=>{const t=Date.parse(String(v||''));return Number.isFinite(t)?t:NaN};

/** القيمة المخزنة الأحدث بين المخزّنة والجديدة (نقية). لا تتراجع القيمة أبدًا. */
export function nextLastSeen(stored,now){
 const n=tsOf(now);
 if(!Number.isFinite(n))return stored||null;
 const s=tsOf(stored);
 if(Number.isFinite(s)&&s>=n)return stored;
 return new Date(n).toISOString();
}

/** القراءة الطازجة من المرآة المشتركة بين التبويبات، مع احتياط للذاكرة المحلية. */
export function readStoredSeen(scope){
 const key=scopedPreferenceKey(HOME_SEEN_KEY,scope);
 try{
  const raw=globalThis.localStorage?.getItem(MIRROR_PREFIX+key);
  if(raw!==null&&raw!==undefined)return JSON.parse(raw);
 }catch{}
 return prefs.get(key,null);
}

/** يسجل مغادرة مكتب اليوم (أو إخفاء التبويب) إن كان الوقت أحدث. يعيد true إن كُتب. */
export async function markHomeSeen(scope,now=new Date()){
 const key=scopedPreferenceKey(HOME_SEEN_KEY,scope);
 const stored=readStoredSeen(scope);
 const next=nextLastSeen(stored,now.toISOString());
 if(!next||next===stored)return false;
 await prefs.set(key,next);
 return true;
}

/**
 * التغييرات منذ baseline: صفوف activityLog الأحدث من baseline فقط، بحد أقصى `limit`.
 * يُستدعى reportRange بحد limit+1 لمعرفة هل هناك المزيد: إن زادت الصفوف عن limit يُعلَن capped=true
 * بدل عدّ غير دقيق. rows بترتيب الأحدث أولًا.
 */
export function sinceChanges(rows=[],baseline=null,limit=HOME_LIMITS.sinceLastVisit){
 const b=tsOf(baseline);
 if(!Number.isFinite(b))return {rows:[],total:0,capped:false};
 const newer=(Array.isArray(rows)?rows:[]).filter(r=>tsOf(r?.timestamp)>b);
 const shown=newer.slice(0,limit);
 return {rows:shown,total:shown.length,capped:newer.length>limit};
}
