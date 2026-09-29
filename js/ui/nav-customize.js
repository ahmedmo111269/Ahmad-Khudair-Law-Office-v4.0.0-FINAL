// =====================================================================
// شاشة تخصيص شريط التنقل العلوي — تحكم كامل بلا برمجة
// ---------------------------------------------------------------------
// • إظهار/إخفاء أي تبويب أو أي عنصر داخله.
// • ترتيب التبويبات وترتيب العناصر داخل كل تبويب (▲ ▼).
// • كل تغيير يُطبَّق ويُحفظ فورًا في تفضيلات المستخدم (ui:topnav-config)
//   عبر onConfig من topnav.js، ويُعاد رسم الجدول من التكوين المطبَّع نفسه.
// =====================================================================
import {icon} from './icons.js';
import {esc} from './dom.js';
import {modal, closeModal, confirmBox} from './modal.js';
import {toast} from './toast.js';
import {NAV_GROUPS, groupById, orderedTabIds, itemRoutesInOrder, moveInList, countLabel} from './nav-model.js';

export function openNavCustomizer({getConfig, onChange, onReset} = {}) {
  let cfg = getConfig?.() || null;
  const card = modal(`
   <h2 class="modal-title">تخصيص شريط التنقل العلوي</h2>
   <p class="muted small">تحكّم كامل: أظهر أو أخفِ أي تبويب أو أي عنصر داخل التبويب، ورتّبه بالسهمين ▲▼. كل تغيير يُحفظ فورًا على هذا الجهاز لهذا المستخدم ويُطبَّق على الشريط مباشرة. المخفي يبقى متاحًا دائمًا من «لوحة الأوامر» (Ctrl + K).</p>
   <div class="tn-cfg" id="tn-cfg"></div>
   <div class="tn-cfg-foot">
    <button type="button" class="ghost" data-cfg-reset>↺ استعادة الترتيب الافتراضي</button>
    <button type="button" class="primary" data-cfg-done>تم</button>
   </div>`);
  const host = card.querySelector('#tn-cfg');

  const save = patch => {
    onChange?.({...cfg, ...patch});
    cfg = getConfig?.() || cfg; // نقرأ النسخة المطبَّعة (نفس قواعد الحماية المطبَّقة في الشريط)
    draw();
    toast('تم تحديث شريط التنقل');
  };

  function draw() {
    const order = orderedTabIds(cfg);
    host.innerHTML = order.map((id, i) => {
      const g = groupById(id);
      if (!g) return '';
      const routes = itemRoutesInOrder(g, cfg);
      const tabHidden = cfg.hiddenTabs.includes(id);
      const onlyVisible = !tabHidden && order.filter(x => !cfg.hiddenTabs.includes(x)).length === 1;
      return `<div class="tn-cfg-block${tabHidden ? ' is-off' : ''}" data-block="${id}">
       <div class="tn-cfg-row">
        <span class="tn-cfg-ic">${icon(g.icon)}</span>
        <span class="tn-cfg-name">${esc(g.label)} <small class="muted">${esc(countLabel(routes.length))}</small></span>
        <span class="tn-cfg-moves">
         <button type="button" class="link" data-move-tab="${id}" data-delta="-1"${i === 0 ? ' disabled' : ''} title="تقديم" aria-label="تقديم ${esc(g.label)}">▲</button>
         <button type="button" class="link" data-move-tab="${id}" data-delta="1"${i === order.length - 1 ? ' disabled' : ''} title="تأخير" aria-label="تأخير ${esc(g.label)}">▼</button>
        </span>
        <label class="tn-cfg-vis"${onlyVisible ? ' title="لا يمكن إخفاء كل التبويبات"' : ''}><input type="checkbox" data-vis-tab="${id}"${tabHidden ? '' : ' checked'}> ظاهر</label>
        <button type="button" class="link tn-cfg-exp" data-expand="${id}" aria-expanded="false" aria-controls="tn-cfg-items-${id}">العناصر ${icon('chevron')}</button>
       </div>
       <div class="tn-cfg-items" id="tn-cfg-items-${id}" hidden>
        ${routes.map((r, j) => {
          const it = g.items.find(x => x.route === r);
          if (!it) return '';
          const itemHidden = cfg.hiddenItems.includes(r);
          const lastVisible = !itemHidden && routes.filter(x => !cfg.hiddenItems.includes(x)).length === 1;
          return `<div class="tn-cfg-row tn-cfg-item${itemHidden ? ' is-off' : ''}">
           <span class="tn-cfg-ic">${icon(it.icon)}</span>
           <span class="tn-cfg-name">${esc(it.label)}</span>
           <span class="tn-cfg-moves">
            <button type="button" class="link" data-move-item="${id}|${r}" data-delta="-1"${j === 0 ? ' disabled' : ''} title="تقديم" aria-label="تقديم ${esc(it.label)}">▲</button>
            <button type="button" class="link" data-move-item="${id}|${r}" data-delta="1"${j === routes.length - 1 ? ' disabled' : ''} title="تأخير" aria-label="تأخير ${esc(it.label)}">▼</button>
           </span>
           <label class="tn-cfg-vis"${lastVisible ? ' title="لا يمكن إخفاء كل عناصر القسم"' : ''}><input type="checkbox" data-vis-item="${r}"${itemHidden ? '' : ' checked'}> ظاهر</label>
          </div>`;
        }).join('')}
       </div>
      </div>`;
    }).join('');
  }

  card.addEventListener('click', async e => {
    const hit = sel => e.target?.closest?.(sel) || null;
    const moveTab = hit('[data-move-tab]');
    if (moveTab) {
      const id = moveTab.dataset.moveTab, delta = Number(moveTab.dataset.delta);
      const at = cfg.tabOrder.indexOf(id);
      save({tabOrder: moveInList(cfg.tabOrder, at, delta)});
      return;
    }
    const moveItem = hit('[data-move-item]');
    if (moveItem) {
      const [gid, route] = moveItem.dataset.moveItem.split('|');
      const list = itemRoutesInOrder(groupById(gid), cfg);
      const at = list.indexOf(route);
      save({itemOrder: {...cfg.itemOrder, [gid]: moveInList(list, at, Number(moveItem.dataset.delta))}});
      return;
    }
    const exp = hit('[data-expand]');
    if (exp) {
      const box = card.querySelector(`#tn-cfg-items-${exp.dataset.expand}`);
      const open = box?.hidden === false;
      if (box) box.hidden = open;
      exp.setAttribute('aria-expanded', String(!open));
      return;
    }
    if (hit('[data-cfg-done]')) { closeModal(); return; }
    if (hit('[data-cfg-reset]')) {
      const ok = await confirmBox('استعادة الترتيب الافتراضي لكل التبويبات وإظهار كل العناصر المخفية؟');
      if (!ok) return;
      onReset?.();
      cfg = getConfig?.() || cfg;
      draw();
      toast('تمت استعادة الترتيب الافتراضي');
      return;
    }
  });

  card.addEventListener('change', e => {
    const visTab = e.target?.dataset?.visTab;
    if (visTab) {
      if (e.target.checked) save({hiddenTabs: cfg.hiddenTabs.filter(x => x !== visTab)});
      else {
        const visible = cfg.tabOrder.filter(x => !cfg.hiddenTabs.includes(x));
        if (visible.length <= 1) { e.target.checked = true; toast('لا يمكن إخفاء كل التبويبات — يجب أن يبقى تبويب واحد ظاهرًا على الأقل', 'error'); draw(); return; }
        save({hiddenTabs: [...cfg.hiddenTabs, visTab]});
      }
      return;
    }
    const vid = e.target?.dataset?.visItem;
    if (vid) {
      if (e.target.checked) save({hiddenItems: cfg.hiddenItems.filter(x => x !== vid)});
      else save({hiddenItems: [...cfg.hiddenItems, vid]});
    }
  });

  draw();
  return card;
}
