# MongoDB — sharing Paarth's database from .NET / Blazor

This doc explains how to connect a **new C# / Blazor** version of Paarth to the **same MongoDB** the Node.js app already uses — env vars, collection names, tenant rules, and pitfalls.

For full API porting see `documents/Csharp.md`. For schema relationships see `documents/mongodb-schema.md`.

---

## Short answer: yes, you need a connection string env var

The Node backend uses **one** environment variable:

| Node (Paarth today) | .NET / Blazor (your app) |
|---------------------|---------------------------|
| `MONGODB_URI` | `ConnectionStrings:MongoDB` (recommended) **or** env var `MONGODB_URI` |

The **database name is inside the URI**, not a separate variable.

```env
# Local
MONGODB_URI=mongodb://localhost:27017/paarth

# MongoDB Atlas (production)
MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster.mongodb.net/paarth?retryWrites=true&w=majority
```

Use the **exact same URI** (same cluster, same database name `paarth`) only when two apps must read and write the same live data.

Local development should use its own database, such as `mongodb://localhost:27017/liminnality-dev`, loaded with synthetic records or a clone that was anonymized. Do not point a laptop, a test script, or a second API at the production connection string.

---

## What “reuse the database” means

```
┌─────────────────────┐     ┌─────────────────────┐
│  Paarth Node API    │     │  Paarth .NET API    │
│  (Express/Mongoose) │     │  (ASP.NET + Driver) │
└─────────┬───────────┘     └─────────┬───────────┘
          │                           │
          └───────────┬───────────────┘
                      ▼
              MongoDB (database: paarth)
              collections: jobs, customers, users, …
```

Both apps talk to the **same collections**. Documents are BSON with MongoDB `ObjectId` `_id` fields and **camelCase** property names (`customerId`, `paymentSchedule`, `tenantId`, etc.).

**Blazor UI** does not connect to MongoDB directly in the normal pattern — your **ASP.NET Core API** (or Blazor Server host) holds the connection; Blazor calls HTTP endpoints.

---

## .NET configuration

### `appsettings.Development.json`

```json
{
  "ConnectionStrings": {
    "MongoDB": "mongodb://localhost:27017/paarth"
  },
  "Jwt": {
    "Secret": "same-as-node-JWT_SECRET-if-sharing-login-tokens",
    "RefreshSecret": "same-as-node-JWT_REFRESH_SECRET"
  }
}
```

### User secrets (local dev — do not commit)

```bash
dotnet user-secrets set "ConnectionStrings:MongoDB" "mongodb+srv://..."
dotnet user-secrets set "Jwt:Secret" "your-existing-secret"
```

### Production / hosting

Set environment variables on the host (Azure, Render, Docker, etc.):

| Variable | Purpose |
|----------|---------|
| `ConnectionStrings__MongoDB` | Mongo connection (double underscore in env) |
| `ASPNETCORE_ENVIRONMENT` | `Production` |
| `Jwt__Secret` | Only if sharing auth with Node during dual-run |

Copy values from the Node app's `backend/.env` — especially `MONGODB_URI` and `JWT_SECRET`.

---

## Register MongoDB in `Program.cs`

```csharp
using MongoDB.Driver;

var mongoConnection = builder.Configuration.GetConnectionString("MongoDB")
    ?? Environment.GetEnvironmentVariable("MONGODB_URI")
    ?? throw new InvalidOperationException("MongoDB connection string is required.");

builder.Services.AddSingleton<IMongoClient>(_ => new MongoClient(mongoConnection));

builder.Services.AddScoped(sp =>
{
    var client = sp.GetRequiredService<IMongoClient>();
    // Database name is taken from the connection string (/paarth)
    var databaseName = MongoUrl.Create(mongoConnection).DatabaseName ?? "paarth";
    return client.GetDatabase(databaseName);
});
```

**Health check** (mirror Node `GET /health`):

```csharp
app.MapGet("/health", async (IMongoDatabase db) =>
{
    await db.RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1));
    return Results.Ok(new { mongo = "ok" });
});
```

