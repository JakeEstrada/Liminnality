# Dead code cleanup log

Tracked removals so we do not re-introduce duplicate or legacy paths.

## Removed (frontend)

| Item | Reason |
|------|--------|
| `pages/CalendarPage.tsx` (old) | Superseded by calendar rewrite; ~1,200 lines duplicate UI |
| `pages/CalendarPageNew.tsx` | Renamed → `CalendarPage.tsx` |
| `pages/CompletedAppointmentsPage.tsx` | Redundant with `CompletedTasksPage` (same data, weekly view) |
| `assets/react.svg` | Vite default asset, never referenced |
| `DashboardPage` `renderSummaryBlocks` / `renderInlineMarkdown` | Duplicated `utils/summaryMarkdown.tsx` (~80 lines) |
| **Documents page** + `components/documents/fileExplorer/*` | Unused file-browser UI (~2k+ lines) |
| **Backend** `/files/documents/*`, folder tree, text doc routes | Only served Documents page |
| **`syncTakeoffToDocuments`** (`jobController`) | Auto `.txt` sync into document folders |
| **`ensureCustomerDocumentLibrary`** (`fileController`) | Folder backfill on tree load |

## Redirects (bookmarks still work)

| Old route | New target |
|-----------|------------|
| `/completed-appointments` | `/completed-tasks` |
| `/dead-estimates` | `/archive` |
| `/documents` | `/dashboard` |

## Kept on purpose

| Item | Why |
|------|-----|
| `DeveloperTasksPage` | Internal dev tracker (sidebar footer link) |
| `CommissionLogsPage` | Finance sidebar entry |
| `backend/src/scripts/*` | One-off maintenance scripts, not loaded at runtime |
| Root `Csharp.md`, `Software.md` | Liminnality planning notes (not runtime code) |

## Next cleanup candidates

- Migrate pages from raw `axios` + `API_URL` to `utils/axios` `api` client
- Code-split `FinanceHubPage`, `CalendarPage`, `DashboardPage` (large bundles)
- Remove `// @ts-nocheck` incrementally on large pages
