// آخر ما فتحه المستخدم: حلقة محدودة (12 عنصرًا) في تفضيلات المستخدم، تُحدَّث عند فتح أي سجل.
// تُقسَّم حسب قاعدة البيانات النشطة حتى لا تقود اختصارات قاعدة إلى سجل مختلف في قاعدة أخرى.
import {prefs,scopedPreferenceKey} from '../core/preferences.js';

const KEY='ui:recents';
const CAP=12;
const cache=new Map();
const prefKey=scope=>scopedPreferenceKey(KEY,scope);
export function getRecent(scope=''){
 const key=prefKey(scope);
 if(cache.has(key))return cache.get(key);
 const v=prefs.get(key,[]);
 const list=Array.isArray(v)?v.filter(x=>x&&x.route&&x.title):[];
 cache.set(key,list);
 return list;
}
/** route: مسار التنقل، title: نص العرض، icon: مفتاح أيقونة ui/icons، sub: سطر فرعي اختياري */
export function trackRecent(route,title,{icon='file',sub='',scope=''}={}){
 if(!route||!title)return getRecent(scope);
 const key=prefKey(scope);
 let list=getRecent(scope).filter(x=>x.route!==route);
 list.unshift({route,title:String(title).slice(0,80),sub:String(sub||'').slice(0,80),icon,at:new Date().toISOString()});
 list=list.slice(0,CAP);
 cache.set(key,list);
 prefs.set(key,list);
 return list;
}
export function removeRecent(route,scope=''){
 const key=prefKey(scope),list=getRecent(scope).filter(x=>x.route!==route);
 cache.set(key,list);prefs.set(key,list);return list;
}
export function clearRecent(scope=''){
 const key=prefKey(scope);cache.set(key,[]);return prefs.set(key,[]);
}
/** للاختبار: إفراغ الذاكرة المؤقتة دون لمس المخزن */
export function _resetRecentsCache(){cache.clear()}
