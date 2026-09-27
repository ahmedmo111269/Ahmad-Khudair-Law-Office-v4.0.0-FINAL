import {esc} from '../ui/dom.js';
import {analyticsSnapshot,analyticsPeriod,analyticsConfigs} from '../services/analytics.js';

const fmt=n=>new Intl.NumberFormat('ar-EG').format(n||0);
const datasets=Object.entries(analyticsConfigs).map(([k,v])=>[k,v.label]);

export async function analyticsPage(app,query){
 const ds=query.get('dataset')||'cases',period=query.get('period')||'last30';
 const [from,to]=analyticsPeriod(period,query.get('from'),query.get('to'));
 const cfg=analyticsConfigs[ds]||analyticsConfigs.cases;
 return `<div class="page-head"><div><h2>مركز الإحصاءات والتحليلات</h2><p>إحصاءات مستقلة عن الصفحة الرئيسية، قابلة للتصفية حسب نوع البيانات والفترة والحالة.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button></div></div>
 <section class="panel analytics-builder"><div class="filter-grid"><label>البيانات<select id="analytics-dataset">${datasets.map(x=>`<option value="${x[0]}" ${x[0]===ds?'selected':''}>${esc(x[1])}</option>`).join('')}</select></label><label>الفترة<select id="analytics-period"><option value="today" ${period==='today'?'selected':''}>اليوم</option><option value="last30" ${period==='last30'?'selected':''}>آخر 30 يومًا</option><option value="month" ${period==='month'?'selected':''}>هذا الشهر</option><option value="year" ${period==='year'?'selected':''}>هذا العام</option><option value="custom" ${period==='custom'?'selected':''}>مخصصة</option></select></label><label>من<input type="date" id="analytics-from" value="${esc(from)}"></label><label>إلى<input type="date" id="analytics-to" value="${esc(to)}"></label></div><div class="filter-actions"><button class="primary" id="run-analytics">تحليل البيانات</button><button class="ghost" id="reset-analytics">إعادة ضبط</button></div></section>
 <section class="panel" id="analytics-result"><div class="loading">جارٍ تجهيز الإحصاءات…</div></section>`;
}

export function bindAnalytics(app){
 const q=new URLSearchParams(app.route.split('?')[1]||'');
 const go=()=>{const p=$('#analytics-period').value,from=$('#analytics-from').value,to=$('#analytics-to').value;app.go(`analytics?dataset=${encodeURIComponent($('#analytics-dataset').value)}&period=${encodeURIComponent(p)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)};
 const $=s=>document.querySelector(s);
 const toggle=()=>{const c=$('#analytics-period').value==='custom';$('#analytics-from').disabled=!c;$('#analytics-to').disabled=!c};
 $('#analytics-period')?.addEventListener('change',toggle);toggle();
 $('#run-analytics')?.addEventListener('click',go);$('#reset-analytics')?.addEventListener('click',()=>app.go('analytics'));
 load(app,q);
}
async function load(app,q){
 const root=document.querySelector('#analytics-result');if(!root)return;
 const ds=q.get('dataset')||'cases',period=q.get('period')||'last30';const [from,to]=analyticsPeriod(period,q.get('from'),q.get('to'));root.innerHTML='<div class="loading">جارٍ تحليل البيانات…</div>';
 try{const r=await analyticsSnapshot(app.office,{dataset:ds,from,to});render(r,root)}catch(e){root.innerHTML=`<div class="error-box">${esc(e.message||e)}</div>`}
}
function render(r,root){
 const groups=Object.entries(r.groups).sort((a,b)=>b[1]-a[1]);
 const trend=Object.entries(r.trend).sort((a,b)=>a[0].localeCompare(b[0]));
 const max=Math.max(1,...groups.map(x=>x[1]));
 root.innerHTML=`<div class="analytics-head"><div><h3>${esc(r.label)}</h3><p class="muted">من ${esc(r.from)} إلى ${esc(r.to)}</p></div><div class="analytics-total"><b>${fmt(r.total)}</b><span>إجمالي السجلات المطابقة</span></div></div>
 ${r.truncated?'<div class="notice">تم إيقاف التحليل عند 10,000 سجل. استخدم فترة أضيق للحصول على تحليل كامل.</div>':''}
 <div class="analytics-grid"><section><h4>التوزيع</h4>${groups.length?groups.map(([k,n])=>`<div class="metric-row"><span>${esc(k)}</span><div><i style="width:${Math.round(n/max*100)}%"></i></div><b>${fmt(n)}</b></div>`).join(''):'<p class="muted">لا توجد بيانات.</p>'}</section><section><h4>الاتجاه الزمني</h4><div class="trend-list">${trend.slice(-30).map(([d,n])=>`<div><span>${esc(d)}</span><b>${fmt(n)}</b></div>`).join('')||'<p class="muted">لا توجد بيانات.</p>'}</div></section></div>`;
}
