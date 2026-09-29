// آخر ما فتحه المستخدم: حلقة محدودة (12 عنصرًا) في تفضيلات المستخدم، تُحدَّث عند فتح أي سجل.
// هدفها تقليل الخطوات اليومية: الملف الذي يعمل عليه المحامي يُفتح بنقرة واحدة من الرئيسية أو لوحة الأوامر.
import {prefs} from '../core/preferences.js';
const KEY='ui:recents';
const CAP=12;
let cache=null;
export function getRecent(){
 if(cache)return cache;
 const v=prefs.get(KEY,[]);
 cache=Array.isArray(v)?v.filter(x=>x&&x.route&&x.title):[];
 return cache;
}
/** route: مسار التنقل، title: نص العرض، icon: مفتاح أيقونة ui/icons، sub: سطر فرعي اختياري */
export function trackRecent(route,title,{icon='file',sub=''}={}){
 if(!route||!title)return getRecent();
 let list=getRecent().filter(x=>x.route!==route);
 list.unshift({route,title:String(title).slice(0,80),sub:String(sub||'').slice(0,80),icon,at:new Date().toISOString()});
 list=list.slice(0,CAP);
 cache=list;
 prefs.set(KEY,list);
 return list;
}
export function removeRecent(route){cache=getRecent().filter(x=>x.route!==route);prefs.set(KEY,cache);return cache}
export function clearRecent(){cache=[];return prefs.set(KEY,[])}
/** للاختبار: إفراغ الذاكرة المؤقتة دون لمس المخزن */
export function _resetRecentsCache(){cache=null}
