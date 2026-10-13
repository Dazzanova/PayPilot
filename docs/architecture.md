# PayPilot Architecture Documentation

## 1. Executive Overview

**PayPilot** is a multi-tenant Human Resource Management System (HRMS) and Payroll SaaS platform designed to manage organizational workforce operations, attendance, leave workflows, and periodic payroll processing.

The foundation follows a clean, decoupled monorepo architecture with an explicit separation between client-side user experience, backend service orchestration, and relational data persistence.

```
                           +------------------------+
                           |  Browser Client (Web)  |
                           | React 19 + Vite + TS   |
                           +-----------+------------+
                                       |
                              HTTP / REST API (JSON)
                                       |
                                       v
                           +------------------------+
                           | Backend Service (API)  |
                           |  Node.js + Express + TS|
                           +-----------+------------+
                                       |
                                   Prisma ORM
                                       |
                                       v
                           +------------------------+
                           | Supabase PostgreSQL DB |
                           | Multi-tenant Relational|
                           +------------------------+
```

---

## 2. Repository and Workspace Structure

The project uses an `npm` workspaces monorepo structure:

```
paypilot/
├── apps/
│   ├── web/                     # Frontend Application
│   │   ├── public/              # Static assets and favicon
│   │   ├── src/
│   │   │   ├── app/             # App entry, router configuration, routes
│   │   │   ├── components/      # Shared components
│   │   │   │   ├── layout/      # TopNav, Sidebar, AppLayout
│   │   │   │   └── ui/          # Button, Card, Badge, Table, Modal primitives
│   │   │   ├── features/        # Feature-specific logic & domain components
│   │   │   │   ├── dashboard/   # Dashboard widgets, stats, charts
│   │   │   │   ├── employees/   # Employee list, filters, cards
│   │   │   │   ├── attendance/  # Attendance log, punch simulator, calendar
│   │   │   │   ├── leave/       # Leave balance cards, request tracker
│   │   │   │   ├── payroll/     # Payroll period run table, summary
│   │   │   │   └── departments/ # Department directory & metrics
│   │   │   ├── data/            # Strongly-typed mock data for demo experience
│   │   │   ├── lib/             # Utility helpers (formatting, dates, classNames)
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
│       │   ├── middleware/      # Logger, error handler, request parsing
│       │   ├── routes/          # Express route controllers & health checks
│       │   ├── services/        # Business logic services (extensible)
│       │   ├── lib/             # Prisma client singleton, logger utility
│       │   └── server.ts        # Express bootstrapping & graceful shutdown
│       ├── package.json
│       └── tsconfig.json
│
├── prisma/
│   └── schema.prisma            # Canonical Prisma schema for Supabase Postgres
├── docs/
│   └── architecture.md          # Architectural decisions & system boundaries
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
   - **Fields:** `id` (UUID), `name`, `slug` (unique), `currency` (default "USD"), `timezone`, `createdAt`, `updatedAt`.
   - **Relationships:** One-to-many with `User`, `Employee`, `Department`, `AttendanceRecord`, `LeaveRequest`, `PayrollRun`, `AuditLog`.

2. **User (`users`)**
   - **Role:** Identity and authentication record. Represents people who log into PayPilot (Admins, HR Staff, Managers, Employees).
   - **Fields:** `id` (UUID), `organizationId`, `email`, `role` (`SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `MANAGER`, `EMPLOYEE`), `isActive`, `lastLoginAt`.
   - **Relationships:** Belongs to `Organization`. Optionally 1:1 linked with an `Employee` profile.

3. **Department (`departments`)**
   - **Role:** Organizational structural unit (e.g., Engineering, Human Resources, Finance).
   - **Fields:** `id` (UUID), `organizationId`, `name`, `code`, `description`.
   - **Constraints:** Unique `[organizationId, code]` prevents collisions while allowing multiple organizations to have "ENG" or "HR".

4. **Employee (`employees`)**
   - **Role:** Employment record storing job title, compensation, join date, and personal contact info.
   - **Fields:** `id` (UUID), `organizationId`, `departmentId` (nullable), `userId` (nullable 1:1), `employeeNumber` (unique per org), `firstName`, `lastName`, `email`, `phone`, `jobTitle`, `employmentType` (`FULL_TIME`, `PART_TIME`, `CONTRACTOR`, `INTERN`), `status` (`ACTIVE`, `ON_LEAVE`, `TERMINATED`), `joinedAt`, `baseSalary` (`Decimal(12, 2)`).
   - **Constraints:** Unique `[organizationId, employeeNumber]` ensures stable per-tenant IDs (e.g., "EMP-001").

5. **AttendanceRecord (`attendance_records`)**
   - **Role:** Daily attendance status and time tracking.
   - **Fields:** `id` (UUID), `organizationId`, `employeeId`, `workDate` (Date), `status` (`PRESENT`, `ABSENT`, `HALF_DAY`, `ON_LEAVE`), `checkInTime` (DateTime nullable), `checkOutTime` (DateTime nullable), `notes`.
   - **Constraints:** Unique `[employeeId, workDate]` prevents duplicate logs for the same employee on a given day.

