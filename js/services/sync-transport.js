import {downloadJSON} from './backup.js';
import {ENCRYPTED_SYNC_FORMAT, decryptSyncEnvelope, encryptSyncEnvelope} from './sync-crypto.js';

export const SYNC_PACKAGE_FORMAT = 'AhmadKhudairLawOfficeSync';
export const SYNC_PACKAGE_VERSION = 1;
export const MAX_SYNC_PACKAGE_CHARS = 12 * 1024 * 1024;

/** Transport boundary. Engine code consumes validated envelopes, never fetches or touches a provider directly. */
export class SyncTransportAdapter {
  constructor({id = 'abstract', onlineRequired = false} = {}) {
    this.id = id;
    this.onlineRequired = Boolean(onlineRequired);
  }
  async readIncoming() { throw new Error(`Sync transport ${this.id} does not implement readIncoming().`); }
  async deliver() { throw new Error(`Sync transport ${this.id} does not implement deliver().`); }
}

/** User-mediated JSON file exchange works between a computer, phone, browser profile, USB, or local share. */
export class FileExchangeSyncTransportAdapter extends SyncTransportAdapter {
  constructor() { super({id: 'file-exchange', onlineRequired: false}); }

  async readIncoming(file, {passphrase = ''} = {}) {
    if (!file) return null;
    if (Number(file.size || 0) > MAX_SYNC_PACKAGE_CHARS) throw new Error('حزمة المزامنة أكبر من الحد الآمن (12 MB). قسّم التبادل إلى دفعات أصغر.');
    let text;
    try { text = await file.text(); }
    catch { throw new Error('تعذرت قراءة ملف حزمة المزامنة.'); }
    if (text.length > MAX_SYNC_PACKAGE_CHARS) throw new Error('حزمة المزامنة أكبر من الحد الآمن (12 MB).');
    let payload;
    try { payload = JSON.parse(text); }
    catch { throw new Error('الملف المحدد ليس حزمة مزامنة JSON صالحة.'); }
    if (payload?.format !== ENCRYPTED_SYNC_FORMAT) throw new Error('حزمة المزامنة غير مشفرة. لن تُستورد بيانات قانونية من ملف مكشوف. أنشئ حزمة مشفرة من الإصدار الحالي.');
    return decryptSyncEnvelope(payload, passphrase);
  }

  async deliver(envelope, {passphrase = ''} = {}) {
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    const encrypted = await encryptSyncEnvelope(envelope, passphrase);
    downloadJSON(encrypted, `law-office-sync-encrypted-${suffix}.json`);
    return {delivered: true, transport: this.id, packageId: envelope?.packageId || '', encrypted: true};
  }
}

export const fileExchangeTransport = new FileExchangeSyncTransportAdapter();
