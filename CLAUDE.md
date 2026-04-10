# CLAUDE.md — Project Management App

## Project Overview

Full-stack project management app: React (Vite) frontend + Node/Express backend + MySQL + Docker.

- **Repo:** github.com/vinhlk32/project-management
- **Branch strategy:** `dev` = staging, `main` = production (PR required to merge to main)
- **Local dev:** `docker compose up -d` → `cd frontend && npm run dev`
- **Backend:** http://localhost:3001 | **Frontend:** http://localhost:3000

---

## Architecture

```
frontend/          React + Vite (SPA)
backend/
  server.js        Express app — exports `app`, boots only when run directly
  db.js            MySQL pool with { rows, lastInsertRowid } adapter
  auth.js          JWT sign/verify/hash utilities
  audit.js         logAudit() helper
  middleware/      requireAuth.js, requireRole.js
  routes/          authRoutes.js, auditRoutes.js
  tests/           Jest + Supertest (run with: cd backend && npm test)
```

**AWS infrastructure:**
- CloudFront #2 (prod frontend) → S3 `pmapp-frontend-prod-898119315288`
- CloudFront #3 (prod backend) → EC2 :80 → Docker container :3001
- CI/CD: push to `dev` → staging deploy; push to `main` → blue/green prod deploy

---

## Working Style & Preferences

- **Clarify requirements fully before writing any code.** Ask all questions upfront (UI behavior, data flow, edge cases, validation rules, interactions). One-shot delivery is the goal — avoid mid-implementation rework.
- Keep responses concise. Lead with the answer, not the reasoning.
- Don't add features, refactors, or "improvements" beyond what was asked.
- Don't add comments/docstrings to code that wasn't changed.

---

## Code Conventions

- Backend uses CommonJS (`require`/`module.exports`)
- DB calls always use the `{ sql, args }` object form, never raw strings with user input
- All mutations go through `logAudit()` after the DB write
- Validation: check presence, type, length, enum membership — return `400` with `{ error: '...' }` before touching the DB
- `requireAuth` must be applied to all non-auth routes; admin-only routes also use `requireRole('admin')`

---

## Testing

```bash
cd backend && npm test
```

- Tests live in `backend/tests/*.test.js`
- Use Jest + Supertest with mocked DB (`jest.mock('../db', ...)`) — no real MySQL needed
- Mock `../audit` in every test file
- Set `process.env.JWT_SECRET` and `process.env.JWT_REFRESH_SECRET` at top of each test file
- Run on demand only — no hook or watch mode

---

## Git Workflow

- Feature work → commit to `dev` → CI deploys to staging automatically
- Production release → PR from `dev` into `main` → requires review → auto blue/green deploy
- Main branch for PRs: `dev` (not `main`)
- Commit message style: short imperative summary, no trailing period

---

## Environment

- Platform: macOS (Apple Silicon), VS Code
- Shell: zsh
- Docker required for local backend/MySQL
- AWS CLI configured for account `898119315288`, region `us-east-1`
