import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole } from '../auth.js';
import { genId, wrap } from './util.js';

const router = Router();

function mapCollectionSession(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    sessionName: row.session_name,
    date: row.collection_date instanceof Date ? row.collection_date.toISOString().split('T')[0] : row.collection_date,
    offeringAmount: Number(row.offering_amount),
    titheAmount: Number(row.tithe_amount),
    otherAmount: Number(row.other_amount),
    totalAmount: Number(row.total_amount),
  };
}

router.get('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  const where = [];
  if (scope) {
    params.push(scope);
    where.push(`s.branch_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT s.*, b.name AS branch_name
     FROM collection_sessions s
     JOIN branches b ON b.id = s.branch_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY s.collection_date DESC, s.created_at DESC`,
    params
  );
  res.json(rows.map(mapCollectionSession));
}));

router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { sessionName, date, branchId, offeringAmount, titheAmount, otherAmount } = req.body || {};
  const name = String(sessionName || '').trim();
  const amount = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 9999999999.99
      && Math.abs(parsed * 100 - Math.round(parsed * 100)) < 0.000001 ? parsed : null;
  };
  const offering = amount(offeringAmount);
  const tithe = amount(titheAmount);
  const other = amount(otherAmount);
  const total = offering === null || tithe === null || other === null ? 0 : offering + tithe + other;
  const validDate = typeof date === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(`${date}T00:00:00Z`))
    && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date);

  if (!name || name.length > 80 || !validDate || offering === null || tithe === null || other === null
      || total <= 0 || total > 9999999999.99) {
    return res.status(400).json({ error: 'Enter a session name, valid date, and non-negative collection amounts with a total greater than zero' });
  }

  const targetBranch = scope || branchId;
  if (!targetBranch) return res.status(400).json({ error: 'Select a campus for this collection session' });
  const { rows: branches } = await query('SELECT id, name FROM branches WHERE id=$1', [targetBranch]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });

  const { rows } = await query(
    `INSERT INTO collection_sessions
       (id, branch_id, session_name, collection_date, offering_amount, tithe_amount, other_amount)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [genId('cs'), targetBranch, name, date, offering, tithe, other]
  );
  res.status(201).json(mapCollectionSession({ ...rows[0], branch_name: branches[0].name }));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [req.params.id];
  const campusFilter = scope ? (params.push(scope), ` AND branch_id=$${params.length}`) : '';
  const { rowCount } = await query(`DELETE FROM collection_sessions WHERE id=$1${campusFilter}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Collection session not found' });
  res.status(204).end();
}));

export default router;
