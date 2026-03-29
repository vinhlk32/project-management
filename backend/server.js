require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { db, initializeDatabase, cleanupExpiredTokens } = require('./db');
const { propagateDates } = require('./propagate');
const requireAuth = require('./middleware/requireAuth');
const requireRole = require('./middleware/requireRole');
const authRoutes = require('./routes/authRoutes');
const auditRoutes = require('./routes/auditRoutes');
const { logAudit } = require('./audit');

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS – restrict to the frontend origin only ───────────────────────────────
// Fail fast in production if FRONTEND_URL is not explicitly configured
if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  throw new Error('FRONTEND_URL environment variable must be set in production');
}
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Authorization', 'X-CSRF-Token', 'Content-Type'],
  credentials: true,
}));

// ── Body size limit ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

// ── Cookie parser ──────────────────────────────────────────────────────────────
app.use(cookieParser());

// ── Rate limiting ──────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Stricter rate limiter for login endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
});

// ── CSRF protection ────────────────────────────────────────────────────────────
const csrfProtect = (req, res, next) => {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();
  if (req.path.startsWith('/api/auth/')) return next(); // login/refresh don't have token yet
  const headerToken = req.headers['x-csrf-token'];
  const cookieToken = req.cookies?.csrf_token;
  if (!headerToken || !cookieToken || headerToken !== cookieToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
};
app.use(csrfProtect);

// ── Attach db to req ──────────────────────────────────────────────────────────
app.use((req, res, next) => { req.db = db; next(); });

// ── Validation helpers ─────────────────────────────────────────────────────────
const VALID_STATUSES   = ['todo', 'in-progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_DEP_TYPES  = ['FS', 'SF', 'SS', 'FF'];
const VALID_ROLES      = ['admin', 'member', 'lead', 'manager', 'designer', 'developer'];

function isValidId(val) {
  const n = Number(val);
  return Number.isInteger(n) && n > 0;
}

// Middleware: validate :id params are positive integers
app.param('id', (req, res, next, id) => {
  if (!isValidId(id)) return res.status(400).json({ error: 'Invalid ID' });
  next();
});

// ── Global error handler ───────────────────────────────────────────────────────
function handleError(res, err) {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

// ── Auth routes (mounted before requireAuth so login/refresh/etc work) ────────
app.use('/api/auth', loginLimiter, authRoutes);

// ── Audit routes (protected inside the router) ────────────────────────────────
app.use('/api', auditRoutes);

// ── Apply requireAuth to all remaining API routes ─────────────────────────────
app.use('/api', requireAuth);

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  try {
    const result = await db.execute('SELECT * FROM projects ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) { handleError(res, err); }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.trim().length > 200) return res.status(400).json({ error: 'Name too long (max 200)' });
    if (description && description.length > 2000) return res.status(400).json({ error: 'Description too long (max 2000)' });

    const result = await db.execute({
      sql: 'INSERT INTO projects (name, description) VALUES (?, ?)',
      args: [name.trim(), (description || '').trim()],
    });
    const row = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [result.lastInsertRowid] });
    const project = row.rows[0];

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'project_created',
      entityType: 'project',
      entityId: Number(result.lastInsertRowid),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      detail: { name: name.trim() },
    });

    res.status(201).json(project);
  } catch (err) { handleError(res, err); }
});

app.put('/api/projects/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.trim().length > 200) return res.status(400).json({ error: 'Name too long (max 200)' });
    if (description && description.length > 2000) return res.status(400).json({ error: 'Description too long (max 2000)' });

    await db.execute({
      sql: 'UPDATE projects SET name = ?, description = ? WHERE id = ?',
      args: [name.trim(), (description || '').trim(), req.params.id],
    });
    const row = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [req.params.id] });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'project_updated',
      entityType: 'project',
      entityId: Number(req.params.id),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      detail: { name: name.trim() },
    });

    res.json(row.rows[0]);
  } catch (err) { handleError(res, err); }
});

app.delete('/api/projects/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [req.params.id] });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'project_deleted',
      entityType: 'project',
      entityId: Number(req.params.id),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  try {
    const isAdmin = req.user?.role === 'admin';
    // Admins see security fields; regular users see only what they need for task assignment
    const sql = isAdmin
      ? 'SELECT id, name, email, avatar_color, role, is_active, locked_until, failed_attempts, created_at FROM users ORDER BY name ASC'
      : 'SELECT id, name, email, avatar_color, role, created_at FROM users WHERE is_active = 1 ORDER BY name ASC';
    const result = await db.execute(sql);
    res.json(result.rows);
  } catch (err) { handleError(res, err); }
});

