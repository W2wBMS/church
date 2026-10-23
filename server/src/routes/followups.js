import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole, canAccessBranch } from '../auth.js';
import { genId, mapFollowup, wrap } from './util.js';

const router = Router();
const STAGES = ['New Guest', 'Contacted', 'Connected', 'Member'];

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = []; let where = '';
  if (scope) { params.push(scope); where = 'WHERE branch_id = $1'; }
  const { rows } = await query(`SELECT * FROM followups ${where} ORDER BY created_at DESC`, params);
  res.json(rows.map(mapFollowup));
}));

router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { name, owner, branchId } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || normalizedName.length > 160) return res.status(400).json({ error: 'Guest name is required and must be 160 characters or fewer' });
  const target = scope || branchId || 'b1';
  if (typeof target !== 'string') return res.status(400).json({ error: 'Choose a valid campus' });
  const { rows: branches } = await query('SELECT id FROM branches WHERE id=$1', [target]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });
  if (owner != null && (typeof owner !== 'string' || owner.trim().length > 120)) return res.status(400).json({ error: 'Owner must be text with at most 120 characters' });
  const { rows } = await query(
    'INSERT INTO followups (id,branch_id,name,stage,owner,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [genId('fu'), target, normalizedName, 'New Guest', owner?.trim() || 'Unassigned', '']
  );
  res.status(201).json(mapFollowup(rows[0]));
}));

// Advance/regress a guest through the pipeline.
router.patch('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { stage } = req.body || {};
  if (!STAGES.includes(stage)) return res.status(400).json({ error: 'Invalid stage' });
  const { rows: existing } = await query('SELECT branch_id FROM followups WHERE id=$1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Follow-up not found' });
  if (!canAccessBranch(req, existing[0].branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { rows } = await query('UPDATE followups SET stage=$1 WHERE id=$2 RETURNING *', [stage, req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Follow-up not found' });
  res.json(mapFollowup(rows[0]));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT branch_id FROM followups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Follow-up not found' });
  if (scope && rows[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM followups WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

export default router;
