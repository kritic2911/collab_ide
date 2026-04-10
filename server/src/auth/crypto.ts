import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

// Lazy-initialize the encryption key so dotenv has time to load.
// ES module imports are hoisted above top-level code, which means
// reading process.env at module-evaluation time may see empty values.
let _key: Buffer | null = null;

function getKey(): Buffer {
  if (_key) return _key;

  const rawKey = process.env.ENCRYPTION_KEY;
  if (!rawKey || rawKey.length !== 32) {
    console.error(
      '❌ ENCRYPTION_KEY must be exactly 32 characters for AES-256. ' +
      `Got ${rawKey ? rawKey.length : 0} characters.`
    );
    process.exit(1);
  }
  _key = Buffer.from(rawKey, 'utf8');
  return _key;
}

/**
 * Encrypt plaintext using AES-256-CBC.
 * @returns `iv:ciphertextHex` format
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
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
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
}