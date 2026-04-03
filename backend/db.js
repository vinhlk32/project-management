const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.DB_HOST     || 'localhost',
      port:               Number(process.env.DB_PORT) || 3306,
      database:           process.env.DB_NAME     || 'projectmanager',
      user:               process.env.DB_USER     || 'root',
      password:           process.env.DB_PASSWORD || '',
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
      dateStrings:        true, // return DATE/DATETIME as strings, not JS Date objects
      ssl: false,
    });
  }
  return pool;
}

// ── Adapter ───────────────────────────────────────────────────────────────────
// Normalises mysql2 output to the { rows, lastInsertRowid } shape used
// throughout the codebase so every call-site works without modification.
const db = {
  async execute(queryOrString) {
    const p = getPool();
    let sql, args;

    if (typeof queryOrString === 'string') {
      sql  = queryOrString;
      args = [];
    } else {
      sql  = queryOrString.sql;
      args = (queryOrString.args || []).map(v => (v === undefined ? null : v));
    }

    const [rows] = await p.execute(sql, args);

    // SELECT → rows is an array; INSERT/UPDATE/DELETE → ResultSetHeader object
    if (Array.isArray(rows)) {
      return { rows, lastInsertRowid: null };
    }
    return { rows: [], lastInsertRowid: rows.insertId || null };
  },
};

// ── Schema initialisation ─────────────────────────────────────────────────────
async function initializeDatabase() {
  const p   = getPool();
  const conn = await p.getConnection();
  try {
    // projects
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS projects (
        id          INT          NOT NULL AUTO_INCREMENT,
        name        VARCHAR(200) NOT NULL,
        description TEXT,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // users
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id              INT          NOT NULL AUTO_INCREMENT,
        name            VARCHAR(100) NOT NULL,
        email           VARCHAR(254) NOT NULL DEFAULT '',
        avatar_color    VARCHAR(20)  NOT NULL DEFAULT '#4a9eff',
        role            ENUM('admin','member','lead','manager','designer','developer')
                                     NOT NULL DEFAULT 'member',
        password_hash   VARCHAR(255) DEFAULT NULL,
        is_active       TINYINT(1)   NOT NULL DEFAULT 1,
        failed_attempts INT          NOT NULL DEFAULT 0,
        locked_until    DATETIME     DEFAULT NULL,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_users_email     (email),
        INDEX idx_users_is_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // tasks
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS tasks (
        id              INT          NOT NULL AUTO_INCREMENT,
        project_id      INT          NOT NULL,
        title           VARCHAR(300) NOT NULL,
        description     TEXT,
        status          ENUM('todo','in-progress','done')      NOT NULL DEFAULT 'todo',
        priority        ENUM('low','medium','high','critical')  NOT NULL DEFAULT 'medium',
        assignee_id     INT          DEFAULT NULL,
        labels          VARCHAR(500) NOT NULL DEFAULT '',
        start_date      DATE         DEFAULT NULL,
        due_date        DATE         DEFAULT NULL,
        estimated_hours DECIMAL(7,2) NOT NULL DEFAULT 0.00,
        logged_hours    DECIMAL(7,2) NOT NULL DEFAULT 0.00,
        created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_tasks_project_id  (project_id),
        INDEX idx_tasks_assignee_id (assignee_id),
        INDEX idx_tasks_status      (status),
        INDEX idx_tasks_due_date    (due_date),
        CONSTRAINT fk_tasks_project  FOREIGN KEY (project_id)
          REFERENCES projects(id) ON DELETE CASCADE,
        CONSTRAINT fk_tasks_assignee FOREIGN KEY (assignee_id)
          REFERENCES users(id)    ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migration: add parent_id column for subtask support
    const [parentIdCheck] = await conn.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tasks' AND COLUMN_NAME = 'parent_id'"
    );
    if (!parentIdCheck.length) {
      await conn.execute('ALTER TABLE tasks ADD COLUMN parent_id INT DEFAULT NULL');
      await conn.execute('ALTER TABLE tasks ADD INDEX idx_tasks_parent_id (parent_id)');
      await conn.execute('ALTER TABLE tasks ADD CONSTRAINT fk_tasks_parent FOREIGN KEY (parent_id) REFERENCES tasks(id) ON DELETE CASCADE');
    }

    // task_dependencies
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id             INT NOT NULL AUTO_INCREMENT,
        predecessor_id INT NOT NULL,
        successor_id   INT NOT NULL,
        type           ENUM('FS','SF','SS','FF') NOT NULL DEFAULT 'FS',
        \`lag\`         INT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_dep (predecessor_id, successor_id),
        CONSTRAINT fk_dep_predecessor FOREIGN KEY (predecessor_id)
          REFERENCES tasks(id) ON DELETE CASCADE,
        CONSTRAINT fk_dep_successor   FOREIGN KEY (successor_id)
          REFERENCES tasks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // comments
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS comments (
        id          INT          NOT NULL AUTO_INCREMENT,
        task_id     INT          NOT NULL,
        user_id     INT          DEFAULT NULL,
        author_name VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
        content     TEXT         NOT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_comments_task_id (task_id),
        CONSTRAINT fk_comments_task FOREIGN KEY (task_id)
          REFERENCES tasks(id)  ON DELETE CASCADE,
        CONSTRAINT fk_comments_user FOREIGN KEY (user_id)
          REFERENCES users(id)  ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // refresh_tokens
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id         INT         NOT NULL AUTO_INCREMENT,
        user_id    INT         NOT NULL,
        token_hash VARCHAR(64) NOT NULL,
        expires_at DATETIME    NOT NULL,
        created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
        revoked    TINYINT(1)  NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uq_token_hash (token_hash),
        INDEX idx_rt_user_id (user_id),
        CONSTRAINT fk_rt_user FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB
    `);

    // token_blacklist
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS token_blacklist (
        jti        VARCHAR(36) NOT NULL,
        expires_at DATETIME    NOT NULL,
        PRIMARY KEY (jti),
        INDEX idx_tb_expires_at (expires_at)
      ) ENGINE=InnoDB
    `);

    // audit_logs
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          INT          NOT NULL AUTO_INCREMENT,
        user_id     INT          DEFAULT NULL,
        action      VARCHAR(50)  NOT NULL,
        entity_type VARCHAR(50)  DEFAULT NULL,
        entity_id   INT          DEFAULT NULL,
        ip_address  VARCHAR(45)  DEFAULT NULL,
        user_agent  VARCHAR(500) DEFAULT NULL,
        detail      JSON         DEFAULT NULL,
        created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_al_user_id (user_id),
        INDEX idx_al_action  (action),
        INDEX idx_al_created (created_at),
        CONSTRAINT fk_al_user FOREIGN KEY (user_id)
          REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log('✅ Database initialised successfully');
  } finally {
    conn.release();
  }
}

// ── Token cleanup ─────────────────────────────────────────────────────────────
async function cleanupExpiredTokens() {
  try {
    await db.execute({ sql: 'DELETE FROM token_blacklist WHERE expires_at < NOW()', args: [] });
    await db.execute({ sql: 'DELETE FROM refresh_tokens  WHERE expires_at < NOW() OR revoked = 1', args: [] });
  } catch (e) {
    console.error('Token cleanup failed:', e.message);
  }
}

// Keep legacy alias
async function init() { return initializeDatabase(); }

module.exports = { db, init, initializeDatabase, cleanupExpiredTokens };
