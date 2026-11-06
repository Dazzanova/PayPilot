# PayPilot Architecture Documentation

## 1. Executive Overview

**PayPilot** is a multi-tenant Human Resource Management System (HRMS) and Payroll SaaS platform designed to manage organizational workforce operations, attendance, leave workflows, and periodic payroll processing.

The foundation follows a clean, decoupled monorepo architecture with an explicit separation between client-side user experience, backend service orchestration, and relational data persistence. Authentication is delegated to a self-hosted Keycloak realm, while tenant isolation is enforced inside PostgreSQL itself with Row-Level Security (RLS).

```text
                           +------------------------+
                           |  Browser Client (Web)  |
                           | React 18 + Vite + TS   |
                           +-----+------------+-----+
                                 |            |
                    OIDC Authorization      REST API (JSON)
                    Code + PKCE S256        Bearer access token
                                 |            |
                                 v            v
                    +----------------+   +---------------------+
                    |    Keycloak    |   | Backend Service     |
                    |  OIDC provider |   | Node.js + Express   |
                    +-------+--------+   +----------+----------+
                            |                       |
                     Keycloak DB               Prisma ORM
                            |                       |
                            v                       v
                    +----------------+   +---------------------+
                    | PostgreSQL     |   | PostgreSQL          |
                    | database:      |   | database: paypilot  |
                    | keycloak       |   | native RLS policies |
                    +----------------+   +---------------------+
```

Both databases run in the local Docker Compose stack, but they are separate databases with separate roles and credentials.

---

## 2. Repository and Workspace Structure

The project uses an `npm` workspaces monorepo structure:

```text
paypilot/
├── apps/
│   ├── web/                     # Frontend Application
│   │   ├── public/              # Static assets incl. silent-check-sso.html
│   │   ├── src/
│   │   │   ├── app/             # App entry, router configuration, routes
│   │   │   ├── components/      # Shared components
│   │   │   │   ├── auth/        # ProtectedRoute
│   │   │   │   ├── layout/      # TopNav, Sidebar, AppLayout
│   │   │   │   └── ui/          # Button, Card, Badge, Table, Modal primitives
│   │   │   ├── contexts/        # AuthContext (Keycloak session, in memory)
│   │   │   ├── features/        # Feature-specific logic & domain components
│   │   │   ├── lib/             # keycloak.ts, api.ts, formatting helpers
│   │   │   ├── pages/           # Navigable views (Dashboard, Employees, etc.)
│   │   │   ├── types/           # Shared frontend domain TypeScript interfaces
│   │   │   ├── index.css        # Tailwind directives and design system tokens
│   │   │   └── main.tsx         # React root mounting
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vite.config.ts
│   │
│   └── api/                     # Backend Application
│       ├── src/
│       │   ├── config/          # Zod-validated environment config
│       │   ├── middleware/      # auth.ts, request logger, error handler
│       │   ├── routes/          # Express routes & health checks
│       │   ├── types/           # AuthenticatedRequest / AuthContext
│       │   ├── lib/             # Prisma singleton, tenant context, logger
│       │   └── server.ts        # Express bootstrapping & graceful shutdown
│       ├── package.json
│       └── tsconfig.json
│
├── prisma/
│   ├── schema.prisma            # Canonical Prisma schema
│   └── migrations/              # Active forward-only migration history
├── prisma/migrations-legacy-supabase/
│                                # Archived Supabase-era migrations (not applied)
├── docker/
│   ├── postgres/init/           # Roles, databases, default privileges
│   └── keycloak/realm/          # Realm import (clients, audience mapper)
├── scripts/
│   └── provision-dev-user.ts    # Controlled Keycloak + PayPilot provisioning
├── docs/
│   └── architecture.md          # Architectural decisions & system boundaries
├── docker-compose.yml           # PostgreSQL + Keycloak services
├── .env.example                 # Environment variables specification
├── .gitignore                   # Version control exclusions
├── package.json                 # Monorepo workspaces definition
└── README.md                    # Project manual and operational guides
```

