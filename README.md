# PayPilot HRMS & Payroll SaaS

A multi-tenant Human Resource Management System (HRMS) and Payroll platform foundation built with React, Express, TypeScript, Tailwind CSS, Prisma, self-managed PostgreSQL, and Keycloak OpenID Connect.

---

## 1. Project Overview

**PayPilot** provides growing and enterprise organizations with a unified interface for workforce administration:

- **Workforce & Department Directory:** Centralized employee records, job profiles, and structural hierarchy.
- **Attendance & Time Logs:** Daily check-in tracking, on-site vs. remote workforce indicators, and shift durations.
- **Leave Request Management:** Time-off workflows with manager reviews and category balances.
- **Payroll Cycles & Payslips:** Batch period runs, gross-to-net salary reconciliations, and payslip distribution.
- **Multi-Tenant Foundation:** Database-enforced tenant isolation plus role-based access levels (`SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`).

> **Current phase:** Supabase has been replaced with independently managed PostgreSQL and Keycloak. Authentication uses Authorization Code + PKCE S256, the API verifies Keycloak JWTs through JWKS, and PostgreSQL RLS isolates tenants using transaction-local context. The employee directory is backed by live database records with a validated API and audit logging. Payroll registers can now be imported and validated into dedicated import tables; attendance, leave, and finalized payroll remain demo views.

---

## 2. Technology Stack

| Layer | Technologies |
|---|---|
| **Frontend** | React 18, Vite, TypeScript, Tailwind CSS, React Router 6, Lucide React, Recharts, `keycloak-js` |
| **Backend** | Node.js, Express, TypeScript, Zod, `jose`, `dotenv` |
| **Database & ORM** | Self-managed PostgreSQL 16, Prisma ORM 5.x, native Row-Level Security |
| **Identity provider** | Keycloak 26.2.5 (Authorization Code + PKCE S256, JWKS) |
| **Local infrastructure** | Docker Compose (PostgreSQL + Keycloak) |
| **Workspace & Tooling** | `npm` Workspaces, TypeScript (strict mode) |

---

## 3. Repository Architecture

```text
paypilot/
├── apps/
│   ├── web/                          # Frontend React SPA
│   │   ├── public/silent-check-sso.html
│   │   └── src/
│   │       ├── app/                  # App entry & React Router setup
│   │       ├── components/           # Layout, auth guard, UI primitives
│   │       ├── contexts/             # AuthContext (Keycloak session in memory)
│   │       ├── pages/                # Navigable views
│   │       ├── lib/                  # keycloak.ts, api.ts, utilities
│   │       └── main.tsx
│   │
│   └── api/                          # Backend Express Service
│       └── src/
│           ├── config/               # Zod-validated environment config
│           ├── lib/                  # Prisma singleton, tenant context, logger
│           ├── middleware/           # Keycloak JWT verification, errors, logging
│           ├── routes/               # API router & health endpoints
│           ├── types/                # Authenticated request/auth context types
│           └── server.ts             # Express bootstrap & graceful shutdown
│
├── prisma/
│   ├── schema.prisma                 # Canonical schema (provider-neutral identity)
│   └── migrations/                   # Active forward-only migrations
├── prisma/migrations-legacy-supabase/# Archived Supabase-era history (not applied)
├── docker/
│   ├── postgres/init/01-init.sh      # Roles, databases, default privileges
│   └── keycloak/realm/               # Realm/client/audience import
├── scripts/provision-dev-user.ts     # Controlled Keycloak + PayPilot provisioning
├── docs/
│   ├── architecture.md
│   ├── authentication.md
│   └── RLS-IMPLEMENTATION.md
├── docker-compose.yml
├── .env.example
└── package.json
```

---

## 4. Prerequisites

- **Node.js:** v18 or later (tested on Node.js v24)
- **npm:** v9 or later
- **Docker:** with either the `docker compose` plugin or the standalone `docker-compose` command
- **Ports:** `5433` (PostgreSQL) and `8080` (Keycloak) by default