app.post('/api/users', requireRole('admin'), async (req, res) => {
  try {
    const { name, email, avatar_color, role } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
    if (name.trim().length > 100) return res.status(400).json({ error: 'Name too long (max 100)' });
    if (email && email.length > 254) return res.status(400).json({ error: 'Email too long (max 254)' });
    if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const result = await db.execute({
      sql: 'INSERT INTO users (name, email, avatar_color, role) VALUES (?, ?, ?, ?)',
      args: [name.trim(), (email || '').trim().toLowerCase(), avatar_color || '#4a9eff', role || 'member'],
    });
    const row = await db.execute({
      sql: 'SELECT id, name, email, avatar_color, role, is_active, locked_until, created_at FROM users WHERE id = ?',
      args: [result.lastInsertRowid],
    });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'user_created',
      entityType: 'user',
      entityId: Number(result.lastInsertRowid),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      detail: { name: name.trim(), email, role },
    });

    res.status(201).json(row.rows[0]);
  } catch (err) { handleError(res, err); }
});

app.put('/api/users/:id', requireRole('admin'), async (req, res) => {
  try {
    const { name, email, avatar_color, role, is_active, locked_until, failed_attempts } = req.body;

    // Get current user data
    const current = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
    if (!current.rows[0]) return res.status(404).json({ error: 'User not found' });

    const u = current.rows[0];
    const newName = name?.trim() || u.name;
    const newEmail = email !== undefined ? (email || '').trim().toLowerCase() : u.email;
    const newAvatarColor = avatar_color || u.avatar_color;
    const newRole = (role && VALID_ROLES.includes(role)) ? role : u.role;
    const newIsActive = is_active !== undefined ? (is_active ? 1 : 0) : u.is_active;
    const newLockedUntil = locked_until !== undefined ? locked_until : u.locked_until;
    const newFailedAttempts = failed_attempts !== undefined ? failed_attempts : u.failed_attempts;

    if (newName.length > 100) return res.status(400).json({ error: 'Name too long (max 100)' });
    if (newEmail && newEmail.length > 254) return res.status(400).json({ error: 'Email too long (max 254)' });
    if (newEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    await db.execute({
      sql: 'UPDATE users SET name = ?, email = ?, avatar_color = ?, role = ?, is_active = ?, locked_until = ?, failed_attempts = ? WHERE id = ?',
      args: [newName, newEmail, newAvatarColor, newRole, newIsActive, newLockedUntil, newFailedAttempts, req.params.id],
    });
    const row = await db.execute({
      sql: 'SELECT id, name, email, avatar_color, role, is_active, locked_until, created_at FROM users WHERE id = ?',
      args: [req.params.id],
    });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'user_updated',
      entityType: 'user',
      entityId: Number(req.params.id),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json(row.rows[0]);
  } catch (err) { handleError(res, err); }
});

app.delete('/api/users/:id', requireRole('admin'), async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'user_deleted',
      entityType: 'user',
      entityId: Number(req.params.id),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/tasks', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT t.*, u.name AS assignee_name, u.avatar_color AS assignee_color
            FROM tasks t
            LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.project_id = ?
            ORDER BY t.created_at DESC`,
      args: [req.params.id],
    });
    res.json(result.rows);
  } catch (err) { handleError(res, err); }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { project_id, title, description, status, priority, assignee_id, labels, start_date, due_date, estimated_hours } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (title.trim().length > 300) return res.status(400).json({ error: 'Title too long (max 300)' });
    if (description && description.length > 5000) return res.status(400).json({ error: 'Description too long (max 5000)' });
    if (!isValidId(project_id)) return res.status(400).json({ error: 'Invalid project_id' });
    if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (priority && !VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
    if (assignee_id && !isValidId(assignee_id)) return res.status(400).json({ error: 'Invalid assignee_id' });
    const hours = Number(estimated_hours) || 0;
    if (hours < 0 || hours > 9999) return res.status(400).json({ error: 'Invalid estimated_hours' });

    const result = await db.execute({
      sql: `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, labels, start_date, due_date, estimated_hours)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        project_id, title.trim(), (description || '').trim(),
        status || 'todo', priority || 'medium',
        assignee_id || null, (labels || '').slice(0, 500),
        start_date || null, due_date || null,
        hours,
      ],
    });
    const row = await db.execute({
      sql: `SELECT t.*, u.name AS assignee_name, u.avatar_color AS assignee_color
            FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.id = ?`,
      args: [result.lastInsertRowid],
    });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'task_created',
      entityType: 'task',
      entityId: Number(result.lastInsertRowid),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      detail: { title: title.trim(), project_id },
    });

    res.status(201).json(row.rows[0]);
  } catch (err) { handleError(res, err); }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { title, description, status, priority, assignee_id, labels, start_date, due_date, estimated_hours, logged_hours } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
    if (title.trim().length > 300) return res.status(400).json({ error: 'Title too long (max 300)' });
    if (description && description.length > 5000) return res.status(400).json({ error: 'Description too long (max 5000)' });
    if (status && !VALID_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
    if (priority && !VALID_PRIORITIES.includes(priority)) return res.status(400).json({ error: 'Invalid priority' });
    if (assignee_id && !isValidId(assignee_id)) return res.status(400).json({ error: 'Invalid assignee_id' });
    const estH = Number(estimated_hours) || 0;
    const logH = Number(logged_hours) || 0;
    if (estH < 0 || estH > 9999) return res.status(400).json({ error: 'Invalid estimated_hours' });
    if (logH < 0 || logH > 9999) return res.status(400).json({ error: 'Invalid logged_hours' });

    await db.execute({
      sql: `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
            assignee_id = ?, labels = ?, start_date = ?, due_date = ?,
            estimated_hours = ?, logged_hours = ?
            WHERE id = ?`,
      args: [
        title.trim(), (description || '').trim(),
        status || 'todo', priority || 'medium',
        assignee_id || null, (labels || '').slice(0, 500),
        start_date || null, due_date || null,
        estH, logH,
        req.params.id,
      ],
    });
    const row = await db.execute({
      sql: `SELECT t.*, u.name AS assignee_name, u.avatar_color AS assignee_color
            FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
            WHERE t.id = ?`,
      args: [req.params.id],
    });
    const task = row.rows[0];
    const affected = await propagateDates(db, Number(req.params.id));

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'task_updated',
      entityType: 'task',
      entityId: Number(req.params.id),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({ task, affected: Object.values(affected) });
  } catch (err) { handleError(res, err); }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [req.params.id] });

    await logAudit(db, {
      userId: req.user?.sub,
      action: 'task_deleted',
      entityType: 'task',
      entityId: Number(req.params.id),
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ── Comments ──────────────────────────────────────────────────────────────────

app.get('/api/tasks/:id/comments', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT c.*, u.name AS user_name, u.avatar_color AS user_color
            FROM comments c
            LEFT JOIN users u ON u.id = c.user_id
            WHERE c.task_id = ?
            ORDER BY c.created_at ASC`,
      args: [req.params.id],
    });
    res.json(result.rows);
  } catch (err) { handleError(res, err); }
});

app.post('/api/tasks/:id/comments', async (req, res) => {
  try {
    const { user_id, author_name, content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
    if (content.trim().length > 5000) return res.status(400).json({ error: 'Comment too long (max 5000)' });
    if (user_id && !isValidId(user_id)) return res.status(400).json({ error: 'Invalid user_id' });
    const safeAuthor = (author_name || 'Anonymous').slice(0, 100);

    const result = await db.execute({
      sql: 'INSERT INTO comments (task_id, user_id, author_name, content) VALUES (?, ?, ?, ?)',
      args: [req.params.id, user_id || null, safeAuthor, content.trim()],
    });
    const row = await db.execute({
      sql: `SELECT c.*, u.name AS user_name, u.avatar_color AS user_color
            FROM comments c LEFT JOIN users u ON u.id = c.user_id
            WHERE c.id = ?`,
      args: [result.lastInsertRowid],
    });
    res.status(201).json(row.rows[0]);
  } catch (err) { handleError(res, err); }
});

app.delete('/api/comments/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM comments WHERE id = ?', args: [req.params.id] });
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ── Dependencies ──────────────────────────────────────────────────────────────

app.get('/api/projects/:id/dependencies', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT td.*
            FROM task_dependencies td
            JOIN tasks t ON t.id = td.predecessor_id
            WHERE t.project_id = ?`,
      args: [req.params.id],
    });
    res.json(result.rows);
  } catch (err) { handleError(res, err); }
});

