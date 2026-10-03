import {esc} from '../ui/dom.js';
import {modal, closeModal} from '../ui/modal.js';
import {toast} from '../ui/toast.js';
import {exportDatabase, downloadJSON} from '../services/backup.js';
import {fileExchangeTransport} from '../services/sync-transport.js';
import {SYNC_PASSPHRASE_MIN_LENGTH} from '../services/sync-crypto.js';
import {
  syncStatus, previewSyncBundle, initializeSyncBaseline, applySyncBundle,
  createSyncBundle, listSyncConflicts, syncHistory, resolveSyncConflict, recordSyncExport
} from '../services/sync-engine.js';
import {networkStatus} from '../core/network-status.js';
import {getDeviceName, setDeviceName} from '../core/device-id.js';

const STATUS_LABELS = {
  SYNCED: ['متزامن', 'is-synced'], PENDING: ['تغييرات بانتظار المزامنة', 'is-pending'],
  SYNCING: ['جارٍ تجهيز المزامنة', 'is-syncing'], CONFLICT: ['تعارض يحتاج مراجعة', 'is-conflict'],
  FAILED: ['تعذرت آخر محاولة — البيانات محفوظة', 'is-failed']
};
const dateLabel = value => value ? new Date(value).toLocaleString('ar-EG') : 'لا توجد مزامنة سابقة';
const jsonText = value => {
  try { return JSON.stringify(value ?? null, null, 2); }
  catch { return '{"error":"تعذر عرض هذه القيمة"}'; }
};
const escapeText = value => esc(String(value || ''));

