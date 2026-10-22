# Shared components

Reusable UI outside `pages/`. Pages compose these; business rules often live in both page and component.

## Layout

| Component | Path | Role |
|-----------|------|------|
| `MainLayout` | `components/layout/MainLayout.tsx` | Sidebar + TopBar + outlet for pages |
| `Sidebar` | `components/layout/Sidebar.tsx` | Nav groups: Workspace, Finance, Operations, Archive |
| `ViewModeFrame` | `components/layout/ViewModeFrame.tsx` | Full-screen kiosk wrapper for TV views |
| `SiteAssistantChat` | `components/assistant/SiteAssistantChat.tsx` | Floating “Paarth help” chat (OpenAI tools) |

## Pipeline & jobs

| Component | Path | Role |
|-----------|------|------|
| `PipelineBoard` | `components/pipeline/PipelineBoard.tsx` | Drag-and-drop kanban columns |
| `JobCard` | `components/pipeline/JobCard.tsx` | Single card in a column |
| `JobDetailModal` | `components/jobs/JobDetailModal.tsx` | Full job view: notes, files, tasks, AI summary |
| `AddJobModal` | `components/jobs/AddJobModal.tsx` | Create job form |
| `JobContextMenu` | `components/jobs/JobContextMenu.tsx` | Right-click actions on cards |

**JobDetailModal** — important sections:
- `fetchJobDetails` — loads job, tasks, estimates
- Overview tab — notes, activity, **AI summary** button → `POST /activities/job/:id/summary`
- Files tab — upload via `POST /files/upload`
- Messages tab — SMS thread with the customer (`GET /twilio/messages?jobId=`)

## Customers

| Component | Path | Role |
|-----------|------|------|
| Customer list/detail | `pages/CustomersPage.tsx` | Main customer UI (not split into many components) |

## Calendar (in page file)

| `CalendarPage.tsx` embeds `EventModal`, `BenchJobCard`, `ScheduledJobCard`, `CalendarDay` — large single file by design.

## Tasks & todos

| Component | Path | Role |
|-----------|------|------|
| `TodoList` | `components/todos/TodoList.tsx` | Task list widget |
| `ProjectModal` | `components/todos/ProjectModal.tsx` | Project/task detail |
| `AddTodoModal` | `components/todos/AddTodoModal.tsx` | Create task |

## Documents

Job and customer file uploads live on **job detail modal** and related flows (`POST /files/upload`, `GET /files/job/:id`). The standalone Documents browser page was removed.

## Finance

| Component | Path | Role |
|-----------|------|------|
| `RegisterLedgerSection` | `components/finance/RegisterLedgerSection.tsx` | Plaid register / ledger |
| `PlaidBankLinkSection` | `components/finance/PlaidBankLinkSection.tsx` | Link bank account |

## Common

| Component | Path | Role |
|-----------|------|------|
| `BrandLogo` | `components/common/BrandLogo.tsx` | Tenant-aware logo |
| `ProtectedRoute` | `components/ProtectedRoute.tsx` | Auth gate |
| `EmployeeSmsRecipientField` | `components/common/EmployeeSmsRecipientField.tsx` | Pick employee for SMS |

## Hooks & utils (cross-cutting)

| File | Role |
|------|------|
| `hooks/useSocketSubscription.ts` | Subscribe to Socket.IO events per tenant room |
| `utils/axios.ts` | Authenticated API client (preferred) |
| `utils/authSession.ts` | Login redirect on 401 |
| `services/socket.ts` | Socket.IO connection singleton |