Port `5433` is the default host port so the stack does not collide with a local PostgreSQL listening on `5432`. Change `POSTGRES_PORT` if needed.

---

## 5. Installation & Setup

### 5.1 Install dependencies

```bash
npm install
```

### 5.2 Configure environment

```bash
cp .env.example .env
```

Replace every `change-me` value in `.env` with a strong, unique secret. The file is gitignored. At minimum these must be set:

- `POSTGRES_ADMIN_PASSWORD`
- `PAYPILOT_MIGRATOR_PASSWORD`
- `PAYPILOT_APP_PASSWORD`
- `KEYCLOAK_DB_PASSWORD`
- `KEYCLOAK_ADMIN_PASSWORD`
- `KEYCLOAK_DEV_USER_PASSWORD`

Connection strings in `.env` must embed the same role credentials:

```ini
# Runtime: least-privileged role used by the API (no BYPASSRLS, does not own tables)
DATABASE_URL="postgresql://paypilot_app:<app-password>@localhost:5433/paypilot?schema=public"

# Migrations and controlled provisioning only
DIRECT_URL="postgresql://paypilot_migrator:<migrator-password>@localhost:5433/paypilot?schema=public"
```

### 5.3 Start PostgreSQL and Keycloak

```bash
npm run infra:up
# equivalent: docker-compose up -d
```

Wait until both containers are healthy:

```bash
docker ps --filter name=paypilot
```

The PostgreSQL init script creates:

- database `paypilot`, owned by `paypilot_migrator`
- database `keycloak`, owned by the `keycloak` role
- runtime role `paypilot_app` with connection and DML privileges only
- no shared database credentials between PayPilot and Keycloak

### 5.4 Apply migrations and generate Prisma Client

```bash
npm run prisma:generate
npm run db:migrate
npm run db:status
```

`db:migrate` runs `prisma migrate deploy` against `DIRECT_URL`. Do not use `prisma db push`; the RLS policies and grants are part of the migration history.

### 5.5 Provision a development user

The provisioning script creates the Keycloak user when needed, then links that **exact Keycloak subject** to a PayPilot user. It never links accounts by email during authentication.

```bash
npm run provision:user -- \
  --email admin@paypilot.local \
  --org-name "PayPilot Demo" \
  --role ADMIN
```

The password for the created Keycloak user is `KEYCLOAK_DEV_USER_PASSWORD` from `.env`.

### 5.6 Seed demo departments

Seed the six demo departments (idempotent, requires the demo organization):

```bash
npm run seed:dev
```

Override the organization with `SEED_ORGANIZATION_SLUG`. The script never creates employees or organizations.

### 5.7 Run the applications

```bash
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:4000
- Keycloak: http://localhost:8080

Or run them separately:

```bash
npm run dev:web
npm run dev:api
```

Sign in at http://localhost:5173/login with the provisioned email and development password.

---

## 6. Environment Variables

| Variable | Purpose |
|---|---|
| `POSTGRES_PORT`, `POSTGRES_ADMIN_USER`, `POSTGRES_ADMIN_PASSWORD` | PostgreSQL container and bootstrap admin |
| `PAYPILOT_DB_NAME`, `PAYPILOT_MIGRATOR_USER`, `PAYPILOT_MIGRATOR_PASSWORD` | PayPilot database and table-owning migration role |
| `PAYPILOT_APP_USER`, `PAYPILOT_APP_PASSWORD` | Least-privileged runtime role |
| `KEYCLOAK_DB_NAME`, `KEYCLOAK_DB_USER`, `KEYCLOAK_DB_PASSWORD` | Separate Keycloak database credentials |
| `KEYCLOAK_PORT`, `KEYCLOAK_ADMIN_USER`, `KEYCLOAK_ADMIN_PASSWORD` | Keycloak bootstrap admin |
| `PORT`, `CORS_ORIGIN`, `NODE_ENV` | API runtime settings |
| `DATABASE_URL`, `DIRECT_URL` | Runtime and migration connection strings |
| `PAYROLL_IMPORT_STORAGE_DIR` | Optional private directory for raw payroll registers; defaults to `<repo>/var/payroll-imports` |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` | Keycloak server and public client |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_AUDIENCE` | Exact JWT issuer and API audience |
| `KEYCLOAK_JWKS_URI` | Optional JWKS override; defaults to issuer `/protocol/openid-connect/certs` |
| `KEYCLOAK_DEV_USER_PASSWORD` | Development-only password used by provisioning |
| `VITE_API_URL`, `VITE_KEYCLOAK_URL`, `VITE_KEYCLOAK_REALM`, `VITE_KEYCLOAK_CLIENT_ID` | Frontend build-time configuration |
| `HOST` | API listen interface; `0.0.0.0` is required for Docker-hosted Prometheus |
| `METRICS_TOKEN_FILE` | Path to the `/metrics` bearer token; relative paths resolve from the repo root |
| `HOST_GID` | Host group id that owns the metrics token; Prometheus joins this group via `group_add` to read the Compose secret |
| `PROMETHEUS_PORT`, `GRAFANA_PORT` | Localhost-bound Prometheus and Grafana ports |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD` | Grafana admin login |

