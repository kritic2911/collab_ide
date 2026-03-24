import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

// Validate ENCRYPTION_KEY on module load — fail fast
const rawKey = process.env.ENCRYPTION_KEY;
if (!rawKey || rawKey.length !== 32) {
  console.error(
    '❌ ENCRYPTION_KEY must be exactly 32 characters for AES-256. ' +
    `Got ${rawKey ? rawKey.length : 0} characters.`
  );
  process.exit(1);
}
const KEY = Buffer.from(rawKey, 'utf8');

/**
 * Encrypt plaintext using AES-256-CBC.
 * @returns `iv:ciphertextHex` format
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypt ciphertext produced by encrypt().
 * @param ciphertext `iv:encryptedHex` format
 */
export function decrypt(ciphertext: string): string {
  const [ivHex, encHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}