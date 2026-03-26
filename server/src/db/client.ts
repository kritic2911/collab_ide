import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

function safeDbHint() {
  const url = process.env.DATABASE_URL;
  if (!url) return 'DATABASE_URL is missing';
  try {
    const u = new URL(url);
    const user = decodeURIComponent(u.username || '');
    const host = u.hostname || '';
    const port = u.port || '';
    const db = (u.pathname || '').replace(/^\//, '');
    return `user="${user || '(none)'}" host="${host || '(none)'}" port="${port || '(default)'}" db="${db || '(none)'}"`;
  } catch {
    return 'DATABASE_URL is not a valid URL';
  }
}

// Test connection on startup — crash immediately if DB unreachable
pool.query('SELECT 1')
  .then(() => console.log('✅ Database connected'))
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
    console.error(`   ↳ Connection info: ${safeDbHint()}`);
    console.error('   ↳ Fix: update server/.env DATABASE_URL to match your local Postgres credentials.');
    process.exit(1);
  });

/** Singleton query function — every other file imports from here */
export const db = {
  query: <T extends pg.QueryResultRow = any>(
    text: string,
    params?: unknown[]
  ): Promise<pg.QueryResult<T>> => {
    return pool.query<T>(text, params);
  },
};

export default pool;