export async function renderSyncPage(app) {
  const [status, conflicts, history] = await Promise.all([
    syncStatus(app.ctx), listSyncConflicts(app.ctx, {limit: 30}), syncHistory(app.ctx, 20)
  ]);
  const [statusLabel, statusClass] = STATUS_LABELS[status.status] || STATUS_LABELS.PENDING;
  const networkLabel = networkStatus.isOnline() ? '🟢 متصل' : '⚪ عدم الاتصال';
  const peers = status.peers.map(peer => `<li><b>${escapeText(peer.deviceName)}</b><small>${escapeText(peer.deviceId)} · آخر تواصل ${escapeText(dateLabel(peer.lastSyncAt))}</small>${peer.remoteConflictCount ? `<span class="sync-chip is-conflict">${peer.remoteConflictCount} تعارض لدى الجهاز الآخر</span>` : ''}</li>`).join('');
  const conflictRows = conflicts.map(conflict => `<article class="sync-conflict-row"><div><b>${escapeText(conflict.entity)}</b><small>المعرّف: <code>${escapeText(conflict.entityId)}</code> · الجهاز: ${escapeText(conflict.peerDeviceName || 'جهاز آخر')} · ${escapeText(dateLabel(conflict.detectedAt))}</small></div><button class="ghost" type="button" data-review-conflict="${escapeText(conflict.id)}">مراجعة القيمتين</button></article>`).join('');
  const logRows = history.map(row => `<li><span><b>${escapeText(row.summary || 'نشاط مزامنة')}</b><small>${escapeText(row.action || '')} · ${escapeText(dateLabel(row.timestamp))}</small></span><span class="sync-chip">${Number(row.metadata?.changes || 0)} تغيير · ${Number(row.metadata?.conflicts || 0)} تعارض</span></li>`).join('');
  const baselineText = status.baselineComplete
    ? 'اكتمل خط الأساس.'
    : `لم يُنشأ خط الأساس بعد. سجلات محلية مرشحة للفحص: ${status.baselinePending.toLocaleString('ar-EG')} (تقدير، يُفحص على دفعات بعد التأكيد).`;
  return `<div class="page-head sync-page-head"><div><h2>المزامنة بين الأجهزة</h2><p>تبادل تغييرات فقط بين الكمبيوتر والهاتف والمتصفح، مع حفظ البيانات محليًا في IndexedDB.</p></div><span class="sync-network">${networkLabel}</span></div>
  <section class="sync-status-grid" aria-label="حالة المزامنة">
    <article class="panel sync-status-card"><span>حالة المزامنة</span><strong class="sync-chip ${statusClass}">${escapeText(statusLabel)}</strong><small>${networkLabel} — حالة الشبكة منفصلة عن حالة المزامنة.</small></article>
    <article class="panel sync-status-card"><span>آخر مزامنة</span><strong>${escapeText(dateLabel(status.lastSyncAt))}</strong><small>${status.peers.length ? `${status.peers.length} جهاز${status.peers.length === 1 ? '' : 'ات'} معروف` : 'لم يتم تبادل حزم مع جهاز آخر بعد.'}</small></article>
    <article class="panel sync-status-card"><span>تغييرات محلية معلّقة</span><strong>${status.pendingChanges.toLocaleString('ar-EG')}</strong><small>${status.pendingLogChanges.toLocaleString('ar-EG')} تغييرًا مسجلًا · ${status.baselinePending.toLocaleString('ar-EG')} سجلًا مرشحًا لخط الأساس.</small></article>
    <article class="panel sync-status-card"><span>التعارضات المحلية</span><strong>${status.unresolvedConflicts.toLocaleString('ar-EG')}</strong><small>لن تُستبدل القيم المتعارضة تلقائيًا.</small></article>
  </section>
  <section class="panel sync-device-panel"><div><h3>هذا الجهاز</h3><p>Device ID: <code dir="ltr">${escapeText(status.deviceId)}</code></p></div><form id="sync-device-form" class="sync-device-form"><label>اسم الجهاز<input name="deviceName" maxlength="80" value="${escapeText(getDeviceName())}" required></label><button class="ghost" type="submit">حفظ الاسم</button></form></section>
  <section class="panel sync-action-panel" data-collapse-default="open"><h3>مزامنة الآن</h3><p>اختر حزمة واردة من الجهاز الآخر إن وجدت. إذا لم تختر ملفًا، ستُنشأ حزمة تغييرات صادرة فقط لتبادلها يدويًا.</p><div class="sync-actions"><label class="file-input sync-file-label">اختيار حزمة من جهاز آخر<input id="sync-incoming-file" type="file" accept="application/json,.json"></label><span id="sync-file-name" class="muted small">لم يتم اختيار ملف وارد.</span><button class="primary" id="sync-now" type="button">🔄 مزامنة الآن</button></div><div class="notice sync-warning"><b>قبل المتابعة:</b> سيظهر ملخص بالأجهزة والتغييرات والتعارضات. بعد التأكيد تُنشأ نسخة احتياطية كاملة باستخدام نظام النسخ الحالي. حزم الأجهزة مشفرة بـ AES-256-GCM؛ استخدم كلمة مرور مشتركة قوية (12 حرفًا على الأقل) وشاركها بقناة منفصلة. كلمة المرور لا تُحفظ. ملاحظة: النسخة الاحتياطية الحالية بصيغة JSON غير مشفرة؛ احفظ الملف في موقع موثوق. لا يبدأ أي نقل أو مزامنة تلقائيًا عند عودة الإنترنت.</div><p id="sync-progress" class="muted small" role="status" aria-live="polite">${escapeText(baselineText)}</p></section>
  <section class="sync-lower-grid"><article class="panel"><h3>الأجهزة المعروفة</h3>${peers ? `<ul class="sync-peer-list">${peers}</ul>` : '<p class="muted">لا توجد أجهزة معروفة. ابدأ بإنشاء حزمة، واستوردها على الجهاز الآخر، ثم تبادلا حزم الرد حتى يتأكد الطرفان من الاستلام.</p>'}</article>
  <article class="panel"><h3>التعارضات</h3>${conflictRows || '<p class="muted">لا توجد تعارضات تحتاج مراجعة.</p>'}</article></section>
  <section class="panel sync-history-panel"><h3>سجل المزامنة</h3>${logRows ? `<ul class="sync-history-list">${logRows}</ul>` : '<p class="muted">لا توجد عمليات مزامنة سابقة. يُعاد استخدام Activity Log الموجود.</p>'}</section>
  <section class="notice sync-provider-note"><b>وسيلة النقل الحالية:</b> حزمة ملف مشفرة بـ AES-256-GCM وتعمل Offline، ولا تحتاج إلى Google Drive أو خادم. يمكن إضافة Google Drive أو LAN أو API لاحقًا كـ <code>SyncTransportAdapter</code> دون ربطها بطبقة IndexedDB.</section>`;
}

