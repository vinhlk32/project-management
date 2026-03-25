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
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const result = await db.execute({ sql: 'INSERT INTO projects (name) VALUES (?)', args: [name.trim()] });
  const row = await db.execute({ sql: 'SELECT * FROM projects WHERE id = ?', args: [result.lastInsertRowid] });
  res.status(201).json(row.rows[0]);
});

app.delete('/api/projects/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM projects WHERE id = ?', args: [req.params.id] });
  res.status(204).end();
});

// ── Tasks ─────────────────────────────────────────────────────────────────────

app.get('/api/projects/:id/tasks', async (req, res) => {
  const result = await db.execute({
    sql: 'SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at DESC',
    args: [req.params.id],
  });
  res.json(result.rows);
});

app.post('/api/tasks', async (req, res) => {
  const { project_id, title, description, status, start_date, due_date } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });
  const result = await db.execute({
    sql: 'INSERT INTO tasks (project_id, title, description, status, start_date, due_date) VALUES (?, ?, ?, ?, ?, ?)',
    args: [project_id, title.trim(), description || '', status || 'todo', start_date || null, due_date || null],
  });
  const row = await db.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [result.lastInsertRowid] });
  res.status(201).json(row.rows[0]);
});

app.put('/api/tasks/:id', async (req, res) => {
  const { title, description, status, start_date, due_date } = req.body;
  await db.execute({
    sql: 'UPDATE tasks SET title = ?, description = ?, status = ?, start_date = ?, due_date = ? WHERE id = ?',
    args: [title, description || '', status, start_date || null, due_date || null, req.params.id],
  });
  const row = await db.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [req.params.id] });
  const task = row.rows[0];

  // Propagate date changes to successors
  const affected = await propagateDates(db, Number(req.params.id));

  res.json({ task, affected: Object.values(affected) });
});

app.delete('/api/tasks/:id', async (req, res) => {
  await db.execute({ sql: 'DELETE FROM tasks WHERE id = ?', args: [req.params.id] });
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
