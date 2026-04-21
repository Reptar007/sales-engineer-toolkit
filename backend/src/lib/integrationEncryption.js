import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended for GCM
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function integrationKey() {
  const raw = process.env.INTEGRATION_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error('INTEGRATION_ENCRYPTION_KEY is not set');
  }
  const fromB64 = Buffer.from(raw, 'base64');
  if (fromB64.length === KEY_LENGTH) {
    return fromB64;
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

/**
 * @param {string} plaintext
 * @returns {string} base64-encoded blob (iv + tag + ciphertext)
 */
export function encryptIntegrationSecret(plaintext) {
  const key = integrationKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * @param {string} stored base64 from encryptIntegrationSecret
 * @returns {string}
 */
export function decryptIntegrationSecret(stored) {
  const key = integrationKey();
  const buf = Buffer.from(stored, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
