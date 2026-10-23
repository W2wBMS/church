import 'dotenv/config';

// Centralized, validated configuration. All secrets come from the environment;
// nothing sensitive is ever committed. See backend/.env.example.
const required = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
};

const jwtSecret = required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-insecure-secret-change-me');
if (process.env.NODE_ENV === 'production' && (jwtSecret.length < 32 || /CHANGE_ME|insecure|development|dev-/i.test(jwtSecret))) {
  throw new Error('JWT_SECRET must be a strong, unique production secret of at least 32 characters');
}

const corsOrigins = (process.env.CORS_ORIGINS || (process.env.NODE_ENV === 'production' ? '' : '*'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (process.env.NODE_ENV === 'production' && corsOrigins.length === 0) {
  throw new Error('CORS_ORIGINS must be configured in production');
}

const supabaseDatabaseUrl = process.env.SUPABASE_DB_URL?.trim();
if (!supabaseDatabaseUrl) {
  throw new Error('Missing required env var: SUPABASE_DB_URL');
}
let supabaseDatabaseProtocol;
try {
  supabaseDatabaseProtocol = new URL(supabaseDatabaseUrl).protocol;
} catch {
  throw new Error('SUPABASE_DB_URL must be a valid PostgreSQL connection string');
}
if (!['postgres:', 'postgresql:'].includes(supabaseDatabaseProtocol)) {
  throw new Error('SUPABASE_DB_URL must be a PostgreSQL connection string');
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),

  // Supabase PostgreSQL connection string from the Supabase project dashboard.
  supabaseDatabaseUrl,

  // Auth
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '12h',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // CORS — comma-separated allowed origins (the Vercel frontend URL in prod).
  corsOrigins,
};
