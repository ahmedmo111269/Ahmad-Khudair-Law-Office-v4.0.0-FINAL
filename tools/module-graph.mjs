// قراءة الرسم البياني للاستيرادات الساكنة (import/export … from) انطلاقًا من js/app.js.
// تُستخدم في: اختبار أن قائمة Precache في sw.js تغطي
// كل وحدة يحتاجها الإقلاع. الاستيراد الديناميكي import() عمدًا غير مُدرج: هو يُحمَّل عند الطلب.
import fs from 'node:fs';
import path from 'node:path';

const STATIC_IMPORT=/(?:^|[\n;])\s*(?:import|export)\b[^'"`;]*?\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]|(?:^|[\n;])\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** @returns {string[]} مسارات نسبية للمستودع (مثل js/core/store.js) بترتيب BFS من نقطة الدخول */
export function bootModuleGraph(root, entry='js/app.js'){
 const order=[],seen=new Set([entry]),queue=[entry];
 while(queue.length){
  const file=queue.shift();order.push(file);
  const src=fs.readFileSync(path.join(root,file),'utf8');
  STATIC_IMPORT.lastIndex=0;
  let m;
  while((m=STATIC_IMPORT.exec(src))){
   const spec=m[1]||m[2];
   const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),spec));
   if(!seen.has(target)&&fs.existsSync(path.join(root,target))){seen.add(target);queue.push(target)}
  }
 }
 return order;
}
