// بيئة اختبار Node: IndexedDB وهمي + DOM خفيف + localStorage في الذاكرة.
// يسمح بتشغيل اختبارات المتصفح نفسها (التي تحتاج IndexedDB) داخل سطر الأوامر.
import 'fake-indexeddb/auto';
import {parseHTML} from 'linkedom';

const {window:dom}=parseHTML('<!doctype html><html lang="ar" dir="rtl"><head></head><body><div id="app"><aside id="sidebar"></aside><main><header class="topbar"><button id="mobile-menu"></button><div><h1 id="page-title"></h1><span id="db-badge"></span><span id="network-badge"></span></div><div class="top-actions"><button id="theme-btn"></button><button id="command-btn"></button><button id="quick-add"></button></div></header><section id="main-content"></section></main></div><div id="modal-root"></div></body></html>');

for(const k of ['document','HTMLElement','Element','Node','MutationObserver','getComputedStyle','CSS']){
 try{if(!(k in globalThis)||k==='document')globalThis[k]=dom[k]}catch{}
}
// أحداث linkedom إجباريًا: حتى تتوافق مع عناصرها أثناء النشر (Node's native Event يكسر النشر)
for(const k of ['Event','CustomEvent','KeyboardEvent','MouseEvent']){
 try{Object.defineProperty(globalThis,k,{value:dom[k],configurable:true,writable:true})}catch{}
}
globalThis.document=dom.document;
if(!globalThis.window||globalThis.window===globalThis.process?.env){/* noop */}
globalThis.window=Object.assign(dom.window,{matchMedia:q=>({matches:false,media:q,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})});
// linkedom لا يوفر matchMedia؛ نوفره على document-view أيضًا
try{dom.window.matchMedia=globalThis.window.matchMedia}catch{}
globalThis.matchMedia=globalThis.window.matchMedia;

// localStorage في الذاكرة
class MemLS{
 constructor(){this.m=new Map()}
 getItem(k){return this.m.has(k)?this.m.get(k):null}
 setItem(k,v){this.m.set(k,String(v))}
 removeItem(k){this.m.delete(k)}
 key(i){return [...this.m.keys()][i]??null}
 get length(){return this.m.size}
 clear(){this.m.clear()}
}
globalThis.localStorage=new MemLS();
globalThis.sessionStorage=new MemLS();
// لا نسمح لخطأ غير ملتقط (مؤقتات متأخرة بعد تفكيك DOM) بإنهاء تشغيل الاختبارات
process.on('uncaughtException',e=>{globalThis.__lastUncaught=e;console.error('[uncaught]',e?.message||e)});
process.on('unhandledRejection',e=>{console.error('[unhandled]',e?.message||e)});
globalThis.requestAnimationFrame=cb=>setTimeout(()=>cb(Date.now()),0);
globalThis.HTMLElement=dom.HTMLElement;
// linkedom لا يوفر CSS.escape — نضيف بديلًا كافيًا للجدول
try{
 if(!globalThis.CSS)globalThis.CSS={};
 if(!globalThis.CSS.escape)globalThis.CSS.escape=s=>String(s).replace(/[^a-zA-Z0-9_\u0600-\u06FF-]/g,c=>'\\'+c);
 dom.window.CSS=globalThis.CSS;
}catch{}
// Event في linkedom يمنع تعديل eventPhase؛ نغلّفه ليسمح بالالتقاط/الفقاعة في الاختبارات
try{
 const OE=dom.window.Event;
 if(OE){
  const pd=Object.getOwnPropertyDescriptor(OE.prototype,'eventPhase');
  if(pd&&!pd.set){
   Object.defineProperty(OE.prototype,'eventPhase',{get(){return this.__phase??pd.get.call(this)},set(v){try{this.__phase=v}catch{}},configurable:true});
  }
 }
}catch{}
// linkedom: خاصية value في <select> للقراءة فقط — نضيف كاتبًا بسيطًا يكفي للاختبارات
try{
 const SEL=dom.window.HTMLSelectElement;
 if(SEL){
  const d=Object.getOwnPropertyDescriptor(SEL.prototype,'value');
  if(d&&!d.set){
   Object.defineProperty(SEL.prototype,'value',{
    get:d.get,
    set(v){try{const opts=[...this.querySelectorAll('option')];const i=opts.findIndex(o=>o.value===String(v));this.selectedIndex=i}catch{}},
    configurable:true
   });
  }
 }
}catch{}
try{if(typeof globalThis.navigator==='undefined')Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true})}catch{}
