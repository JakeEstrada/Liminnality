# Liminnality

**An ERP for shops that build and install: pipeline, scheduling, payroll, and the money on every job.**

This repository is that hosted ERP (React, Node.js, Express, MongoDB). The desktop plan in `local-crm/` is a separate product and is not this application.

Liminnality is the system of record for San Clemente Woodworking. Every job that enters the shop lives here from the first phone call to the final payment: the estimate, the signed contract, the deposit that cleared the bank, the takeoff measurements, the installer assigned to Tuesday, the text message that told the customer their stairs were ready, and the commission the salesman earned when the check arrived. One database, one timeline per job, one place to look.

It is built for the way a real shop actually works. The owner opens it on a laptop. The salesman checks the pipeline from a phone in a customer's driveway. A TV on the shop wall shows the board, the install calendar, and the county map all day without anyone touching it. A Raspberry Pi by the door reads RFID badges, and a text to the shop line clocks the same timesheet. Nobody has to be at a desk for the business to keep running.

### Recent (October 2026)

The first half of the month went into the wall display, the county map, and talking to the shop without picking up a phone. The second half went into paper the crew can take to a job, the texts that already happen on a job card, and payroll hours that stay put after someone fixes them by hand.

- **Shop dashboard** — `/dashboard-view` is the TV page: team activity, pipeline mix, and the job map, with a switcher for pipeline, calendar, and customers. The office `/dashboard` stays the full morning page.
- **Job map** — Orange County pins from geocoded sites. New and edited jobs place themselves (US Census, then OpenStreetMap). Views for the pipeline, who is on site now, this week, completed, and archived. Filter by name, city, stage, scheduled or not, dollar amount, or a 10-mile radius. Full screen, satellite imagery, and a click opens the job card. A missing or failed pin shows an error on the pipeline card and on the job so the address can be fixed. A wrong pin can also be corrected with lat/lng on the job.
- **Liminality** — wake word, then a 30-second listen window with a start sound and a close sound. She opens shop screens, texts a customer card, books a reminder or an appointment, and answers live questions (payments, deposits, who is coming up). “Jobs in Dana Point” and “jobs near Fullerton” walk the map, naming each job while that pin highlights. “Open the Hammer job” puts the card on the current page, Files tab first. Speech streams from ElevenLabs so she starts talking before the sentence is finished. **Stop** ends the window. **Close**, or a key or click while she is talking, drops the card or the tour and keeps listening. The voice is chosen under Account Settings → Liminality.
- **Text clock-in** — a registered mobile texts the shop line `in`, `out`, a period, or a blank and gets a confirmation back. The API also polls Twilio every 10 seconds, so a missed webhook still becomes a punch.
- **Job messages** — the job card has a Messages tab right after Overview. It is the back-and-forth with that customer: canned texts, replies, and a composer. New customer replies put `(+n)` on the pipeline card until someone opens the tab. Sent and received texts are timestamped on Recent Activity, on Notes, and in the shop activity log.
- **Cover pages** — from the job card, two US-letter pages open in a print tab (estimate number, payment terms from the job schedule, Zelle QR, California contract language, signature block). The browser’s print dialog is the export, so it does not save as a grey PDF.
- **Print bench and print calendar** — both live in the calendar bench gear. Print bench is a landscape worksheet of the current bench: address, deposit date, payment split (40/60 or custom), payments, total, and blank start / finish / who. Print calendar is this month and next month, each on its own landscape letter page, with job chips, installers, and holidays.
- **Payroll** — the RFID timesheet is the first tab; Manual is the handwritten sheet. Pay weeks are configurable. Hours you lock with Edit stay locked when a later RFID OUT arrives.
- **Archive search** — finding an archived job opens the archive on that year. The card does not auto-open; you pick it.
- **Takeoff** — any row, including the first, can be made double height from a `2×` control. Add double row converts the first empty single-height row instead of only appending at the bottom.
- **Website slideshow** — the website CMS can download every homepage photo as a shuffled zip.

---

## Contents

