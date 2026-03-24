import { db } from '../db/client.js';
import { encrypt, decrypt } from '../auth/crypto.js';

/**
 * Get a decrypted GitHub token for a user.
 * Returns null if user has no stored token.
 */
export async function getGithubToken(userId: number): Promise<string | null> {
  const result = await db.query<{ github_token: string | null }>(
    'SELECT github_token FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].github_token) {
    return null;
  }

  return decrypt(result.rows[0].github_token);
}

/**
 * Encrypt and store a GitHub token for a user.
 */
export async function setGithubToken(userId: number, plainToken: string): Promise<void> {
  const encrypted = encrypt(plainToken);
  await db.query(
    'UPDATE users SET github_token = $1, updated_at = NOW() WHERE id = $2',
    [encrypted, userId]
  );
}
