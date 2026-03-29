const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const VALID_AUDIT_ACTIONS = [
  'login_success', 'login_failed', 'logout', 'account_locked', 'password_changed',
  'project_created', 'project_updated', 'project_deleted',
  'task_created', 'task_updated', 'task_deleted',
  'user_created', 'user_updated', 'user_deleted',
  'comment_created', 'comment_deleted',
];

// GET /api/audit-logs
router.get('/audit-logs', requireAuth, requireRole('admin'), async (req, res) => {
  const db = req.db;

  const { userId, from, to } = req.query;
  const action = req.query.action && VALID_AUDIT_ACTIONS.includes(req.query.action)
    ? req.query.action : null;
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;

  try {
    const conditions = [];
    const args = [];

    if (userId) {
      conditions.push('al.user_id = ?');
      args.push(Number(userId));
    }
    if (action) {
      conditions.push('al.action = ?');
      args.push(action);
    }
    if (from) {
      conditions.push('al.created_at >= ?');
      args.push(from);
    }
    if (to) {
      conditions.push('al.created_at <= ?');
      args.push(to);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await db.execute({
      sql: `SELECT COUNT(*) as total FROM audit_logs al ${where}`,
      args,
    });
    const total = countResult.rows[0]?.total ?? 0;

    // LIMIT/OFFSET are validated integers — safe to inline (avoids mysql2 prepared-stmt limitation)
    const logsResult = await db.execute({
      sql: `SELECT al.*, u.name AS user_name
            FROM audit_logs al
            LEFT JOIN users u ON u.id = al.user_id
            ${where}
            ORDER BY al.created_at DESC
            LIMIT ${limit} OFFSET ${offset}`,
      args,
    });

    return res.json({ total, logs: logsResult.rows });
  } catch (err) {
    console.error('Audit logs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
