# Best Practices — Project Management App

Grounded in this codebase's actual stack: Node/Express, React/Vite, MySQL, Docker, AWS.  
Each section calls out what's already done well and what to apply going forward.

---

## 1. Security

### Already in place
- Helmet for security headers
- Rate limiting (200/15min general, 10/15min login)
- CSRF via custom header (`X-CSRF-Token`) — correct for cross-origin SPA+API
- JWT with short-lived access tokens (15m) + rotating refresh tokens (7d)
- bcrypt with constant-time compare (dummy hash prevents user enumeration)
- Account lockout after 5 failed attempts
- Token blacklist on logout
- Input length limits on all fields

### Apply going forward

**Never trust client input at the DB boundary.**
```js
// Bad — string interpolation
db.execute(`SELECT * FROM tasks WHERE id = ${req.params.id}`)

// Good — always parameterised (already used everywhere, keep it this way)
db.execute({ sql: 'SELECT * FROM tasks WHERE id = ?', args: [req.params.id] })
```

**Validate before DB write, not after.**  
All validation (type, length, enum) must happen at the top of the route handler before any `await db.execute()`.

**Never log sensitive values.**
```js
// Bad
console.log('Login attempt:', email, password)

// Good
console.log('Login attempt for:', email)
```

**Principle of least privilege.**  
Admin-only routes must use `requireRole('admin')`. Regular users must never receive fields like `password_hash`, `failed_attempts`, `locked_until` — the selective SELECT in `GET /api/users` is the right pattern.

**Environment variables — never hardcode secrets.**
```
JWT_SECRET, JWT_REFRESH_SECRET, DB_PASSWORD — .env only, never committed
```
`.env` must remain in `.gitignore`. Use AWS SSM Parameter Store for production secrets.

---

## 2. Code Structure / Architecture

### Already in place
- Route handlers in `server.js`, shared utilities in `auth.js`, `audit.js`, `propagate.js`
- Middleware in `middleware/`
- `db.js` adapter normalises mysql2 output across the codebase

### Apply going forward

**Keep route handlers thin.** They should: validate input → call a service/helper → respond.  
Business logic (like `propagateDates`, `wouldCreateCycle`) belongs outside the route handler — already done for propagation, keep this pattern.

**One responsibility per file.**
```
routes/       HTTP: parse, validate, respond
services/     Business logic (future: extract task scheduling, conflict detection here)
db.js         DB connection and query adapter only
audit.js      Audit logging only
```

**Avoid duplicating logic across routes.**  
`addDays()` exists in both `propagate.js` and inline in `server.js` (conflicts section) — they should share one source. Extract shared utilities to a `utils/` module.

**Constants in one place.**
```js
// Already done — keep this centralised in server.js
const VALID_STATUSES   = ['todo', 'in-progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const VALID_DEP_TYPES  = ['FS', 'SF', 'SS', 'FF'];
```

---

## 3. Testing Strategy

### Already in place
- Jest + Supertest with mocked DB (`jest.mock('../db', ...)`)
- Tests cover: health, auth (login validation + success + /me), projects CRUD, tasks CRUD
- No real MySQL needed — fast, isolated tests (~0.6s for 25 tests)

### Apply going forward

**Test pyramid — keep the balance:**
```
         [ E2E / integration ]    ← few, slow, real DB
        [   API / route tests  ]  ← current sweet spot (Supertest)
      [     Unit tests          ] ← pure functions (propagateDates, addDays, wouldCreateCycle)
```

**Unit test pure business logic separately.**
```js
// propagate.js, addDays(), wouldCreateCycle() are deterministic — unit test them
// without HTTP overhead
```

**One test file per domain.** Current structure is correct:
```
tests/health.test.js
tests/auth.test.js
tests/projects.test.js
tests/tasks.test.js
```
Add `tests/propagate.test.js` and `tests/dependencies.test.js` as logic grows.

**Test the sad path as much as the happy path.**  
For every endpoint: missing required field, invalid ID, wrong role, expired token.

**Never test implementation details — test behaviour.**
```js
// Bad: assert that db.execute was called N times
// Good: assert the HTTP status and response body shape
expect(res.status).toBe(201);
expect(res.body).toHaveProperty('id');
```

**Run tests before every PR merge** — wire into CI (already done in `.github/workflows`).

---

## 4. Git / CI-CD Workflow

### Already in place
- `dev` → staging deploy (S3 + CloudFront invalidation)
- `main` → blue/green production deploy to EC2
- PR required to merge to `main`

### Apply going forward

**Branch naming convention:**
```
feature/wbs-grid-enhancements
fix/timezone-date-calculation
chore/upgrade-dependencies
```

**Commit message format — imperative, present tense:**
```
Add WBS grid subtask rollup
Fix timezone bug in date calculations
Remove unused propagate helper
```
Not: "Added...", "Fixed...", "I changed..."

**PRs should be small and focused.**  
One feature or fix per PR. Large PRs are hard to review and risky to merge.

**Never force-push to `main` or `dev`.**  
If you need to undo something, use `git revert` — it creates a new commit and preserves history.

**Keep `.env` out of git forever.**  
If it ever gets committed by accident: rotate all secrets immediately, then remove from history.

**Tag releases on `main`:**
```bash
git tag -a v1.2.0 -m "Release v1.2.0"
git push origin v1.2.0
```

---

## 5. Performance

### Already in place
- MySQL connection pooling (`connectionLimit: 10`)
- DB indexes on `project_id`, `assignee_id`, `status`, `due_date`, `email`
- `dateStrings: true` on the pool (avoids JS Date conversion overhead)
- `Promise.all()` for parallel analytics queries

### Apply going forward

