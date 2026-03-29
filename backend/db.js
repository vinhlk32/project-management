const { createClient } = require('@libsql/client');
const path = require('path');

const db = createClient({
  url: `file:${path.join(__dirname, 'data.db')}`,
});

async function initializeDatabase() {
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
      role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member', 'lead', 'manager', 'designer', 'developer')),
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
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      revoked INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS token_blacklist (
      jti TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      ip_address TEXT,
      user_agent TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_al_user_id ON audit_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_al_action ON audit_logs(action);
    CREATE INDEX IF NOT EXISTS idx_al_created ON audit_logs(created_at);
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
    'ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT NULL',
    'ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1',
    'ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL',
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch (_) {
      // Column already exists — safe to ignore
    }
  }
}

async function cleanupExpiredTokens() {
  const now = new Date().toISOString();
  try {
    await db.execute({
      sql: 'DELETE FROM token_blacklist WHERE expires_at < ?',
      args: [now],
    });
    await db.execute({
      sql: 'DELETE FROM refresh_tokens WHERE expires_at < ?',
      args: [now],
    });
  } catch (e) {
    console.error('Token cleanup failed:', e.message);
  }
}

// Keep legacy `init` export for backward compatibility
async function init() {
  return initializeDatabase();
}

module.exports = { db, init, initializeDatabase, cleanupExpiredTokens };
