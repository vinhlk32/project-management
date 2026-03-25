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
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo', 'in-progress', 'done')),
      start_date TEXT,
      due_date TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
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
    PRAGMA foreign_keys = ON;
  `);

  // Migration: add start_date if the existing DB doesn't have it yet
  try {
    await db.execute('ALTER TABLE tasks ADD COLUMN start_date TEXT');
  } catch (_) {
    // Column already exists — safe to ignore
  }
}

module.exports = { db, init };
