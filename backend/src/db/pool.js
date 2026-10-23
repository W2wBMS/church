import pg from 'pg';
import { config } from '../config.js';

// Supabase connection strings include the required TLS mode.
export const pool = new pg.Pool({
  connectionString: config.supabaseDatabaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const query = (text, params) => pool.query(text, params);

// Run a set of statements inside a transaction.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Database rollback failed:', rollbackError);
    }
    throw e;
  } finally {
    client.release();
  }
}
