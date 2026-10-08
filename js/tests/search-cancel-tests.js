// اختبارات إلغاء البحث: نص جديد يُجهض المسح السابق، ولا تُرجع نتائج قديمة أبدًا.
import {searchAll, searchStore, isAbortError} from '../services/search-engine.js';
import {upgradeSchema} from '../db/schema.js';
import {uid} from '../core/id.js';
import {Office} from '../services/office.js';

export async function runSearchCancelTests(test, expect) {
  const name = `AhmadKhudairLawOfficeDB__test__cancel__${Date.now()}`;
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(name, 13);
    r.onupgradeneeded = e => upgradeSchema(r.result, e.target.transaction);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const office = new Office({db, assert() {}, token: 't', profile: {id: 'cancel-test'}});
  const out = {};
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < 400; i++) {
      await office.r.clients.add({id: uid(), fullName: `موكل رقم ${i} اختبار الإلغاء`, fullNameNormalized: `موكل رقم ${i} اختبار الالغاء`, nationalId: String(29000000000000 + i), phones: [], createdAt: now, updatedAt: now, version: 1, isDeleted: false});
    }
    out.known = await searchAll(office, 'اختبار الإلغاء', {stores: ['clients'], perStore: 5});
    const ctl = new AbortController();
    ctl.abort();
    out.preAborted = await searchAll(office, 'اختبار', {signal: ctl.signal});
    out.storeAborted = await searchStore(office, 'clients', 'اختبار', {signal: ctl.signal}).then(() => null, e => e);
    const mid = new AbortController();
    const pending = searchAll(office, 'كلمة غير موجودة إطلاقًا', {stores: ['clients', 'files', 'cases'], perStore: 8, signal: mid.signal});
    mid.abort();
    out.midAborted = await pending;
  } finally {
    db.close();
    try { indexedDB.deleteDatabase(name); } catch {}
  }

  test('البحث بلا إلغاء يعمل كما قبل (regression)', () => {
    expect(out.known.groups.length).toBe(1);
    expect(out.known.groups[0].items.length).toBe(5);
    expect(out.known.aborted).toBe(undefined);
  });
  test('نص أُلغي قبل البدء لا يرجع نتائج ولا يقرأ المخازن', () => {
    expect(out.preAborted.aborted).toBe(true);
    expect(out.preAborted.groups.length).toBe(0);
    expect(out.preAborted.total).toBe(0);
  });
  test('searchStore يرمي AbortError عند الإلغاء (لا يُبتلع كخطأ عادي)', () => {
    expect(isAbortError(out.storeAborted)).toBe(true);
  });
  test('الإلغاء أثناء المسح يُرجع aborted بلا نتائج قديمة', () => {
    expect(out.midAborted.aborted).toBe(true);
    expect(out.midAborted.groups.length).toBe(0);
  });
}