---

## 3. Data Model & Entity-Relationship Design

The database schema is modeled for multi-tenant isolation, data integrity, and compliance. The core entities and their relationships are defined as follows:

### 3.1 Core Entities

1. **Organization (`organizations`)**
   - **Role:** The top-level tenant entity. Every enterprise client is encapsulated within an organization.
   - **Fields:** `id` (UUID string), `name`, `slug` (unique), `currency` (default "USD"), `timezone`, `createdAt`, `updatedAt`.
   - **Relationships:** One-to-many with `User`, `Employee`, `Department`, `AttendanceRecord`, `LeaveRequest`, `PayrollRun`, `AuditLog`.

2. **User (`users`)**
   - **Role:** Identity and authorization record. Represents people who log into PayPilot (Admins, HR Staff, Managers, Employees).
   - **Fields:** `id` (UUID string), `organizationId`, `email`, `role` (`SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`), `isActive`, `lastLoginAt`, `identityIssuer`, `identitySubject`.
   - **Identity mapping:** `identityIssuer` and `identitySubject` store the exact OIDC issuer and subject pair. They are unique together. There is no email-based auto-linking.
   - **Relationships:** Belongs to `Organization`. Optionally 1:1 linked with an `Employee` profile.

3. **Department (`departments`)**
   - **Role:** Organizational structural unit (e.g., Engineering, Human Resources, Finance).
   - **Fields:** `id`, `organizationId`, `name`, `code`, `description`.
   - **Constraints:** Unique `[organizationId, code]` prevents collisions while allowing multiple organizations to have "ENG" or "HR".

4. **Employee (`employees`)**
   - **Role:** Employment record storing job title, compensation, join date, and personal contact info.
   - **Fields:** `id`, `organizationId`, `departmentId` (nullable), `userId` (nullable 1:1), `employeeNumber` (unique per org), `firstName`, `lastName`, `email`, `phone`, `jobTitle`, `employmentType` (`FULL_TIME`, `PART_TIME`, `CONTRACTOR`, `INTERN`), `status` (`ACTIVE`, `ON_LEAVE`, `TERMINATED`), `joinedAt`, `baseSalary` (`Decimal(12, 2)`).
   - **Constraints:** Unique `[organizationId, employeeNumber]` ensures stable per-tenant IDs (e.g., "EMP-001").

5. **AttendanceRecord (`attendance_records`)**
   - **Role:** Daily attendance status and time tracking.
   - **Fields:** `id`, `organizationId`, `employeeId`, `workDate` (Date), `status` (`PRESENT`, `ABSENT`, `HALF_DAY`, `ON_LEAVE`), `checkInTime` (DateTime nullable), `checkOutTime` (DateTime nullable), `notes`.
   - **Constraints:** Unique `[employeeId, workDate]` prevents duplicate logs for the same employee on a given day.

6. **LeaveRequest (`leave_requests`)**
   - **Role:** Time-off application and manager/HR approval pipeline.
   - **Fields:** `id`, `organizationId`, `employeeId`, `leaveType`, `startDate`, `endDate`, `totalDays` (`Decimal(4, 1)`), `reason`, `status`, `reviewedById` (nullable), `reviewedAt`.

7. **PayrollRun (`payroll_runs`)**
   - **Role:** Periodical batch payroll processing run (e.g., Monthly October 2026).
   - **Fields:** `id`, `organizationId`, `periodStart`, `periodEnd`, `payDate`, `status`, `totalGross`, `totalDeductions`, `totalNet`, `processedById`.
   - **Constraints:** Unique `[organizationId, periodStart, periodEnd]`.

8. **Payslip (`payslips`)**
   - **Role:** Individual itemized payslip generated for an employee during a `PayrollRun`.
   - **Fields:** `id`, `organizationId`, `payrollRunId`, `employeeId`, `grossPay`, `totalDeductions`, `netPay`, `currency`, `status`, `documentUrl`.
   - **Constraints:** Unique `[payrollRunId, employeeId]`.