Node connection options today (`backend/src/server.js`):

- `serverSelectionTimeoutMS: 5000`
- `socketTimeoutMS: 45000`

You can set equivalent `MongoClientSettings` if Atlas is slow to respond.

---

## Collections (Mongoose → MongoDB.Driver)

Mongoose uses **lowercase plural** collection names by default. No custom `collection:` overrides in Paarth models.

| C# entity (suggested) | Mongoose model | Collection name |
|----------------------|----------------|-----------------|
| `Job` | `Job` | `jobs` |
| `Customer` | `Customer` | `customers` |
| `User` | `User` | `users` |
| `Tenant` | `Tenant` | `tenants` |
| `Task` | `Task` | `tasks` |
| `Appointment` | `Appointment` | `appointments` |
| `Activity` | `Activity` | `activities` |
| `FileRecord` | `File` | `files` |
| `DocumentFolder` | `DocumentFolder` | `documentfolders` |
| `Estimate` | `Estimate` | `estimates` |
| `Invoice` | `Invoice` | `invoices` |
| `Contract` | `Contract` | `contracts` |
| `Bill` | `Bill` | `bills` |
| `PipelineLayout` | `PipelineLayout` | `pipelinelayouts` |
| `SmsMessage` | `SmsMessage` | `smsmessages` |
| `ScheduledSms` | `ScheduledSms` | `scheduledsmses` |
| `EmployeeContact` | `EmployeeContact` | `employeecontacts` |
| `DocumentSequence` | `DocumentSequence` | `documentsequences` |
| `PlaidRegisterCache` | `PlaidRegisterCache` | `plaidregistercaches` |
| `RfidTag` | `RfidTag` | `rfidtags` |
| `RfidScan` | `RfidScan` | `rfidscans` |
| `DeveloperTask` | `DeveloperTask` | `developertasks` |

Access in C#:

```csharp
var jobs = database.GetCollection<JobDocument>("jobs");
```

Verify names once against Atlas/Compass if unsure — `db.getCollectionNames()`.

---

## C# document mapping essentials

### ObjectIds

MongoDB stores `_id` as `ObjectId`. In C# use `MongoDB.Bson.ObjectId` or `string` with serializers.

```csharp
using MongoDB.Bson;
using MongoDB.Bson.Serialization.Attributes;

public class JobDocument
{
    [BsonId]
    [BsonRepresentation(BsonType.ObjectId)]
    public string Id { get; set; } = "";

    [BsonRepresentation(BsonType.ObjectId)]
    public string CustomerId { get; set; } = "";

    [BsonRepresentation(BsonType.ObjectId)]
    public string? TenantId { get; set; }

    public string Title { get; set; } = "";
    public string Stage { get; set; } = "";
    // … match Node field names exactly (camelCase)
}
```

Register a **camelCase convention** so C# `CustomerId` maps to BSON `customerId`:

```csharp
using MongoDB.Bson.Serialization.Conventions;

var conventionPack = new ConventionPack
{
    new CamelCaseElementNameConvention(),
    new IgnoreExtraElementsConvention(true)  // important: Node adds fields over time
};
ConventionRegistry.Register("paarth", conventionPack, _ => true);
```

`IgnoreExtraElementsConvention` prevents deserialization failures when Paarth Node has fields your C# model does not yet define.

### Mixed / flexible fields

Several fields are schemaless `Mixed` in Mongoose:

- `Job.commissionLog`
- `Tenant.pipelineStageOverrides`
- `Job.takeoff.sheetData`
- Plaid cache `accounts` / `transactions` arrays

Model these as `BsonDocument`, `JsonElement`, or `Dictionary<string, object>` in C#.

### Timestamps

Mongoose `{ timestamps: true }` adds `createdAt` and `updatedAt` as BSON dates. Map as `DateTime` (UTC).

### Embedded arrays

Common embedded structures (not separate collections):

