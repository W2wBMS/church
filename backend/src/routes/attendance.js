import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole } from '../auth.js';
import { isDateOnly, wrap } from './util.js';

const router = Router();

function mapHeadcount(row) {
  return {
    id: row.id,
    branchId: row.branch_id,
    branchName: row.branch_name,
    date: row.service_date instanceof Date ? row.service_date.toISOString().split('T')[0] : row.service_date,
    totalPresent: row.total_present,
  };
}

// All attendance records in scope (the client computes per-service views).
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  const filters = [];
  if (req.user.role === 'member') { params.push(req.user.memberId || ''); filters.push(`member_id = $${params.length}`); }
  if (scope) { params.push(scope); filters.push(`branch_id = $${params.length}`); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  const { rows } = await query(`SELECT * FROM attendance ${where}`, params);
  res.json(rows.map((r) => ({
    id: r.id, memberId: r.member_id, branchId: r.branch_id,
    date: r.service_date instanceof Date ? r.service_date.toISOString().split('T')[0] : r.service_date,
    present: r.present,
    arrivalMode: r.arrival_mode || '',
  })));
}));

router.get('/headcounts', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  const where = [];
  if (scope) {
    params.push(scope);
    where.push(`h.branch_id = $${params.length}`);
  }
  const { rows } = await query(
    `SELECT h.*, b.name AS branch_name
     FROM attendance_headcounts h
     JOIN branches b ON b.id = h.branch_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY h.service_date DESC, b.name`,
    params
  );
  res.json(rows.map(mapHeadcount));
}));

router.delete('/headcounts/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [req.params.id];
  const campusFilter = scope ? (params.push(scope), ` AND branch_id=$${params.length}`) : '';
  const { rowCount } = await query(`DELETE FROM attendance_headcounts WHERE id=$1${campusFilter}`, params);
  if (!rowCount) return res.status(404).json({ error: 'Attendance total not found' });
  res.status(204).end();
}));

router.put('/headcount', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { branchId, date, totalPresent } = req.body || {};
  if (!isDateOnly(date) || !Number.isSafeInteger(totalPresent) || totalPresent < 0 || totalPresent > 1000000) {
    return res.status(400).json({ error: 'A valid service date and whole-number headcount between 0 and 1,000,000 are required' });
  }

  const targetBranch = scope || branchId;
  if (!targetBranch) return res.status(400).json({ error: 'Select a campus for this attendance record' });
  const { rows } = await query(
    `INSERT INTO attendance_headcounts (id, branch_id, service_date, total_present)
     SELECT $1, b.id, $3, $4 FROM branches b WHERE b.id = $2
     ON CONFLICT (branch_id, service_date) DO UPDATE
       SET total_present = EXCLUDED.total_present, updated_at = now()
     RETURNING *`,
    [`ah_${targetBranch}_${date}`, targetBranch, date, totalPresent]
  );
  if (!rows[0]) return res.status(400).json({ error: 'Invalid campus' });
  const { rows: branchRows } = await query('SELECT name FROM branches WHERE id=$1', [targetBranch]);
  res.json(mapHeadcount({ ...rows[0], branch_name: branchRows[0].name }));
}));

// Toggle/record a member's attendance for a service date (upsert).
router.put('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { memberId, date, present, arrivalMode = null } = req.body || {};
  if (!memberId || !date) return res.status(400).json({ error: 'memberId and date are required' });
  const { rows: m } = await query('SELECT branch_id FROM members WHERE id=$1', [memberId]);
  if (!m[0]) return res.status(404).json({ error: 'Member not found' });
  if (scope && m[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });

  if (!isDateOnly(date) || typeof present !== 'boolean') {
    return res.status(400).json({ error: 'A valid service date and boolean attendance value are required' });
  }
  const validArrivalModes = ['Car', 'Motorcycle (boda)', 'Bicycle', 'Walked', 'Other'];
  if (arrivalMode !== null && arrivalMode !== '' && !validArrivalModes.includes(arrivalMode)) {
    return res.status(400).json({ error: 'Choose a valid arrival mode' });
  }

  const id = `att_${memberId}_${date}`;
  const { rows } = await query(
    `INSERT INTO attendance (id,member_id,branch_id,service_date,present,arrival_mode)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (member_id, service_date) DO UPDATE
       SET present = EXCLUDED.present, arrival_mode = EXCLUDED.arrival_mode RETURNING *`,
    [id, memberId, m[0].branch_id, date, present, arrivalMode || null]
  );
  const r = rows[0];
  res.json({ id: r.id, memberId: r.member_id, branchId: r.branch_id, date,
             present: r.present, arrivalMode: r.arrival_mode || '' });
}));

router.delete('/:memberId/:date', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  if (!isDateOnly(req.params.date)) return res.status(400).json({ error: 'Date must be a valid YYYY-MM-DD date' });
  const params = [req.params.memberId, req.params.date];
  const campusFilter = scope ? (params.push(scope), ` AND branch_id=$${params.length}`) : '';
  const { rowCount } = await query(
    `DELETE FROM attendance WHERE member_id=$1 AND service_date=$2${campusFilter}`,
    params
  );
  if (!rowCount) return res.status(404).json({ error: 'Attendance record not found' });
  res.status(204).end();
}));

export default router;
