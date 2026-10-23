import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole } from '../auth.js';
import { genId, isDateOnly, wrap } from './util.js';

const router = Router();
const FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly', 'annually'];

const validAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 && amount <= 9999999999.99
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
    ? amount
    : null;
};

function mapRecurringGift(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    memberName: row.member_name || 'Anonymous',
    branchId: row.branch_id,
    branchName: row.branch_name || '',
    amount: Number(row.amount),
    category: row.category || '',
    frequency: row.frequency,
    method: row.method || '',
    nextDate: row.next_date instanceof Date ? row.next_date.toISOString().split('T')[0] : row.next_date,
    active: row.active,
  };
}

async function resolveDonor(memberId, memberName, branchId) {
  if (memberId == null || memberId === '') {
    const name = typeof memberName === 'string' ? memberName.trim() : '';
    if (!name || name.length > 160) return { error: 'Provide a member or donor name' };
    return { memberId: null, memberName: name };
  }
  if (typeof memberId !== 'string') return { error: 'Member ID must be text' };
  const { rows } = await query(
    'SELECT first_name, last_name, branch_id FROM members WHERE id=$1',
    [memberId]
  );
  if (!rows[0]) return { error: 'Member not found' };
  if (rows[0].branch_id !== branchId) return { error: 'Member does not belong to the selected campus' };
  return { memberId, memberName: `${rows[0].first_name} ${rows[0].last_name}` };
}

router.get('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  let where = '';
  if (scope) {
    params.push(scope);
    where = `WHERE g.branch_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT g.*, b.name AS branch_name
     FROM recurring_gifts g
     JOIN branches b ON b.id = g.branch_id
     ${where}
     ORDER BY g.active DESC, g.next_date NULLS LAST`,
    params
  );
  res.json(rows.map(mapRecurringGift));
}));

router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { memberId = null, memberName = null, branchId, amount, category = 'Tithe',
    frequency, method = null, nextDate = null, active = true } = req.body || {};
  const scope = resolveScope(req);
  const targetBranch = scope || branchId;
  if (typeof targetBranch !== 'string' || !targetBranch) return res.status(400).json({ error: 'Select a campus for this recurring gift' });
  const normalizedAmount = validAmount(amount);
  if (normalizedAmount === null) return res.status(400).json({ error: 'Amount must be greater than zero with at most two decimal places' });
  if (typeof frequency !== 'string' || !FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'Choose a supported recurring frequency' });
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 80) return res.status(400).json({ error: 'Category must contain 1 to 80 characters' });
  if (method != null && (typeof method !== 'string' || method.trim().length > 80)) return res.status(400).json({ error: 'Payment method must be text with at most 80 characters' });
  const normalizedNextDate = nextDate === '' ? null : nextDate;
  if (normalizedNextDate != null && !isDateOnly(normalizedNextDate)) return res.status(400).json({ error: 'Next date must be a valid YYYY-MM-DD date' });
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Active must be a boolean value' });
  const { rows: branches } = await query('SELECT id, name FROM branches WHERE id=$1', [targetBranch]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });
  const donor = await resolveDonor(memberId, memberName, targetBranch);
  if (donor.error) return res.status(400).json({ error: donor.error });
  const { rows } = await query(
    `INSERT INTO recurring_gifts (id,member_id,member_name,branch_id,amount,category,frequency,method,next_date,active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [genId('rg'), donor.memberId, donor.memberName, targetBranch, normalizedAmount,
      category.trim(), frequency, method?.trim() || null, normalizedNextDate, active]
  );
  res.status(201).json(mapRecurringGift({ ...rows[0], branch_name: branches[0].name }));
}));

router.patch('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows: existingRows } = await query('SELECT * FROM recurring_gifts WHERE id=$1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Recurring gift not found' });
  if (scope && existing.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });

  const body = req.body || {};
  const amount = body.amount === undefined ? Number(existing.amount) : validAmount(body.amount);
  const category = body.category === undefined ? existing.category : body.category;
  const frequency = body.frequency === undefined ? existing.frequency : body.frequency;
  const method = body.method === undefined ? existing.method : body.method;
  const storedNextDate = existing.next_date instanceof Date
    ? existing.next_date.toISOString().split('T')[0]
    : existing.next_date;
  const nextDate = body.nextDate === undefined ? storedNextDate : (body.nextDate === '' ? null : body.nextDate);
  const active = body.active === undefined ? existing.active : body.active;
  const memberId = body.memberId === undefined ? existing.member_id : body.memberId;
  const memberName = body.memberName === undefined ? existing.member_name : body.memberName;
  if (amount === null || amount <= 0 || amount > 9999999999.99
      || Math.abs(amount * 100 - Math.round(amount * 100)) >= 0.000001) {
    return res.status(400).json({ error: 'Amount must be greater than zero with at most two decimal places' });
  }
  if (typeof category !== 'string' || !category.trim() || category.trim().length > 80) return res.status(400).json({ error: 'Category must contain 1 to 80 characters' });
  if (typeof frequency !== 'string' || !FREQUENCIES.includes(frequency)) return res.status(400).json({ error: 'Choose a supported recurring frequency' });
  if (method != null && (typeof method !== 'string' || method.trim().length > 80)) return res.status(400).json({ error: 'Payment method must be text with at most 80 characters' });
  if (nextDate != null && !isDateOnly(nextDate)) return res.status(400).json({ error: 'Next date must be a valid YYYY-MM-DD date' });
  if (typeof active !== 'boolean') return res.status(400).json({ error: 'Active must be a boolean value' });
  const donor = await resolveDonor(memberId, memberName, existing.branch_id);
  if (donor.error) return res.status(400).json({ error: donor.error });

  const { rows } = await query(
    `UPDATE recurring_gifts
     SET member_id=$1,member_name=$2,amount=$3,category=$4,frequency=$5,method=$6,next_date=$7,active=$8
     WHERE id=$9 RETURNING *`,
    [donor.memberId, donor.memberName, amount, category.trim(), frequency, method?.trim() || null, nextDate, active, existing.id]
  );
  const { rows: branchRows } = await query('SELECT name FROM branches WHERE id=$1', [existing.branch_id]);
  res.json(mapRecurringGift({ ...rows[0], branch_name: branchRows[0].name }));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT branch_id FROM recurring_gifts WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Recurring gift not found' });
  if (scope && rows[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM recurring_gifts WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

export default router;
