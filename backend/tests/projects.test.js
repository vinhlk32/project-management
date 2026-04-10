process.env.JWT_SECRET = 'test-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const mockExecute = jest.fn().mockResolvedValue({ rows: [], lastInsertRowid: null });
jest.mock('../db', () => ({
  db: { execute: mockExecute },
  initializeDatabase: jest.fn().mockResolvedValue(undefined),
  cleanupExpiredTokens: jest.fn(),
}));
jest.mock('../audit', () => ({ logAudit: jest.fn() }));

const request = require('supertest');
const { signAccessToken } = require('../auth');
const app = require('../server');

let authHeader;
const CSRF = 'test-csrf-token';

beforeAll(() => {
  const token = signAccessToken({ id: 1, role: 'admin', name: 'Admin' });
  authHeader = `Bearer ${token}`;
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: isBlacklisted check returns empty (not blacklisted)
  mockExecute.mockResolvedValue({ rows: [], lastInsertRowid: null });
});

describe('GET /api/projects', () => {
  test('no auth → 401', async () => {
    const res = await request(app).get('/api/projects');
    expect(res.status).toBe(401);
  });

  test('with auth → 200 with array', async () => {
    const projects = [{ id: 1, name: 'Alpha', description: '', created_at: '2024-01-01' }];
    mockExecute
      .mockResolvedValueOnce({ rows: [] })       // isBlacklisted
      .mockResolvedValueOnce({ rows: projects }); // SELECT projects

    const res = await request(app)
      .get('/api/projects')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].name).toBe('Alpha');
  });
});

describe('POST /api/projects', () => {
  test('missing name → 400', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // isBlacklisted

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ description: 'no name here' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name/i);
  });

  test('name too long → 400', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // isBlacklisted

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ name: 'x'.repeat(201) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/too long/i);
  });

  test('valid name → 201 with project', async () => {
    const created = { id: 5, name: 'New Project', description: '', created_at: '2024-01-01' };
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                          // isBlacklisted
      .mockResolvedValueOnce({ rows: [], lastInsertRowid: 5 })      // INSERT
      .mockResolvedValueOnce({ rows: [created] });                  // SELECT new project

    const res = await request(app)
      .post('/api/projects')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ name: 'New Project' });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(5);
    expect(res.body.name).toBe('New Project');
  });
});

describe('PUT /api/projects/:id', () => {
  test('invalid id (non-integer) → 400', async () => {
    const res = await request(app)
      .put('/api/projects/abc')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ name: 'Updated' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid id/i);
  });

  test('valid update → 200', async () => {
    const updated = { id: 1, name: 'Updated', description: '', created_at: '2024-01-01' };
    mockExecute
      .mockResolvedValueOnce({ rows: [] })           // isBlacklisted
      .mockResolvedValueOnce({ rows: [], lastInsertRowid: null }) // UPDATE
      .mockResolvedValueOnce({ rows: [updated] });   // SELECT

    const res = await request(app)
      .put('/api/projects/1')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ name: 'Updated', description: '' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });
});

describe('DELETE /api/projects/:id', () => {
  test('valid delete → 204', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })  // isBlacklisted
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    const res = await request(app)
      .delete('/api/projects/1')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF);
    expect(res.status).toBe(204);
  });
});
