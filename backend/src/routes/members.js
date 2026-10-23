import { Router } from 'express';
import { query, withTransaction } from '../db/pool.js';
import { hashPassword, resolveScope, requireRole } from '../auth.js';
import { genId, mapMember, wrap } from './util.js';

const router = Router();

// List members, always scoped to the caller's permitted campus.
router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req); // null = all (HQ global) else branch id
  const search = (req.query.search || '').toString().trim().toLowerCase();
  const params = [];
  const where = [];
  if (req.user.role === 'member') { params.push(req.user.memberId || ''); where.push(`m.id = $${params.length}`); }
  if (scope) { params.push(scope); where.push(`m.branch_id = $${params.length}`); }
  if (search) {
    params.push(`%${search}%`);
    const p = `$${params.length}`;
    where.push(`(lower(m.first_name || ' ' || m.last_name) LIKE ${p} OR lower(coalesce(m.email,'')) LIKE ${p} OR coalesce(m.phone,'') LIKE ${p})`);
  }
  const sql = `SELECT m.*, b.name AS branch_name FROM members m JOIN branches b ON b.id = m.branch_id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.last_name, m.first_name`;
  const { rows } = await query(sql, params);
  res.json(rows.map(mapMember));
}));

router.post('/import', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { members, branchId } = req.body || {};
  if (!Array.isArray(members) || members.length === 0 || members.length > 500) {
    return res.status(400).json({ error: 'Import between 1 and 500 member rows at a time' });
  }

  const scope = resolveScope(req);
  const targetBranch = scope || branchId;
  if (typeof targetBranch !== 'string' || !targetBranch) {
    return res.status(400).json({ error: 'Select a campus for this import' });
  }
  const { rows: branches } = await query('SELECT id, name FROM branches WHERE id=$1', [targetBranch]);
  if (!branches[0]) return res.status(400).json({ error: 'Invalid campus' });

  const errors = [];
  const ready = [];
  const seenEmails = new Set();
  members.forEach((row, index) => {
    const rowNumber = Number.isInteger(row?.rowNumber) ? row.rowNumber : index + 2;
    const firstName = typeof row?.firstName === 'string' ? row.firstName.trim() : '';
    const lastName = typeof row?.lastName === 'string' ? row.lastName.trim() : '';
    const email = typeof row?.email === 'string' ? row.email.trim().toLowerCase() : '';
    const phone = typeof row?.phone === 'string' ? row.phone.trim() : '';
    const skills = row?.volunteer_skills ?? [];
    const groupIds = row?.groupIds ?? [];
    const maritalStatus = typeof row?.maritalStatus === 'string' ? row.maritalStatus.trim() : '';
    const background = typeof row?.background === 'string' ? row.background.trim() : '';
    const expectations = typeof row?.expectations === 'string' ? row.expectations.trim() : '';
    let message = '';

    if (!firstName || !lastName) message = 'First and last name are required';
    else if (firstName.length > 100 || lastName.length > 100) message = 'Names must be 100 characters or fewer';
    else if (row?.email != null && typeof row.email !== 'string') message = 'Email must be text';
    else if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) message = 'Enter a valid email address';
    else if (row?.phone != null && typeof row.phone !== 'string') message = 'Phone number must be text';
    else if (phone.length > 40) message = 'Phone number must be 40 characters or fewer';
    else if (!Array.isArray(skills) || skills.length > 30 || skills.some((skill) => typeof skill !== 'string' || skill.trim().length > 80)) {
      message = 'Volunteer skills must be text values up to 80 characters each';
    } else if (!Array.isArray(groupIds) || groupIds.length > 50
      || groupIds.some((id) => typeof id !== 'string') || new Set(groupIds).size !== groupIds.length) {
      message = 'Choose valid groups for this member';
    } else if ([['maritalStatus', maritalStatus, 80], ['background', background, 5000], ['expectations', expectations, 5000]]
      .some(([key, value, maxLength]) => (row?.[key] != null && typeof row[key] !== 'string') || value.length > maxLength)) {
      message = 'Member details contain an invalid value or exceed the allowed length';
    } else if (email && seenEmails.has(email)) {
      message = 'This email appears more than once in the CSV';
    }

    if (message) {
      errors.push({ row: rowNumber, message });
      return;
    }
    if (email) seenEmails.add(email);
    ready.push({ rowNumber, firstName, lastName, email, phone, skills, groupIds, maritalStatus, background, expectations });
  });

  const emails = ready.map((row) => row.email).filter(Boolean);
  if (emails.length) {
    const { rows: existing } = await query(
      'SELECT lower(email) AS email FROM members WHERE branch_id=$1 AND lower(email) = ANY($2::text[])',
      [targetBranch, emails]
    );
    const existingEmails = new Set(existing.map((row) => row.email));
    for (let index = ready.length - 1; index >= 0; index--) {
      const row = ready[index];
      if (row.email && existingEmails.has(row.email)) {
        errors.push({ row: row.rowNumber, message: 'A member with this email already exists at this campus' });
        ready.splice(index, 1);
      }
    }
  }

  const requestedGroupIds = [...new Set(ready.flatMap((row) => row.groupIds))];
  if (requestedGroupIds.length) {
    const { rows: groups } = await query(
      'SELECT id FROM groups WHERE branch_id=$1 AND id=ANY($2::text[])',
      [targetBranch, requestedGroupIds]
    );
    const validGroupIds = new Set(groups.map((group) => group.id));
    for (let index = ready.length - 1; index >= 0; index--) {
      const row = ready[index];
      if (row.groupIds.some((id) => !validGroupIds.has(id))) {
        errors.push({ row: row.rowNumber, message: 'Every selected group must exist at the member campus' });
        ready.splice(index, 1);
      }
    }
  }

  const created = ready.length ? await withTransaction(async (client) => {
    const results = [];
    for (const row of ready) {
      const id = genId('m');
      const { rows } = await client.query(
        `INSERT INTO members (id,branch_id,first_name,last_name,email,phone,volunteer_skills,engagement_score,
                              marital_status,background,expectations)
         VALUES ($1,$2,$3,$4,$5,$6,$7,60,$8,$9,$10) RETURNING *`,
        [id, targetBranch, row.firstName, row.lastName, row.email || null, row.phone || null,
          row.skills.map((skill) => skill.trim()).filter(Boolean),
          row.maritalStatus || null, row.background || null, row.expectations || null]
      );
      if (row.groupIds.length) {
        await client.query(
          'UPDATE groups SET member_ids=array_append(member_ids,$1) WHERE id=ANY($2::text[])',
          [id, row.groupIds]
        );
      }
      results.push({ rowNumber: row.rowNumber, member: mapMember({ ...rows[0], branch_name: branches[0].name }) });
    }
    return results;
  }) : [];

  errors.sort((a, b) => a.row - b.row);
  res.status(200).json({
    imported: created.length,
    members: created.map((item) => ({ ...item.member, importRowNumber: item.rowNumber })),
    errors,
  });
}));

