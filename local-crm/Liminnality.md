# Liminnality Lite — Product & Build Specification

**Status:** Planning document for a **new, separate project** (new directory / repo).  
**Reference only:** The existing **Paarth** codebase (`Paarth/backend`, `Paarth/frontend`) — do **not** modify Paarth to build this.  
**Database source of truth:** [`schema.sql`](./schema.sql) (SQLite).

---

## 1. What Liminnality Lite is

A **free, downloadable desktop CRM** for small shops (woodworking, trades, install crews). It is a **lite local version** of Paarth:

- Runs on the user’s machine (no cloud host required for core use)
- **SQLite** database + **local file storage** for attachments
- **Single organization** (no multi-tenant)
- **Multiple users** on one install (login, roles)
- Customizable **Kanban pipeline**, **calendar** (bench + scheduled + install grid), **customers**, **jobs**, **tasks**, **appointments**, **activity log**

### Explicitly out of scope (vs Paarth)

| Paarth feature | Liminnality Lite |
|----------------|------------------|
| Multi-tenant / organizations | No — one company per database |
| MongoDB / cloud API | No — SQLite embedded |
| AWS S3 | No — local `files.local_path` |
| Finance Hub (estimates, invoices, Plaid, contracts, bills) | No |
| Twilio SMS / RFID / AI assistant | No |
| Socket.IO real-time | No (optional later; desktop can refresh on save) |
| EmailJS / hosted auth | Local login only (v1) |

### Optional later (schema already has hooks)

- **Google Calendar** sync on `appointments` (`google_event_id`, `sync_status`, etc.)
- Export / backup (zip DB + upload folder)

---

## 2. Tech stack

| Layer | Choice |
|-------|--------|
| Runtime | **.NET 8** |
| UI | **Avalonia UI** (cross-platform desktop) |
| Pattern | **MVVM** + **CommunityToolkit.Mvvm** |
| App logic | **MediatR** (commands/queries) |
| DI | **Microsoft.Extensions.DependencyInjection** |
| Data | **EF Core** + **SQLite** |
| Logging | **Serilog** (file + debug sink) |

### Why this stack fits

- **Desktop-first:** Avalonia + SQLite = single `.db` file users can back up
- **MediatR:** Keeps ViewModels thin; each screen action = `IRequest` handler
- **EF Core:** Maps `schema.sql` to entities; migrations for upgrades
- **MVVM Toolkit:** `[ObservableProperty]`, `[RelayCommand]` for fast UI work

---

## 3. Recommended solution layout (new repo)

Create a **sibling folder** to Paarth, e.g. `Liminnality/` or `LiminnalityLite/`:

```text
Liminnality/
├── Liminnality.sln
├── docs/
│   └── Liminnality.md          ← copy of this file
├── database/
│   └── schema.sql              ← copy of schema.sql
├── src/
│   ├── Liminnality.App/        # Avalonia host, Views, ViewModels, DI bootstrap
│   ├── Liminnality.Application/# MediatR handlers, DTOs, validators, interfaces
│   ├── Liminnality.Domain/     # Entities, enums, domain rules (bench logic)
│   └── Liminnality.Infrastructure/
│       ├── Persistence/        # DbContext, EF configs, migrations, seed
│       ├── Files/              # Local file store under user data dir
│       └── Security/           # Password hashing (BCrypt or ASP.NET Identity hasher)
└── tests/
    └── Liminnality.Application.Tests/
```

### Dependency direction

```text
App → Application → Domain
App → Infrastructure → Application + Domain
```

**Rule:** Domain has no references to Avalonia, EF, or MediatR.

---

## 4. Data model (from `schema.sql`)

### 4.1 Configuration & users

| Table | Purpose |
|-------|---------|
| `app_settings` | Singleton row: company name, timezone, `default_board_id` |
| `users` | Login accounts, roles, `password_hash` |

**Roles:** `admin`, `manager`, `sales`, `installer`, `read_only`, `employee`

### 4.2 Kanban (customizable pipeline)

| Table | Purpose |
|-------|---------|
| `kanban_boards` | Multiple pipelines; optional link to `calendars`; `on_schedule_stage_id` for auto-move when scheduled |
| `kanban_sections` | Horizontal groupings within a board (e.g. “Sales”, “Production”) |
| `pipeline_stages` | Columns/cards live here; **behavior flags** per stage |
| `job_field_definitions` | Per-board: which fields show on cards (`show_on_card`, `required`, `field_type`) |