export async function bindSyncPage(app) {
  const fileInput = document.querySelector('#sync-incoming-file');
  const fileLabel = document.querySelector('#sync-file-name');
  const runButton = document.querySelector('#sync-now');
  fileInput?.addEventListener('change', () => { fileLabel.textContent = fileInput.files?.[0]?.name || 'لم يتم اختيار ملف وارد.'; });
  document.querySelector('#sync-device-form')?.addEventListener('submit', event => {
    event.preventDefault();
    try { setDeviceName(new FormData(event.currentTarget).get('deviceName')); toast('تم حفظ اسم الجهاز'); }
    catch (error) { toast(error.message, 'error'); }
  });
  runButton?.addEventListener('click', async () => {
    runButton.disabled = true;
    let passphrase = '';
    try {
      const incomingFile = fileInput?.files?.[0] || null;
      if (incomingFile) {
        passphrase = await requestTransferPassphrase({confirmRepeat: false});
        if (!passphrase) return;
      }
      const incoming = incomingFile ? await fileExchangeTransport.readIncoming(incomingFile, {passphrase}) : null;
      const status = await syncStatus(app.ctx);
      const plan = incoming ? await previewSyncBundle(app.ctx, incoming) : {
        peerDeviceId: '', peerDeviceName: 'لم يتم اختيار جهاز وارد', lastSyncAt: status.lastSyncAt,
        localChanges: status.pendingChanges, localLogChanges: status.pendingLogChanges,
        baselinePending: status.baselinePending, remoteChanges: 0,
        conflicts: 0, existingConflicts: status.unresolvedConflicts, bundleHasMore: false,
        noChanges: status.pendingChanges === 0
      };
      const accepted = await confirmSyncSummary(plan, Boolean(incoming));
      if (!accepted) return;
      if (!passphrase) {
        passphrase = await requestTransferPassphrase({confirmRepeat: true});
        if (!passphrase) return;
      }
      await backupBeforeSync(app);
      updateProgress('تم إنشاء نسخة الأمان. تجهيز خط الأساس على دفعات…');
      const baseline = await initializeSyncBaseline(app.ctx, {
        onProgress: progress => updateProgress(`خط الأساس: ${progress.scanned.toLocaleString('ar-EG')} من نحو ${progress.total.toLocaleString('ar-EG')} سجلًا · ${progress.generated.toLocaleString('ar-EG')} تغيير مسجل.`)
      });
      let result = null;
      if (incoming) {
        result = await applySyncBundle(app.ctx, incoming, {
          onProgress: progress => updateProgress(`استيراد التغييرات: ${progress.processed.toLocaleString('ar-EG')} من ${progress.total.toLocaleString('ar-EG')} · تعارضات جديدة ${progress.conflicts}.`)
        });
      }
      const outgoing = await createSyncBundle(app.ctx, {peerKnownVector: incoming?.knownVector || {}});
      await fileExchangeTransport.deliver(outgoing, {passphrase});
      await recordSyncExport(app.ctx, outgoing);
      fileInput.value = '';
      fileLabel.textContent = 'لم يتم اختيار ملف وارد.';
      updateProgress(outgoing.hasMore
        ? `أُنجزت دفعة. توجد تغييرات إضافية؛ كرر إنشاء/تبادل الحزم. خط أساس أُضيف: ${baseline.generated.toLocaleString('ar-EG')}.`
        : `تم إنشاء حزمة الرد (${outgoing.changes.length} تغيير). انقلها إلى الجهاز الآخر؛ لا تكتمل المصافحة حتى يستورد الطرفان حزمة الرد.`);
      if (result?.conflicts) toast(`تمت المزامنة مع ${result.conflicts} تعارض يحتاج اختيارًا يدويًا. لم تُستبدل القيم المحلية.`, 'warn', {duration: 7000});
      else toast('تم إنشاء حزمة التغييرات بعد نسخة الأمان. انقلها يدويًا إلى الجهاز الآخر.', 'ok', {duration: 6500});
      if (app.route === 'sync') await app.refresh();
    } catch (error) {
      console.error('sync operation', error);
      toast(error.message || 'تعذرت المزامنة. التغييرات المحفوظة محليًا لم تُحذف؛ أعد المحاولة.', 'error', {duration: 7000});
      updateProgress(`لم تكتمل العملية: ${error.message || 'خطأ غير معروف'}. يمكن إعادة استيراد الحزمة بأمان؛ Change ID يمنع تكرار ما نجح.`);
    } finally {
      passphrase = '';
      if (runButton?.isConnected) runButton.disabled = false;
    }
  });
  document.querySelectorAll('[data-review-conflict]').forEach(button => button.addEventListener('click', () => reviewConflict(app, button.dataset.reviewConflict)));
}

