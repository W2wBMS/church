import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole, canAccessBranch } from '../auth.js';
import { genId, mapGroup, wrap } from './util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = []; let where = '';
  if (scope) { params.push(scope); where = 'WHERE branch_id = $1'; }
  const { rows } = await query(`SELECT * FROM groups ${where} ORDER BY name`, params);
  res.json(rows.map(mapGroup));
}));

router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { name, schedule, description, branchId } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  if (!normalizedName || normalizedName.length > 100) return res.status(400).json({ error: 'Group name is required and must be 100 characters or fewer' });
  const target = scope || branchId || 'b1';
  if (typeof target !== 'string') return res.status(400).json({ error: 'Choose a valid campus' });
  const { rows: branches } = await query('SELECT id FROM branches WHERE id=$1', [target]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });
  if (schedule != null && (typeof schedule !== 'string' || schedule.length > 120)) return res.status(400).json({ error: 'Schedule must be text with at most 120 characters' });
  if (description != null && (typeof description !== 'string' || description.length > 2000)) return res.status(400).json({ error: 'Description must be text with at most 2,000 characters' });
  const id = genId('g');
  const { rows } = await query(
    'INSERT INTO groups (id,branch_id,name,schedule,description,member_ids) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [id, target, normalizedName, schedule?.trim() || null, description?.trim() || null, []]
  );
  res.status(201).json(mapGroup(rows[0]));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT branch_id FROM groups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Group not found' });
  if (scope && rows[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  await query('DELETE FROM groups WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

router.delete('/:id/members/:memberId', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows } = await query('SELECT branch_id FROM groups WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Group not found' });
  if (!canAccessBranch(req, rows[0].branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { rows: members } = await query('SELECT branch_id FROM members WHERE id=$1', [req.params.memberId]);
  if (!members[0] || members[0].branch_id !== rows[0].branch_id) {
    return res.status(404).json({ error: 'Group member not found' });
  }
  await query('UPDATE groups SET member_ids=array_remove(member_ids,$1) WHERE id=$2', [req.params.memberId, req.params.id]);
  res.status(204).end();
}));

// Join/leave: toggles the member in the group's roster.
router.post('/:id/toggle-member', requireRole('hq_admin', 'branch_admin', 'ministry_leader', 'member'), wrap(async (req, res) => {
  const { memberId: requestedMemberId } = req.body || {};
  const memberId = req.user.role === 'member' ? req.user.memberId : requestedMemberId;
  if (!memberId) return res.status(400).json({ error: 'memberId is required' });
  const { rows } = await query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
  const g = rows[0];
  if (!g) return res.status(404).json({ error: 'Group not found' });
  if (!canAccessBranch(req, g.branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { rows: members } = await query('SELECT branch_id FROM members WHERE id=$1', [memberId]);
  if (!members[0] || members[0].branch_id !== g.branch_id) return res.status(400).json({ error: 'Member and group must belong to the same branch' });
  const { rows: upd } = await query(
    `UPDATE groups
     SET member_ids = CASE
       WHEN $1 = ANY(member_ids) THEN array_remove(member_ids, $1)
       ELSE array_append(member_ids, $1)
     END
     WHERE id=$2 RETURNING *`,
    [memberId, g.id]
  );
  res.json(mapGroup(upd[0]));
}));

export default router;
