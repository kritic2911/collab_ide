/**
 * Seed 5 dummy users into the database for demo / testing.
 * Run:  npx tsx src/db/seedUsers.ts
 */
import 'dotenv/config';
import { db } from './client.js';

const DUMMY_USERS = [
  { github_id: 'demo_1001', username: 'alice_dev',    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=alice',  color_hex: '#58A6FF' },
  { github_id: 'demo_1002', username: 'bob_codes',    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=bob',    color_hex: '#F78166' },
  { github_id: 'demo_1003', username: 'carol_eng',    avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=carol',  color_hex: '#D2A8FF' },
  { github_id: 'demo_1004', username: 'dave_hacker',  avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=dave',   color_hex: '#7EE787' },
  { github_id: 'demo_1005', username: 'eve_builder',  avatar_url: 'https://api.dicebear.com/7.x/identicon/svg?seed=eve',    color_hex: '#FFA657' },
];

async function seedUsers() {
  for (const u of DUMMY_USERS) {
    await db.query(
      `INSERT INTO users (github_id, username, avatar_url, color_hex, role)
       VALUES ($1, $2, $3, $4, 'user')
       ON CONFLICT (github_id) DO NOTHING`,
      [u.github_id, u.username, u.avatar_url, u.color_hex]
    );
  }
  console.log(`✅ Seeded ${DUMMY_USERS.length} demo users.`);
  // await db.end();
}

seedUsers().catch(err => {
  console.error('❌ Failed to seed users:', err);
  process.exit(1);
});
