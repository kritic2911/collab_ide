import { Strategy as GitHubStrategy, Profile } from 'passport-github2';
import bcrypt from 'bcryptjs';
import { db } from '../db/client.js';
import { encrypt } from './crypto.js';

const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1',
  '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8',
];

/** Pick color by round-robin based on current user count */
async function pickColor(): Promise<string> {
  const result = await db.query<{ count: string }>('SELECT COUNT(*) as count FROM users');
  const count = parseInt(result.rows[0].count, 10);
  return COLORS[count % COLORS.length];
}

/** Verify the org code against the stored bcrypt hash */
async function verifyOrgCode(code: string): Promise<boolean> {
  const result = await db.query<{ code_hash: string }>(
    'SELECT code_hash FROM organizations LIMIT 1'
  );
  if (result.rows.length === 0) return false;
  return bcrypt.compare(code, result.rows[0].code_hash);
}

export { verifyOrgCode };

export const githubStrategy = new GitHubStrategy(
  {
    clientID: process.env.GITHUB_CLIENT_ID!,
    clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    callbackURL: process.env.GITHUB_CALLBACK_URL || 'http://localhost:3000/auth/github/callback',
    passReqToCallback: true,
  },
  async (
    req: any,
    accessToken: string,
    _refreshToken: string,
    profile: Profile,
    done: (err: Error | null, user?: any, info?: any) => void
  ) => {
    try {
      const username = profile.username || profile.displayName || 'unknown';
      const avatarUrl = profile.photos?.[0]?.value || null;
      const githubId = profile.id;
      const adminUsername = process.env.ADMIN_GITHUB_USERNAME;

      // --- Admin check ---
      const isAdmin = username.toLowerCase() === adminUsername?.toLowerCase();

      // --- Org code verification (non-admin users) ---
      if (!isAdmin) {
        // Extract org code from OAuth state
        let orgCode = '';
        try {
          const state = req.query?.state;
          if (state) {
            const parsed = JSON.parse(decodeURIComponent(state));
            orgCode = parsed.orgCode || '';
          }
        } catch {
          // state parsing failed — treat as empty code
        }

        if (!orgCode) {
          return done(null, false, { message: 'invalid_code' });
        }

        const valid = await verifyOrgCode(orgCode);
        if (!valid) {
          return done(null, false, { message: 'invalid_code' });
        }
      }

      // --- Determine role ---
      const role = isAdmin ? 'admin' : 'user';

      // --- Upsert user ---
      const existing = await db.query<{ id: number }>(
        'SELECT id FROM users WHERE github_id = $1',
        [githubId]
      );

      let user: any;

      if (existing.rows.length === 0) {
        // New user — insert
        const color = await pickColor();
        const encryptedToken = isAdmin ? encrypt(accessToken) : null;

        const insertResult = await db.query(
          `INSERT INTO users (github_id, username, avatar_url, color_hex, role, github_token)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [githubId, username, avatarUrl, color, role, encryptedToken]
        );
        user = insertResult.rows[0];
      } else {
        // Existing user — update username and avatar_url only
        const encryptedToken = isAdmin ? encrypt(accessToken) : null;

        const updateResult = await db.query(
          `UPDATE users SET username = $1, avatar_url = $2, github_token = COALESCE($3, github_token), updated_at = NOW()
           WHERE github_id = $4
           RETURNING *`,
          [username, avatarUrl, encryptedToken, githubId]
        );
        user = updateResult.rows[0];
      }

      return done(null, user);
    } catch (err) {
      return done(err as Error);
    }
  }
);
