import bcrypt from 'bcryptjs';
import { db } from './client.js';

/**
 * Seeds the organization code into the DB if not already present.
 * Called on server startup when ORG_CODE env var is set.
 */
export async function seedOrgCode(): Promise<void> {
  const orgCode = process.env.ORG_CODE;
  if (!orgCode) return;

  // Check if an org code already exists
  const existing = await db.query('SELECT id FROM organizations LIMIT 1');

  if (existing.rows.length === 0) {
    // First time — hash and insert
    const hash = await bcrypt.hash(orgCode, 12);
    await db.query('INSERT INTO organizations (code_hash) VALUES ($1)', [hash]);
    console.log('✅ Organization code seeded successfully.');
  } else {
    // Update the existing org code hash (admin may have changed ORG_CODE)
    const hash = await bcrypt.hash(orgCode, 12);
    await db.query('UPDATE organizations SET code_hash = $1 WHERE id = $2', [
      hash,
      existing.rows[0].id,
    ]);
    console.log('✅ Organization code updated.');
  }
}
