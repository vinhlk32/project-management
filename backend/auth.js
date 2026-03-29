const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name, jti: uuidv4() },
    process.env.JWT_SECRET,
    { expiresIn: '15m' }
  );
}

function signRefreshToken(userId) {
  return jwt.sign(
    { sub: userId, jti: uuidv4() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function isBlacklisted(db, jti) {
  const result = await db.execute({
    sql: 'SELECT jti FROM token_blacklist WHERE jti = ?',
    args: [jti],
  });
  return result.rows.length > 0;
}

async function blacklistToken(db, jti, expiresAt) {
  await db.execute({
    sql: 'INSERT OR IGNORE INTO token_blacklist (jti, expires_at) VALUES (?, ?)',
    args: [jti, expiresAt],
  });
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  isBlacklisted,
  blacklistToken,
};