router.get('/:id', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT m.*, b.name AS branch_name FROM members m JOIN branches b ON b.id=m.branch_id WHERE m.id=$1', [req.params.id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ error: 'Member not found' });
  if (req.user.role === 'member' && m.id !== req.user.memberId) return res.status(403).json({ error: 'Out of scope' });
  if (scope && m.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  res.json(mapMember(m));
}));

router.patch('/:id/milestones', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { spiritualMilestones } = req.body || {};
  if (!Array.isArray(spiritualMilestones) || spiritualMilestones.length > 100
      || spiritualMilestones.some((milestone) => typeof milestone !== 'string' || !milestone.trim() || milestone.trim().length > 200)) {
    return res.status(400).json({ error: 'Provide up to 100 non-empty spiritual milestones, each 200 characters or fewer' });
  }
  const { rows } = await query('SELECT branch_id FROM members WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Member not found' });
  if (scope && rows[0].branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  await query(
    'UPDATE members SET spiritual_milestones=$1 WHERE id=$2',
    [spiritualMilestones.map((milestone) => milestone.trim()), req.params.id]
  );
  const { rows: updated } = await query(
    'SELECT m.*, b.name AS branch_name FROM members m JOIN branches b ON b.id=m.branch_id WHERE m.id=$1',
    [req.params.id]
  );
  if (!updated[0]) return res.status(404).json({ error: 'Member not found' });
  res.json(mapMember(updated[0]));
}));

