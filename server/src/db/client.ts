import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test connection on startup — crash immediately if DB unreachable
pool.query('SELECT 1')
  .then(() => console.log('✅ Database connected'))
  .catch((err) => {
    console.error('❌ Database connection failed:', err.message);
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