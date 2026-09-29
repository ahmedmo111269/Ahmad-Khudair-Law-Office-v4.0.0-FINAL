// استوديو المظهر: اختيار الثيم + تخصيص الألوان والخطوط والأحجام + الثيمات المخصصة المسمّاة.
// كل تغيير يُطبَّق فورًا ويُحفظ في IndexedDB. زر "إعادة الضبط" يعيد كل شيء للافتراضي.
import {esc} from '../ui/dom.js';
import {toast} from '../ui/toast.js';
import {confirmBox} from '../ui/modal.js';
import {PRESETS,FONTS_AR,FONTS_EN,getConfig,setTheme,resetTheme,effectiveColors,contrast,customThemes,saveCustomTheme,applyCustomTheme,deleteCustomTheme,exportThemeJSON,importThemeJSON,onThemeChange} from '../ui/theme.js';
import {formatDate} from '../core/format.js';

const COLOR_FIELDS=[['primary','اللون الأساسي (الذهبي)'],['primary2','الذهبي الثانوي'],['bg','الخلفية الرئيسية'],['surface','البطاقات والجداول'],['chrome','شريط التنقل العلوي'],['textStrong','العناوين'],['text','النص الأساسي'],['textMuted','النص الثانوي']];
const seg=(name,val,opts)=>`<div class="ts-seg" role="radiogroup" data-seg="${name}">${opts.map(([v,l])=>`<button type="button" role="radio" aria-checked="${String(v)===String(val)}" class="${String(v)===String(val)?'on':''}" data-v="${v}">${l}</button>`).join('')}</div>`;
function presetCard(k,p,on){const c=p.c;return `<button type="button" class="preset-card${on?' on':''}" data-preset="${k}" aria-pressed="${on}">
 <span class="preset-preview" style="background:${c.bg}"><span class="pv-side" style="background:${c.chrome}"><i style="background:${c.primary};opacity:1"></i><i style="background:${c.text}"></i><i style="background:${c.text}"></i><i style="background:${c.text}"></i></span>
 <span class="pv-main"><span class="pv-card" style="background:${c.surface};border:1px solid ${c.primary}33"><span class="pv-btn" style="background:linear-gradient(135deg,${c.primary2},${c.primary})"></span></span></span></span>
 <span class="pc-name">${esc(p.ar)}</span><span class="pc-desc">${esc(p.name)} — ${esc(p.desc)}</span></button>`}

