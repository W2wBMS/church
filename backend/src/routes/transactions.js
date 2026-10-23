import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole } from '../auth.js';
import { genId, isDateOnly, mapTx, wrap } from './util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  const filters = [];
  if (req.user.role === 'member') { params.push(req.user.memberId || ''); filters.push(`t.member_id = $${params.length}`); }
  if (scope) { params.push(scope); filters.push(`t.branch_id = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await query(
    `SELECT t.*, b.name AS branch_name FROM transactions t JOIN branches b ON b.id=t.branch_id ${where} ORDER BY t.date DESC, t.created_at DESC`,
    params
  );
  res.json(rows.map(mapTx));
}));

// Record a contribution. Admins/ministry leaders; branch forced to scope.
router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader', 'member'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { memberId, amount, category, paymentMethod, date, memberName, branchId } = req.body || {};
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 9999999999.99
      || Math.abs(amt * 100 - Math.round(amt * 100)) >= 0.000001) {
    return res.status(400).json({ error: 'A valid amount greater than 0 with at most two decimal places is required' });
  }
  if (category != null && (typeof category !== 'string' || !category.trim() || category.trim().length > 80)) {
    return res.status(400).json({ error: 'Category must contain 1 to 80 characters' });
  }
  if (paymentMethod != null && (typeof paymentMethod !== 'string' || paymentMethod.trim().length > 80)) {
    return res.status(400).json({ error: 'Payment method must be text with at most 80 characters' });
  }
  if (date != null && !isDateOnly(date)) return res.status(400).json({ error: 'Date must be a valid YYYY-MM-DD date' });
  if (memberId != null && typeof memberId !== 'string') return res.status(400).json({ error: 'Member ID must be text' });
  if (req.user.role === 'member' && memberId !== req.user.memberId) {
    return res.status(403).json({ error: 'Members may only record their own contributions' });
  }

  let targetBranch = scope || branchId || 'b1';
  let name = memberName || 'Anonymous';
  if (memberId && memberId !== 'anonymous') {
    const { rows } = await query('SELECT branch_id, first_name, last_name FROM members WHERE id=$1', [memberId]);
    if (!rows[0]) return res.status(400).json({ error: 'Member not found' });
    if (req.user.role !== 'hq_admin' && rows[0].branch_id !== req.user.branchId) return res.status(403).json({ error: 'Insufficient permissions' });
    if (scope && rows[0].branch_id !== scope) return res.status(400).json({ error: 'Member does not belong to the selected campus' });
    targetBranch = scope || rows[0].branch_id; name = `${rows[0].first_name} ${rows[0].last_name}`;
  }
  const { rows: branches } = await query('SELECT name FROM branches WHERE id=$1', [targetBranch]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });
  const id = genId('t');
  const receipt = `REC-${new Date().getUTCFullYear()}-${id.slice(2).toUpperCase()}`;
  const { rows } = await query(
    `INSERT INTO transactions (id,branch_id,member_id,member_name,amount,category,date,payment_method,receipt_number)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [id, targetBranch, memberId && memberId !== 'anonymous' ? memberId : null, name, amt, category || 'Offering', date || new Date().toISOString().split('T')[0], paymentMethod || 'Cash', receipt]
  );
  res.status(201).json(mapTx({ ...rows[0], branch_name: branches[0].name }));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [req.params.id];
  const campusFilter = scope ? (params.push(scope), ` AND branch_id=$${params.length}`) : '';
  const { rowCount } = await query(`DELETE FROM transactions WHERE id=$1${campusFilter}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Transaction not found' });
  res.status(204).end();
}));

export default router;
