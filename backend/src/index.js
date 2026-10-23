import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { authenticate } from './auth.js';
import authRoutes from './routes/auth.js';
import memberRoutes from './routes/members.js';
import transactionRoutes from './routes/transactions.js';
import collectionSessionRoutes from './routes/collection-sessions.js';
import attendanceRoutes from './routes/attendance.js';
import dashboardRoutes from './routes/dashboard.js';
import groupRoutes from './routes/groups.js';
import followupRoutes from './routes/followups.js';
import announcementRoutes from './routes/announcements.js';
import prayerRoutes from './routes/prayer.js';
import eventRoutes from './routes/events.js';
import campaignRoutes from './routes/campaigns.js';
import recurringGiftRoutes from './routes/recurring-gifts.js';

const app = express();
app.set('trust proxy', 1); // behind nginx
app.use(helmet());
app.use('/api/members/import', express.json({ limit: '8mb' }));
app.use(express.json({ limit: '256kb' }));
app.use(
  cors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: false,
  })
);

// Basic rate limiting; stricter on auth.
app.use('/api/', rateLimit({ windowMs: 60_000, max: 300 }));
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 30,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many sign-in attempts. Please wait before trying again.' });
  },
});

// Health check (used by Docker/uptime probes).
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'up' });
  } catch (error) {
    console.error('Health check database query failed:', error);
    res.status(503).json({ status: 'degraded', db: 'down' });
  }
});

// Public auth endpoints
app.use('/api/auth', authLimiter, authRoutes);

// Everything below requires a valid token
app.use('/api', authenticate);
app.use('/api/members', memberRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/collection-sessions', collectionSessionRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/followups', followupRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api/prayer-requests', prayerRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/recurring-gifts', recurringGiftRoutes);

// 404 + error handlers
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must contain valid JSON' });
  const knownDatabaseErrors = {
    '22P02': [400, 'A request value has an invalid format'],
    '22007': [400, 'A date or time value is invalid'],
    '23502': [400, 'A required value is missing'],
    '23503': [400, 'A referenced record does not exist'],
    '23505': [409, 'A record with these details already exists'],
    '23514': [400, 'A value does not meet the required constraints'],
  };
  const mapped = knownDatabaseErrors[err.code];
  if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
  if (err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.publicMessage || err.message || 'Request could not be processed' });
  }
  res.status(500).json({ error: err.publicMessage || 'Internal server error' });
});

const server = app.listen(config.port, () => {
  console.log(`Church 2.0 API listening on :${config.port} (${config.env})`);
});

// Graceful shutdown
const shutdown = () => {
  server.close(() => pool.end().then(() => process.exit(0)));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
