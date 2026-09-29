import { prefs } from '../core/preferences.js';

const STORE_KEY = 'ui:collapsed-panels';

/** Add accessible, preference-backed collapse controls to cards that have a heading. */
export function enhanceCollapsiblePanels(root, scope = 'page') {
  if (!root?.querySelectorAll) return;
  const state = prefs.get(STORE_KEY, {}) || {};
  [...root.querySelectorAll('.panel')].forEach((panel, index) => {
    if (panel.dataset.collapseReady) return;
    let header = panel.querySelector(':scope > .panel-head');
    if (!header) {
      const title = panel.querySelector(':scope > h2,:scope > h3,:scope > h4');
      if (!title) return;
      header = document.createElement('div');
      header.className = 'panel-collapse-head';
      panel.insertBefore(header, title);
      header.append(title);
    } else {
      header.classList.add('panel-collapse-head');
    }
    const heading = header.querySelector('h2,h3,h4')?.textContent?.trim() || `بطاقة ${index + 1}`;
    const key = panel.id || `${scope}:${index}:${heading}`;
    panel.dataset.collapseReady = 'true';
    panel.dataset.collapseKey = key;
    const collapsed = Boolean(state[key]);
    panel.classList.toggle('card-collapsed', collapsed);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost small card-collapse-toggle';
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', `${collapsed ? 'توسيع' : 'طي'} البطاقة: ${heading}`);
    button.title = collapsed ? 'توسيع البطاقة' : 'طي البطاقة';
    button.textContent = collapsed ? '▸' : '▾';
    button.addEventListener('click', async () => {
      const next = !panel.classList.contains('card-collapsed');
      panel.classList.toggle('card-collapsed', next);
      button.setAttribute('aria-expanded', String(!next));
      button.setAttribute('aria-label', `${next ? 'توسيع' : 'طي'} البطاقة: ${heading}`);
      button.title = next ? 'توسيع البطاقة' : 'طي البطاقة';
      button.textContent = next ? '▸' : '▾';
      const current = prefs.get(STORE_KEY, {}) || {};
      if (next) current[key] = true; else delete current[key];
      await prefs.set(STORE_KEY, current);
    });
    header.append(button);
  });
}
