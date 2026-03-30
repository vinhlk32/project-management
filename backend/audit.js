async function logAudit(db, { userId = null, action, entityType = null, entityId = null, ip = null, userAgent = null, detail = null }) {
  try {
    await db.execute({
      sql: `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [userId, action, entityType, entityId, ip, userAgent, detail ? JSON.stringify(detail) : null]
    });
  } catch (e) {
    console.error('Audit log failed:', e.message);
  }
}

module.exports = { logAudit };
