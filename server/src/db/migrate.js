import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { pool } from './pool.js';

// Applies schema.sql. The schema is idempotent (IF NOT EXISTS), so this doubles
// as a simple migration runner — safe to run on every deploy.
const __dirname = dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('✓ Schema applied');
}

// Allow `npm run migrate`
if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  migrate()
    .then(() => pool.end())
    .catch((e) => {
      console.error('Migration failed:', e);
      process.exit(1);
    });
}
