const { verifyAccessToken, isBlacklisted } = require('../auth');

module.exports = async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.access_token ||
      (req.headers.authorization?.startsWith('Bearer ') && req.headers.authorization.slice(7));
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const payload = verifyAccessToken(token);
    if (await isBlacklisted(req.db, payload.jti)) return res.status(401).json({ error: 'Token revoked' });
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
