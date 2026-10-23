import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole } from '../auth.js';
import { genId, wrap } from './util.js';

const router = Router();

const validAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 9999999999.99
    && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
    ? amount
    : null;
};

function mapCampaign(row) {
  return {
    id: row.id,
    name: row.name,
    goal: Number(row.goal),
    raisedOffset: Number(row.raised_offset),
    fundCategory: row.fund_category || '',
    branchId: row.branch_id,
    branchName: row.branch_name || '',
  };
}

router.get('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  let where = '';
  if (scope) {
    params.push(scope);
    where = `WHERE c.branch_id IS NULL OR c.branch_id = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT c.*, b.name AS branch_name
     FROM campaigns c
     LEFT JOIN branches b ON b.id = c.branch_id
     ${where}
     ORDER BY c.name`,
    params
  );
  res.json(rows.map(mapCampaign));
}));

router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { name, goal = 0, raisedOffset = 0, fundCategory = null, branchId } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedGoal = validAmount(goal);
  const normalizedRaised = validAmount(raisedOffset);
  if (!normalizedName || normalizedName.length > 160 || normalizedGoal === null || normalizedRaised === null) {
    return res.status(400).json({ error: 'Provide a campaign name and valid non-negative goal and raised offset amounts' });
  }
  if (fundCategory != null && (typeof fundCategory !== 'string' || fundCategory.trim().length > 80)) {
    return res.status(400).json({ error: 'Fund category must be text with at most 80 characters' });
  }

  const scope = resolveScope(req);
  const targetBranch = scope || branchId || null;
  if (targetBranch != null) {
    if (typeof targetBranch !== 'string') return res.status(400).json({ error: 'Choose a valid campus' });
    const { rows: branches } = await query('SELECT id FROM branches WHERE id=$1', [targetBranch]);
    if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });
  }
  const { rows } = await query(
    `INSERT INTO campaigns (id,name,goal,raised_offset,fund_category,branch_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [genId('camp'), normalizedName, normalizedGoal, normalizedRaised, fundCategory?.trim() || null, targetBranch]
  );
  const { rows: branchRows } = targetBranch
    ? await query('SELECT name FROM branches WHERE id=$1', [targetBranch])
    : { rows: [] };
  res.status(201).json(mapCampaign({ ...rows[0], branch_name: branchRows[0]?.name }));
}));

router.patch('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows: existingRows } = await query('SELECT * FROM campaigns WHERE id=$1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Campaign not found' });
  if (scope && existing.branch_id !== null && existing.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  if (scope && existing.branch_id === null) return res.status(403).json({ error: 'Only HQ administrators can edit a global campaign' });

  const body = req.body || {};
  const name = body.name === undefined ? existing.name : (typeof body.name === 'string' ? body.name.trim() : '');
  const goal = body.goal === undefined ? Number(existing.goal) : validAmount(body.goal);
  const raisedOffset = body.raisedOffset === undefined ? Number(existing.raised_offset) : validAmount(body.raisedOffset);
  const fundCategory = body.fundCategory === undefined ? existing.fund_category : body.fundCategory;
  if (!name || name.length > 160 || goal === null || raisedOffset === null) {
    return res.status(400).json({ error: 'Provide a campaign name and valid non-negative goal and raised offset amounts' });
  }
  if (fundCategory != null && (typeof fundCategory !== 'string' || fundCategory.trim().length > 80)) {
    return res.status(400).json({ error: 'Fund category must be text with at most 80 characters' });
  }
  const { rows } = await query(
    `UPDATE campaigns SET name=$1,goal=$2,raised_offset=$3,fund_category=$4
     WHERE id=$5 RETURNING *`,
    [name, goal, raisedOffset, fundCategory?.trim() || null, existing.id]
  );
  const { rows: branchRows } = existing.branch_id
    ? await query('SELECT name FROM branches WHERE id=$1', [existing.branch_id])
    : { rows: [] };
  res.json(mapCampaign({ ...rows[0], branch_name: branchRows[0]?.name }));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT branch_id FROM campaigns WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Campaign not found' });
  if (scope && rows[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM campaigns WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

export default router;
