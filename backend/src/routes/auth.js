import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';
import { withTransaction } from '../db/pool.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword, issueSession, authenticate } from '../auth.js';

const router = Router();

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, branchId: u.branch_id, memberId: u.member_id || null });

const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));

// Public registration can only create a branch member, never an elevated role.
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password, firstName, lastName, phone, branchId = 'b1' } = req.body || {};
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!validEmail(normalizedEmail) || typeof password !== 'string' || password.length < 12
        || typeof firstName !== 'string' || !firstName.trim() || firstName.trim().length > 100
        || typeof lastName !== 'string' || !lastName.trim() || lastName.trim().length > 100
        || (phone != null && (typeof phone !== 'string' || phone.trim().length > 40))
        || typeof branchId !== 'string') {
      return res.status(400).json({ error: 'Use a valid email, a password of at least 12 characters, and your first and last name' });
    }
    if (!branchId.trim()) return res.status(400).json({ error: 'Choose a valid campus' });
    const passwordHash = await hashPassword(password);
    const result = await withTransaction(async (client) => {
      const { rows: branch } = await client.query('SELECT id FROM branches WHERE id=$1', [branchId.trim()]);
      if (!branch[0]) return { error: 'Invalid branch' };
      const { rows: existing } = await client.query('SELECT id FROM users WHERE email=$1', [normalizedEmail]);
      if (existing[0]) return { error: 'An account with that email already exists' };
      const memberId = `m_${crypto.randomUUID()}`;
      const { rows: member } = await client.query(
        `INSERT INTO members (id,branch_id,first_name,last_name,email,phone,engagement_score)
         VALUES ($1,$2,$3,$4,$5,$6,60) RETURNING id`,
        [memberId, branchId.trim(), firstName.trim(), lastName.trim(), normalizedEmail, phone?.trim() || null]
      );
      const { rows: user } = await client.query(
        `INSERT INTO users (email,password_hash,name,role,branch_id,member_id,mfa_enabled)
         VALUES ($1,$2,$3,'member',$4,$5,false)
         RETURNING id,email,name,role,branch_id,member_id`,
        [normalizedEmail, passwordHash, `${firstName.trim()} ${lastName.trim()}`, branchId.trim(), member[0].id]
      );
      return { user: user[0] };
    });
    if (result.error) return res.status(result.error === 'Invalid branch' ? 400 : 409).json({ error: result.error });
    return res.status(201).json({ token: await issueSession(result.user), user: publicUser(result.user) });
  } catch (e) {
    next(e);
  }
});

// Step 1 — validate credentials. If MFA is enabled, return a short-lived ticket
// the client exchanges for a full token after entering the code.
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.trim().toLowerCase()]);
    const user = rows[0];
    // Constant-ish response to avoid user enumeration.
    const ok = user && (await verifyPassword(password, user.password_hash));
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' });

    if (user.mfa_enabled) {
      const ticket = jwt.sign({ sub: user.id, purpose: 'mfa' }, config.jwtSecret, { expiresIn: '5m' });
      return res.json({ mfaRequired: true, ticket });
    }
    return res.json({ token: await issueSession(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

// Step 2 — verify the MFA code and issue the access token.
// NOTE: this is a mock TOTP check (accepts the demo code) wired for a real
// authenticator/OTP provider later — swap the code comparison for TOTP verify.
router.post('/mfa', async (req, res, next) => {
  try {
    const { ticket, code } = req.body || {};
    if (!ticket || !code) return res.status(400).json({ error: 'Ticket and code are required' });

    let payload;
    try {
      payload = jwt.verify(ticket, config.jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Verification session expired — please sign in again.' });
    }
    if (payload.purpose !== 'mfa') return res.status(400).json({ error: 'Invalid ticket' });

    const expected = process.env.MFA_DEMO_CODE || '123456';
    if (String(code) !== expected) return res.status(401).json({ error: 'Incorrect code' });

    const { rows } = await query('SELECT * FROM users WHERE id = $1', [payload.sub]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'Account not found' });
    return res.json({ token: await issueSession(user), user: publicUser(user) });
  } catch (e) {
    next(e);
  }
});

// Current identity from a valid token.
router.get('/me', authenticate, (req, res) => {
  res.json({ user: { id: req.user.sub, email: req.user.email, name: req.user.name, role: req.user.role, branchId: req.user.branchId, memberId: req.user.memberId } });
});

export default router;
