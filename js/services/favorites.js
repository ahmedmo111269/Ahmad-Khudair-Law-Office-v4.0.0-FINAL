// تثبيت الملفات والسياقات المهمة — تفضيل مستخدم فقط، لا يمس سجلات المكتب.
import {prefs} from '../core/preferences.js';

const KEY='ui:favorites';
const MAX=24;

export function getFavorites(){
 const v=prefs.get(KEY,[]);
 return Array.isArray(v)?v.filter(x=>x&&x.route):[];
}
export function isFavorite(route){return getFavorites().some(x=>x.route===route)}
export async function toggleFavorite(item){
 if(!item?.route)return false;
 const had=isFavorite(item.route);
 const next=getFavorites().filter(x=>x.route!==item.route);
 if(!had)next.unshift({route:item.route,title:item.title||item.route,sub:item.sub||'',at:new Date().toISOString()});
 await prefs.set(KEY,next.slice(0,MAX));
 return !had;
}
