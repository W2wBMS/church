import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { resolveScope, canAccessBranch, requireRole } from '../auth.js';
import { genId, isDateOnly, mapEvent, wrap } from './util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = []; let where = '';
  if (scope) { params.push(scope); where = 'WHERE branch_id = $1'; }
  const { rows } = await query(`SELECT * FROM events ${where} ORDER BY date`, params);
  res.json(rows.map(mapEvent));
}));

router.post('/', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { title, description = null, date, rolesRequired = [], branchId } = req.body || {};
  const rawTime = req.body?.time;
  const time = rawTime === '' ? null : (rawTime === undefined ? null : rawTime);
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  if (!normalizedTitle || normalizedTitle.length > 160 || !isDateOnly(date)) {
    return res.status(400).json({ error: 'A title of up to 160 characters and a valid event date are required' });
  }
  if (description != null && (typeof description !== 'string' || description.length > 5000)) {
    return res.status(400).json({ error: 'Event description must be text with at most 5,000 characters' });
  }
  if (time != null && (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    return res.status(400).json({ error: 'Event time must use 24-hour HH:MM format' });
  }
  if (!Array.isArray(rolesRequired) || rolesRequired.length > 50
      || rolesRequired.some((role) => typeof role !== 'string' || !role.trim() || role.trim().length > 80)
      || new Set(rolesRequired.map((role) => role.trim())).size !== rolesRequired.length) {
    return res.status(400).json({ error: 'Volunteer roles must be unique text values up to 80 characters each' });
  }
  const scope = resolveScope(req);
  const targetBranch = scope || branchId;
  if (typeof targetBranch !== 'string' || !targetBranch) {
    return res.status(400).json({ error: 'Select a campus for this event' });
  }
  const { rows: branches } = await query('SELECT id FROM branches WHERE id=$1', [targetBranch]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });
  const { rows } = await query(
    `INSERT INTO events (id,branch_id,title,description,date,time,roles_required,volunteers_signed_up)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [genId('e'), targetBranch, normalizedTitle, description?.trim() || null, date, time || null,
      rolesRequired.map((role) => role.trim()), []]
  );
  res.status(201).json(mapEvent(rows[0]));
}));

router.patch('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows: existingRows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'Event not found' });
  if (!canAccessBranch(req, existing.branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });

  const body = req.body || {};
  const title = body.title === undefined ? existing.title : (typeof body.title === 'string' ? body.title.trim() : '');
  const description = body.description === undefined ? existing.description : body.description;
  const date = body.date === undefined
    ? (existing.date instanceof Date ? existing.date.toISOString().split('T')[0] : existing.date)
    : body.date;
  const time = body.time === undefined ? existing.time : (body.time === '' ? null : body.time);
  const rolesRequired = body.rolesRequired === undefined ? existing.roles_required : body.rolesRequired;
  if (!title || title.length > 160 || !isDateOnly(date)) {
    return res.status(400).json({ error: 'A title of up to 160 characters and a valid event date are required' });
  }
  if (description != null && (typeof description !== 'string' || description.length > 5000)) {
    return res.status(400).json({ error: 'Event description must be text with at most 5,000 characters' });
  }
  if (time != null && (typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time))) {
    return res.status(400).json({ error: 'Event time must use 24-hour HH:MM format' });
  }
  if (!Array.isArray(rolesRequired) || rolesRequired.length > 50
      || rolesRequired.some((role) => typeof role !== 'string' || !role.trim() || role.trim().length > 80)
      || new Set(rolesRequired.map((role) => role.trim())).size !== rolesRequired.length) {
    return res.status(400).json({ error: 'Volunteer roles must be unique text values up to 80 characters each' });
  }
  const { rows } = await query(
    `UPDATE events SET title=$1,description=$2,date=$3,time=$4,roles_required=$5
     WHERE id=$6 RETURNING *`,
    [title, description?.trim() || null, date, time || null, rolesRequired.map((role) => role.trim()), existing.id]
  );
  res.json(mapEvent(rows[0]));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows } = await query('SELECT branch_id FROM events WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Event not found' });
  if (!canAccessBranch(req, rows[0].branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  await query('DELETE FROM events WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

router.delete('/:id/volunteer/:memberId', requireRole('hq_admin', 'branch_admin', 'ministry_leader'), wrap(async (req, res) => {
  const { rows } = await query('SELECT branch_id FROM events WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Event not found' });
  if (!canAccessBranch(req, rows[0].branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const { rowCount } = await query(
    'UPDATE events SET volunteers_signed_up=array_remove(volunteers_signed_up,$1) WHERE id=$2 AND $1=ANY(volunteers_signed_up)',
    [req.params.memberId, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Volunteer assignment not found' });
  res.status(204).end();
}));

router.post('/:id/rsvp', wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!canAccessBranch(req, event.branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  const memberId = req.user.role === 'member' ? req.user.memberId : req.body?.memberId;
  if (!memberId) return res.status(400).json({ error: 'Member account is not linked to a profile' });
  const { rows: member } = await query('SELECT branch_id FROM members WHERE id=$1', [memberId]);
  if (!member[0] || member[0].branch_id !== event.branch_id) return res.status(400).json({ error: 'Member and event must belong to the same branch' });
  const { rows: updated } = await query(
    `UPDATE events
     SET volunteers_signed_up = CASE
       WHEN $1 = ANY(volunteers_signed_up) THEN volunteers_signed_up
       ELSE array_append(volunteers_signed_up, $1)
     END
     WHERE id=$2 RETURNING *`,
    [memberId, event.id]
  );
  res.json(mapEvent(updated[0]));
}));

router.post('/:id/volunteer', wrap(async (req, res) => {
  const { role } = req.body || {};
  if (typeof role !== 'string' || !role.trim() || role.trim().length > 80) {
    return res.status(400).json({ error: 'Volunteer role is required and must be 80 characters or fewer' });
  }
  const { rows } = await query('SELECT * FROM events WHERE id=$1', [req.params.id]);
  const event = rows[0];
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!canAccessBranch(req, event.branch_id)) return res.status(403).json({ error: 'Insufficient permissions' });
  if (!(event.roles_required || []).includes(role.trim())) {
    return res.status(400).json({ error: 'Choose a volunteer role listed for this event' });
  }
  const memberId = req.user.role === 'member' ? req.user.memberId : req.body?.memberId;
  if (!memberId) return res.status(400).json({ error: 'Member account is not linked to a profile' });
  const { rows: member } = await query('SELECT branch_id, volunteer_skills FROM members WHERE id=$1', [memberId]);
  if (!member[0] || member[0].branch_id !== event.branch_id) return res.status(400).json({ error: 'Member and event must belong to the same branch' });
  const updated = await withTransaction(async (client) => {
    await client.query(
      `UPDATE members
       SET volunteer_skills = CASE
         WHEN $1 = ANY(volunteer_skills) THEN volunteer_skills
         ELSE array_append(volunteer_skills, $1)
       END
       WHERE id=$2`,
      [role.trim(), memberId]
    );
    const { rows } = await client.query(
      `UPDATE events
       SET volunteers_signed_up = CASE
         WHEN $1 = ANY(volunteers_signed_up) THEN volunteers_signed_up
         ELSE array_append(volunteers_signed_up, $1)
       END
       WHERE id=$2 RETURNING *`,
      [memberId, event.id]
    );
    return rows[0];
  });
  res.json(mapEvent(updated));
}));

export default router;
