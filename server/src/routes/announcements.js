import { Router } from 'express';
import { query } from '../db/pool.js';
import { resolveScope, requireRole } from '../auth.js';
import { genId, mapAnnouncement, wrap } from './util.js';

const router = Router();

router.get('/', wrap(async (req, res) => {
  const scope = resolveScope(req);
  const params = [];
  const filter = req.user.role === 'hq_admin' && !scope
    ? ''
    : (scope
      ? (params.push(scope), `WHERE audience = 'all' OR audience = $${params.length}`)
      : "WHERE audience = 'all'");
  const { rows } = await query(`SELECT * FROM announcements ${filter} ORDER BY sent_at DESC`, params);
  res.json(rows.map(mapAnnouncement));
}));

// Send a broadcast. Recipient count is computed server-side from the audience.
router.post('/', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const { title, body, audience = 'all', channels = [] } = req.body || {};
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 160
      || typeof body !== 'string' || !body.trim() || body.trim().length > 10000) {
    return res.status(400).json({ error: 'A title of up to 160 characters and message of up to 10,000 characters are required' });
  }
  const allowedChannels = ['sms', 'email', 'push'];
  if (!Array.isArray(channels) || channels.length === 0
      || channels.some((channel) => !allowedChannels.includes(channel))
      || new Set(channels).size !== channels.length) {
    return res.status(400).json({ error: 'Choose one or more supported channels without duplicates' });
  }

  let targetAudience = audience;
  if (req.user.role !== 'hq_admin') {
    if (audience !== 'all' && audience !== req.user.branchId) {
      return res.status(403).json({ error: 'You may only send announcements to your campus' });
    }
    targetAudience = req.user.branchId;
  }
  if (targetAudience !== 'all') {
    const { rows: branch } = await query('SELECT id FROM branches WHERE id=$1', [targetAudience]);
    if (!branch[0]) return res.status(400).json({ error: 'Invalid announcement audience' });
  }
  const countSql = targetAudience === 'all'
    ? await query('SELECT count(*)::int AS n FROM members')
    : await query('SELECT count(*)::int AS n FROM members WHERE branch_id = $1', [targetAudience]);
  const recipients = countSql.rows[0].n;

  const { rows } = await query(
    'INSERT INTO announcements (id,title,body,audience,channels,recipients) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [genId('an'), title.trim(), body.trim(), targetAudience, channels, recipients]
  );
  res.status(201).json(mapAnnouncement(rows[0]));
}));

router.delete('/:id', requireRole('hq_admin', 'branch_admin'), wrap(async (req, res) => {
  const scope = resolveScope(req);
  const { rows } = await query('SELECT audience FROM announcements WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Announcement not found' });
  if (req.user.role !== 'hq_admin' && rows[0].audience !== scope) {
    return res.status(403).json({ error: 'You may only remove announcements sent to your campus' });
  }
  await query('DELETE FROM announcements WHERE id=$1', [req.params.id]);
  res.status(204).end();
}));

export default router;