export function renderAppearance(){
 const cfg=getConfig(),col=effectiveColors(cfg);
 const ratio=(a,b)=>contrast(a,b);
 return `<div class="theme-studio">
 <section class="panel">
  <div class="panel-head"><h3>الثيم الأساسي</h3><span class="muted small">التبديل فوري بدون إعادة تحميل، ويُحفظ لهذا المستخدم.</span></div>
  <div class="theme-presets">${Object.entries(PRESETS).map(([k,p])=>presetCard(k,p,!cfg.customId&&cfg.preset===k)).join('')}</div>
  <label class="ts-switch"><span><b>اتباع وضع الجهاز</b><br><small class="muted">فاتح نهارًا وداكن ليلًا حسب إعداد النظام</small></span><input type="checkbox" data-bool="followSystem" ${cfg.followSystem?'checked':''}></label>

  <div class="ts-section"><h4>الألوان</h4><div class="ts-grid">${COLOR_FIELDS.map(([k,l])=>`<label class="ts-field"><span>${l}</span><span class="ts-color"><input type="color" data-color="${k}" value="${esc(col[k])}" aria-label="${l}"><code>${esc(String(col[k]).toUpperCase())}</code>${cfg.colors[k]?`<button type="button" class="link" data-color-reset="${k}" title="إرجاع لون الثيم">↺</button>`:''}</span></label>`).join('')}</div></div>

  <div class="ts-section"><h4>الخطوط</h4><div class="ts-grid">
   <label class="ts-field"><span>الخط العربي</span><select data-sel="fontAr">${FONTS_AR.map(f=>`<option value="${esc(f.id)}"${f.id===cfg.fontAr?' selected':''}>${esc(f.label)}</option>`).join('')}</select></label>
   <label class="ts-field"><span>خط العناوين</span><select data-sel="headingFont"><option value="">نفس الخط الأساسي</option>${FONTS_AR.filter(f=>f.id!=='system').map(f=>`<option value="${esc(f.id)}"${f.id===cfg.headingFont?' selected':''}>${esc(f.label)}</option>`).join('')}</select></label>
   <label class="ts-field"><span>الخط الإنجليزي والأرقام</span><select data-sel="fontEn">${FONTS_EN.map(f=>`<option value="${esc(f.id)}"${f.id===cfg.fontEn?' selected':''}>${esc(f.label)}</option>`).join('')}</select></label>
   <label class="ts-field"><span>سماكة الخط</span><select data-sel="fontWeight">${[[300,'رفيع'],[400,'عادي'],[500,'متوسط'],[600,'سميك']].map(([v,l])=>`<option value="${v}"${Number(cfg.fontWeight)===v?' selected':''}>${l}</option>`).join('')}</select></label>
  </div>
  <div class="ts-field" style="margin-top:12px"><span>حجم الخط الأساسي</span>${seg('fontSize',cfg.fontSize,[['sm','صغير'],['md','متوسط'],['lg','كبير'],['xl','كبير جدًا'],['custom','مخصص']])}
   <div class="ts-range" ${cfg.fontSize==='custom'?'':'hidden'} data-custom-size><input type="range" min="12" max="24" step="1" value="${cfg.customSize}" data-range="customSize" aria-label="حجم مخصص"><output>${cfg.customSize}px</output></div></div>
  </div>

  <div class="ts-section"><h4>الشكل والتباعد</h4><div class="ts-grid">
   <div class="ts-field"><span>استدارة الحواف</span><div class="ts-range"><input type="range" min="0" max="24" step="1" value="${cfg.radius}" data-range="radius" aria-label="استدارة الحواف"><output>${cfg.radius}px</output></div></div>
   <div class="ts-field"><span>كثافة التباعد</span>${seg('density',cfg.density,[['compact','مضغوط'],['comfortable','مريح'],['spacious','واسع']])}</div>
  </div>
  <label class="ts-switch" style="margin-top:12px"><span><b>الظلال والتوهج الذهبي</b><br><small class="muted">إيقافها يعطي مظهرًا مسطحًا ويحسّن الأداء على الأجهزة الضعيفة</small></span><input type="checkbox" data-bool="effects" ${cfg.effects?'checked':''}></label>
  </div>

  <div class="ts-actions">
   <button type="button" class="primary" data-act="save">💾 حفظ كثيم مخصص…</button>
   <button type="button" class="ghost" data-act="export">تصدير الثيم (JSON)</button>
   <label class="ghost" style="cursor:pointer">استيراد ثيم<input type="file" accept="application/json,.json" data-act="import" hidden></label>
   <button type="button" class="ghost danger" data-act="reset">↺ إعادة الضبط للافتراضي</button>
  </div>
 </section>

 <aside class="ts-preview">
  <section class="panel">
   <h3>معاينة مباشرة</h3>
   <div class="mock"><div class="mock-head"><b>ملف 2026/0142</b><span class="badge open">متداول</span></div>
    <div class="mock-body"><div class="stat"><b>12</b><span>جلسات هذا الأسبوع</span></div>
     <div class="table-wrap"><table style="min-width:0"><thead><tr><th>التاريخ</th><th>المحكمة</th></tr></thead><tbody><tr><td>${formatDate(new Date())}</td><td>بنها الابتدائية</td></tr><tr class="dg-selected"><td>${formatDate(new Date(Date.now()+864e5*7))}</td><td>استئناف طنطا</td></tr></tbody></table></div>
     <div style="display:flex;gap:8px"><button type="button" class="primary">حفظ</button><button type="button" class="ghost">إلغاء</button></div></div></div>
   <h4 style="margin:14px 0 6px">فحص التباين (WCAG)</h4>
   <div class="contrast" data-contrast>${contrastChips(col,ratio)}</div>
  </section>
  <section class="panel"><h3>ثيماتي المحفوظة</h3>
   <ul class="ts-saved">${customThemes().map(t=>`<li class="${cfg.customId===t.id?'on':''}"><b>${esc(t.name)}</b><button type="button" class="link" data-apply="${esc(t.id)}">تطبيق</button><button type="button" class="link danger" data-del="${esc(t.id)}">حذف</button></li>`).join('')||'<li class="muted">لا توجد ثيمات محفوظة بعد. خصّص المظهر ثم اضغط «حفظ كثيم مخصص».</li>'}</ul>
  </section>
 </aside></div>`;
}
function contrastChips(c,ratio){
 const items=[['النص/الخلفية',ratio(c.text,c.bg),4.5],['النص/البطاقة',ratio(c.text,c.surface),4.5],['الثانوي/البطاقة',ratio(c.textMuted,c.surface),4.5],['الذهبي/البطاقة',ratio(c.primary,c.surface),3]];
 return items.map(([l,r,min])=>`<span class="${r>=min?'ok':'bad'}" title="الحد الأدنى ${min}:1">${r>=min?'✓':'⚠'} ${l} ${r.toFixed(1)}:1</span>`).join('');
}

