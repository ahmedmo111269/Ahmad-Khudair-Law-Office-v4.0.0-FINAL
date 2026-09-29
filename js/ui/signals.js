// مؤشرات زمنية نصية — اللون يرافق النص ولا يستبدله.
import {localDate,addDays} from '../core/clock.js';

export function dateSignal(iso){
 const d=String(iso||'').slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(d))return null;
 const t=localDate();
 if(d<t)return {text:'فات الموعد',tone:'danger'};
 if(d===t)return {text:'اليوم',tone:'danger'};
 if(d===addDays(t,1))return {text:'غدًا',tone:'warn'};
 if(d<=addDays(t,3))return {text:'قريبة',tone:'warn'};
 if(d<=addDays(t,7))return {text:'خلال أسبوع',tone:'info'};
 return null;
}
export function fileSignal(row){
 if(!row)return null;
 if(row.isArchived||row.status==='مؤرشف')return {text:'مؤرشف',tone:'warn'};
 if(row.status==='منتهٍ'||row.status==='مغلق'||row.status==='closed')return {text:'مغلق',tone:''};
 if(row.status==='متوقف')return {text:'متوقف',tone:'warn'};
 return null;
}