function updateProgress(message) {
  const element = document.querySelector('#sync-progress');
  if (element) element.textContent = String(message || '');
}

function requestTransferPassphrase({confirmRepeat = false} = {}) {
  return new Promise(resolve => {
    const card = modal(`<h2>كلمة مرور حزمة المزامنة</h2><p>أدخل كلمة مرور مشتركة وقوية من ${SYNC_PASSPHRASE_MIN_LENGTH} أحرف على الأقل. استخدم الكلمة نفسها على الجهاز الآخر؛ لن تُحفظ في التطبيق أو داخل الملف.</p><label>كلمة المرور المشتركة<input type="password" data-sync-passphrase autocomplete="new-password" minlength="${SYNC_PASSPHRASE_MIN_LENGTH}" required></label>${confirmRepeat ? '<label>إعادة كلمة المرور<input type="password" data-sync-passphrase-repeat autocomplete="new-password" required></label>' : ''}<p class="muted small sync-pass-error" role="alert"></p><div class="form-actions"><button class="primary" type="button" data-passphrase-submit>متابعة</button><button class="ghost" type="button" data-passphrase-cancel>إلغاء</button></div>`);
    const input = card.querySelector('[data-sync-passphrase]');
    const error = card.querySelector('.sync-pass-error');
    const finish = value => { closeModal(); resolve(value); };
    const submit = () => {
      const value = input.value;
      if ([...value.normalize('NFC')].length < SYNC_PASSPHRASE_MIN_LENGTH) { error.textContent = `يجب ألا تقل كلمة المرور عن ${SYNC_PASSPHRASE_MIN_LENGTH} أحرف.`; input.focus(); return; }
      const repeated = card.querySelector('[data-sync-passphrase-repeat]');
      if (repeated && value.normalize('NFC') !== repeated.value.normalize('NFC')) { error.textContent = 'كلمتا المرور غير متطابقتين.'; repeated.focus(); return; }
      finish(value);
    };
    card.querySelector('[data-passphrase-submit]').onclick = submit;
    card.querySelector('[data-passphrase-cancel]').onclick = () => finish('');
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    card.querySelector('[data-sync-passphrase-repeat]')?.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); submit(); } });
    card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(button => button.addEventListener('click', () => resolve('')));
    input.focus();
  });
}

function confirmSyncSummary(plan, hasIncoming) {
  return new Promise(resolve => {
    const card = modal(`<h2>ملخص المزامنة قبل التنفيذ</h2><dl class="sync-summary-list"><div><dt>الجهاز الآخر</dt><dd>${escapeText(plan.peerDeviceName || 'غير محدد — حزمة صادرة فقط')}</dd></div><div><dt>آخر مزامنة</dt><dd>${escapeText(dateLabel(plan.lastSyncAt))}</dd></div><div><dt>التغييرات المحلية</dt><dd>${Number(plan.localChanges || 0).toLocaleString('ar-EG')}</dd></div><div><dt>التغييرات الواردة الجديدة</dt><dd>${Number(plan.remoteChanges || 0).toLocaleString('ar-EG')}</dd></div><div><dt>التعارضات المتوقعة</dt><dd>${Number(plan.conflicts || 0).toLocaleString('ar-EG')}</dd></div><div><dt>تعارضات سابقة للمراجعة</dt><dd>${Number(plan.existingConflicts || 0).toLocaleString('ar-EG')}</dd></div></dl><p class="notice">${hasIncoming ? `ستُعالج ${Number(plan.remoteChanges || 0)} تغييرًا واردًا على دفعات. التغييرات المكررة تُتجاوز بواسطة Change ID، والتعارضات تُحفظ للمراجعة.` : 'لم يتم اختيار حزمة واردة؛ سيُنشأ ملف حزمة صادر فقط بعد الموافقة.'} ستُنشأ نسخة احتياطية كاملة قبل أي كتابة مؤثرة. لا يحدث أي تغيير قبل الضغط على «تأكيد المزامنة».</p><div class="form-actions"><button class="primary" type="button" data-confirm-sync>تأكيد المزامنة</button><button class="ghost" type="button" data-cancel-sync>إلغاء</button></div>`);
    const finish = value => { closeModal(); resolve(value); };
    card.querySelector('[data-confirm-sync]').onclick = () => finish(true);
    card.querySelector('[data-cancel-sync]').onclick = () => finish(false);
    card.querySelectorAll('[data-close],[data-modal-back],[data-modal-home]').forEach(button => button.addEventListener('click', () => resolve(false)));
  });
}

