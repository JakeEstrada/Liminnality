# Frontend pages reference

Every route-level page in `frontend/src/pages/`. Each source file has a matching header comment.

**Legend:** 🔒 = requires login · 👤 = admin only · 📺 = kiosk/TV view mode

---

## Authentication & legal

### LoginPage.tsx
- **Route:** `/login`
- **Purpose:** Email/password sign-in; stores JWT and tenant id in `localStorage`.
- **API:** `POST /auth/login`
- **Key logic:** On success, `AuthContext.login` sets axios headers and redirects to `/pipeline`.

### RegisterPage.tsx
- **Route:** `/register`
- **Purpose:** Self-service signup (when enabled).
- **API:** `POST /auth/register`

### ForgotPasswordPage.tsx
- **Route:** `/forgot-password`
- **Purpose:** Request password reset email.
- **API:** `POST /auth/forgot-password`

### ResetPasswordPage.tsx
- **Route:** `/reset-password?token=…`
- **Purpose:** Set new password from email link.
- **API:** `POST /auth/reset-password` with token from query string.

### ForgotUsernamePage.tsx
- **Route:** `/forgot-username`
- **Purpose:** Recover account email/username.
- **API:** `POST /auth/forgot-username`

### PrivacyPolicy.tsx · TermsAndConditions.tsx · SmsConsentPage.tsx
- **Routes:** `/privacy-policy`, `/terms`, `/sms-consent`
- **Purpose:** Static compliance copy for Twilio/SMS and registration.

---

## Workspace (core CRM) 🔒

### DashboardPage.tsx
- **Route:** `/dashboard`
- **Purpose:** Home screen — stats, upcoming tasks/appointments, recent activity, print view, **AI activity summary**.
- **APIs:** `GET /activities/recent`, `GET /tasks`, `GET /appointments`, `POST /activities/summary`
- **Important logic:**
  - `runActivitySummary` (~712) — calls OpenAI-backed date-range summary dialog.
  - `DashboardPage` main render — quick tiles navigate to pipeline, calendar, customers.
  - `PrintView` (~1811) — printable activity sheet for a selected day.
  - `useShopViewSensitive` — hides dollar amounts for shop/kiosk roles when configured.

### PipelinePage.tsx
- **Routes:** `/pipeline` · 📺 `/pipeline-view`
- **Purpose:** Main **kanban board** — jobs by stage, drag to move, layouts, embedded todos/appointments.
- **APIs:** `GET /jobs`, `POST /jobs/:id/move-stage`, `GET /pipeline-layouts`
- **Important logic:**
  - `fetchJobs` (~203) — loads active jobs (excludes archive/dead/closed-out by default).
  - `getPipelineSelectionStorageKey` (~47) — remembers selected column layout per tenant in `localStorage`.
  - `handleStageChange` (~286) — `POST …/move-stage` then refreshes board; backend logs activity + note.
  - `useSocketSubscription` (~270) — live updates on `project.updated` / `task.*` without full page reload.
  - `tvMode` prop — simplified chrome for wall displays.

### OutlookInboxPage.tsx
- **Route:** `/outlook`
- **Purpose:** Team Outlook inbox — worksheets from Joe/team flagged until a pipeline job is created.
- **APIs:** `GET /outlook/status`, `GET /outlook/messages`, `POST /outlook/sync`, `PUT /outlook/settings`, `GET /outlook/auth-url`
- **Important logic:** Super admin connects Microsoft Graph. Team sender list filters whose mail is pulled. Subject containing “worksheet” is flagged in Outlook and listed here.

### CustomersPage.tsx
- **Routes:** `/customers` · 📺 `/customers-view`
- **Purpose:** Customer directory, detail drawer, jobs list, CSV import, global search integration.
- **APIs:** `GET /customers`, `PATCH /customers/:id`, `POST /customers`, `GET /customers/global-search`
- **Important logic:**
  - `fetchCustomers` (~88) — paginated list with search/tag filters.
  - `handleSaveCustomerEdit` (~387) — persists phones, emails, addresses arrays.
  - URL `?customerId=` — deep-link opens customer detail (used by search bar and assistant).

### CalendarPage.tsx
- **Routes:** `/calendar` · 📺 `/calendar-view`
- **Purpose:** **Production calendar** — month grid, install bench, scheduled jobs, appointments, installer lanes.
- **APIs:** `GET /jobs`, `GET/POST /appointments`, schedule entry endpoints via job updates
- **Important logic:**
  - `splitCalendarJobs` — splits jobs into **bench** (readiness stage, no dates, or parked with `schedule.returnToBench`) vs **scheduled** (has dates and not parked on bench). Drag scheduled → bench parks the card without clearing dates or color.
  - `fetchJobs` (~1629) — loads jobs then derives bench/scheduled lists.
  - `BenchJobCard` (~1320) — draggable bench card; assign to installer lane + date.
  - `EventModal` (~162) — create/edit calendar events and job schedule blocks.
  - `shouldExcludeJobFromCalendarSchedule` (~1499) — hides archived/closed jobs from grid.

### TasksPage.tsx
- **Route:** `/tasks`
- **Purpose:** Projects & tasks — open/completed, optional job/customer link.
- **APIs:** `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`

### TasksPage.tsx
- **Route:** `/messages`
- **Purpose:** SMS inbox — sent, scheduled, received; Twilio integration.
- **APIs:** `GET /twilio/messages`, `POST /twilio/send-sms`, `POST /twilio/schedule-sms`

### RfidPage.tsx
- **Route:** `/rfid`
- **Purpose:** Live RFID scan log from shop floor devices; Socket.IO updates.
- **APIs:** `GET /rfid/scans`, `GET /rfid/tags`