---

## 7. Authentication Flow

1. The SPA calls `keycloak.login()` with Authorization Code flow and PKCE S256.
2. Keycloak redirects back to `http://localhost:5173/` with an authorization code.
3. `keycloak-js` exchanges the code and keeps the access token in memory.
4. The SPA calls `GET /api/auth/me` with `Authorization: Bearer <token>`.
5. The API verifies signature, `RS256`, issuer, `paypilot-api` audience, `exp`, and `nbf` against the realm JWKS.
6. The API resolves the exact `(issuer, subject)` pair with `public.paypilot_resolve_identity(text, text)`.
7. The API loads the user and organization inside a tenant-scoped transaction and updates `lastLoginAt`.
8. Invalid, expired, tampered, or unprovisioned identities receive `401`. Inactive users receive `403`.

Tokens are never written to `localStorage` or `sessionStorage`. The realm disables implicit and hybrid flows, and the public client has restricted redirect URIs and web origins. See [docs/authentication.md](./docs/authentication.md).

---

## 8. Database & RLS Operations

```bash
npm run prisma:validate     # validate schema
npm run prisma:generate     # generate Prisma Client
npm run db:migrate          # apply forward-only migrations via DIRECT_URL
npm run db:status           # show migration status
npm run purge:payroll-imports  # remove raw import files past 90-day retention
```

Key security properties:

- The API connects as `paypilot_app`, which is not a table owner, is not a superuser, and does **not** have `BYPASSRLS`.
- RLS is enabled and forced on all tenant-owned tables.
- `withOrganizationContext()` sets `app.current_organization_id` transaction-locally in the same Prisma interactive transaction as the query.
- Missing or invalid tenant context returns no rows and rejects writes.
- The migration role cannot be assumed by the runtime role.
- Audit logs are append-only for the runtime role.

See [docs/RLS-IMPLEMENTATION.md](./docs/RLS-IMPLEMENTATION.md).

### Migration history note

The active history begins at `20261014000000_baseline_schema`. Supabase-era migrations are retained under `prisma/migrations-legacy-supabase/` for historical reference but are not executed against native PostgreSQL. Existing databases that already applied those migrations should mark the baseline as applied once and then deploy the forward migrations:

```bash
npx prisma migrate resolve --applied 20261014000000_baseline_schema
npm run db:migrate
```

---

## 9. Verification Commands

```bash
npm run prisma:validate
npm run typecheck
npm run build
npm test

# Requires the Docker stack and DIRECT_URL.
# Runs the real-PostgreSQL RLS and identity-resolution suites.
npm run test:integration
```

`RUN_DB_INTEGRATION=1` gates database integration tests. Without it, those suites are skipped while unit tests still run.

---

## 10. Observability