app.get('/api/tasks/:id/dependencies', async (req, res) => {
  try {
    const result = await db.execute({
      sql: `SELECT td.*, t.title AS predecessor_title
            FROM task_dependencies td
            JOIN tasks t ON t.id = td.predecessor_id
            WHERE td.successor_id = ?
            ORDER BY td.id`,
      args: [req.params.id],
    });
    res.json(result.rows);
  } catch (err) { handleError(res, err); }
});

app.post('/api/tasks/:id/dependencies', async (req, res) => {
  try {
    const { predecessor_id, type, lag } = req.body;
    const successorId = Number(req.params.id);

    if (!isValidId(predecessor_id)) return res.status(400).json({ error: 'Invalid predecessor_id' });
    if (Number(predecessor_id) === successorId) return res.status(400).json({ error: 'A task cannot depend on itself' });
    if (type && !VALID_DEP_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid dependency type' });
    const lagVal = Number(lag) || 0;
    if (!Number.isInteger(lagVal) || lagVal < -999 || lagVal > 999) return res.status(400).json({ error: 'Invalid lag value' });

    if (await wouldCreateCycle(db, successorId, Number(predecessor_id))) {
      return res.status(400).json({ error: 'This dependency would create a cycle' });
    }

    const result = await db.execute({
      sql: 'INSERT INTO task_dependencies (predecessor_id, successor_id, type, lag) VALUES (?, ?, ?, ?)',
      args: [predecessor_id, successorId, type || 'FS', lagVal],
    });
    const row = await db.execute({
      sql: `SELECT td.*, t.title AS predecessor_title
            FROM task_dependencies td
            JOIN tasks t ON t.id = td.predecessor_id
            WHERE td.id = ?`,
      args: [result.lastInsertRowid],
    });
    const affected = await propagateDates(db, Number(predecessor_id));
    res.status(201).json({ dependency: row.rows[0], affected: Object.values(affected) });
  } catch (err) {
    if (err.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Dependency already exists' });
    handleError(res, err);
  }
});

app.delete('/api/dependencies/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM task_dependencies WHERE id = ?', args: [req.params.id] });
    res.status(204).end();
  } catch (err) { handleError(res, err); }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/analytics', async (req, res) => {
  try {
    const projectId = req.params.id;
    const today = new Date().toISOString().split('T')[0];

    const [taskStats, priorityStats, assigneeStats, overdueTasks, recentActivity] = await Promise.all([
      db.execute({ sql: `SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status`, args: [projectId] }),
      db.execute({ sql: `SELECT priority, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY priority`, args: [projectId] }),
      db.execute({
        sql: `SELECT u.id, u.name, u.avatar_color,
                COUNT(t.id) as total,
                SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) as done,
                SUM(CASE WHEN t.status = 'in-progress' THEN 1 ELSE 0 END) as in_progress
              FROM users u
              LEFT JOIN tasks t ON t.assignee_id = u.id AND t.project_id = ?
              GROUP BY u.id, u.name, u.avatar_color
              ORDER BY total DESC`,
        args: [projectId],
      }),
      db.execute({ sql: `SELECT COUNT(*) as count FROM tasks WHERE project_id = ? AND due_date < ? AND status != 'done'`, args: [projectId, today] }),
      db.execute({
        sql: `SELECT c.*, t.title as task_title, u.name as user_name, u.avatar_color as user_color
              FROM comments c
              JOIN tasks t ON t.id = c.task_id
              LEFT JOIN users u ON u.id = c.user_id
              WHERE t.project_id = ?
              ORDER BY c.created_at DESC LIMIT 10`,
        args: [projectId],
      }),
    ]);

    res.json({
      taskStats: taskStats.rows,
      priorityStats: priorityStats.rows,
      assigneeStats: assigneeStats.rows,
      overdueCount: overdueTasks.rows[0]?.count ?? 0,
      recentActivity: recentActivity.rows,
    });
  } catch (err) { handleError(res, err); }
});

// ── Cycle detection ───────────────────────────────────────────────────────────

async function wouldCreateCycle(db, startId, targetId) {
  const visited = new Set();
  const queue = [startId];
  while (queue.length) {
    const current = queue.shift();
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    const result = await db.execute({
      sql: 'SELECT successor_id FROM task_dependencies WHERE predecessor_id = ?',
      args: [current],
    });
    for (const row of result.rows) queue.push(row.successor_id);
  }
  return false;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
initializeDatabase().then(() => {
  cleanupExpiredTokens();
  app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