**Stage flags (replace Paarth hardcoded stage names):**

| Column | Meaning |
|--------|---------|
| `moves_to_bench` | Job in this stage **with no schedule entries** appears on **calendar bench** |
| `is_scheduled_stage` | Job counts as **scheduled** in sidebar even without dates (optional) |
| `is_closed` | Terminal stage — hide from active bench/sidebar |

**Board-level scheduling:**

| Column | Meaning |
|--------|---------|
| `kanban_boards.on_schedule_stage_id` | When first `job_schedule_entries` row is created, move job to this stage (optional) |

### 4.3 Customers & jobs

| Table | Purpose |
|-------|---------|
| `customers` | Contractor/customer card |
| `customer_phones`, `customer_emails`, `customer_addresses` | Unlimited contact rows (repeat customer, new numbers over time) |
| `jobs` | `customer_id`, `board_id`, `stage_id`, title, optional amount, job site address, `color`, `custom_fields` JSON |
| `job_notes` | Timeline notes on job |
| `tags`, `job_tags` | Optional labels on jobs |

**Repeat customer pattern:** One `customers` row → many `jobs`. New phone → insert `customer_phones` or update `primary_phone`. Job-only site info → `jobs.job_site_*` columns.

### 4.4 Calendar & install schedule

| Table | Purpose |
|-------|---------|
| `calendars` | Parallel calendars (Sales, Install crew A, …) |
| `installer_lanes` | Resource rows per calendar (Installer 1–4, Other) |
| `job_schedule_entries` | **Source of truth for install grid** — job, lane, `start_at`, `end_at` |

**Bench vs scheduled (app logic, not hardcoded stages):**

```csharp
// Pseudocode — implement in Domain or Application
bool HasSchedule(job) => job.ScheduleEntries.Any();

bool IsOnBench(job, stage) =>
    stage.MovesToBench && !HasSchedule(job) && !stage.IsClosed;

bool IsInScheduledSidebar(job, stage) =>
    !stage.IsClosed && (HasSchedule(job) || stage.IsScheduledStage);
```

**Weekend exclusion:** Not in SQL — port logic from Paarth `EventModal` in `CalendarPageNew.tsx` when expanding date ranges before saving entries.

### 4.5 Tasks & appointments (optional job link)

| Table | Purpose |
|-------|---------|
| `tasks` | `job_id` and `customer_id` **nullable** |
| `appointments` | Same; plus walk-in fields; optional `calendar_id`; Google sync columns |

**UI rule:** If `job_id` is set, show linked job chip (title / job number) on task and appointment lists.

### 4.6 Activity & files

| Table | Purpose |
|-------|---------|
| `activities` | Audit timeline (`activity_type`, `metadata` JSON) |
| `files` | Metadata only; binary on disk at `local_path` |

**Suggested local paths:**

```text
{UserData}/Liminnality/
├── liminnality.db
├── logs/
└── uploads/
    ├── jobs/{jobId}/
    ├── customers/{customerId}/
    └── tasks/{taskId}/
```

---

## 5. Paarth reference map (what to read, not copy)

Use Paarth as **UX and behavior reference**. Reimplement in C#/Avalonia; do not port Node/React directly.

| Liminnality feature | Paarth reference |
|---------------------|------------------|
| Kanban board, drag stage, customize columns | `frontend/src/components/pipeline/PipelineBoard.tsx`, `frontend/src/pages/PipelinePage.tsx` |
| Job card content | `frontend/src/components/pipeline/JobCard.tsx` |
| Job detail (notes, customer, schedule) | `frontend/src/components/jobs/JobDetailModal.tsx` |
| Calendar bench + scheduled + install grid | `frontend/src/pages/CalendarPageNew.tsx` (especially `EventModal`, `splitCalendarJobs`, `BenchJobCard`) |
| Customers, multi-phone/address | `frontend/src/pages/CustomersPage.tsx`, `backend/src/models/Customer.js` |
| Tasks | `frontend/src/pages/TasksPage.tsx`, `backend/src/models/Task.js` |
| Appointments | `backend/src/models/Appointment.js`, appointment flows in calendar |
| Activity timeline | `backend/src/models/Activity.js`, job/customer activity endpoints |
| Job schedule shape | `backend/src/models/Job.js` → `schedule.entries[]` maps to `job_schedule_entries` |
| Stage labels (old hardcoded — **avoid in Lite**) | `backend/src/utils/stageConfig.js` — replace with DB-driven `pipeline_stages` |

