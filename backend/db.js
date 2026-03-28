const { createClient } = require('@libsql/client');
const path = require('path');

const db = createClient({
  url: `file:${path.join(__dirname, 'data.db')}`,
});

async function init() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT DEFAULT '',
      avatar_color TEXT DEFAULT '#4a9eff',
      role TEXT DEFAULT 'member',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in-progress', 'done')),
      priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
      assignee_id INTEGER,
      labels TEXT DEFAULT '',
      start_date TEXT,
      due_date TEXT,
      estimated_hours REAL DEFAULT 0,
      logged_hours REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (assignee_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS task_dependencies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      predecessor_id INTEGER NOT NULL,
      successor_id INTEGER NOT NULL,
      type TEXT NOT NULL DEFAULT 'FS' CHECK(type IN ('FS', 'SF', 'SS', 'FF')),
      lag INTEGER DEFAULT 0,
      FOREIGN KEY (predecessor_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (successor_id) REFERENCES tasks(id) ON DELETE CASCADE,
      UNIQUE(predecessor_id, successor_id)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL,
      user_id INTEGER,
      author_name TEXT DEFAULT 'Anonymous',
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    PRAGMA foreign_keys = ON;
  `);

  // Migrations for existing databases
  const migrations = [
    'ALTER TABLE tasks ADD COLUMN start_date TEXT',
    'ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT \'medium\'',
    'ALTER TABLE tasks ADD COLUMN assignee_id INTEGER',
    'ALTER TABLE tasks ADD COLUMN labels TEXT DEFAULT \'\'',
    'ALTER TABLE tasks ADD COLUMN estimated_hours REAL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN logged_hours REAL DEFAULT 0',
    'ALTER TABLE projects ADD COLUMN description TEXT DEFAULT \'\'',
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch (_) {
      // Column already exists — safe to ignore
    }
  }
}

module.exports = { db, init };