Prometheus and Grafana run in the local Docker Compose stack. The API runs on the host and exposes a token-protected `GET /metrics` endpoint.

```text
Host API (HOST=0.0.0.0, PORT=4000)
  GET /metrics  ->  Bearer token required
        ^
        | host.docker.internal:4000
Prometheus (127.0.0.1:9090) -> 15s scrape, 15d retention
Grafana    (127.0.0.1:3000) -> provisioned datasource + two dashboards
```

### 10.1 Generate the metrics token

```bash
mkdir -p .secrets
chmod 700 .secrets
printf '%s' "$(openssl rand -hex 32)" > .secrets/paypilot_metrics_token
chmod 640 .secrets/paypilot_metrics_token
```

`.secrets/` is git-ignored. The API reads the token from `METRICS_TOKEN_FILE`; Prometheus reads the same file through a Compose secret at `/run/secrets/paypilot_metrics_token`. Set `HOST_GID` in `.env` to the token file's group (`stat -c '%g' .secrets/paypilot_metrics_token`) so Prometheus can read it without the token being world-readable. Rotating the token requires restarting the API; Prometheus picks up the new file on its next scrape.

### 10.2 Start the stack

Add `GRAFANA_ADMIN_PASSWORD` to `.env` if it is missing, then:

```bash
docker-compose up -d prometheus grafana
```

- Prometheus: <http://localhost:9090> (targets at `/targets`, alerts at `/alerts`)
- Grafana: <http://localhost:3000> (login with `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD`)

Both ports bind to `127.0.0.1`. Grafana anonymous access and sign-up are disabled.

### 10.3 Verify `/metrics`

```bash
curl -i http://localhost:4000/metrics
# HTTP/1.1 401 Unauthorized
# WWW-Authenticate: Bearer

curl -s -H "Authorization: Bearer $(cat .secrets/paypilot_metrics_token)" \
  http://localhost:4000/metrics | head
# HTTP/1.1 200 OK
```

`/metrics` is not proxied by Vite and never emits CORS headers.

### 10.4 Firewall requirement

Because `host.docker.internal` cannot reach a loopback-only listener, the API binds `0.0.0.0`. Restrict port 4000 to loopback and the Docker bridge subnet:

```bash
sudo iptables -N PAYPILOT_API 2>/dev/null || true
sudo iptables -F PAYPILOT_API
sudo iptables -A PAYPILOT_API -s 127.0.0.0/8 -j ACCEPT
sudo iptables -A PAYPILOT_API -s 172.16.0.0/12 -j ACCEPT
sudo iptables -A PAYPILOT_API -j DROP
sudo iptables -I INPUT -p tcp --dport 4000 -j PAYPILOT_API
```

Adapt `172.16.0.0/12` to the actual bridge subnet from:

```bash
docker network inspect bridge --format '{{(index .IPAM.Config 0).Subnet}}'
```

### 10.5 Dashboards and alerts

Grafana provisions two dashboards from JSON in the **PayPilot** folder:

- **PayPilot API Overview** — target/DB health, request rate, 5xx ratio, latency, in-flight requests, process CPU/memory, event loop, DB probe, top routes.
- **PayPilot Business Activity** — attendance punches, leave requests and reviews, payroll imports.

Prometheus provisions five alerts: `PayPilotApiDown`, `PayPilotHigh5xxRate`, `PayPilotHighP95Latency`, `PayPilotDatabaseDown`, and `PayPilotDatabaseProbeStale`. There is no Alertmanager; firing alerts appear in the Prometheus UI and can be added to a Grafana panel.

Dashboard JSON is the source of truth. UI edits are overwritten on restart. Export changes back to JSON. Changing histogram buckets requires updating dashboard and alert queries in the same change.

See [docs/OBSERVABILITY.md](./docs/OBSERVABILITY.md) for the metric catalog, label policy, alert thresholds, and troubleshooting.

---

## 11. API Endpoints

### Public

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | API status, uptime, and memory usage |
| `GET` | `/api/health/db` | Live database connectivity check |
| `GET` | `/api/` | API version metadata banner |