// Create a member (admins only). Branch is forced to the caller's scope unless HQ.
router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { firstName, lastName, email, phone, volunteer_skills = [], branchId,
          maritalStatus = null, background = null, expectations = null, groupIds = [], account = null } = req.body || {};
  const normalizedFirst = String(firstName || '').trim();
  const normalizedLast = String(lastName || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedFirst || !normalizedLast) return res.status(400).json({ error: 'First and last name are required' });
  if (normalizedFirst.length > 100 || normalizedLast.length > 100) {
    return res.status(400).json({ error: 'Names must be 100 characters or fewer' });
  }
  if (normalizedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address' });
  }
  if (email != null && typeof email !== 'string') return res.status(400).json({ error: 'Email must be text' });
  if (phone != null && (typeof phone !== 'string' || phone.trim().length > 40)) {
    return res.status(400).json({ error: 'Phone number must be text with at most 40 characters' });
  }
  if (!Array.isArray(volunteer_skills) || volunteer_skills.some((skill) => typeof skill !== 'string' || skill.length > 80)) {
    return res.status(400).json({ error: 'Volunteer skills must be an array of text values up to 80 characters each' });
  }
  if (!Array.isArray(groupIds) || groupIds.some((id) => typeof id !== 'string') || new Set(groupIds).size !== groupIds.length) {
    return res.status(400).json({ error: 'Choose valid groups for this member' });
  }
  const targetBranch = scope || branchId || 'b1';
  const accountRole = account?.role || null;
  if (accountRole && !['member', 'ministry_leader', 'branch_admin'].includes(accountRole)) {
    return res.status(400).json({ error: 'Choose a supported user role' });
  }
  if (accountRole === 'branch_admin' && req.user.role !== 'hq_admin') {
    return res.status(403).json({ error: 'Only HQ administrators can assign the branch administrator role' });
  }
  if (accountRole && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      || typeof account.password !== 'string' || account.password.length < 12)) {
    return res.status(400).json({ error: 'A valid email and password with at least 12 characters are required to create a login' });
  }
  const passwordHash = accountRole ? await hashPassword(account.password) : null;
  const memberId = genId('m');
  const result = await withTransaction(async (client) => {
    const { rows: branches } = await client.query('SELECT id, name FROM branches WHERE id=$1', [targetBranch]);
    if (!branches[0]) return { error: 'Invalid campus' };
    if (accountRole) {
      const { rows: existingUsers } = await client.query('SELECT id FROM users WHERE email=$1', [normalizedEmail]);
      if (existingUsers[0]) return { error: 'An account with this email already exists' };
    }
    if (groupIds.length) {
      const { rows: groups } = await client.query(
        'SELECT id FROM groups WHERE branch_id=$1 AND id = ANY($2::text[])',
        [targetBranch, groupIds]
      );
      if (groups.length !== groupIds.length) return { error: 'Every selected group must belong to the member campus' };
    }
    const { rows: members } = await client.query(
      `INSERT INTO members (id,branch_id,first_name,last_name,email,phone,volunteer_skills,engagement_score,
                            marital_status,background,expectations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,60,$8,$9,$10) RETURNING *`,
      [memberId, targetBranch, normalizedFirst, normalizedLast, normalizedEmail || null, phone || null,
        volunteer_skills.map((skill) => skill.trim()).filter(Boolean),
        maritalStatus || null, background || null, expectations || null]
    );
    if (groupIds.length) {
      await client.query('UPDATE groups SET member_ids = array_append(member_ids, $1) WHERE id = ANY($2::text[])', [memberId, groupIds]);
    }
    if (accountRole) {
      const { rows: users } = await client.query(
        `INSERT INTO users (email,password_hash,name,role,branch_id,member_id,mfa_enabled)
         VALUES ($1,$2,$3,$4,$5,$6,true)
         RETURNING id`,
        [normalizedEmail, passwordHash, `${normalizedFirst} ${normalizedLast}`, accountRole, targetBranch, memberId]
      );
      if (!users[0]) throw new Error('User account could not be created');
    }
    return { member: members[0], branchName: branches[0].name };
  });
  if (result.error) return res.status(result.error.includes('already exists') ? 409 : 400).json({ error: result.error });
  res.status(201).json(mapMember({ ...result.member, branch_name: result.branchName }));
}));

// Remove a member (administrators only, and only from their own campus).
// Agreed 17 Aug 2026: nobody below administrator may alter the roll.
router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT branch_id FROM members WHERE id=$1', [req.params.id]);
  const existing = rows[0];
  if (!existing) return res.status(404).json({ error: 'Member not found' });
  if (scope && existing.branch_id !== scope) return res.status(403).json({ error: 'Out of scope' });
  await withTransaction(async (client) => {
    await client.query('DELETE FROM attendance WHERE member_id=$1', [req.params.id]);
    await client.query('UPDATE groups SET member_ids = array_remove(member_ids, $1) WHERE $1 = ANY(member_ids)', [req.params.id]);
    await client.query('UPDATE events SET volunteers_signed_up = array_remove(volunteers_signed_up, $1) WHERE $1 = ANY(volunteers_signed_up)', [req.params.id]);
    await client.query('DELETE FROM users WHERE member_id=$1', [req.params.id]);
    await client.query('DELETE FROM members WHERE id=$1', [req.params.id]);
  });
  res.status(204).end();
}));

export default router;
