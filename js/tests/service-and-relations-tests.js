// v13 regression tests: flexible file parties, hearing chains, service records and additive backfill.
import { upgradeSchema } from '../db/schema.js';
import { Office } from '../services/office.js';
import { createLegalFile, saveParty, moveParty } from '../services/legal-files.js';
import { saveOperational, hearingCycle } from '../services/operations.js';
import { saveServiceRecord, saveBailiff, reannounceServiceRecord, serviceCycle, fileServiceRecords } from '../services/service-records.js';
import { migrateSchema13Data } from '../services/maintenance.js';

export async function runServiceAndRelationsTests(test, expect) {
  const name = `AhmadKhudairLawOfficeDB__test__v13__${Date.now()}`;
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 13);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const office = new Office({ db, assert() {}, token: 'test-v13', profile: { id: 'test-v13' } });
  const out = {};
  try {
    const client = await office.saveClient({ fullName: 'موكل اختبار الإصدار الثالث عشر' });
    const file = await createLegalFile(office, { clientId: client.id, title: 'ملف اختبار v13', fileType: 'مدني' });
    const stage = await office.createCase({ fileId: file.id, stageType: 'دعوى', caseNumber: '100', caseYear: '2026' });
    out.file = file; out.stage = stage;

    const externalOne = await saveParty(office, { fileId: file.id, partyKind: 'other', name: 'طرف أول', role: 'مدعى عليه' });
    const externalTwo = await saveParty(office, { fileId: file.id, partyKind: 'other', name: 'طرف ثانٍ', role: 'مدعى عليه' });
    out.partyGroup = externalOne.roleGroup;
    await moveParty(office, externalTwo.id, -1);
    out.partyOrder = await office.r.fileParties.byIndexAll('fileId', file.id);
    let duplicateBlocked = false;
    try { await saveParty(office, { fileId: file.id, partyKind: 'client', clientId: client.id, role: 'موكل' }); }
    catch (e) { duplicateBlocked = Boolean(e.details?.duplicateParty); }
    out.duplicateBlocked = duplicateBlocked;
    out.duplicateAllowed = await saveParty(office, { fileId: file.id, partyKind: 'client', clientId: client.id, role: 'موكل', allowDuplicate: true });

    const firstHearing = await saveOperational(office, 'hearings', {
      caseId: stage.id, hearingDate: '2026-10-01', type: 'نظر', result: 'قرار سابق', notes: 'ملاحظات الجلسة السابقة', adjournedTo: '2026-10-15', nextAction: 'متابعة'
    });
    const hearingChildren = await office.r.hearings.byIndex('previousHearingId', firstHearing.id, 20);
    out.firstHearing = firstHearing; out.followUp = hearingChildren[0];
    out.hearingCycle = await hearingCycle(office, firstHearing.id);
    const updated = await saveOperational(office, 'hearings', { ...firstHearing, adjournedTo: '2026-10-20' }, firstHearing.id);
    out.updatedFollowUp = (await office.r.hearings.get(hearingChildren[0]?.id))?.hearingDate;
    out.updatedFlag = Boolean(updated.__followUpUpdated);
    let hearingCycleBlocked = false;
    try { await saveOperational(office, 'hearings', { ...firstHearing, previousHearingId: hearingChildren[0]?.id }, firstHearing.id); }
    catch { hearingCycleBlocked = true; }
    out.hearingCycleBlocked = hearingCycleBlocked;

    const bailiff = await saveBailiff(office, { name: 'محضر اختبار', court: 'محكمة اختبار', section: 'قسم اختبار', office: 'مكتب اختبار' });
    const inactiveBailiff = await saveBailiff(office, { name: 'محضر غير نشط', isActive: false });
    out.bailiff = bailiff; out.inactiveBailiff = inactiveBailiff;
    out.selectableBailiffs = await office.r.bailiffs.byIndex('activeStatus', 'active', 1000);
    const service = await saveServiceRecord(office, {
      fileId: file.id, caseId: stage.id, partyId: externalOne.id, type: 'إعلان صحيفة دعوى', actionType: 'إعلان',
      bailiffId: bailiff.id, status: 'تعذر الإعلان', result: 'عدم الاستدلال', serviceDate: '2026-10-02', address: 'عنوان اختبار', notes: 'نتيجة محفوظة'
    });
    const relaunch = await reannounceServiceRecord(office, service.id);
    const deletedService = await saveServiceRecord(office, { fileId: file.id, actionType: 'إعلان', type: 'اختبار محذوف', status: 'مسودة' });
    await office.softDelete('serviceRecords', deletedService.id, deletedService.version);
    out.service = service; out.relaunch = relaunch; out.deletedService = deletedService;
    out.serviceCycle = await serviceCycle(office, relaunch.id);
    out.serviceCount = await fileServiceRecords(office, file.id);

    // Simulate rows written by an older schema and verify incremental backfill is additive.
    await office.r.fileParties.put({ id: 'legacy-party-v13-test', fileId: file.id, partyKind: 'other', name: 'طرف تاريخي', role: 'مدعٍ', isDeleted: false, createdAt: '2020-01-01T00:00:00.000Z' });
    await office.r.hearings.put({ id: 'legacy-hearing-v13-test', fileId: file.id, caseId: stage.id, hearingDate: '2020-01-01', isDeleted: false });
    await office.r.serviceRecords.put({ id: 'legacy-service-v13-test', fileId: file.id, actionType: 'إعلان', status: 'مسودة', isDeleted: false });
    await office.r.bailiffs.put({ id: 'legacy-bailiff-v13-test', name: 'محضر تاريخي', isActive: false, isDeleted: false });
    out.backfill = await migrateSchema13Data(office, 2);
    out.backfilledParty = await office.r.fileParties.get('legacy-party-v13-test');
    out.backfilledHearing = await office.r.hearings.get('legacy-hearing-v13-test');
    out.backfilledService = await office.r.serviceRecords.get('legacy-service-v13-test');
    out.backfilledBailiff = await office.r.bailiffs.get('legacy-bailiff-v13-test');
    out.legacyFileStillExists = Boolean(await office.r.files.get(file.id));
  } finally {
    db.close();
    try { indexedDB.deleteDatabase(name); } catch {}
  }

  test('v13: party role groups and reorder sequence persist', () => {
    expect(out.partyGroup).toBe('المدعى عليهم');
    const rows = out.partyOrder.filter(x => x.roleGroup === out.partyGroup).sort((a,b) => a.sequence-b.sequence);
    expect(rows[0]?.id).toBe(out.partyOrder.find(x => x.name === 'طرف ثانٍ')?.id);
  });
  test('v13: duplicate registered client link requires explicit override', () => {
    expect(out.duplicateBlocked).toBe(true);
    expect(Boolean(out.duplicateAllowed?.id)).toBe(true);
  });
  test('v13: adjournment creates an independent linked next hearing without copying result/notes', () => {
    expect(Boolean(out.firstHearing.__followUpCreated)).toBe(true);
    expect(out.followUp.previousHearingId).toBe(out.firstHearing.id);
    expect(out.followUp.hearingDate).toBe('2026-10-15');
    expect(out.followUp.result).toBe('');
    expect(out.followUp.notes).toBe('');
    expect(out.hearingCycle.items.length).toBe(2);
  });
  test('v13: changing adjournment date updates only generated follow-up and prevents cycles', () => {
    expect(out.updatedFlag).toBe(true);
    expect(out.updatedFollowUp).toBe('2026-10-20');
    expect(out.hearingCycleBlocked).toBe(true);
  });
  test('v13: bailiff and service record create/relaunch retain history with new internal numbers', () => {
    expect(out.service.internalNumber!==out.relaunch.internalNumber).toBe(true);
    expect(out.relaunch.previousServiceId).toBe(out.service.id);
    expect(out.relaunch.actionType).toBe('إعادة إعلان');
    expect(out.relaunch.result).toBe('');
    expect(out.serviceCycle.records.length).toBe(2);
    expect(out.serviceCount.total).toBe(2);
    expect(out.serviceCount.rows.some(row => row.id === out.deletedService.id)).toBe(false);
    expect(out.bailiff.isActive).toBe(true);
    expect(out.selectableBailiffs.some(row => row.id === out.bailiff.id)).toBe(true);
    expect(out.selectableBailiffs.some(row => row.id === out.inactiveBailiff.id)).toBe(false);
  });
  test('v13: resumable additive backfill fills legacy fields and preserves the file', () => {
    expect(out.backfill.complete).toBe(true);
    expect(out.backfilledParty.partyName).toBe('طرف تاريخي');
    expect(out.backfilledParty.roleGroup).toBe('المدعون');
    expect(out.backfilledParty.sequence).toBe(1);
    expect(out.backfilledHearing.stageId).toBe(out.stage.id);
    expect(out.backfilledService.recordState).toBe('active');
    expect(out.backfilledBailiff.activeStatus).toBe('inactive');
    expect(out.legacyFileStillExists).toBe(true);
  });
}