### Protected (Bearer token required)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/auth/me` | Authenticated user's profile, role, and organization |
| `GET` | `/api/employees` | Paginated employee list with search, filters, and summary |
| `GET` | `/api/employees/:id` | Single employee |
| `POST` | `/api/employees` | Create an employee |
| `PATCH` | `/api/employees/:id` | Update employee fields |
| `PATCH` | `/api/employees/:id/status` | Change employee status |
| `GET` | `/api/departments` | Departments for the current organization |
| `POST` | `/api/payroll-imports` | Upload a `text/csv` payroll register with `X-File-Name` |
| `GET` | `/api/payroll-imports` | Paginated import history with optional `status` |
| `GET` | `/api/payroll-imports/:id` | Import batch detail and counts |
| `GET` | `/api/payroll-imports/:id/records` | Paginated imported records with optional `valid` |
| `GET` | `/api/payroll-imports/:id/findings` | Paginated findings with optional `severity` and `ruleCode` |
| `GET` | `/api/payroll-imports/:id/exception-report` | Downloadable CSV exception report |

Employee and department endpoints require `SUPER_ADMIN`, `ADMIN`, or `HR_MANAGER`. Employee numbers are generated server-side (`PP-1001`, `PP-1002`, …). Employees are offboarded by changing status, never by hard delete. Payroll import endpoints use the same HR role restriction.

### Payroll register imports

Upload one CSV per batch with exactly these columns:

```csv
employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions,net_pay
PP-1001,2026-10-01,2026-10-31,INR,75000.00,12500.00,62500.00
```

- Dates are ISO `YYYY-MM-DD`; currency is a three-letter uppercase code; money allows at most two decimal places.
- Limits are 5 MB per request and 10,000 data rows. Files must use one currency and one pay period per batch.
- File-level problems (empty file, invalid header, CSV parse error, row limit) persist a `FAILED` batch. Row-level problems keep the batch `COMPLETED` with invalid rows and findings.
- Rules include missing/invalid values, invalid dates and periods, unknown employees, negative amounts, arithmetic mismatches, duplicate employee periods, inconsistent currency/period, inactive employees, and periods before the join date. Findings carry a stable rule code, severity, row/field, explanation, and expected/actual values under ruleset `payroll-import-rules/v1`.
- The invariant is `gross_pay - total_deductions = net_pay`, compared as decimal cents rather than floating point.
- Employees are resolved only within the authenticated organization. Inactive employees are not rejected for status alone.
- Re-uploading identical bytes is rejected with `409 DUPLICATE_IMPORT` when a completed batch with the same SHA-256 hash exists. Failed batches may be retried.
- Raw files are stored privately outside the web root with `0700` directories and `0600` files, retained for 90 days, then removed by `npm run purge:payroll-imports`. Batch metadata, records, and findings remain. There is no raw-file download endpoint.
- Imported records never write to `payroll_runs` or `payslips`; they are validation input, not finalized payroll.

The web app exposes **Payroll Imports** at `/payroll/imports` with upload, history, filters, detail, findings/records tabs, and the exception report download.

---

## 12. Next Implementation Milestones

1. ~~**Authentication & tenant isolation:**~~ Complete — Keycloak OIDC, JWKS verification, provider-neutral identity mapping, native PostgreSQL RLS.
2. ~~**Employee Directory CRUD:**~~ Complete — validated API, tenant-scoped service, RLS enforcement, audit logging, live UI with create/edit and status changes.
3. ~~**Payroll Import & Integrity Validation:**~~ Complete — CSV register upload, deterministic findings, persisted batches/records, history/detail APIs, exception reports, and the Payroll Imports UI.
4. **Attendance System:** Geo/device-aware clock-in punch engine and timesheet export.
5. **Leave Approval Engine:** Tiered manager approval workflows and holiday calendar calculations.
6. **Payroll Calculation Engine:** Localized tax brackets, statutory deductions, and automated PDF payslip generation.