### Paarth patterns to **not** repeat

- Hardcoded `readinessStages` arrays for bench (`CalendarPageNew.tsx`, `JobCard.tsx`)
- Multi-tenant middleware and `x-tenant-id`
- Finance Hub, Twilio, Plaid routes/controllers

---

## 6. Application architecture

### 6.1 MVVM (Avalonia)

| Piece | Responsibility |
|-------|----------------|
| **View** (AXAML) | Layout, bindings, minimal code-behind |
| **ViewModel** | State, commands, calls MediatR |
| **Model / DTO** | What the UI displays (from Application layer) |

Example flow:

```text
PipelineView → PipelineViewModel → MoveJobStageCommand → MoveJobStageHandler → DbContext
```

### 6.2 MediatR conventions

| Type | Naming | Example |
|------|--------|---------|
| Query | `GetXQuery` → `GetXHandler` | `GetCalendarBenchJobsQuery` |
| Command | `CreateXCommand` | `SaveJobScheduleCommand` |
| Notification | `JobStageChangedNotification` | Log activity, refresh calendar VM |

Keep **one handler per use case**; avoid fat ViewModels.

### 6.3 EF Core

- **`LiminnalityDbContext`** — DbSets for all tables in `schema.sql`
- **Fluent API** in `IEntityTypeConfiguration<T>` per entity
- **Migrations** for schema changes after v1
- **Seed** on first run: default board, sections, stages, field definitions, one calendar, installer lanes, admin user prompt

**Schema bootstrap options:**

1. **Recommended:** EF migrations generated from entities (long-term)
2. **Alternative:** Run `schema.sql` once on empty DB, then EF maps existing tables

**Note:** `schema.sql` creates `app_settings` before `kanban_boards` but references it via FK. For a fresh SQL script run, either reorder tables or add FKs with `ALTER TABLE` after seed. EF migrations avoid this ordering issue.

### 6.4 Serilog

```csharp
// Log to {UserData}/Liminnality/logs/liminnality-.log
// Minimum: Information in app, Warning for Microsoft.*
```

Log MediatR failures, DB errors, file IO, Google sync (if added).

### 6.5 Dependency injection (App startup)

Register:

- `DbContext` (SQLite path from config)
- `IMediator`
- All handlers (assembly scan)
- `IFileStorage`, `ICurrentUser`, `IDateTimeProvider`
- ViewModels (transient) and navigation service

---

## 7. Screens (v1)

| Screen | Primary tables | Paarth analog |
|--------|----------------|---------------|
| **Login** | `users` | `LoginPage.tsx` |
| **Pipeline / Kanban** | `jobs`, `pipeline_stages`, `kanban_boards`, `job_field_definitions` | `PipelinePage` |
| **Job detail** | `jobs`, `job_notes`, `job_tags`, schedule | `JobDetailModal` |
| **Customers** | `customers` + contact tables | `CustomersPage` |
| **Calendar** | `job_schedule_entries`, `installer_lanes`, bench/scheduled queries | `CalendarPageNew` |
| **Tasks** | `tasks` | `TasksPage` |
| **Appointments** | `appointments` | Appointment sections in calendar |
| **Settings** | `app_settings`, boards, stages, fields, users | Parts of `AccountSettingsPage` + pipeline customize |
| **Activity** (optional tab on job/customer) | `activities` | Job timeline in modal |

### Calendar UI (library)

Use a **calendar component** for the month/week grid (Avalonia-compatible or custom `ItemsControl` grid). Port **your** UX:

- Left/right: **Bench** + **Scheduled** lists
- Center: install events from `job_schedule_entries` colored by `jobs.color`
- Modal: job, title, installer lane, start/end, exclude Sat/Sun, color (from Paarth `EventModal`)

Appointments can render on same grid or a separate “Appointments” calendar layer (`calendars` table).

---

## 8. Default seed data (first launch)

