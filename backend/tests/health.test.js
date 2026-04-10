process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

jest.mock('../db', () => ({
  db: { execute: jest.fn().mockResolvedValue({ rows: [], lastInsertRowid: null }) },
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  cleanupExpiredTokens: jest.fn(),
}));
jest.mock('../audit', () => ({ logAudit: jest.fn() }));

const request = require('supertest');
const app = require('../server');

describe('GET /api/health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body).toHaveProperty('timestamp');
  });
});
