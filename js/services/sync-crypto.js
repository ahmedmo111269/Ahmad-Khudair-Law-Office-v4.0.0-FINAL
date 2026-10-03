export const ENCRYPTED_SYNC_FORMAT = 'AhmadKhudairLawOfficeEncryptedSync';
export const ENCRYPTED_SYNC_VERSION = 1;
export const SYNC_PASSPHRASE_MIN_LENGTH = 12;
const ITERATIONS = 310_000;
const KDF = 'PBKDF2-SHA-256';
const CIPHER = 'AES-256-GCM';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal: true});

function webCrypto() {
  const crypto = globalThis.crypto;
  if (!crypto?.subtle || typeof crypto.getRandomValues !== 'function') throw new Error('التشفير الآمن غير متاح في هذا المتصفح أو السياق. افتح التطبيق عبر HTTPS أو localhost.');
  return crypto;
}
function normalizePassphrase(value) {
  const passphrase = String(value ?? '').normalize('NFC');
  if ([...passphrase].length < SYNC_PASSPHRASE_MIN_LENGTH) throw new Error(`استخدم كلمة مرور مشتركة من ${SYNC_PASSPHRASE_MIN_LENGTH} أحرف على الأقل.`);
  return passphrase;
}
function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}
function fromBase64(value, label) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new Error(`بيانات ${label} في الحزمة المشفرة غير صالحة.`);
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw new Error(`تعذر فك ترميز ${label} في الحزمة المشفرة.`); }
}
function additionalData(iterations) { return encoder.encode(`${ENCRYPTED_SYNC_FORMAT}:${ENCRYPTED_SYNC_VERSION}:${KDF}:${iterations}:${CIPHER}`); }
async function deriveKey(passphrase, salt, crypto) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(normalizePassphrase(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:ITERATIONS}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
}

/** Encrypts the complete sync envelope. The passphrase is never stored or included in the output. */
export async function encryptSyncEnvelope(envelope, passphrase) {
  const crypto = webCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, crypto);
  const plaintext = encoder.encode(JSON.stringify(envelope));
  const encrypted = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:additionalData(ITERATIONS),tagLength:128}, key, plaintext);
  return {
    format: ENCRYPTED_SYNC_FORMAT,
    version: ENCRYPTED_SYNC_VERSION,
    kdf: KDF,
    iterations: ITERATIONS,
    cipher: CIPHER,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(encrypted))
  };
}

/** Authenticates and decrypts an encrypted file. Invalid passwords and modified files fail closed. */
export async function decryptSyncEnvelope(container, passphrase) {
  const crypto = webCrypto();
  if (!container || typeof container !== 'object' || container.format !== ENCRYPTED_SYNC_FORMAT || Number(container.version) !== ENCRYPTED_SYNC_VERSION) throw new Error('الحزمة ليست بصيغة مزامنة مشفرة مدعومة.');
  if (container.kdf !== KDF || container.cipher !== CIPHER || Number(container.iterations) !== ITERATIONS) throw new Error('إعدادات تشفير الحزمة غير مدعومة أو غير آمنة.');
  const salt = fromBase64(container.salt, 'salt'), iv = fromBase64(container.iv, 'IV'), ciphertext = fromBase64(container.ciphertext, 'النص المشفر');
  if (salt.length !== 16 || iv.length !== 12 || ciphertext.length < 16 || ciphertext.length > 10 * 1024 * 1024) throw new Error('حجم مكونات الحزمة المشفرة غير صالح.');
  try {
    const key = await deriveKey(passphrase, salt, crypto);
    const plaintext = await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:additionalData(ITERATIONS),tagLength:128}, key, ciphertext);
    return JSON.parse(decoder.decode(plaintext));
  } catch {
    throw new Error('تعذر فك الحزمة: كلمة المرور غير مطابقة أو الملف عُدّل/تلف. لم تُغيّر أي بيانات.');
  }
}
