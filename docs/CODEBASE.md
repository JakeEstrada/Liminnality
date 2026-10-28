# Codebase guide

How Liminnality is organized and how data flows through the app. The hosted ERP in this repository is React, Node.js, Express, and MongoDB.

## High-level flow

```
Browser (React)
    │  Axios (+ JWT, x-tenant-id, x-socket-id)
    ▼
Express API (/jobs, /customers, … and /api/* aliases)
    │  requireAuth → tenant context middleware
    ▼
Controllers (business logic)
    ▼
Mongoose models (MongoDB, tenant-scoped)
```

Real-time updates use **Socket.IO**: the backend publishes `project.updated`, `task.created`, etc.; pages subscribe via `useSocketSubscription`.

## Frontend conventions

### API calls

- Prefer **`import api from '../utils/axios'`** — attaches token, tenant header, socket id, and handles 401 redirect.
- Many older pages still use raw `axios` + `API_URL`; behavior is the same if the user is logged in.

### Routing

All authenticated app routes live in `frontend/src/App.tsx` inside `MainLayout` (sidebar + top bar). Public auth routes and kiosk “view” routes are siblings outside the layout.

### Auth & roles

`frontend/src/context/AuthContext.tsx` holds the logged-in user and helpers:

| Helper | Meaning |
|--------|---------|
| `isAdmin()` | Admin or super_admin |
| `canModifyPipeline()` | Can drag jobs / edit pipeline |
| `canViewCalendar()` / `canModifyCalendar()` | Calendar read/write |
| `tenantIdForBranding` | Logo and tenant display |

`ProtectedRoute` wraps routes that require login; `/users` also requires admin.

### Multi-tenant

Every API request (except auth/branding) sends `x-tenant-id`. The backend `tenantScopePlugin` auto-filters queries by `tenantId`.

### Page file headers

Each file in `frontend/src/pages/` starts with a block comment: route, purpose, main APIs. Full detail is in [PAGES.md](./PAGES.md).

### Types

Several large pages use `// @ts-nocheck` while types are added incrementally. New code should be typed where practical.

## Backend conventions

### Entry point

`backend/src/server.js` — CORS, JSON body, tenant middleware, route mounting, MongoDB connect, Socket.IO, background jobs (SMS scheduler, Plaid refresh).

### Route → controller pattern

```javascript
// routes/jobs.js
router.post('/:id/move-stage', moveJobStage);

// controllers/jobController.js
async function moveJobStage(req, res) { … }
```

See [BACKEND.md](./BACKEND.md) for the full route map.

### Activity log

Most user-visible changes create an `Activity` document (stage moves, notes, file uploads). Dashboard and job modals read from `/activities`.

### Stage names

Pipeline stages are still **string enums** in MongoDB (`APPOINTMENT_SCHEDULED`, `SCHEDULED`, …). Labels come from `backend/src/utils/stageConfig.js`.

## Environment variables (common)

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_API_URL` | frontend | Backend base URL |
| `MONGODB_URI` | backend | Database |
| `JWT_SECRET` | backend | Auth tokens |
| `OPENAI_API_KEY` | backend | AI summaries + in-app assistant |
| `AWS_*` | backend | S3 file storage (production) |
| `CORS_ORIGINS` | backend | Allowed frontend origins |
