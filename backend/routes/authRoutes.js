const express = require('express');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  blacklistToken,
} = require('../auth');
const requireAuth = require('../middleware/requireAuth');
const { logAudit } = require('../audit');

const IS_PROD = process.env.NODE_ENV === 'production';

function setCookies(res, accessToken, refreshToken, csrfToken) {
  const accessExpiry = new Date(Date.now() + 15 * 60 * 1000);
  const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  res.cookie('access_token', accessToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'Strict',
    expires: accessExpiry,
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'Strict',
    expires: refreshExpiry,
  });
  res.cookie('csrf_token', csrfToken, {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'Strict',
    expires: accessExpiry,
  });
}

function clearCookies(res) {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
  res.clearCookie('csrf_token');
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const db = req.db;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'] || null;

  const { email, password } = req.body;

  // Validate inputs
  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }

  try {
    const result = await db.execute({
      sql: 'SELECT id, name, email, role, avatar_color, password_hash, is_active, failed_attempts, locked_until FROM users WHERE email = ?',
      args: [email.trim().toLowerCase()],
    });

    const user = result.rows[0];

    // Always run bcrypt to prevent user-enumeration via timing differences.
    // Use a dummy hash when the user doesn't exist or has no password set yet.
    const DUMMY_HASH = '$2b$12$invalidhashfortimingXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX.u';
    const hashToCompare = user?.password_hash || DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!user) {
      await logAudit(db, { action: 'login_failed', ip, userAgent, detail: { reason: 'user_not_found' } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.is_active === 0) {
      await logAudit(db, { userId: user.id, action: 'login_failed', ip, userAgent, detail: { reason: 'account_deactivated' } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await logAudit(db, { userId: user.id, action: 'login_failed', ip, userAgent, detail: { reason: 'account_locked' } });
      return res.status(401).json({ error: 'Invalid email or password. Account temporarily locked.' });
    }

    if (!user.password_hash || !passwordMatch) {
      const newAttempts = (user.failed_attempts || 0) + 1;
      let lockUntil = null;
      if (newAttempts >= 5) {
        lockUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        await logAudit(db, { userId: user.id, action: 'account_locked', ip, userAgent, detail: { attempts: newAttempts } });
      }
      await db.execute({
        sql: 'UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?',
        args: [newAttempts, lockUntil, user.id],
      });
      const reason = !user.password_hash ? 'no_password_set' : 'wrong_password';
      await logAudit(db, { userId: user.id, action: 'login_failed', ip, userAgent, detail: { reason, attempts: newAttempts } });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Success — reset counters
    await db.execute({
      sql: 'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
      args: [user.id],
    });

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);
    const csrfToken = uuidv4();

    // Store hashed refresh token
    const refreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.execute({
      sql: 'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      args: [user.id, hashToken(refreshToken), refreshExpiry],
    });

    setCookies(res, accessToken, refreshToken, csrfToken);

    await logAudit(db, { userId: user.id, action: 'login_success', ip, userAgent });

    return res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      accessToken,
      csrfToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  const db = req.db;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'] || null;

  try {
    // Blacklist current access token
    const payload = req.user;
    if (payload?.jti && payload?.exp) {
      await blacklistToken(db, payload.jti, new Date(payload.exp * 1000).toISOString());
    }

    // Revoke refresh token if present
    const refreshToken = req.cookies?.refresh_token;
    if (refreshToken) {
      try {
        const tokenHash = hashToken(refreshToken);
        await db.execute({
          sql: 'UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?',
          args: [tokenHash],
        });
      } catch (_) {}
    }

    clearCookies(res);
    await logAudit(db, { userId: payload?.sub, action: 'logout', ip, userAgent });

    return res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  const db = req.db;

  const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token provided' });
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    const result = await db.execute({
      sql: 'SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked = 0',
      args: [tokenHash],
    });

    const stored = result.rows[0];
    if (!stored) {
      return res.status(401).json({ error: 'Invalid or revoked refresh token' });
    }

    if (new Date(stored.expires_at) < new Date()) {
      return res.status(401).json({ error: 'Refresh token expired' });
    }

    // Get fresh user data
    const userResult = await db.execute({
      sql: 'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
      args: [payload.sub],
    });
    const user = userResult.rows[0];
    if (!user || user.is_active === 0) {
      return res.status(401).json({ error: 'Account not available' });
    }

    // Rotate refresh token
    const newRefreshToken = signRefreshToken(user.id);
    const newRefreshExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await db.execute({
      sql: 'DELETE FROM refresh_tokens WHERE token_hash = ?',
      args: [tokenHash],
    });
    await db.execute({
      sql: 'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
      args: [user.id, hashToken(newRefreshToken), newRefreshExpiry],
    });

    const newAccessToken = signAccessToken(user);
    const newCsrfToken = uuidv4();

    setCookies(res, newAccessToken, newRefreshToken, newCsrfToken);

    return res.json({ accessToken: newAccessToken, csrfToken: newCsrfToken });
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  const db = req.db;
  try {
    const result = await db.execute({
      sql: 'SELECT id, name, email, role, avatar_color, is_active, created_at FROM users WHERE id = ?',
      args: [req.user.sub],
    });
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json(user);
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/set-password
router.post('/set-password', requireAuth, async (req, res) => {
  const db = req.db;
  const ip = req.ip || req.connection?.remoteAddress;
  const userAgent = req.headers['user-agent'] || null;

  const { userId, newPassword } = req.body;

  const targetId = userId ? Number(userId) : req.user.sub;

  // Only admin can set another user's password
  if (targetId !== req.user.sub && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  if (!newPassword || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'New password is required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain at least one number' });
  }
  if (!/[a-zA-Z]/.test(newPassword)) {
    return res.status(400).json({ error: 'Password must contain at least one letter' });
  }

  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await db.execute({
      sql: 'UPDATE users SET password_hash = ? WHERE id = ?',
      args: [passwordHash, targetId],
    });
    await logAudit(db, { userId: req.user.sub, action: 'password_changed', entityType: 'user', entityId: targetId, ip, userAgent });
    return res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('Set password error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