6. **LeaveRequest (`leave_requests`)**
   - **Role:** Time-off application and manager/HR approval pipeline.
   - **Fields:** `id` (UUID), `organizationId`, `employeeId`, `leaveType` (`ANNUAL`, `SICK`, `UNPAID`, `MATERNITY`, `PATERNITY`, `BEREAVEMENT`), `startDate`, `endDate`, `totalDays` (`Decimal(4, 1)`), `reason`, `status` (`PENDING`, `APPROVED`, `REJECTED`, `CANCELLED`), `reviewedById` (User reference nullable), `reviewedAt`.

7. **PayrollRun (`payroll_runs`)**
   - **Role:** Periodical batch payroll processing run (e.g., Monthly October 2026).
   - **Fields:** `id` (UUID), `organizationId`, `periodStart` (Date), `periodEnd` (Date), `payDate` (Date), `status` (`DRAFT`, `CALCULATING`, `APPROVED`, `PAID`, `VOID`), `totalGross` (`Decimal(14, 2)`), `totalDeductions` (`Decimal(14, 2)`), `totalNet` (`Decimal(14, 2)`), `processedById`.
   - **Constraints:** Unique `[organizationId, periodStart, periodEnd]` ensures duplicate payroll runs cannot be created for identical timeframes.

8. **Payslip (`payslips`)**
   - **Role:** Individual itemized payslip generated for an employee during a `PayrollRun`.
   - **Fields:** `id` (UUID), `organizationId`, `payrollRunId`, `employeeId`, `grossPay` (`Decimal(12, 2)`), `totalDeductions` (`Decimal(12, 2)`), `netPay` (`Decimal(12, 2)`), `currency`, `status` (`DRAFT`, `ISSUED`, `PAID`), `documentUrl`.
   - **Constraints:** Unique `[payrollRunId, employeeId]` prevents duplicate payslips for an employee in the same cycle.

9. **AuditLog (`audit_logs`)**
   - **Role:** Immutable audit trail capturing security-sensitive actions and operational changes.
   - **Fields:** `id` (UUID), `organizationId`, `actorId` (nullable User ID), `action` (e.g., `PAYROLL_APPROVED`, `EMPLOYEE_CREATED`), `entityType` (e.g., `Employee`, `PayrollRun`), `entityId`, `metadata` (JSON), `createdAt`.

---

## 4. Tenant Boundary and Security Architecture

### 4.1 Strict Multi-Tenant Isolation
- **Explicit Organization ID:** Every database table that stores tenant data holds an explicit foreign key column `organizationId REFERENCES organizations(id) ON DELETE CASCADE`.
- **Query Scoping:** Backend queries are strictly required to filter by the authenticated user's `organizationId`. A client can never supply an `organizationId` parameter in request payloads to access other tenants.
- **Future Supabase RLS Strategy:** While initial development enforces multi-tenancy at the application query layer, the schema is prepared for Supabase PostgreSQL Row Level Security (RLS) policies using Postgres session variables or Supabase JWT claims (`auth.jwt() ->> 'org_id'`).

### 4.2 Monetary Safety
- All monetary calculations and representations use PostgreSQL `DECIMAL` / `NUMERIC` types with fixed decimal precision (e.g., `Decimal(12, 2)` and `Decimal(14, 2)`).
- Floating-point types (`float`, `double`) are strictly prohibited in the schema to eliminate binary IEEE 754 precision inaccuracies.

---

## 5. Architectural Decisions Requiring Evolution Before Production

1. **Authentication & Session Management:**
   - *Current Foundation:* Demo mode with typed mock users and mock organization contexts.
   - *Production Need:* Integrate Supabase Auth or standard JWT/OIDC authentication with refresh tokens and MFA.
2. **Payroll Calculation Engine:**
   - *Current Foundation:* Schema models runs and payslips with status flags and monetary fields.
   - *Production Need:* Rule engine supporting regional statutory taxes, social security, pension deductions, bonuses, overtime hours, and localized tax brackets.
3. **Document Generation & Storage:**
   - *Current Foundation:* Reference URLs in `Payslip.documentUrl`.
   - *Production Need:* PDF rendering service (e.g., headless Chrome / PDFKit / React-PDF) combined with private S3/Supabase Storage buckets and signed time-limited download URLs.
4. **Supabase Connection Pooling:**
   - Prisma requires standard session connections (`DIRECT_URL` at port 5432) for running migrations and DDL, whereas runtime application queries (`DATABASE_URL`) should route through Supabase Transaction Pooler (PgBouncer/Supavisor at port 6543) to prevent connection starvation in serverless or multi-instance environments.