**Use `SELECT` only the columns you need.** Avoid `SELECT *` in hot paths.
```js
// Bad (in high-traffic routes)
SELECT * FROM tasks WHERE project_id = ?

// Good
SELECT id, title, status, priority, due_date FROM tasks WHERE project_id = ?
```
Note: `SELECT *` is acceptable in low-traffic admin routes or when all columns are needed.

**Avoid N+1 queries.** Use JOINs instead of looping DB calls.
```js
// Bad — one query per task
for (const task of tasks) {
  const user = await db.execute({ sql: 'SELECT name FROM users WHERE id = ?', args: [task.assignee_id] });
}

// Good — one query with JOIN (already used in task routes)
SELECT t.*, u.name AS assignee_name FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
```

**Paginate large result sets.**  
`GET /api/audit-logs` and task lists can grow unbounded. Add `LIMIT` + `OFFSET` for any endpoint that can return 100+ rows.
```js
const limit  = Math.min(Number(req.query.limit)  || 50, 200);
const offset = Math.max(Number(req.query.offset) || 0, 0);
```

**Cache CloudFront aggressively for static assets.** Already configured in CI — keep `Cache-Control: max-age=31536000` on hashed assets, `no-cache` on `index.html`.

---

## 6. Error Handling & Logging

### Already in place
- `handleError(res, err)` centralises 500 responses and `console.error`
- `logAudit()` records every mutation with userId, IP, user-agent
- `try/catch` wraps every route handler

### Apply going forward

**Distinguish operational errors from programmer errors.**
```js
// Operational (expected, handle gracefully): user not found, duplicate entry, validation fail
// Programmer (unexpected, log + return 500): null reference, DB schema mismatch
```

**Never expose internal error details to the client.**
```js
// Bad
res.status(500).json({ error: err.message }) // leaks stack info

// Good (already done)
res.status(500).json({ error: 'Internal server error' })
```

**Log structured data, not just strings.**
```js
// Bad
console.error('Failed to create task');

// Good
console.error({ event: 'task_create_failed', project_id, title, err: err.message });
```

**Add a process-level uncaught exception handler in `server.js`:**
```js
process.on('unhandledRejection', (reason) => {
  console.error({ event: 'unhandledRejection', reason });
});
process.on('uncaughtException', (err) => {
  console.error({ event: 'uncaughtException', err });
  process.exit(1); // always exit — state is now unknown
});
```

**Audit log failures must never crash the request.**  
Already done (`try/catch` in `logAudit`) — keep it this way.

---

## 7. Frontend — React Patterns

### Already in place
- `AuthContext` with `authFetch` handles token refresh transparently
- `useCallback` on all context functions (prevents child re-renders)
- `csrfTokenRef` (ref, not state) for CSRF token — correct, avoids re-renders
- Automatic token refresh on 401 via retry in `authFetch`

### Apply going forward

**Error boundaries — catch unexpected component crashes.**
```jsx
// Create ErrorBoundary.jsx and wrap <App> in main.jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  render() {
    if (this.state.hasError) return <div>Something went wrong. Please refresh.</div>;
    return this.props.children;
  }
}
```

**Show errors to the user, not just `console.error`.**  
`App.jsx` currently silently fails API calls. Add toast notifications or inline error states:
```js
// Bad
if (!res.ok) { console.error('Failed to create project'); return; }

// Good
if (!res.ok) {
  const err = await res.json();
  setError(err.error || 'Failed to create project');
  return;
}
```

**Extract API calls into a service layer** — keep components focused on rendering:
```js
// api/projects.js
export const createProject = (authFetch, name) =>
  authFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
```

**Loading states for all async operations.**
```jsx
const [loading, setLoading] = useState(false);
setLoading(true);
try { await createProject(...); } finally { setLoading(false); }
// Disable submit button while loading, show spinner
```

**Avoid prop drilling beyond 2 levels.**  
`App.jsx` passes `users` and callbacks through multiple levels. As the app grows, move shared state to context or a lightweight state manager.

**Key prop on lists must be stable and unique:**
```jsx
// Bad
{tasks.map((t, i) => <TaskCard key={i} task={t} />)}

// Good
{tasks.map(t => <TaskCard key={t.id} task={t} />)}
```

---

## 8. Docker & Deployment

### Already in place
- Multi-container `docker-compose.yml` for local dev
- Separate `docker-compose.prod.yml` for production
- Blue/green deployment in CI/CD pipeline
- Health check endpoint (`/api/health`) used by ALB + Docker

### Apply going forward

**Pin image versions — never use `latest` in production.**
```dockerfile
# Bad
FROM node:latest

# Good
FROM node:20.11-alpine
```

**Non-root user in Dockerfile:**
```dockerfile
RUN addgroup -S app && adduser -S app -G app
USER app
```

**Keep images small — use multi-stage builds for the frontend:**
```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
```

**Secrets via environment only — never baked into the image.**  
Production `.env` lives on the EC2 host, injected at container start. Never `COPY .env`.

**Always set resource limits on containers:**
```yaml
deploy:
  resources:
    limits:
      memory: 512m
      cpus: '0.5'
```

**Graceful shutdown — already handled by Node's `listen` callback**, but also add:
```js
process.on('SIGTERM', () => {
  server.close(() => { pool.end(); process.exit(0); });
});
```

---

## Quick Reference Checklist

Before any PR:
- [ ] Input validated before first DB call
- [ ] No `SELECT *` in high-traffic routes (unless all columns needed)
- [ ] New routes have auth + CSRF protection
- [ ] Admin-only routes use `requireRole('admin')`
- [ ] Errors return `{ error: '...' }` — no internal details leaked
- [ ] `logAudit()` called after every mutation
- [ ] Tests added or updated for new behaviour
- [ ] No secrets or `.env` files committed
- [ ] UI shows errors to user (not just `console.error`)