Not in `schema.sql` today — add via EF seed or SQL insert on setup wizard:

1. **Calendar:** “Main” + 4 installer lanes + Other  
2. **Kanban board:** “Default pipeline” linked to Main calendar  
3. **Sections:** e.g. “Pipeline” (single section v1)  
4. **Stages:** Lead → Quote → Ready to schedule (`moves_to_bench=1`) → Scheduled (`is_scheduled_stage=1`) → In progress → Complete (`is_closed=1`)  
5. **Field definitions:** title, customer, description on card; amount/address off  
6. **First admin user** — created in setup wizard (hash password, insert `users`)

Set `app_settings.default_board_id` and optionally `kanban_boards.on_schedule_stage_id` → Scheduled stage.

---

## 9. Build phases

### Phase 1 — Shell
- Solution + Avalonia window + navigation shell  
- SQLite + EF Core + apply schema/seed  
- Serilog + DI + MediatR  
- Login + session (`ICurrentUser`)

### Phase 2 — CRM core
- Customers CRUD + phones/emails/addresses  
- Jobs CRUD + stage moves on default board  
- Kanban UI with configurable card fields from `job_field_definitions`

### Phase 3 — Calendar
- `job_schedule_entries` CRUD  
- Bench / scheduled sidebar queries  
- Schedule modal (installer lanes, weekend skip, color)  
- Optional auto-move stage via `on_schedule_stage_id`

### Phase 4 — Tasks, appointments, activity
- Tasks/appointments with optional `job_id` + link chip in UI  
- Activity logging on key commands  
- Local file attach (copy into `uploads/`, row in `files`)

### Phase 5 — Polish
- Board/stage/field settings UI  
- Multiple `kanban_boards`  
- Tags, job numbers (`jobs.job_number`)  
- Backup/export  
- Google Calendar (optional)

---

## 10. Key domain rules (checklist for handlers)

- [ ] Moving job `stage_id` writes `activities` (`stage_changed`)  
- [ ] Bench membership = `pipeline_stages.moves_to_bench` ∧ no schedule entries ∧ ¬`is_closed`  
- [ ] Calendar grid events = one bar per `job_schedule_entries` row  
- [ ] Saving schedule with exclude Sat/Sun splits ranges (app layer)  
- [ ] First schedule entry may update `jobs.stage_id` if board has `on_schedule_stage_id`  
- [ ] Task/appointment without `job_id` still valid; show link when present  
- [ ] Customer delete: `ON DELETE RESTRICT` on jobs — must reassign or delete jobs first  
- [ ] Card UI reads `job_field_definitions` for board; never assume amount/address exist

---

## 11. NuGet packages (starter list)

**Liminnality.App**
- `Avalonia`, `Avalonia.Desktop`, `Avalonia.Themes.Fluent`
- `CommunityToolkit.Mvvm`
- `Microsoft.Extensions.Hosting`
- `Serilog.Extensions.Hosting`, `Serilog.Sinks.File`

**Liminnality.Application**
- `MediatR`
- `FluentValidation` (optional)

**Liminnality.Infrastructure**
- `Microsoft.EntityFrameworkCore.Sqlite`
- `Microsoft.EntityFrameworkCore.Design`
- `BCrypt.Net-Next` or `Microsoft.AspNetCore.Cryptography.KeyDerivation`

---

## 12. Relationship to this Paarth repo

| In Paarth repo | Purpose |
|----------------|---------|
| `local-crm/schema.sql` | Database design to copy into new repo |
| `local-crm/Liminnality.md` | This document |
| `Paarth/backend`, `Paarth/frontend` | **Reference only** — behavior & UX |

**Do not** wire Liminnality into Paarth’s Express/Mongo deployment. Copy `schema.sql` + this MD into the new directory and start fresh.

---

## 13. Open decisions (fill in as you build)

- [ ] **Avalonia calendar control** — which library or custom grid?  
- [ ] **Auth v1** — single shared machine password vs per-user login (schema supports per-user)  
- [ ] **Job numbers** — auto-increment `job_number` strategy  
- [ ] **Multiple boards** — switcher in UI vs one default only for v1  
- [ ] **Google OAuth** — desktop loopback redirect for appointments sync  

---

*Document version: 1.0 — aligned with `local-crm/schema.sql` in Paarth repo.*