async function backupBeforeSync(app) {
  updateProgress('إنشاء نسخة أمان كاملة قبل تطبيق أي تغيير…');
  const backup = await exportDatabase(app.ctx);
  downloadJSON(backup, `law-office-pre-sync-${app.ctx.profile?.id || 'database'}-${Date.now()}.json`);
  return backup;
}

async function reviewConflict(app, conflictId) {
  const [conflict] = await listSyncConflicts(app.ctx, {limit: 500});
  let selected = conflict?.id === conflictId ? conflict : null;
  if (!selected) {
    // A resolved row can be reviewed only while pending through this screen; fetch directly by ID if it is not in the first page.
    const req = app.ctx.db.transaction('syncConflicts', 'readonly').objectStore('syncConflicts').get(conflictId);
    selected = await new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); });
  }
  if (!selected || selected.status !== 'pending') return toast('لم يعد هذا التعارض معلقًا. حدّث الصفحة.', 'warn');
  const card = modal(`<h2>مراجعة تعارض — ${escapeText(selected.entity)}</h2><p>السجل: <code>${escapeText(selected.entityId)}</code> · الجهاز البعيد: ${escapeText(selected.peerDeviceName || 'جهاز آخر')}</p><div class="sync-values-grid"><details open><summary>القيمة المحلية — لا تُستبدل تلقائيًا</summary><pre>${escapeText(jsonText(selected.local))}</pre></details><details open><summary>القيمة البعيدة — Change ID ${escapeText(selected.remoteChangeId)}</summary><pre>${escapeText(jsonText(selected.remote))}</pre></details></div><label class="sync-manual-label">دمج يدوي (JSON كامل للسجل)<textarea data-manual-merge rows="12" spellcheck="false">${escapeText(jsonText(selected.local))}</textarea></label><p class="muted small">اختيار «المحلي» أو «البعيد» ينشئ تغيير قرار جديدًا متزامنًا؛ تبقى القيمتان الأصليتان محفوظتين في سجل التعارض.</p><div class="form-actions"><button class="ghost" type="button" data-resolve="local">الاحتفاظ بالمحلي</button><button class="ghost" type="button" data-resolve="remote">الاحتفاظ بالبعيد</button><button class="primary" type="button" data-resolve="manual">اعتماد الدمج اليدوي</button><button class="ghost" type="button" data-close>إلغاء</button></div>`);
  card.querySelectorAll('[data-resolve]').forEach(button => button.addEventListener('click', async () => {
    const choice = button.dataset.resolve;
    let manual = null;
    if (choice === 'manual') {
      try { manual = JSON.parse(card.querySelector('[data-manual-merge]').value); }
      catch { toast('صيغة الدمج اليدوي ليست JSON صالحًا.', 'error'); return; }
    }
    button.disabled = true;
    try {
      const backup = await exportDatabase(app.ctx);
      downloadJSON(backup, `law-office-pre-conflict-${app.ctx.profile?.id || 'database'}-${Date.now()}.json`);
      await resolveSyncConflict(app.ctx, conflictId, choice, manual);
      closeModal();
      toast('تم حفظ القرار كتغيير مزامنة جديد، مع الاحتفاظ بسجل القيمتين.');
      if (app.route === 'sync') await app.refresh();
    } catch (error) { button.disabled = false; toast(error.message || 'تعذر حفظ قرار التعارض.', 'error'); }
  }));
}