- `Job.notes[]`, `Job.paymentSchedule.items[]`, `Job.changeOrders[]`, `Job.schedule.entries[]`
- `Job.invoices[]`

Read `backend/src/models/Job.js` and siblings for the authoritative shape.

---

## Tenant isolation — highest risk when sharing DB

Paarth is **multi-tenant**. Most collections have a `tenantId` field (ObjectId → `tenants`).

Node applies filtering automatically via `tenantScopePlugin` (`backend/src/models/plugins/tenantScopePlugin.js`):

- Every `find` / `update` / `delete` gets `{ tenantId: <current> }` unless bypassed
- `save` auto-fills `tenantId` from request context

**Your .NET app must replicate this.** If you query `jobs` without `tenantId`, you will leak or corrupt another org's data.

### How tenant is resolved today

1. Request header `x-tenant-id` (24-char ObjectId) — validated against `tenants`
2. Else header `x-tenant-slug` or body `tenantSlug` → `ensureTenantBySlug` (defaults to `default`)
3. After `requireAuth`, tenant is taken from **`req.user.tenantId`** (overrides header for scoped routes)

Blazor/client should send the same headers the React app sends (`frontend/src/utils/axios.ts`):

```
Authorization: Bearer <jwt>
x-tenant-id: <tenant ObjectId>
```

### .NET middleware pattern

```csharp
// TenantContextMiddleware — store TenantId on HttpContext
public class TenantContext
{
    public string? TenantId { get; set; }
    public bool BypassTenant { get; set; }
}

// In every repository query:
var filter = Builders<JobDocument>.Filter.Eq(j => j.TenantId, tenantContext.TenantId);
```

### Routes that bypass tenant in Node (your app must too)

| Path prefix | Why |
|-------------|-----|
| `/auth` | Login finds user across tenants with `bypassTenant` |
| `/health`, `/` | No DB tenant scope |
| `/twilio` | Webhooks |
| `/tenants/branding` | Public logos |
| `/developer-tasks` | Global dev list (no `tenantId` on model) |
| `/uploads` | Static files |

Auth loads user with bypass, then sets tenant from user:

```30:43:backend/src/middleware/auth.js
    const user = await User.findById(decoded.userId).setOptions({ bypassTenant: true });
    ...
    runWithTenantContext(
      {
        tenantId: user.tenantId ? String(user.tenantId) : null,
        bypassTenant: false,
      },
      () => next()
    );
```

### Models **without** `tenantScopePlugin`

| Model | Notes |
|-------|-------|
| `Tenant` | Top-level org record |
| `DeveloperTask` | No `tenantId`; shared dev backlog |
| `PlaidRegisterCache` | Has explicit `tenantId` field + unique index; filter manually |

All other business models in `backend/src/models/` use the plugin.

---

## Auth & passwords (if sharing users collection)

Users live in `users` with **bcrypt** hashes (`bcryptjs`, cost 10 in Node).

| Concern | Requirement |
|---------|-------------|
| Password verify | Use `BCrypt.Net-Next` — compatible with Node `bcryptjs` |
| JWT | Same `JWT_SECRET` if both APIs should accept the same tokens during migration |
| JWT payload | `{ userId: "<ObjectId>" }` only — no tenant in token |
| Active users | Respect `isActive` and `isPending` like `authController.login` |

If you use **different** JWT secrets, users must log in separately to each app (same password, different token).

---

## Running Node and .NET against the same DB

### Safe during migration

- **Read** jobs, customers, users with correct `tenantId` filter
- **Write** fields using the **same BSON shape** Node expects
- Add new optional fields (Node `IgnoreExtraElements` equivalent on your side too)

### Risky / avoid until intentional

- Renaming fields or collections
- Changing `_id` types
- Stripping `tenantId` on insert
- Different enum strings for `stage`, `role`, payment `status`, etc.
- Running destructive migrations while production Node is live
- Two apps **both** running background jobs (Plaid refresh, SMS scheduler) — duplicate work

### Recommended dev setup

