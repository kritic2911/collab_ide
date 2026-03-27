import { db } from './client.js';

const PREDEFINED_ROLES = ['admin', 'user'];

/**
 * Seeds predefined roles into the `roles` table if they don't already exist.
 * Called on server startup, similar to seedOrgCode().
 */
export async function seedRoles(): Promise<void> {
  for (const name of PREDEFINED_ROLES) {
    const existing = await db.query<{ id: number }>(
      'SELECT id FROM roles WHERE name = $1',
      [name]
    );

    if (existing.rows.length === 0) {
      await db.query(
        'INSERT INTO roles (name, is_predefined) VALUES ($1, true)',
        [name]
      );
      console.log(`✅ Seeded predefined role: ${name}`);
    }
  }
}
