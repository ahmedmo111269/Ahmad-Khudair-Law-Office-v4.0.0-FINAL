import {esc} from '../ui/dom.js';
import {analyticsSnapshot,analyticsPeriod,analyticsConfigs} from '../services/analytics.js';
import {enhanceCollapsiblePanels} from '../ui/collapsible.js';

const fmt=n=>new Intl.NumberFormat('ar-EG').format(n||0);
const datasets=Object.entries(analyticsConfigs).map(([k,v])=>[k,v.label]);
const periodLabels={today:'اليوم',last30:'آخر 30 يومًا',month:'هذا الشهر',year:'هذا العام',custom:'مخصصة'};
const analyticsFilterSummary=(dataset,period,from='',to='')=>`${analyticsConfigs[dataset]?.label||dataset} · ${periodLabels[period]||period}${period==='custom'&&(from||to)?` · ${from||'…'} — ${to||'…'}`:''}`;

export async function analyticsPage(app,query){
 const ds=query.get('dataset')||'cases',period=query.get('period')||'last30';
 const [from,to]=analyticsPeriod(period,query.get('from'),query.get('to'));
 const cfg=analyticsConfigs[ds]||analyticsConfigs.cases;
 return `<div class="page-head"><div><h2>مركز الإحصاءات والتحليلات</h2><p>إحصاءات مستقلة عن الصفحة الرئيسية، قابلة للتصفية حسب نوع البيانات والفترة والحالة.</p></div><div class="head-actions"><button class="ghost" data-page-back>رجوع</button><button class="ghost" data-page-close>إغلاق</button></div></div>
 <section class="panel analytics-builder" data-collapse-id="analytics-filters"><div class="panel-head"><h3>عوامل التصفية والتحليل</h3><span class="badge" data-analytics-filter-summary>${esc(analyticsFilterSummary(ds,period,from,to))}</span></div><div class="filter-grid"><label>البيانات<select id="analytics-dataset">${datasets.map(x=>`<option value="${x[0]}" ${x[0]===ds?'selected':''}>${esc(x[1])}</option>`).join('')}</select></label><label>الفترة<select id="analytics-period"><option value="today" ${period==='today'?'selected':''}>اليوم</option><option value="last30" ${period==='last30'?'selected':''}>آخر 30 يومًا</option><option value="month" ${period==='month'?'selected':''}>هذا الشهر</option><option value="year" ${period==='year'?'selected':''}>هذا العام</option><option value="custom" ${period==='custom'?'selected':''}>مخصصة</option></select></label><label>من<input type="date" id="analytics-from" value="${esc(from)}"></label><label>إلى<input type="date" id="analytics-to" value="${esc(to)}"></label></div><div class="filter-actions"><button class="primary" id="run-analytics">تحليل البيانات</button><button class="ghost" id="reset-analytics">إعادة ضبط</button></div></section>
 <section class="panel" id="analytics-result" data-collapse-id="analytics-results"><div class="panel-head"><h3>نتائج التحليل</h3><span class="badge" data-analytics-total>جارٍ التجهيز</span></div><div class="analytics-result-content"><div class="loading">جارٍ تجهيز الإحصاءات…</div></div></section>`;
}

