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
  mockExecute.mockResolvedValue({ rows: [], lastInsertRowid: null });
});

describe('GET /api/projects/:id/tasks', () => {
  test('no auth → 401', async () => {
    const res = await request(app).get('/api/projects/1/tasks');
    expect(res.status).toBe(401);
  });

  test('with auth → 200 with array', async () => {
    const tasks = [{ id: 10, title: 'Write tests', status: 'todo', priority: 'high' }];
    mockExecute
      .mockResolvedValueOnce({ rows: [] })      // isBlacklisted
      .mockResolvedValueOnce({ rows: tasks });  // SELECT tasks

    const res = await request(app)
      .get('/api/projects/1/tasks')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].title).toBe('Write tests');
  });
});

describe('POST /api/tasks', () => {
  test('missing title → 400', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // isBlacklisted

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ project_id: 1, status: 'todo' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/i);
  });

  test('invalid project_id → 400', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // isBlacklisted

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ title: 'My Task', project_id: 'bad' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/project_id/i);
  });

  test('invalid status → 400', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] }); // isBlacklisted

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ title: 'My Task', project_id: 1, status: 'invalid-status' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/status/i);
  });

  test('valid task → 201 with task', async () => {
    const created = {
      id: 20, title: 'My Task', project_id: 1,
      status: 'todo', priority: 'medium', assignee_name: null, assignee_color: null,
    };
    mockExecute
      .mockResolvedValueOnce({ rows: [] })                       // isBlacklisted
      .mockResolvedValueOnce({ rows: [], lastInsertRowid: 20 })  // INSERT task
      .mockResolvedValueOnce({ rows: [created] });               // SELECT new task

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF)
      .send({ title: 'My Task', project_id: 1 });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('My Task');
    expect(res.body.id).toBe(20);
  });
});

describe('DELETE /api/tasks/:id', () => {
  test('valid delete → 204', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })  // isBlacklisted
      .mockResolvedValueOnce({ rows: [] }); // DELETE

    const res = await request(app)
      .delete('/api/tasks/10')
      .set('Authorization', authHeader)
      .set('X-CSRF-Token', CSRF);
    expect(res.status).toBe(204);
  });
});

describe('GET /api/tasks/:id/subtasks', () => {
  test('returns subtasks array', async () => {
    const subtasks = [{ id: 11, title: 'Sub 1', parent_id: 10 }];
    mockExecute
      .mockResolvedValueOnce({ rows: [] })         // isBlacklisted
      .mockResolvedValueOnce({ rows: subtasks });  // SELECT subtasks

    const res = await request(app)
      .get('/api/tasks/10/subtasks')
      .set('Authorization', authHeader);
    expect(res.status).toBe(200);
    expect(res.body[0].parent_id).toBe(10);
  });
});
