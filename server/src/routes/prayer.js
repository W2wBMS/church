import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole, canAccessBranch } from '../auth.js';
import { genId, mapPrayer, wrap } from './util.js';

const router = Router();

// Prayer requests are scoped by campus (sensitive pastoral content).
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const where = [];
  const params = [];
  if (req.user.role === 'member') {
    params.push(req.user.memberId || '');
    where.push(`member_id = $${params.length}`);
  }
  if (scope) {
    const { rows: b } = await query('SELECT name FROM branches WHERE id=$1', [scope]);
    params.push(b[0]?.name || '');
    where.push(`branch_name = $${params.length}`);
  }
  const { rows } = await query(`SELECT * FROM prayer_requests ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC`, params);
  res.json(rows.map(mapPrayer));
}));

// Members submit prayer requests from the mobile app.
router.post('/', wrap(async (req, res) => {
  const { memberId, memberName, branchName, text, category, route } = req.body || {};
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 5000) {
    return res.status(400).json({ error: 'Prayer text is required and must be 5,000 characters or fewer' });
  }
  if (req.user.role === 'member' && memberId !== req.user.memberId) {
    return res.status(403).json({ error: 'Members may only submit their own prayer requests' });
  }
  let verifiedMember = null;
  if (memberId) {
    const { rows } = await query(
      `SELECT m.id, m.first_name, m.last_name, m.branch_id, b.name AS branch_name
       FROM members m JOIN branches b ON b.id = m.branch_id WHERE m.id=$1`,
      [memberId]
    );
    verifiedMember = rows[0];
    if (!verifiedMember) return res.status(400).json({ error: 'Member not found' });
    if (!canAccessBranch(req, verifiedMember.branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  }
  let targetBranchName;
  if (verifiedMember) {
    targetBranchName = verifiedMember.branch_name;
  } else if (req.user.role === 'hq_admin') {
    const requestedBranchName = typeof branchName === 'string' ? branchName.trim() : '';
    const { rows: branch } = await query(
      requestedBranchName
        ? 'SELECT name FROM branches WHERE name=$1'
        : 'SELECT name FROM branches WHERE id=$1',
      [requestedBranchName || 'b1']
    );
    if (!branch[0]) return res.status(400).json({ error: 'Choose a valid campus for the prayer request' });
    targetBranchName = branch[0].name;
  } else {
    const { rows: branch } = await query('SELECT name FROM branches WHERE id=$1', [req.user.branchId]);
    if (!branch[0]) return res.status(403).json({ error: 'Your account is not assigned to a valid campus' });
    targetBranchName = branch[0].name;
  }

  const { rows } = await query(
    `INSERT INTO prayer_requests (id,member_id,member_name,branch_name,text,category,route,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Assigned') RETURNING *`,
    [genId('pr'), verifiedMember?.id || null, verifiedMember ? `${verifiedMember.first_name} ${verifiedMember.last_name}` : 'Member', targetBranchName, text.trim(), category || 'General', route || 'Pastoral Care Team']
  );
  res.status(201).json(mapPrayer(rows[0]));
}));

// Approve/dismiss removes it from the active inbox.
router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows: existing } = await query('SELECT branch_name FROM prayer_requests WHERE id=$1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Prayer request not found' });
  if (req.user.role !== 'hq_admin') {
    const { rows: branch } = await query('SELECT id FROM branches WHERE name=$1', [existing[0].branch_name]);
    if (!branch[0] || !canAccessBranch(req, branch[0].id)) return res.status(403).json({ error: 'Insufficient permissions' });
  }
  await query('DELETE FROM prayer_requests WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

export default router;