export function bindAnalytics(app){
 const q=new URLSearchParams(app.route.split('?')[1]||'');
 const $=s=>document.querySelector(s);
 const go=()=>{const p=$('#analytics-period').value,from=$('#analytics-from').value,to=$('#analytics-to').value;app.go(`analytics?dataset=${encodeURIComponent($('#analytics-dataset').value)}&period=${encodeURIComponent(p)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)};
 const syncSummary=()=>{const node=$('[data-analytics-filter-summary]');if(node)node.textContent=analyticsFilterSummary($('#analytics-dataset').value,$('#analytics-period').value,$('#analytics-from').value,$('#analytics-to').value)};
 const toggle=()=>{const c=$('#analytics-period').value==='custom';$('#analytics-from').disabled=!c;$('#analytics-to').disabled=!c;syncSummary()};
 $('#analytics-period')?.addEventListener('change',toggle);$('#analytics-dataset')?.addEventListener('change',syncSummary);$('#analytics-from')?.addEventListener('input',syncSummary);$('#analytics-from')?.addEventListener('change',syncSummary);$('#analytics-to')?.addEventListener('input',syncSummary);$('#analytics-to')?.addEventListener('change',syncSummary);toggle();
 $('#run-analytics')?.addEventListener('click',go);$('#reset-analytics')?.addEventListener('click',()=>app.go('analytics'));
 load(app,q);
}
async function load(app,q){
 const shell=document.querySelector('#analytics-result');if(!shell)return;
 const root=shell.querySelector('.analytics-result-content')||shell;
 const ds=q.get('dataset')||'cases',period=q.get('period')||'last30';const [from,to]=analyticsPeriod(period,q.get('from'),q.get('to'));root.innerHTML='<div class="loading">جارٍ تحليل البيانات…</div>';
 try{const r=await analyticsSnapshot(app.office,{dataset:ds,from,to});render(r,root);const total=shell.querySelector('[data-analytics-total]');if(total)total.textContent=`${fmt(r.total)} سجل`;enhanceCollapsiblePanels(document.querySelector('#main-content'),'analytics')}
 catch(e){root.innerHTML=`<div class="error-box">${esc(e.message||e)}</div>`;const total=shell.querySelector('[data-analytics-total]');if(total)total.textContent='تعذر التحليل'}
}
function render(r,root){
 const groups=Object.entries(r.groups).sort((a,b)=>b[1]-a[1]);
 const trend=Object.entries(r.trend).sort((a,b)=>a[0].localeCompare(b[0]));
 const max=Math.max(1,...groups.map(x=>x[1]));
 root.innerHTML=`<div class="analytics-head"><div><h3>${esc(r.label)}</h3><p class="muted">من ${esc(r.from)} إلى ${esc(r.to)}</p></div><div class="analytics-total"><b>${fmt(r.total)}</b><span>إجمالي السجلات المطابقة</span></div></div>
 ${r.truncated?'<div class="notice">تم إيقاف التحليل عند 10,000 سجل. استخدم فترة أضيق للحصول على تحليل كامل.</div>':''}
 <div class="analytics-grid"><section class="panel analytics-chart" data-collapse-id="analytics-distribution"><div class="panel-head"><h4>التوزيع</h4><span class="badge">${groups.length} مجموعات</span></div>${groups.length?groups.map(([k,n])=>`<div class="metric-row"><span>${esc(k)}</span><div><i style="width:${Math.round(n/max*100)}%"></i></div><b>${fmt(n)}</b></div>`).join(''):'<p class="muted">لا توجد بيانات.</p>'}</section><section class="panel analytics-chart" data-collapse-id="analytics-trend"><div class="panel-head"><h4>الاتجاه الزمني</h4><span class="badge">${trend.length} يومًا</span></div>${trendGraph(trend)}<div class="trend-list">${trend.slice(-30).map(([d,n])=>`<div><span>${esc(d)}</span><b>${fmt(n)}</b></div>`).join('')||'<p class="muted">لا توجد بيانات.</p>'}</div></section></div>`;
}
// رسم خطي SVG خفيف للاتجاه اليومي (بلا مكتبات، يتلوّن من التوكنز)
function trendGraph(trend){
 const pts=trend.slice(-30);
 if(pts.length<2)return '';
 const w=560,h=90,pad=6;
 const maxV=Math.max(...pts.map(([,n])=>Number(n)||0),1);
 const step=(w-pad*2)/(pts.length-1);
 const xy=pts.map(([d,n],i)=>[pad+i*step,h-pad-(Number(n)||0)/maxV*(h-pad*2)]);
 const line=xy.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
 const area=`${line} L${xy.at(-1)[0].toFixed(1)},${h-pad} L${xy[0][0].toFixed(1)},${h-pad} Z`;
 const last=xy.at(-1);
 return `<svg class="trend-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="رسم الاتجاه اليومي" preserveAspectRatio="none"><path d="${area}" fill="var(--primary-soft)"/><path d="${line}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" fill="var(--primary)"/></svg><div class="trend-cap muted small">${esc(pts[0][0])} ← ${esc(pts.at(-1)[0])} (آخر ${pts.length} يومًا، الأعلى ${fmt(maxV)})</div>`;
}