export function bindAppearance(app){
 const root=document.querySelector('#appearance-root');if(!root)return;
 const rerender=()=>{const y=scrollY;root.innerHTML=renderAppearance();scrollTo(0,y)};
 let off=null;
 root.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.dataset.preset){setTheme({preset:b.dataset.preset,colors:{},customId:null});rerender();return}
  if(b.dataset.colorReset){const colors={...getConfig().colors};delete colors[b.dataset.colorReset];setTheme({colors,customId:null});rerender();return}
  if(b.closest('[data-seg]')){const name=b.closest('[data-seg]').dataset.seg;setTheme({[name]:b.dataset.v,customId:getConfig().customId});rerender();return}
  if(b.dataset.apply){applyCustomTheme(b.dataset.apply);rerender();toast('تم تطبيق الثيم');return}
  if(b.dataset.del){if(await confirmBox('حذف هذا الثيم المخصص؟',{okText:'حذف'})){await deleteCustomTheme(b.dataset.del);rerender()}return}
  const act=b.dataset.act;
  if(act==='reset'){if(await confirmBox('إعادة كل إعدادات المظهر إلى الافتراضي (الأسود والذهبي)؟ الثيمات المحفوظة لن تُحذف.',{okText:'إعادة الضبط'})){resetTheme();rerender();toast('تمت إعادة الضبط')}}
  if(act==='save'){const cur=customThemes().find(t=>t.id===getConfig().customId);const r=await confirmBox('احفظ الإعدادات الحالية كثيم مخصص يمكنك الرجوع إليه في أي وقت.',{okText:'حفظ',input:true,label:'اسم الثيم',value:cur?.name||''});if(r?.ok){try{await saveCustomTheme(r.value);rerender();toast('تم حفظ الثيم')}catch(err){toast(err.message,'error')}}}
  if(act==='export'){const blob=new Blob([exportThemeJSON()],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='theme-akl.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1500)}
 });
 root.addEventListener('input',e=>{
  const t=e.target;
  if(t.dataset.color){const colors={...getConfig().colors,[t.dataset.color]:t.value};setTheme({colors,customId:null},{save:false});t.nextElementSibling.textContent=t.value.toUpperCase();root.querySelector('[data-contrast]').innerHTML=contrastChips(effectiveColors(),contrast)}
  if(t.dataset.range){t.nextElementSibling.textContent=t.value+'px';setTheme({[t.dataset.range]:Number(t.value)},{save:false})}
 });
 root.addEventListener('change',async e=>{
  const t=e.target;
  if(t.dataset.color||t.dataset.range){setTheme({},{save:true});if(t.dataset.color)rerender();return}
  if(t.dataset.sel){setTheme({[t.dataset.sel]:t.dataset.sel==='fontWeight'?Number(t.value):t.value});return}
  if(t.dataset.bool){setTheme({[t.dataset.bool]:t.checked});return}
  if(t.dataset.act==='import'){const f=t.files[0];if(!f)return;try{importThemeJSON(await f.text());rerender();toast('تم استيراد الثيم')}catch(err){toast(err.message||'ملف غير صالح','error')}}
 });
 off=onThemeChange(()=>{if(!document.body.contains(root))off?.()});
}
