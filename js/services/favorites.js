// تثبيت الملفات والسياقات المهمة — تفضيل مستخدم فقط، لا يمس سجلات المكتب.
// تظل التفضيلات منفصلة بحسب قاعدة المكتب النشطة لمنع روابط عابرة لقواعد البيانات.
import {prefs,scopedPreferenceKey} from '../core/preferences.js';

const KEY='ui:favorites';
const MAX=24;
const prefKey=scope=>scopedPreferenceKey(KEY,scope);

export function getFavorites(scope=''){
 const v=prefs.get(prefKey(scope),[]);
 return Array.isArray(v)?v.filter(x=>x&&x.route):[];
}
export function isFavorite(route,scope=''){return getFavorites(scope).some(x=>x.route===route)}
export async function removeFavorite(route,scope=''){
 if(!route)return getFavorites(scope);
 const key=prefKey(scope),next=getFavorites(scope).filter(x=>x.route!==route);
 await prefs.set(key,next);
 return next;
}
export async function toggleFavorite(item,scope=''){
 if(!item?.route)return false;
 const had=isFavorite(item.route,scope),key=prefKey(scope);
 const next=getFavorites(scope).filter(x=>x.route!==item.route);
 if(!had)next.unshift({route:item.route,title:item.title||item.route,sub:item.sub||'',at:new Date().toISOString()});
 await prefs.set(key,next.slice(0,MAX));
 return !had;
}