- [Who uses it, and on what](#who-uses-it-and-on-what)
- [The pipeline](#the-pipeline) — the heart of the app
- [Scheduling and the install calendar](#scheduling-and-the-install-calendar)
- [Mobile messaging](#mobile-messaging)
- [Liminality](#liminality) — voice and in-app help
- [The job map](#the-job-map)
- [Real-time updates](#real-time-updates)
- [What it keeps track of](#what-it-keeps-track-of)
- [Money](#money)
- [The shop floor](#the-shop-floor)
- [Interface and experience](#interface-and-experience)
- [Architecture](#architecture)
- [Security and access control](#security-and-access-control)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Background jobs](#background-jobs)
- [Known gaps and roadmap](#known-gaps-and-roadmap)
- [Further documentation](#further-documentation)

---

## Who uses it, and on what

| Person | Device | What they need |
|--------|--------|----------------|
| Owner / admin | Desktop | Everything: finance, users, website, analytics, bank register |
| Salesman | Phone and laptop | Pipeline, customers, calendar, their commission log |
| Shop lead | Wall-mounted TV | The board and the install calendar, read-only, never logs out |
| Installer | Phone | Where they are going, who the customer is, what the address is |
| Shop employee | RFID badge, kiosk PIN, or a text | Clock in, clock out |
| Office | Desktop | Estimates, invoices, contracts, bills, payroll, messages |

The same application serves all of them. What changes is what each one is allowed to see and how the interface reshapes itself for the screen it is on — covered in [Interface and experience](#interface-and-experience).

---

## The pipeline

The pipeline is a Kanban board, but it is modelled on how a stair job actually progresses rather than on generic "to do / doing / done" columns. Twelve stages are grouped into three phases that match the three real handoffs in the business: selling the job, getting it ready to build, and executing it.

```
SALES PHASE
  Estimate Current, first 5 days │ Estimate Sent │ Design Review │ Contract Out

JOB READINESS
  Signed / Deposit Pending │ Job Prep │ Fabrication │ Ready to Schedule

EXECUTION PHASE
  Scheduled │ In Production │ Installed │ Final Payment Closed
```

A thirteenth stage, **Appointment Scheduled**, sits ahead of the board. Pre-sales appointments are not jobs yet, so they live in their own list beside the board instead of as a column.

### Moving work through it

Jobs are dragged between columns with native HTML5 drag and drop. On drop, the board:

1. Updates the card's position **immediately** in local state, before the server answers, and rolls it back if the request fails. The board never feels like it is waiting on the network.
2. Calls `POST /jobs/:id/move-stage`, which records the stage change on the job's activity timeline server-side, so there is a permanent audit trail of who moved what and when.
3. Checks whether the destination stage has an enabled SMS template. If it does, a dialog opens pre-filled with the customer's message — "your estimate is on the way", "we're scheduling your install" — and the user can send it or dismiss it. The text is always optional and never blocks the move.
4. Broadcasts the change to every other connected browser, so the shop TV and the owner's laptop update within a second. See [Real-time updates](#real-time-updates).

Templates are configured per stage and stored on the tenant, so each business writes its own customer-facing language once and then reuses it on every job.

### The job card

Cards are deliberately sparse. A column is narrow, and a board with sixty jobs on it has to be readable at a glance from across a room, so a card shows the customer or job name, a coloured left edge, and a row of payment squares on the right — two for deposit and final, three when there is a progress payment, and so on. A square fills green when that line is paid and stays empty until then.

Opening a card is the rest of the job: **Overview**, **Messages**, **Schedule**, **Payments**, **Files**, **Notes**. Messages is the customer text thread. Overview’s Recent Activity (and the Notes list) includes timestamped `Text sent` / `Text received` lines. A pipeline card shows `(+n)` when the customer has unread replies, and a map-error icon when the site address is not on the county map.

The colour of that left edge answers the single most common question in the shop — *is this job actually going to happen this week?*

| Colour | Meaning |
|--------|---------|
| **Green** | Scheduled — it has install dates on the calendar, or it sits in the Scheduled stage |
| **Orange** | On the bench — it is ready to build but has no dates yet |
| **Blue** | Open — still in sales, or otherwise not yet a production commitment |

That distinction between *scheduled* and *on the bench* is the one the whole calendar is built around, and it is explained below.

### Board-level tools

- **Stage totals.** Each column header can show the summed estimated value of the jobs in it, formatted compactly (`$1.2K`, `$450K`). This is money on the screen, so it sits behind the financial PIN gate and is hidden entirely for shop-floor roles.
- **Search** filters across job title, customer name, and stage, and searches every job rather than only the current board.
- **Right-click any job** for a context menu: move to a stage, add a change order, add a task, edit the payment schedule, archive it.
- **Close out completed jobs.** When jobs pile up in Final Payment Closed, one control archives them in bulk after a confirmation, keeping the board honest without losing history.
- **Custom boards.** A tenant can define alternate pipeline layouts with their own phase titles and their own stage keys, and jobs are filed against the layout they belong to. Stage labels, descriptions, and visibility on the default board are also overridable per tenant, so a business can rename "Fabrication" to whatever its crew actually calls it, or hide a stage it does not use.
- **Fullscreen / TV mode.** `/pipeline-view`, `/calendar-view`, `/customers-view`, and `/dashboard-view` strip the app down for a wall display: no sidebar, a switcher between those four screens, and a long-lived kiosk session so the screen survives a power cycle without someone typing a password. Leaving the display asks for a PIN. The pipeline TV view also drops task lists, the appointment panel, and SMS prompts.

---

## Scheduling and the install calendar

The calendar is a month grid, but the interesting part is the **bench** beside it.

A job is "on the bench" when it is sold, prepped, and buildable but has no install dates yet. Those jobs are the shop's backlog — real committed work with real revenue attached, waiting for a slot. The calendar shows the bench as a live list next to the month so that whoever is scheduling can see the backlog and the open days at the same time, which is the actual job to be done.

- **Bench and scheduled lists** are drag-and-drop between each other. Pulling a job back to the bench sets a `returnToBench` flag that parks it *without* destroying its dates or colour, so nothing is lost when plans slip.
- **Dates and installers** are assigned by clicking a day, which opens a scheduling dialog supporting multiple installer-and-date groups on one job. A job can have two installers on different weeks, or one installer across a ten-day range, with weekends automatically excluded when a range is expanded.
- **Multi-day jobs** render as continuous bars across the days they span.
- **Installer lanes.** Each day cell lays out up to four named installer lanes plus an "Other" lane, so the grid reads as a crew schedule rather than an undifferentiated pile of chips. Lane order is a user preference.
- **Colour** is per job and carries through the bench card, the scheduled list, and the grid, so a long-running job is recognisable everywhere.
- **Hidden weekdays.** A shop that never installs on Sundays can right-click a day header and remove that column from the grid permanently, reclaiming the space. TV mode always shows the full week.
- **Holidays** (US federal plus Easter) are marked on day headers, because they are the thing people forget when promising a date.
- **Duration estimate.** Bench cards show a rough day count derived from job value, giving the scheduler a sense of size before they commit a slot.
- **Print from bench settings.** The gear on the bench list has **Print bench** (landscape worksheet of the current bench: address, deposit date, payment split, payments, total, blank start / finish / who) and **Print calendar** (the month you are looking at plus the next one, one landscape letter page each, with chips, installers, and holidays). Hidden weekdays stay hidden.
- **TV mode** at `/calendar-view` shows multiple months at once for wall display.

On a phone the calendar becomes read-only and reshapes completely — see [the mobile experience](#the-mobile-experience).

---

## Mobile messaging

Liminnality sends and receives real SMS through Twilio, in both directions, and keeps the whole conversation in the job record.

### Outbound

| Kind | Where it comes from |
|------|--------------------|
| Ad-hoc | The Messages page, to any number the user types |
| Pipeline stage templates | Offered automatically when a job moves stage |
| Appointment reminders | Queued when an appointment is booked, keyed to the appointment |
| Payment notifications | Fired automatically when a payment is marked paid, to a configured recipient list |
| Job-card thread | The job’s Messages tab — canned or free text to the customer, plus their replies, stored on that job |
| Employee and customer texts | From the job modal, customer page, vendor page, and calendar — including sharing a job's schedule and address with an installer. The same customer card can be sent by voice: “send [customer] to [employee]” texts only rolodex mobiles |

Recipients can be resolved from the employee roster rather than retyped, and messages can be **scheduled for the future** rather than sent now. Images can be attached via a staged MMS upload.

### Inbound

Replies come back on a signed webhook. The API checks the signature before it stores the message, then infers which tenant it belongs to (by prior conversation thread, then by the number it was sent from, then by fallback). Delivery receipts arrive on a separate signed callback and update each message's delivery state.

Because webhooks can be misconfigured or miss a window, the API also **polls Twilio every 10 seconds** for recent inbound messages and records any clock-in texts it finds. There is still an admin-only **backfill**: one button pulls recent messages straight from the Twilio API and reconciles anything both paths missed.

Unread replies surface as a **badge in the sidebar**, and a new customer reply on a job also puts **`(+n)` on that pipeline card**. Both clear when the thread is read, so a reply is never silently sitting in a page nobody opened.

A public `/sms-consent` page carries the A2P compliance copy required for campaign registration.

### Scheduled delivery

A scheduler inside the API process wakes every minute, claims scheduled messages whose send time has passed, sends them in small batches, and refreshes stale delivery statuses from Twilio. No separate worker process to deploy or babysit.

---

## Liminality

Hands-busy help for the shop floor and the office, not a generic chatbot bolted on the side.

**Liminnality Help** is the typed assistant (floating chat). It only answers about this app and this tenant. Tools pull live data the signed-in user is already allowed to see: global search, job notes, job details, recent payments, recent deposits, jobs by city or name, the upcoming calendar, the employee rolodex, and the job map. It can jump the browser to a whitelisted path, open a job card, or filter the map. It does not invent customer or financial numbers.

**Voice** is the same brain, spoken. On desktop Chrome or Edge, Account Settings → Liminality turns the microphone on and picks the ElevenLabs voice (Sarah by default). Nothing is listened to while it is off.

1. Say **Liminality**. A listen sound plays. She then listens for 30 seconds; you do not have to say the name again inside that window. A different sound plays when the window ends.
2. Shop-view words — pipeline, calendar, customers, dashboard — open the matching screen immediately. On a kiosk she stays inside the `*-view` routes. From the office dashboard, “dashboard” stays on the office page unless you say “dashboard view”.
3. A few commands are handled in the browser before any model runs: navigation, “send Hammer to Jake”, stop, and close.
4. Anything else goes to the assistant and is read back in one or two short sentences.

What she can do once she is listening:

| You say | What happens |
|---------|----------------|
| Pipeline, calendar, customers, dashboard | Opens that screen |
| Send Hammer to Jake | Texts the Hammer customer card (name, phones, email, address, gate code, job title) to a rolodex mobile. Ambiguous names are asked back. It never texts an arbitrary number |
| Remind me to call the lumber yard | Creates the task, then asks whether you want a reminder text. The number has to already be on a user or rolodex card. Yesterday is rejected. “Next week” means seven days out at 9 PM |
| Create an appointment with Hammer tomorrow at 2 | Books the appointment, then offers the same reminder text |
| What’s the most recent deposit? / Did Hammer make a deposit? | Reads the job’s paid deposit line. Unlinked bank inflows are ignored |
| Who’s coming up? | Upcoming appointments and dated jobs |
| What jobs do we have in Dana Point? | Opens the map, filters to that city, zooms in, and names each job while that pin highlights |
| What jobs do we have near Fullerton? | Same tour, inside a 10-mile radius |
| Open the Hammer job | Opens that job card on the page you are already on, Files tab first, so photos are visible |
| Close | Drops the job card and stops the map tour. She keeps listening |
| Stop / never mind / goodbye | Ends the listen window and goes back to waiting for the wake word |

A key press or a click while she is talking cuts her off the same way **Close** does, so a wrong answer does not have to finish.

Speech streams PCM from ElevenLabs (Flash by default, with slower models as fallback), so playback starts before the whole sentence is ready. Common navigation lines are still warmed when the mic turns on. Recognition commits after a short pause instead of waiting for Chrome’s slow “final” transcript. The microphone is muted while she talks, so her own voice is not taken as the next command.

A command cheat sheet lives on the developer page. The request path — wake, local match, assistant tools, streamed speech — is written up in [liminalVoice.md](liminalVoice.md).

Liminality is a desktop feature. Phones stay on the five-page mobile product; the mic toggle is a no-op there.

---

## The job map

The Orange County map sits on both dashboards. Pins come from job-site coordinates, not from a hand-maintained list.

A job is geocoded when it is created, when its address changes, and in small batches when the map is opened if a pin is still missing. The API asks the US Census geocoder first and OpenStreetMap if Census misses. A hit is stored on the job (`lat`, `lng`, the address that was looked up, and whether it succeeded) and is not looked up again until the address changes or a failed lookup is a week old. Coordinates typed on the job card are marked manual and are left alone. Opening the map only plots points inside Orange County. Sales-funnel jobs (estimate through contract out) stay off the pipeline view; that view is contracted work. Misses — no street number, no match, nothing to plot — show up on the developer geocode panel, and lat/lng on the job card overrides the lookup.

The map itself has five views — **Pipeline**, **On site now** (scheduled or in production today), **This week**, **Completed**, and **Archived** — and filters for name, city, stage, scheduled or not, and amount. “Near” is a 10-mile radius around a city center. Green pins are scheduled or completed; amber pins are still unscheduled; grey pins are archived. Dollar amounts on the pins follow the same financial gates as the rest of the app.

The basemap is Mapbox satellite streets when `VITE_MAPBOX_ACCESS_TOKEN` is set, and Esri imagery with a label overlay otherwise. Full screen takes the map over the page. Zoom fits the pins that are actually showing, so two jobs in one city do not sit at a county-wide view. Clicking a pin opens the job card. Liminality drives the same component: a voice tour sets the filters, highlights one pin at a time, and speaks that job’s name.

---

## Real-time updates

Liminnality is a multi-user application where two people genuinely do touch the same job at the same time — a salesman moving a card while the shop lead schedules it. Rather than making users refresh, the server pushes changes over Socket.IO.

**Rooms are per tenant.** On connect, an authenticated socket joins `tenant:{tenantId}`, and every broadcast is scoped to that room, so one business never receives another's events. Clients can additionally subscribe to a specific `project:` or `task:` topic for finer-grained updates.

Events the server emits:

| Event | Fires when |
|-------|-----------|
| `project.created` / `project.updated` | A job is created, edited, moved stage, archived, or deleted |
| `task.created` / `task.updated` | A task is created, edited, completed, or removed |
| `appointment.changed` | An appointment is booked, edited, completed, cancelled, or deleted |
| `customer.changed` | A customer is created, edited, or deleted |
| `rfid.scan.created` | A badge is scanned, or a text clock-in is recorded |
| `rfid.tag.*`, `rfid.pin.*`, `rfid.phone.*`, `rfid.timesheet.updated`, `rfid.employee-profile.updated` | Timekeeping configuration or timesheet changes |
| `user.audit.created` | Audit activity is ingested |
| `website.analytics.created` | A visitor event lands from the public marketing site |
| `sms.inbound.created` | An inbound text is stored, including one found by the Twilio poll |

On the client, two hooks do the work:

- **`useSocketSubscription(room, event, handler)`** — ref-counted room joins, automatic re-subscription after a reconnect, and cleanup on unmount.
- **`useTenantRealtimeRefresh(room, refresh)`** — a debounced refetch for pages that just need to stay fresh.

Two details matter more than they look:

1. **Debounced refetch.** A burst of twenty events produces one refetch, not twenty. A busy afternoon does not turn into a stampede on the API.
2. **Ignoring your own writes.** Every HTTP request carries the browser's socket id in a header, and the server echoes it back on the resulting broadcast. The originating tab recognises its own id and skips the refresh, because it already applied the change optimistically. Without this, the user who moved a card would see it jump as their own echo came back.

---

## What it keeps track of

Thirty-two collections, every one of them scoped to a tenant. The core thread is **Customer → Job**, and almost everything else hangs off a job.

```mermaid
erDiagram
  Customer ||--o{ Job : "has"
  Job ||--o{ Estimate : "quoted by"
  Job ||--o{ Contract : "signed as"
  Job ||--o{ Invoice : "billed by"
  Job ||--o{ Activity : "timeline"
  Job ||--o{ File : "documents"
  Job ||--o{ Task : "work items"
  Job ||--o{ DepositAllocation : "bank deposits"
  Estimate ||--o{ Invoice : "converts to"
  Estimate ||--o{ Contract : "converts to"
  Appointment ||--o| ScheduledSms : "reminder"
  Tenant ||--o{ User : "employs"
```

### The job record

A job is the richest document in the system, because in this business a job *is* the unit of work. One job holds:

- **Where it stands** — current pipeline stage, which board it belongs to, who it is assigned to
- **What it is worth** — estimated value and contracted value, tracked separately
- **How it gets paid** — a full payment schedule of percentage or fixed-amount milestones, each with a due type (deposit, milestone, final), its own status (pending, invoiced, paid), and its own dates
- **Change orders** — each billed separately or rolled into the final payment, each with its own paid status
- **Measurements** — the complete takeoff sheet, saved as structured data, with who completed it and when
- **The install plan** — start and end dates, installers, multiple scheduled entries, crew notes, calendar colour, and a flag for jobs parked back on the bench
- **Where it is** — job site address and on-site contact, which are often not the customer's billing details. The address is geocoded onto the job automatically; lat/lng can also be set by hand. Customers also carry a **gate code**, which prints on cover pages and in the installer text card
- **How it closed** — final payment method, close-out state, archive state, and a "dead estimate" flag for jobs that never happened
- **Its whole story** — a notes timeline where stage changes, appointments, texts sent and received, and flagged important notes are interleaved with free text

### Everything else

| Domain | Collections | What it is for |
|--------|-------------|----------------|
| **Sales** | `Customer`, `Job`, `Appointment`, `PipelineLayout` | Leads, jobs, site visits, custom boards. Customers carry multiple labelled phones, emails, and addresses, plus a lead source and referral company so marketing spend can be judged |
| **Money** | `Estimate`, `Contract`, `Invoice`, `DocumentSequence`, `DepositAllocation`, `PlaidRegisterCache`, `Bill` | Numbered financial documents, their counters, bank reconciliation, recurring bills |
| **Work** | `Task`, `Activity`, `File`, `DocumentFolder` | To-dos (which can nest under a parent to form projects), the audit timeline, uploads, and a folder tree |
| **Messaging** | `SmsMessage`, `ScheduledSms`, `OutlookMessage`, `EmployeeContact` | Sent and received texts, the outbound queue, synced email, and the roster of staff without logins |
| **Shop floor** | `RfidTag`, `RfidPin`, `RfidPhone`, `RfidScan`, `RfidEmployeeProfile`, `RfidTimesheetWeek` | Badges, kiosk PINs, text-in numbers, raw scans, pay rates and shift defaults, compiled timesheets |
| **Suppliers** | `Vendor` | Lumber, hardware, subcontractors, delivery, with reusable order-item catalogues |
| **Marketing** | `WebsiteContent`, `WebsiteAnalyticsEvent` | The public site's CMS and first-party visitor analytics |
| **Platform** | `Tenant`, `User`, `UserAuditLog`, `DeveloperTask` | Organisations, logins, a security audit trail, and the internal engineering backlog |

The **activity log** deserves a mention on its own: it recognises more than forty distinct event types — stage changes, texts sent and received, payments received, deposits, files uploaded and deleted, estimates sent, contracts signed, takeoffs completed, payroll printed, appointments created and completed, tasks opened and closed. The result is that any job, customer, or task can answer "what has happened here?" without anyone having kept notes by hand.

---

## Money

A woodworking business lives or dies on deposits, progress payments, and final balances actually being collected. Liminnality treats that as a first-class workflow rather than an export to a spreadsheet.

### Documents

**Estimates, contracts, and invoices** are separate numbered document types, each with its own per-tenant sequence counter so numbers never collide or repeat. An estimate carries line items, tax, discounts, and a grand total, and moves through a real lifecycle — draft, sent, approved, rejected, superseded, converted, archived. Approved estimates convert into contracts and invoices, and the derived documents stay linked back to the estimate that produced them, so a disputed invoice can be traced to the quote it came from. Invoices know what kind they are (deposit, final, full, or change order) and track a running balance due. PDFs are generated in the browser.

**Cover pages** are the packet that goes in the truck, not the numbered sales contract. From the job card, Liminnality asks for the QuickBooks estimate number and confirms customer details, then opens two US-letter pages in a print tab: a bordered cover (shop letterhead, terms from the job’s payment schedule, Zelle QR) and a California contract page with mechanics’-lien notice and a signature block. Print or Save as PDF from the browser — the same path as the bench and calendar sheets — so Windows and Firefox do not get a grey file. The action stays on the job header even when dollar amounts are hidden on a shared screen.

### Payment schedules

Rather than a single "amount owed", a job holds an ordered schedule of payment milestones — the standard 40/60 split, or anything custom. Each line can be a percentage or a fixed amount, knows whether it is a deposit, a milestone, or the final balance, and carries its own status and dates. The pipeline, the commission log, and the payment notification system all read from this one structure, so "what is owed on this job" has exactly one answer.

### Bank reconciliation

The tenant can link a real bank account through Plaid. Transactions and balances are cached server-side for the finance register, and **deposits are matched against job payment schedules**: a bank deposit can be linked to a specific milestone on a specific job, which optionally marks that milestone paid. The matching is recorded as its own record, so the link between "money arrived in the account" and "this job's deposit is satisfied" is auditable rather than remembered.

### Commissions

The commission log is a dense, purpose-built grid rather than a report. It shows every job's payment tiers side by side, groups payouts by the physical check or cash payment they were paid with, lets rows and payments be reordered by drag, and expands each check to show the individual payments inside it. Salesmen can see what they have earned and, more importantly, what they have not been paid yet.

### Also

- **Bills** — recurring company obligations (utilities, rent, insurance, software) with a due day of the month and a link to the payment portal
- **Payroll** — RFID timesheets first, then a Manual tab for the handwritten sheet. The pay week is configurable per person. Mileage 0.725/mi, PDF print, SMS share. Hours locked with Edit are not overwritten by a later RFID OUT.

---

## The shop floor

The parts of the business that happen away from a computer.

**RFID time clock.** A Raspberry Pi with an MFRC522 reader sits at the shop entrance running a small Python script that posts every badge scan to the API, authenticated with a device key and a tenant header rather than a user login. Each employee has a badge, and a four-digit kiosk PIN as a fallback for a lost or forgotten one. Scans stream into the app in real time.

**Text clock-in.** The same timesheet accepts a punch from a phone. On the RFID page, a mobile number is registered to an employee name. That person texts the shop Twilio line `in`, `out`, a period, or a blank message (a space counts). Anything else stays a normal customer text and is not a punch. The shop replies with the clock time. A second punch from the same number inside two minutes is ignored, so a webhook and the inbound poll cannot double-book the same text. The scan is stored like a badge read, with the source marked as SMS, and it rolls into the same Friday-to-Thursday timesheet.

**Timesheets.** Raw scans are compiled into weekly timesheets. The pay period is configurable per person. The week being paid is still editable — because readers get missed and people forget to clock out — then it locks after payday. An explicit Edit lock stays put when another RFID OUT arrives later. Each employee has shift defaults, a break allowance, and an hourly rate, and each week can carry extra hours, expense receipts, and travel mileage.

**Takeoff sheet.** A measurement tool built for the way takeoffs are actually written: room-by-room rows, fractional measurements, double-height rows (including the first line), autofill from the job, tab-completion for repeated values, local persistence so a half-finished sheet survives a closed tab, and PDF export. The completed sheet saves back onto the job as structured data.

**Vendors.** Suppliers and subcontractors with contact details and reusable order-item catalogues, so re-ordering the same stair parts does not mean re-typing part numbers.

---

## Interface and experience

The functionality above is only useful if people actually use it, and the people using it are a shop crew, not software operators. A large share of the work in this codebase is in making the interface disappear.

### The mobile experience

The mobile build is not a responsive afterthought — it is a deliberately reduced product. On a phone, **five pages exist**: Calendar, Pipeline, Customers, Commission Logs, and Website Analytics. Everything else is hidden from navigation *and* blocked at the router, with a single allowlist shared by the drawer and the route guard so the two can never drift apart. The phone's home page is the Calendar, not the dashboard, because the first question in a driveway is "where am I supposed to be?"

Each surviving page was then reshaped rather than shrunk:

| Page | On a phone |
|------|-----------|
| **Pipeline** | All twelve columns fit the screen at real font sizes, in narrow square panes with label-only headers, minimal gaps, and name-only cards. Totals, counts, search, the board picker, and the new-job button are all stripped. The board renders at native size — no CSS zoom, which collapses glyphs below roughly half scale |
| **Calendar** | Read-only. The bench and scheduled lists are gone. Day cells show coloured bars instead of unreadable text chips. Tapping a day opens the whole week's schedule with customer, installer, location, and a tap-to-call button. Swiping changes month. An "Upcoming jobs" list sits below the grid |
| **Customers** | Name, phone, and address only; tap a row for email, source, and notes |
| **Commission Logs** | Checks and cash first, numeric dates, payment tiers locked to one line, and the columns that only matter at a desk removed |

Smaller decisions throughout: dialogs go nearly full-bleed instead of floating in MUI's default margin, headings shrink, table gutters tighten, buttons lose their desktop padding, and the financial PIN gate is skipped entirely because a phone is already a personal device. The dark-mode toggle was moved out of the top bar — it sat beside the avatar where a thumb hits it by accident — and into the user menu with an explicit label.

### The dashboard

`/dashboard` is the office morning page: pipeline mix, recent payments, site traffic, team activity (pages, clicks, and sign-ins, with a day you can open), the upcoming work list, and the job map. Sensitive money series hide behind the same financial gates as the rest of the app. It is not in the five-page mobile set.

`/dashboard-view` is the shop-wall version of that page. It keeps team activity, pipeline mix, and the map, drops the payment ledger and the finance shortcuts, and sits in the same kiosk frame as the pipeline, calendar, and customers TVs. A `shop_view` login lands there. Voice “dashboard” follows whichever of the two you are already in.

### The job map on screen

Both dashboards embed the [Orange County job map](#the-job-map). On a phone the map is hidden; the wall and the office are where it is meant to be read.

### Design system

A single theme provider defines light and dark palettes, responsive typography that steps down at the mobile breakpoint, and component-level overrides: buttons that are not shouty all-caps, cards that lift on hover, a gradient app bar, and mobile-specific rules for dialogs and table cells. Mode is remembered per browser and defaults to light.

### Interaction details

- **Optimistic updates** on pipeline stage moves, with rollback on failure
- **Debounced realtime refetches**, and the self-echo suppression described [above](#real-time-updates)
- **Right-click context menus** on jobs, calendar events, and day headers, so power users get depth without the primary interface growing buttons
- **Tooltips** that explain what a stage means and what a status colour implies, rather than restating the label
- **Confirmation dialogs** on destructive and bulk actions — archiving, closing out, deleting schedule entries
- **Print stylesheets** on payroll, the dashboard day sheet, cover pages, the bench worksheet, and the two-month calendar, because those are documents that leave the screen
- **Empty states** written as guidance rather than "No data"
- **Kiosk mode** with a view switcher across dashboard, pipeline, calendar, and customers, a long-lived session so wall displays never log out, and a PIN to leave the display and get back to the office app
- **Accessibility** touches: `aria-label` on icon-only buttons, `title` on truncated text so a clipped job name is still readable on hover, and `role="img"` on the hand-rolled analytics chart
- **Deep links** throughout — `?jobId=`, `?customerId=`, `?tab=`, `?year=` on archive — so a page can be shared or bookmarked in the state you were looking at. Global search for an archived job opens that archive year and leaves the card closed.

### Sensitive data on shared screens

A board on a shop wall should not display what every job is worth to anyone walking past, and a shop-floor login should not reveal margins. Two independent gates handle this: a role-based filter that hides dollar amounts from shop-view users, and a session-scoped PIN lock that hides financial amounts across the pipeline, customers, calendar, and job modal until it is unlocked. Both are deliberately client-side deterrents for shoulder-surfing on shared hardware, not a substitute for the server-side role checks that protect the finance pages themselves.

---

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript, Material UI 7, React Router 7, Axios, Socket.IO client, Leaflet, date-fns, dnd-kit (sortable grids), jsPDF + html2canvas, pdf.js |
| Backend | Node.js, Express 5, Mongoose 9, JSON Web Tokens, Socket.IO |
| Database | MongoDB, multi-tenant |
| Files | AWS S3 in production, local disk in development, chosen automatically |
| Integrations | Twilio (SMS), Plaid (banking), Microsoft Graph (email), Google Calendar, OpenAI (summaries and Liminnality Help / Liminality), ElevenLabs (spoken replies, streamed), US Census and OpenStreetMap (job-site geocoding), Mapbox or Esri (map tiles) |

### Multi-tenancy

Tenant isolation is enforced at the data layer, not sprinkled across controllers. A Mongoose plugin applied to every model adds an indexed `tenantId`, sets it automatically on save, and **rewrites every query and aggregation** to filter by the tenant in the current request's async-local context. Authentication middleware establishes that context before a route handler runs. A controller cannot accidentally leak another tenant's data by forgetting a filter, because the filter is not the controller's job. The few places that legitimately need to read across tenants — loading the user during login, for instance — opt out explicitly.

Each tenant carries its own branding, estimate document header, pipeline stage overrides, SMS templates, notification recipients, and integration credentials, so the platform genuinely supports more than one business rather than being one business's app with a tenant column bolted on.

### Request lifecycle

```
Browser
  │  Authorization: Bearer <jwt>
  │  x-tenant-id: <tenant>
  │  x-socket-id: <this tab's socket>
  ▼
Express  →  tenant resolution  →  requireAuth (verify JWT, load user)
                                    │
                                    ▼
                          runWithTenantContext()
                                    │
                    ┌───────────────┼───────────────┐
                    ▼               ▼               ▼
               controller      Mongoose        eventBus
                               (auto-scoped)   emits to tenant room
                                                    │
                                                    ▼
                                            every other open tab
```

---

## Security and access control

Access tokens are time-limited JWTs — 24 hours by default — paired with longer-lived refresh tokens; kiosk sessions get a deliberately extended lifetime so wall displays survive restarts. Passwords are bcrypt-hashed, and the user serialiser strips the hash before anything leaves the server.

Eight roles exist:

| Role | Intended for |
|------|-------------|
| `super_admin` | Owner — finance, users, website, bank links, analytics |
| `admin` | Office manager — everything operational, plus the team inbox |
| `manager`, `sales` | Day-to-day operations; may link banking |
| `installer`, `employee` | Field and shop staff |
| `shop_view` | Wall displays and shop terminals; dollar amounts hidden |
| `read_only` | Observers |

Super-admin-only areas are guarded on both sides: the router refuses to render them and the API refuses to serve them. Finance, user administration, bills, the website CMS, analytics, and the developer backlog all sit behind that gate. Twilio configuration and inbound backfill are admin-or-above. Bank linking is restricted to a named set of roles.

Every authenticated session also writes an audit trail — logins, logouts, page views, and clicks, with IP-derived location — queryable by super admins.

> **Note on PINs.** The two PIN gates described earlier protect against someone reading a shared screen. They are client-side by design and are not an authorisation boundary; the server-side role checks are.

---

## Repository layout

```
Liminnality/
├── frontend/                 React SPA
│   └── src/
│       ├── pages/            34 route-level pages
│       ├── components/       pipeline/, jobs/, finance/, dashboard/, layout/, common/, …
│       ├── context/          auth, theme, financial PIN lock
│       ├── hooks/            useIsMobile, useSocketSubscription, PIN gates, Liminality voice
│       ├── voice/            wake word, command table, streamed ElevenLabs playback, map and job-card buses
│       ├── services/         socket client
│       └── utils/            axios, payment schedules, SMS templates, mobile nav, customer share texts
├── backend/                  Express API
│   └── src/
│       ├── models/           32 Mongoose models + tenant-scope plugin
│       ├── controllers/      request handlers
│       ├── routes/           27 route modules
│       ├── services/         socket server, event bus, Plaid, Outlook, deposits, geocoding, assistant tools
│       ├── middleware/       auth, tenant resolution, uploads, RFID device auth
│       └── scripts/          tenant cloning, seeding, backfills, job-address geocode
├── scripts/
│   └── raspberry-pi/         RFID reader → API
├── docs/                     Developer documentation
└── documents/                Deployment and integration notes
```

---

## Getting started

### Prerequisites

Node.js 20.19 or newer (required by Mongoose 9), and a MongoDB instance (local or Atlas).

### Run it

```bash
# API
cd backend && npm install && npm run dev      # http://localhost:4000

# Frontend, in a second terminal
cd frontend && npm install && npm run dev     # http://localhost:5173
```

Create the first login:

```bash
cd backend && npm run create-super-admin
```

### Configuration

`frontend/.env`:

```bash
VITE_API_URL=http://localhost:4000
```

`backend/.env` — required:

```bash
MONGODB_URI=mongodb://localhost:27017/paarth
JWT_SECRET=...
JWT_REFRESH_SECRET=...
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
PORT=4000
```

Everything below is optional; each integration degrades gracefully when its variables are absent, and `GET /health` reports which ones are live.

| Integration | Variables |
|-------------|-----------|
| Twilio SMS | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `PUBLIC_API_BASE_URL` |
| File storage | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME`, `AWS_REGION` — falls back to local `uploads/` |
| Plaid | `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL` |
| Microsoft Graph | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` |
| Google Calendar | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_REFRESH_TOKEN` |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` — Liminnality Help, Liminality answers, job summaries |
| ElevenLabs | `ELEVENLABS_API_KEY` on the **API** host (not the frontend). Optional `ELEVENLABS_TTS_MODEL` (default `eleven_flash_v2_5`). Voice replies stream from `POST /tts/speech-stream` |
| Job map | `VITE_MAPBOX_ACCESS_TOKEN` on the **frontend**. Without it the map uses Esri satellite imagery. Geocoding needs no key |
| RFID devices | `RFID_DEVICE_API_KEY`, `RFID_SHOP_TIMEZONE` |
| Email (EmailJS) | `EMAILJS_PUBLIC_KEY`, `EMAILJS_PRIVATE_KEY`, `EMAILJS_SERVICE_ID`, `EMAILJS_TEMPLATE_ID` |

For `PUBLIC_API_BASE_URL`, point Twilio's inbound webhook at `<that base>/twilio/sms` with HTTP POST.

### Checks

```bash
cd frontend && npm run build        # production bundle
cd frontend && npm run typecheck    # tsc, no emit
cd frontend && npm run lint
cd frontend && npm run test         # vitest
cd backend  && npm test             # node:test
cd backend  && npm run typecheck
```

---

## Background jobs

Started by the API process once MongoDB connects — no separate worker to deploy:

| Job | Schedule | Purpose |
|-----|----------|---------|
| SMS scheduler | Every minute | Send due scheduled messages, refresh delivery statuses |
| Inbound SMS poll | Every 10 seconds | Pull recent inbound texts Twilio’s webhook may have missed, and record text clock-ins |
| Outlook inbox sync | 90s after boot, then every 15 minutes | Pull worksheet emails into the team inbox |
| Plaid refresh | Daily, Pacific time | Re-sync bank transactions and balances |

---

## Known gaps and roadmap

Documented honestly, because knowing where the edges are is part of running the thing:

- **Touch drag on the pipeline.** The board uses native HTML5 drag and drop, which does not fire on touch devices. The mobile board is intentionally read-only as a result; moving a job on a phone needs a pointer-event or dnd-kit implementation.
- **Recurring installs.** Jobs carry a recurrence field and the API preserves it, but there is no interface to configure a repeating schedule.
- **Dragging onto a calendar day.** Scheduling is done by clicking a day and filling the dialog; the day cells themselves are not drop targets.
- **`read_only` role.** The API rejects creates, updates, and deletes for that role. Logout, the activity audit ping, and voice speech requests still go through. The office screens are not separately locked in the browser, so a read-only user who tampers with the page still cannot save.
- **Loading states** are spinners throughout; skeleton placeholders would make the heavier grids feel faster.
- **Liminality voice** is Chrome/Edge on desktop only. Safari and phones have no wake listening. Spoken answers need ElevenLabs configured on the API. Speech-to-text is still the browser’s, so shop names sometimes need a second try.

---

## Further documentation

| Document | Contents |
|----------|----------|
| [SECURITY.md](SECURITY.md) | How to report a vulnerability |
| [docs/CODEBASE.md](docs/CODEBASE.md) | Architecture, authentication, tenancy, conventions |
| [liminalVoice.md](liminalVoice.md) | How Liminality voice is wired: wake, tools, streamed speech |
| [docs/PAGES.md](docs/PAGES.md) | Page-by-page reference: routes, APIs, key logic |
| [docs/BACKEND.md](docs/BACKEND.md) | REST routes and controllers |
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | Shared UI building blocks |
| [docs/plaid.md](docs/plaid.md) | Banking integration notes |
| [docs/CLEANUP.md](docs/CLEANUP.md) | Removed code and redirect map |
| [database.md](database.md) | Schema reference |
| [backend/S3_SETUP.md](backend/S3_SETUP.md) | File storage setup |

`frontend/src/App.tsx` is the authoritative source for routes and access guards; where a document disagrees, trust the router.

---

## Related

**Liminnality Lite** — a separate desktop product on SQLite. See `local-crm/Liminnality.md`. It is not part of this deployment and the two should not be mixed.
