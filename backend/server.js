const express = require('express');
const cors = require('cors');
const { db, init } = require('./db');
const { propagateDates } = require('./propagate');

const app = express();
app.use(cors());
app.use(express.json());

// ── Projects ──────────────────────────────────────────────────────────────────

app.get('/api/projects', async (req, res) => {
  const result = await db.execute('SELECT * FROM projects ORDER BY created_at DESC');
  res.json(result.rows);
});

app.post('/api/projects', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = await db.execute({
    sql: 'INSERT INTO projects (name, description) VALUES (?, ?)',
    args: [name.trim(), description || ''],
  });
  const row = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [result.lastInsertRowid] });
  res.status(201).json(row.rows[0]);
});

app.put('/api/projects/:id', async (req, res) => {
  const { name, description } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  await db.execute({
    sql: 'UPDATE projects SET name = ?, description = ? WHERE id = ?',
    args: [name.trim(), description || '', req.params.id],
  });
  const row = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [req.params.id] });
  res.json(row.rows[0]);
});

app.delete('/api/projects/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
});

// ── Users ─────────────────────────────────────────────────────────────────────

app.get('/api/users', async (req, res) => {
  const result = await db.execute('SELECT * FROM users ORDER BY name ASC');
  res.json(result.rows);
});

app.post('/api/users', async (req, res) => {
  const { name, email, avatar_color, role } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = await db.execute({
    sql: 'INSERT INTO users (name, email, avatar_color, role) VALUES (?, ?, ?, ?)',
    args: [name.trim(), email || '', avatar_color || '#4a9eff', role || 'member'],
  });
  const row = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [result.lastInsertRowid] });
  res.status(201).json(row.rows[0]);
});

app.put('/api/users/:id', async (req, res) => {
  const { name, email, avatar_color, role } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  await db.execute({
    sql: 'UPDATE users SET name = ?, email = ?, avatar_color = ?, role = ? WHERE id = ?',
    args: [name.trim(), email || '', avatar_color || '#4a9eff', role || 'member', req.params.id],
  });
  const row = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [req.params.id] });
  res.json(row.rows[0]);
});

app.delete('/api/users/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/tasks', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT t.*, u.name AS assignee_name, u.avatar_color AS assignee_color
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.project_id = ?
          ORDER BY t.created_at DESC`,
    args: [req.params.id],
  });
  res.json(result.rows);
});

app.post('/api/tasks', async (req, res) => {
  const { project_id, title, description, status, priority, assignee_id, labels, start_date, due_date, estimated_hours } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const result = await db.execute({
    sql: `INSERT INTO tasks (project_id, title, description, status, priority, assignee_id, labels, start_date, due_date, estimated_hours)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      project_id, title.trim(), description || '',
      status || 'todo', priority || 'medium',
      assignee_id || null, labels || '',
      start_date || null, due_date || null,
      estimated_hours || 0,
    ],
  });
  const row = await db.execute({
    sql: `SELECT t.*, u.name AS assignee_name, u.avatar_color AS assignee_color
          FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
          WHERE t.id = ?`,
    args: [result.lastInsertRowid],
  });
  res.status(201).json(row.rows[0]);
});