| Environment | Connection string |
|-------------|-------------------|
| Local .NET dev | Copy prod URI → **or** `mongodb://localhost:27017/paarth-dev` (imported snapshot) |
| Staging .NET | Same Atlas cluster, optional separate DB name `paarth-staging` |
| Production cutover | **Same** `paarth` database as Node |

To clone one tenant for testing, use Node script `backend/src/scripts/cloneTenant.js` (needs `MONGODB_URI`).

---

## Blazor-specific notes

### Blazor WebAssembly + API

- WASM runs in the browser — **no direct MongoDB connection**
- Store API base URL in `wwwroot/appsettings.json` or env at publish time (like `VITE_API_URL`)
- API project holds `ConnectionStrings:MongoDB`

### Blazor Server

- Can host API controllers in the same process
- Still use `IMongoClient` singleton + scoped `IMongoDatabase`
- Do not put connection strings in client-visible config

### What to send from Blazor on each API call

Mirror the React axios client:

| Header | Value |
|--------|-------|
| `Authorization` | `Bearer {accessToken}` |
| `x-tenant-id` | Tenant ObjectId from logged-in user |
| `Content-Type` | `application/json` |

---

## Other env vars (not Mongo, but needed for full parity)

Mongo is the minimum. For a complete Paarth replacement you'll also need (from `backend/.env` / `documents/Csharp.md`):

| Variable | When needed |
|----------|-------------|
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Login |
| `AWS_*` | File uploads (S3) — `files` collection stores `s3Key` / `path` |
| `CORS_ORIGINS` | Blazor origin |
| `TWILIO_*`, `PLAID_*`, `GOOGLE_*`, `OPENAI_API_KEY` | Integrations |

Files in Mongo are **metadata only**; binary lives on disk (`/uploads`) or S3. Reusing DB without S3/local files means broken downloads.

---

## Quick verification checklist

After wiring MongoDB in .NET:

1. **Ping** — `db.runCommand({ ping: 1 })` via `/health`
2. **List tenants** — `db.tenants.find()` (bypass filter; admin only)
3. **Read one job** — `jobs.findOne({ tenantId: ObjectId("...") })` with known id from Compass
4. **Login** — same email/password as React app; confirm `users` document matches
5. **Tenant leak test** — user A must never see user B's `jobs` when `tenantId` differs
6. **Write round-trip** — PATCH a harmless field from .NET; confirm React app shows the change

---

## Key files in Paarth (Node reference)

| Topic | Path |
|-------|------|
| Connection | `backend/src/server.js` (`mongoose.connect(process.env.MONGODB_URI)`) |
| Tenant plugin | `backend/src/models/plugins/tenantScopePlugin.js` |
| Tenant middleware | `backend/src/server.js`, `backend/src/middleware/tenantContext.js` |
| Auth + tenant | `backend/src/middleware/auth.js` |
| All schemas | `backend/src/models/*.js` |
| Schema overview | `documents/mongodb-schema.md` |
| .NET port plan | `documents/Csharp.md` |
| Env template | `documents/Software.md` (Configuration section) |

---

## Purposeful rules for agents

1. **Same URI = same data** — `MONGODB_URI` / `ConnectionStrings:MongoDB` is the only DB switch. Development uses a separate URI from production.
2. **Database name is `paarth`** in standard installs (last path segment of URI).
3. **Always filter by `tenantId`** on tenant-scoped collections — no plugin in .NET means you enforce it manually.
4. **Keep camelCase BSON keys** — match Node JSON exactly for interoperability.
5. **Use `IgnoreExtraElements`** — Node schema evolves; .NET models should not break on new fields.
6. **ObjectIds are strings in API JSON** — 24 hex chars; store as `ObjectId` in BSON.
7. **Blazor does not connect to Mongo** — only the .NET API does.
8. **Do not run two production APIs writing the same data** without coordination — prefer read-only Node during early .NET testing, or separate database for experiments.

When in doubt, read the Mongoose model in `backend/src/models/` before defining a C# document class.
