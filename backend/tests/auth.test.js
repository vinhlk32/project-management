process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const mockExecute = jest.fn().mockResolvedValue({ rows: [], lastInsertRowid: null });
jest.mock('../db', () => ({
  db: { execute: mockExecute },
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  cleanupExpiredTokens: jest.fn(),
}));
jest.mock('../audit', () => ({ logAudit: jest.fn() }));
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('$hashed'),
}));

const request = require('supertest');
const bcrypt = require('bcrypt');
const { signAccessToken } = require('../auth');
const app = require('../server');

beforeEach(() => {
  jest.clearAllMocks();
  mockExecute.mockResolvedValue({ rows: [], lastInsertRowid: null });
});

describe('POST /api/auth/login — input validation', () => {
  test('missing email → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'pass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('invalid email format → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'notanemail', password: 'pass123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email/i);
  });

  test('missing password → 400', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/password/i);
  });
});

describe('POST /api/auth/login — authentication', () => {
  test('user not found → 401', async () => {
    bcrypt.compare.mockResolvedValue(false);
    mockExecute.mockResolvedValueOnce({ rows: [], lastInsertRowid: null }); // user lookup

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'pass123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  test('wrong password → 401', async () => {
    bcrypt.compare.mockResolvedValue(false);
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1, name: 'Alice', email: 'alice@example.com', role: 'member',
        avatar_color: '#4a9eff', password_hash: '$2b$12$somehash',
        is_active: 1, failed_attempts: 0, locked_until: null,
      }],
    });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'alice@example.com', password: 'wrongpass' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid email or password/i);
  });

  test('correct credentials → 200 with user and tokens', async () => {
    bcrypt.compare.mockResolvedValue(true);
    const user = {
      id: 1, name: 'Admin', email: 'admin@example.com', role: 'admin',
      avatar_color: '#4a9eff', password_hash: '$2b$12$somehash',
      is_active: 1, failed_attempts: 0, locked_until: null,
    };
    mockExecute
      .mockResolvedValueOnce({ rows: [user] })   // user lookup
      .mockResolvedValueOnce({ rows: [], lastInsertRowid: null }) // reset failed_attempts
      .mockResolvedValueOnce({ rows: [], lastInsertRowid: 10 });  // store refresh token

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'Admin123!' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('accessToken');
    expect(res.body).toHaveProperty('csrfToken');
    expect(res.body.user.email).toBe('admin@example.com');
  });
});

describe('GET /api/auth/me', () => {
  test('no token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('valid token → 200 with user data', async () => {
    const token = signAccessToken({ id: 1, role: 'admin', name: 'Admin' });
    mockExecute
      .mockResolvedValueOnce({ rows: [] }) // isBlacklisted check
      .mockResolvedValueOnce({
        rows: [{
          id: 1, name: 'Admin', email: 'admin@example.com',
          role: 'admin', avatar_color: '#4a9eff', is_active: 1, created_at: '2024-01-01',
        }],
      });

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
    expect(res.body.email).toBe('admin@example.com');
  });
});