app.put('/api/tasks/:id', async (req, res) => {
  const { title, description, status, priority, assignee_id, labels, start_date, due_date, estimated_hours, logged_hours } = req.body;
  await db.execute({
    sql: `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?,
          assignee_id = ?, labels = ?, start_date = ?, due_date = ?,
          estimated_hours = ?, logged_hours = ?
          WHERE id = ?`,
    args: [
      title, description || '',
      status, priority || 'medium',
      assignee_id || null, labels || '',
      start_date || null, due_date || null,
      estimated_hours || 0, logged_hours || 0,
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

  // Propagate date changes to successors
  const affected = await propagateDates(db, Number(req.params.id));

  res.json({ task, affected: Object.values(affected) });
});

app.delete('/api/tasks/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
});

// ── Comments ──────────────────────────────────────────────────────────────────

app.get('/api/tasks/:id/comments', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT c.*, u.name AS user_name, u.avatar_color AS user_color
          FROM comments c
          LEFT JOIN users u ON u.id = c.user_id
          WHERE c.task_id = ?
          ORDER BY c.created_at ASC`,
    args: [req.params.id],
  });
  res.json(result.rows);
});

app.post('/api/tasks/:id/comments', async (req, res) => {
  const { user_id, author_name, content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Content is required' });
  const result = await db.execute({
    sql: 'INSERT INTO comments (task_id, user_id, author_name, content) VALUES (?, ?, ?, ?)',
    args: [req.params.id, user_id || null, author_name || 'Anonymous', content.trim()],
  });
  const row = await db.execute({
    sql: `SELECT c.*, u.name AS user_name, u.avatar_color AS user_color
          FROM comments c LEFT JOIN users u ON u.id = c.user_id
          WHERE c.id = ?`,
    args: [result.lastInsertRowid],
  });
  res.status(201).json(row.rows[0]);
});

app.delete('/api/comments/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM comments WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
});

// ── Dependencies ──────────────────────────────────────────────────────────────

// Get all dependencies for every task in a project (used by Gantt chart)
app.get('/api/projects/:id/dependencies', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT td.*
          FROM task_dependencies td
          JOIN tasks t ON t.id = td.predecessor_id
          WHERE t.project_id = ?`,
    args: [req.params.id],
  });
  res.json(result.rows);
});

// Get all predecessor dependencies for a task (with predecessor task name)
app.get('/api/tasks/:id/dependencies', async (req, res) => {
  const result = await db.execute({
    sql: `SELECT td.*, t.title AS predecessor_title
          FROM task_dependencies td
          JOIN tasks t ON t.id = td.predecessor_id
          WHERE td.successor_id = ?
          ORDER BY td.id`,
    args: [req.params.id],
  });
  res.json(result.rows);
});

// Add a dependency (this task is the successor)
app.post('/api/tasks/:id/dependencies', async (req, res) => {
  const { predecessor_id, type, lag } = req.body;
  const successorId = Number(req.params.id);

  if (predecessor_id === successorId) {
    return res.status(400).json({ error: 'A task cannot depend on itself' });
  }

  // Simple cycle check: would predecessor become reachable from successor?
  if (await wouldCreateCycle(db, successorId, predecessor_id)) {
    return res.status(400).json({ error: 'This dependency would create a cycle' });
  }

  try {
    const result = await db.execute({
      sql: 'INSERT INTO task_dependencies (predecessor_id, successor_id, type, lag) VALUES (?, ?, ?, ?)',
      args: [predecessor_id, successorId, type || 'FS', lag || 0],
    });
    const row = await db.execute({
      sql: `SELECT td.*, t.title AS predecessor_title
            FROM task_dependencies td
            JOIN tasks t ON t.id = td.predecessor_id
            WHERE td.id = ?`,
      args: [result.lastInsertRowid],
    });

    // Immediately propagate from the predecessor so the new successor gets correct dates
    const affected = await propagateDates(db, predecessor_id);

    res.status(201).json({ dependency: row.rows[0], affected: Object.values(affected) });
  } catch (e) {
    if (e.message?.includes('UNIQUE')) return res.status(409).json({ error: 'Dependency already exists' });
    throw e;
  }
});

app.delete('/api/dependencies/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM task_dependencies WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
});

// ── Analytics ─────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/analytics', async (req, res) => {
  const projectId = req.params.id;
  const today = new Date().toISOString().split('T')[0];

  const [taskStats, priorityStats, assigneeStats, overdueTasks, recentActivity] = await Promise.all([
    // Task counts by status
    db.execute({
      sql: `SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status`,
      args: [projectId],
    }),
    // Task counts by priority
    db.execute({
      sql: `SELECT priority, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY priority`,
      args: [projectId],
    }),
    // Tasks per assignee
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
    // Overdue tasks
    db.execute({
      sql: `SELECT COUNT(*) as count FROM tasks
            WHERE project_id = ? AND due_date < ? AND status != 'done'`,
      args: [projectId, today],
    }),
    // Recent comments
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
});

// ── Cycle detection ───────────────────────────────────────────────────────────

async function wouldCreateCycle(db, startId, targetId) {
  // BFS: can we reach targetId starting from startId following successor edges?
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

const PORT = 3001;
init().then(() => {
  app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