9. **AuditLog (`audit_logs`)**
   - **Role:** Immutable audit trail capturing security-sensitive actions and operational changes.
   - **Fields:** `id`, `organizationId`, `actorId` (nullable), `action`, `entityType`, `entityId`, `metadata` (JSON), `createdAt`.
   - **Write model:** Append-only through the runtime role; updates and deletes are denied by RLS.

---

## 4. Tenant Boundary and Security Architecture

### 4.1 Authentication and Identity

- The browser uses Keycloak's public `paypilot-web` client with Authorization Code flow and PKCE S256.
- Implicit and hybrid flows are disabled in the realm import.
- Access tokens are held in memory by `keycloak-js`; PayPilot does not write tokens to `localStorage` or `sessionStorage`.
- The API verifies every bearer token with `jose` against the realm JWKS. Signature, algorithm (`RS256`), issuer, audience (`paypilot-api`), expiry, and not-before are validated.
- Only after verification does the API resolve the exact `(issuer, subject)` pair to an internal user via `public.paypilot_resolve_identity(text, text)`.
- Role and organization are always read from the database. Client-supplied role or tenant values are never trusted.

### 4.2 Strict Multi-Tenant Isolation

- Every tenant-owned table carries an explicit `organization_id` foreign key.
- PostgreSQL RLS is enabled and forced on all tenant-owned tables.
- The runtime role `paypilot_app` is a non-owner, non-superuser role without `BYPASSRLS`.
- The application enters tenant context with `set_config('app.current_organization_id', ..., true)` inside the same Prisma interactive transaction that executes the query. Missing context returns no rows and denies writes.
- The table-owning migration/provisioning role `paypilot_migrator` has an explicit permissive policy so migrations and controlled provisioning still work under `FORCE ROW LEVEL SECURITY`.
- The identity lookup runs before tenant context and is the only `SECURITY DEFINER` function. It returns only `user_id` and `organization_id` for an exact identity match.
- See [RLS-IMPLEMENTATION.md](./RLS-IMPLEMENTATION.md) and [authentication.md](./authentication.md) for details.

### 4.3 Monetary Safety

- All monetary calculations and representations use PostgreSQL `DECIMAL` / `NUMERIC` types with fixed decimal precision (e.g., `Decimal(12, 2)` and `Decimal(14, 2)`).
- Floating-point types (`float`, `double`) are strictly prohibited in the schema to eliminate binary IEEE 754 precision inaccuracies.

---

## 5. Architectural Decisions Requiring Evolution Before Production

1. **Production identity operations:**
   - *Current foundation:* Development realm imported from JSON, development user provisioning script, and bootstrap administrator.
   - *Production need:* Managed Keycloak deployment, TLS, SMTP, MFA, password policy, backups, and an audited identity lifecycle process.
2. **Payroll Calculation Engine:**
   - *Current foundation:* Schema models runs and payslips with status flags and monetary fields.
   - *Production need:* Rule engine supporting regional statutory taxes, social security, pension deductions, bonuses, overtime hours, and localized tax brackets.
3. **Document Generation & Storage:**
   - *Current foundation:* Reference URLs in `Payslip.documentUrl`.
   - *Production need:* PDF rendering service combined with private object storage buckets and signed, time-limited download URLs.
4. **Connection pooling and operations:**
   - *Current foundation:* Direct PostgreSQL connections for local development.
   - *Production need:* A pooled runtime connection (for example PgBouncer) while keeping a separate direct session for migrations, plus backups, monitoring, and credential rotation.
5. **Migration history:**
   - *Current foundation:* A consolidated baseline followed by forward-only identity and RLS migrations. Supabase-era migrations are archived under `prisma/migrations-legacy-supabase/`.
   - *Production need:* Exercise the upgrade path on a restored copy of any existing database before cutover.