---

## Finance & operations 🔒

### FinanceHubPage.tsx
- **Route:** `/finance`
- **Purpose:** Estimates, invoices, contracts, change orders, PDF export, Plaid register tab.
- **APIs:** `/estimates`, `/invoices`, `/contracts`, `/plaid/*`, `/files/upload-document`
- **Important logic:**
  - `FinanceHubPage` (~346) — tab state synced to URL `?tab=`.
  - `computeEstimateFormFromJobSnapshot` (~248) — pre-fills estimate lines from job data.
  - `buildFreshEstimateDraftForJob` (~334) — new estimate from pipeline job.
  - Large helper block at top — estimate numbering, job picker labels, PDF generation via html2canvas + jsPDF.

### BillsPage.tsx
- **Route:** `/bills`
- **Purpose:** Vendor bills tracking.
- **APIs:** `/bills`

### PayrollPage.tsx
- **Route:** `/payroll`
- **Purpose:** RFID payroll (default) plus a Manual timesheet tab. Mileage 0.725/mi, PDF print, SMS share. Daniel uses a Mon–Sun pay week.
- **APIs:** User/time endpoints, `POST /activities/payroll/print`, `POST /twilio/send-sms`

### CommissionLogsPage.tsx
- **Route:** `/commission-logs`
- **Purpose:** Sales commission log table/export.

### TakeoffSheetPage.tsx
- **Route:** `/takeoff-sheet`
- **Purpose:** Field takeoff form — room rows, fractions, link to job for customer/address autofill.
- **APIs:** `GET /jobs/:id` when job selected; form persisted in localStorage.

### UsersPage.tsx 👤
- **Route:** `/users`
- **Purpose:** Admin user management — roles, phones, active flag.
- **APIs:** `GET /users`, `POST /users`, `PATCH /users/:id`

### AccountSettingsPage.tsx
- **Route:** `/account-settings`
- **Purpose:** Profile, password, tenant logo (super admin), theme preferences.

### DeveloperTasksPage.tsx
- **Route:** `/developer`
- **Purpose:** Internal dev task tracker (separate from customer tasks).

---

## Archive & completed 🔒

### JobArchivePage.tsx
- **Routes:** `/archive`, `/dead-estimates`
- **Purpose:** Dead estimates and manually archived jobs by month.
- **APIs:** `GET /jobs/archive` or `GET /jobs/dead-estimates`

### CompletedJobsPage.tsx
- **Route:** `/completed-jobs`
- **Purpose:** Jobs in final closed/paid stage.
- **APIs:** `GET /jobs/completed`

### CompletedTasksPage.tsx
- **Route:** `/completed-tasks` (also `/completed-appointments` redirects here)
- **Purpose:** Completed tasks and appointments in one weekly view.
- **APIs:** `GET /tasks`, `GET /appointments` (filtered client-side)

---

## File viewers 🔒

### PdfViewerPage.tsx
- **Route:** `/pdf/:fileId`
- **Purpose:** Full-page PDF viewer for a stored file.
- **API:** `GET /files/:id/download`

### PictureViewerPage.tsx
- **Route:** `/picture/:fileId`
- **Purpose:** Full-page image viewer.

### ContractCoverPrintPage.tsx
- **Route:** `/print/contract-cover`
- **Purpose:** Printable HTML contract cover (letter, two pages). Opened from the job Cover page dialog. Does not save a file to the job.

### CalendarBenchPrintPage.tsx
- **Route:** `/print/calendar-bench`
- **Purpose:** Landscape worksheet of jobs currently on the install bench: address, deposit date, payment split (40/60 or custom), payments, total, plus blank start / finish / who columns. Opened from bench settings.

### CalendarMonthsPrintPage.tsx
- **Route:** `/print/calendar-months`
- **Purpose:** One landscape letter page of this month and next month (from the calendar you are viewing), with job chips, installers, and holidays. Opened from bench settings.

---

## Route map (quick)

| Path | Page |
|------|------|
| `/dashboard` | DashboardPage |
| `/pipeline` | PipelinePage |
| `/outlook` | OutlookInboxPage |
| `/customers` | CustomersPage |
| `/calendar` | CalendarPage |
| `/tasks` | TasksPage |
| `/messages` | MessagePage |
| `/rfid` | RfidPage |
| `/finance` | FinanceHubPage |
| `/bills` | BillsPage |
| `/payroll` | PayrollPage |
| `/commission-logs` | CommissionLogsPage |
| `/takeoff-sheet` | TakeoffSheetPage |
| `/users` | UsersPage |
| `/account-settings` | AccountSettingsPage |
| `/archive` | JobArchivePage |
| `/completed-jobs` | CompletedJobsPage |
| `/completed-tasks` | CompletedTasksPage |
| `/developer` | DeveloperTasksPage |
| `/pipeline-view` | PipelinePage (tvMode) |
| `/calendar-view` | CalendarPage (tvMode) |
| `/customers-view` | CustomersPage (viewMode) |
| `/print/contract-cover` | ContractCoverPrintPage |
| `/print/calendar-bench` | CalendarBenchPrintPage |
| `/print/calendar-months` | CalendarMonthsPrintPage |

Defined in `frontend/src/App.tsx`.

---

## Adding a new page

1. Create `frontend/src/pages/YourPage.tsx` with the standard file header.
2. Add route in `App.tsx` inside the `MainLayout` `<Routes>`.
3. Add sidebar entry in `components/layout/Sidebar.tsx` if needed.
4. Document the page in this file.
