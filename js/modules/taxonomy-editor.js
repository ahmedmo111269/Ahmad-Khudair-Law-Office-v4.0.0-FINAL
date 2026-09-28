// محرر الأقسام وأنواع الأعمال والمسارات المقترحة والحقول — بيانات وليست كودًا.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {userError} from '../core/errors.js';
import {taxonomy,saveTaxonomyItem,saveTemplate} from '../services/client-files.js';

const FIELD_TYPES={text:'نص',number:'رقم',date:'تاريخ',textarea:'نص طويل'};
export async function renderTaxonomyEditor(app){
 const tax=await taxonomy(app.office);
 const catId=app.__taxCat&&tax.byId.get(app.__taxCat)?app.__taxCat:tax.categories[0]?.id;
 const cat=tax.byId.get(catId);const types=tax.rows.filter(r=>r.kind==='fileType'&&r.parentId===catId).sort((a,b)=>(a.sortOrder??999)-(b.sortOrder??999));
 const typeId=app.__taxType&&types.some(t=>t.id===app.__taxType)?app.__taxType:types[0]?.id;const type=tax.byId.get(typeId);
 const stages=tax.rows.filter(r=>r.kind==='stageType'&&r.parentId===catId);
 const tpl=type?tax.templateFor(type.id):null;
 return `<div class="tax-editor grid2">
 <section class="panel"><div class="panel-head"><h3>الأقسام</h3></div>
  <div class="cf-lines">${tax.rows.filter(r=>r.kind==='category').sort((a,b)=>(a.sortOrder??999)-(b.sortOrder??999)).map(c=>`<button class="cf-line ${c.id===catId?'active':''}" data-tax-cat="${esc(c.id)}"><span class="cf-line-icon">${esc(c.icon||'📁')}</span><span class="cf-line-main"><b>${esc(c.name)}</b><small>${tax.rows.filter(r=>r.kind==='fileType'&&r.parentId===c.id).length} نوع</small></span>${c.isActive===false?'<span class="badge warn">معطل</span>':''}</button>`).join('')}</div>
  <form class="inline-form" data-tax-new="category"><input name="name" placeholder="اسم قسم جديد" required><input name="icon" placeholder="رمز" maxlength="4" style="width:60px"><button class="ghost">+ قسم</button></form>
 </section>
 <section class="panel">${cat?`<div class="panel-head"><h3>${esc(cat.icon||'')} ${esc(cat.name)}</h3><span><button class="ghost small" data-tax-toggle="${esc(cat.id)}">${cat.isActive===false?'تفعيل':'تعطيل'}</button></span></div>
  <form class="inline-form" data-tax-rename="${esc(cat.id)}"><input name="name" value="${esc(cat.name)}"><input name="icon" value="${esc(cat.icon||'')}" style="width:60px"><input name="color" type="color" value="${esc(/^#/.test(cat.color||'')?cat.color:'#c9a646')}"><button class="ghost">حفظ</button></form>
  <h4>أنواع الأعمال</h4><div class="type-chips">${types.map(t=>`<button class="chip ${t.id===typeId?'active':''}" data-tax-type="${esc(t.id)}">${esc(t.name)}${t.isActive===false?' (معطل)':''}</button>`).join('')}</div>
  <form class="inline-form" data-tax-new="fileType"><input name="name" placeholder="نوع عمل جديد" required><button class="ghost">+ نوع</button></form>
  ${type?`<hr><h4>${esc(type.name)} <button class="ghost small" data-tax-toggle="${esc(type.id)}">${type.isActive===false?'تفعيل':'تعطيل'}</button></h4>
  <form class="inline-form" data-tax-rename="${esc(type.id)}"><input name="name" value="${esc(type.name)}"><button class="ghost">إعادة تسمية</button></form>
  <label>المسار المقترح <small class="muted">(مرحلة في كل سطر — ابدأ السطر بـ ? للمرحلة «عند الحاجة». اقتراح فقط ولا يُفرض)</small><textarea id="tax-tpl" rows="6">${esc((tpl?.steps||[]).map(s=>(s.optional?'?':'')+s.name).join('\n'))}</textarea></label>
  <button class="ghost" data-tax-save-tpl>حفظ المسار</button>
  <label>الحقول الخاصة <small class="muted">(سطر لكل حقل: الاسم | النوع: ${Object.values(FIELD_TYPES).join('/')})</small><textarea id="tax-fields" rows="6">${esc((type.fields||[]).map(f=>`${f.l} | ${FIELD_TYPES[f.t]||'نص'}${f.k?` | ${f.k}`:''}`).join('\n'))}</textarea></label>
  <button class="ghost" data-tax-save-fields>حفظ الحقول</button><p class="muted small">القيم المحفوظة سابقًا لا تُحذف عند حذف حقل — تبقى في السجل ويمكن إرجاعها.</p>`:''}
  <details><summary>أنواع المراحل في هذا القسم (${stages.length})</summary><p class="small">${stages.map(s=>esc(s.name)).join('، ')||'—'}</p><form class="inline-form" data-tax-new="stageType"><input name="name" placeholder="نوع مرحلة جديد" required><button class="ghost">+ مرحلة</button></form></details>`:''}
 </section></div>`;
}
export function bindTaxonomyEditor(app){
 const root=document.querySelector('.tax-editor');if(!root)return;
 const run=async p=>{try{await p;toast('تم الحفظ');app.refresh()}catch(e){toast(userError(e),'error')}};
 root.querySelectorAll('[data-tax-cat]').forEach(b=>b.onclick=()=>{app.__taxCat=b.dataset.taxCat;app.__taxType='';app.refresh()});
 root.querySelectorAll('[data-tax-type]').forEach(b=>b.onclick=()=>{app.__taxType=b.dataset.taxType;app.refresh()});
 root.querySelectorAll('[data-tax-new]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const kind=f.dataset.taxNew;const v=Object.fromEntries(new FormData(f));run(saveTaxonomyItem(app.office,{kind,name:v.name,icon:v.icon||undefined,parentId:kind==='category'?undefined:app.__taxCat||root.querySelector('[data-tax-cat].active')?.dataset.taxCat}))});
 root.querySelectorAll('[data-tax-rename]').forEach(f=>f.onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f));run(saveTaxonomyItem(app.office,v,f.dataset.taxRename))});
 root.querySelectorAll('[data-tax-toggle]').forEach(b=>b.onclick=async()=>{const tax=await taxonomy(app.office);const r=tax.byId.get(b.dataset.taxToggle);run(saveTaxonomyItem(app.office,{isActive:r.isActive===false},r.id))});
 const typeId=root.querySelector('[data-tax-type].active')?.dataset.taxType;
 root.querySelector('[data-tax-save-tpl]')?.addEventListener('click',()=>{const steps=root.querySelector('#tax-tpl').value.split('\n').map(l=>l.trim()).filter(Boolean).map(l=>({name:l.replace(/^\?/,'').trim(),optional:l.startsWith('?')}));run(saveTemplate(app.office,typeId,steps))});
 root.querySelector('[data-tax-save-fields]')?.addEventListener('click',async()=>{
  const rev=Object.fromEntries(Object.entries(FIELD_TYPES).map(([k,v])=>[v,k]));
  const fields=root.querySelector('#tax-fields').value.split('\n').map(l=>l.split('|').map(x=>x.trim())).filter(p=>p[0]).map((p,i)=>({l:p[0],t:rev[p[1]]||p[1]&&FIELD_TYPES[p[1]]&&p[1]||'text',k:(p[2]||'f'+Date.now().toString(36)+i).replace(/[^\w]/g,'')}));
  const old=new Map(((await taxonomy(app.office)).byId.get(typeId)?.fields||[]).map(f=>[f.k,f]));
  run(saveTaxonomyItem(app.office,{fields:fields.map(f=>({...(old.get(f.k)||{}),...f}))},typeId));
 });
}
