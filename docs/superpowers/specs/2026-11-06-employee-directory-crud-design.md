# Employee Directory CRUD — Design

**Date:** 2026-11-06
**Status:** Approved
**Depends on:** PostgreSQL + Keycloak migration (merged as `5edfba8`)

## 1. Goal

Replace the mock employee list on the web app with tenant-scoped, database-backed
employee records managed through a validated API and a create/edit modal, without
introducing an account-provisioning path or any new runtime dependency.

## 2. Non-goals

- Department create/update/delete (read-only list plus seeded data only)
- Attendance, leave, payroll, or payslip features
- Employee avatars or file uploads (`Employee` has no avatar column; the UI uses initials)
- Bulk CSV import or export
- Hard delete or `deleted_at` soft delete (offboarding is a status change)
- Salary history or effective-dated compensation
- Creating or linking Keycloak login accounts
- Manager-to-department mapping
- Production deployment concerns

## 3. Roles and permissions

| Capability | SUPER_ADMIN | ADMIN | HR_MANAGER | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| List / read employees | yes | yes | yes | 403 | 403 |
| Create / update / change status | yes | yes | yes | 403 | 403 |
| List departments | yes | yes | yes | 403 | 403 |

Enforcement is server-side with `requireRole('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')`
after `requireAuth`. The web app hides write controls for roles that cannot write,
but the API is the authority.

Tenant isolation is enforced twice: `withOrganizationContext` sets
`app.current_organization_id` transaction-locally, and the existing
`employees_app_*` / `departments_app_select` RLS policies restrict rows.

## 4. Data model changes

One forward-only migration, `20261106090300_employee_directory_constraints`:

```sql
CREATE UNIQUE INDEX "employees_organization_id_email_key"
  ON "employees" ("organization_id", "email");

CREATE INDEX "employees_organization_id_status_idx"
  ON "employees" ("organization_id", "status");
```

Corresponding `prisma/schema.prisma` changes on `Employee`:

```prisma
@@unique([organizationId, email])
@@index([organizationId, status])
```

Notes:

- Emails are normalized to lowercase, trimmed, in the API before persistence, so
  the plain unique index is sufficient. No expression index is needed.
- If legacy data contains duplicate `(organization_id, email)` pairs, the migration
  fails loudly. It must not silently drop rows.
- No new RLS policies or grants are required. The runtime role already has
  `SELECT, INSERT, UPDATE, DELETE` on `employees` and `SELECT` on `departments`.
- `DELETE` is deliberately not exposed by any endpoint.

## 5. Employee number generation

Format: `PP-<integer>`, starting at `PP-1001` for an empty organization.

Inside the create transaction, before reading the current maximum:

```sql
SELECT pg_advisory_xact_lock(
  hashtext(current_setting('app.current_organization_id')),
  hashtext('employee_number')
);
```

Then select the highest number matching `^PP-[0-9]+$` for the current organization
and add one. Non-matching values are ignored. The advisory lock serializes
concurrent creates per tenant, and the lock is released when the transaction ends.

If the insert still violates the unique constraint (for example, data written
outside this path), the API retries once with a recomputed number and then returns
`409 DUPLICATE_EMPLOYEE_NUMBER`.

## 6. API contract

Base path: `/api/employees`. Every route runs
`requireAuth` → `requireRole('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER')` →
`tenantRouteHandler` (which opens the tenant-scoped transaction and forwards the
Prisma transaction client).

All responses use the existing envelope:

```json
{ "success": true, "data": { } }
```

Errors use `AppError` and the existing `errorHandler`:

```json
{
  "success": false,
  "error": { "code": "EMPLOYEE_NOT_FOUND", "message": "Employee not found" },
  "meta": { "timestamp": "...", "path": "/api/employees/..." }
}
```

### 6.1 Employee DTO

```ts
interface EmployeeDto {
  id: string;
  employeeNumber: string;      // server-assigned, e.g. "PP-1001"
  firstName: string;
  lastName: string;
  email: string;               // lowercase
  phone: string | null;
  jobTitle: string;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'CONTRACTOR' | 'INTERN';
  status: 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';
  joinedAt: string;            // "YYYY-MM-DD"
  baseSalary: string;          // decimal string, 2 dp, e.g. "75000.00"
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  createdAt: string;           // ISO 8601
  updatedAt: string;           // ISO 8601
}
```

`baseSalary` is serialized as a string to avoid floating-point drift and to match
Prisma's `Decimal` behavior. Clients format it for display.

### 6.2 `GET /api/employees`

Query parameters (all optional):

| Param | Type | Default | Rules |
|---|---|---|---|
| `page` | integer | `1` | `>= 1` |
| `pageSize` | integer | `25` | `1..100` |
| `search` | string | — | max 100 chars; matches first name, last name, email, employee number, job title |
| `departmentId` | uuid | — | must be a valid uuid |
| `status` | enum | — | `EmployeeStatus` |
| `sort` | enum | `lastName` | `lastName`, `joinedAt`, `employeeNumber`, `createdAt` |
| `order` | enum | `asc` | `asc`, `desc` |

Search is case-insensitive (`mode: 'insensitive'`), trims whitespace, and is
OR-combined across the five fields. Filters are AND-combined.

Response:

```json
{
  "success": true,
  "data": {
    "employees": [ /* EmployeeDto */ ],
    "pagination": { "page": 1, "pageSize": 25, "total": 42, "totalPages": 2 },
    "summary": { "total": 42, "active": 37, "onLeave": 3, "suspended": 1, "terminated": 1 },
    "sort": { "field": "lastName", "order": "asc" }
  }
}
```

`summary` is computed for the whole organization (unfiltered) so the page stat
cards stay stable while searching.

### 6.3 `GET /api/employees/:id`

Returns `{ "employee": EmployeeDto }`. Invalid uuid → `400 VALIDATION_ERROR`.
Missing or cross-tenant id → `404 EMPLOYEE_NOT_FOUND` (never reveal existence).

### 6.4 `POST /api/employees`

Request:

```json
{
  "firstName": "Alex",
  "lastName": "Mercer",
  "email": "alex.mercer@acme-corp.demo",
  "phone": "+1 (555) 234-5678",
  "jobTitle": "VP of Engineering",
  "employmentType": "FULL_TIME",
  "joinedAt": "2026-01-15",
  "baseSalary": "145000.00",
  "departmentId": "0f7d..."
}
```

Rules:

- `employeeNumber`, `userId`, and `status` are rejected as unknown keys
  (`400 VALIDATION_ERROR`). New employees always start as `ACTIVE`; status
  changes go through `PATCH /:id/status`.
- `email` is lowercased and trimmed.
- `joinedAt` accepts `YYYY-MM-DD` and must not be in the future (UTC date comparison).
- `departmentId` may be `null`. If provided, the department must exist in the
  current organization; otherwise `400 INVALID_DEPARTMENT`.
- Duplicate email in the organization → `409 EMAIL_ALREADY_EXISTS`.

Returns `201` with `{ "employee": EmployeeDto }` and a `Location: /api/employees/:id`
header.

### 6.5 `PATCH /api/employees/:id`

Partial update. At least one recognized field is required. Same field rules as
create. `employeeNumber`, `userId`, `organizationId`, `id`, `status`, `createdAt`,
and `updatedAt` are rejected as unknown keys; status changes must use the
dedicated endpoint so the audit action is unambiguous. Email changes still
enforce uniqueness → `409`.

Returns `200` with `{ "employee": EmployeeDto }`.

### 6.6 `PATCH /api/employees/:id/status`

Request: `{ "status": "TERMINATED" }`.

Any status transition is allowed so rehiring does not require recreating the
record; every change is audited. No other fields are accepted.
Returns `200` with `{ "employee": EmployeeDto }`.

### 6.7 `GET /api/departments`

This is a separate router at `/api/departments`, registered alongside the employee
router. It returns all departments in the current organization, ordered by name:

```json
{
  "success": true,
  "data": {
    "departments": [
      { "id": "...", "name": "Engineering", "code": "ENG", "description": "..." }
    ]
  }
}
```

Same role restrictions as employees.

### 6.8 Validation rules

Implemented with Zod schemas in `apps/api/src/routes/employees.schema.ts` and
`apps/api/src/routes/departments.routes.ts`:

| Field | Rule |
|---|---|
| `firstName`, `lastName` | trimmed, 1–100 characters |
| `email` | trimmed, lowercased, valid email, max 254 |
| `phone` | trimmed, optional/nullable, max 30, `^[+0-9 ().-]+$` if non-empty; empty string becomes `null` |
| `jobTitle` | trimmed, 1–120 characters |
| `departmentId` | uuid or null |
| `employmentType` | enum |
| `status` | enum |
| `joinedAt` | `YYYY-MM-DD`, valid date, not after today (UTC), not before 1900-01-01 |
| `baseSalary` | decimal string or number, `> 0`, `<= 9999999999.99`, max 2 dp |
| `pageSize` | coerced integer, default 25, clamped to 1–100 |
| `search` | max 100 characters |

`page` is coerced to an integer and clamped to `>= 1`; `pageSize` is clamped
rather than rejected so a stale client cannot break the page. All other
validation failures return `400 VALIDATION_ERROR` with
`details: [{ path, message }]` produced from `ZodError.issues`.

## 7. Audit logging

Every mutation writes one `audit_logs` row inside the same transaction:

| Action | Metadata |
|---|---|
| `employee.created` | `{ employeeNumber }` |
| `employee.updated` | `{ changedFields: string[] }` |
| `employee.status_changed` | `{ from, to }` |

`entityType` is `"Employee"`, `entityId` is the employee id, `actorId` is the
authenticated user id, and `organizationId` comes from the tenant context. Salary
values are never written to audit metadata.

## 8. Backend file structure

| File | Responsibility |
|---|---|
| `apps/api/src/routes/employees.schema.ts` | Zod request schemas and query parsing |
| `apps/api/src/routes/employees.dto.ts` | `EmployeeDto` type and Prisma-to-DTO mapper |
| `apps/api/src/routes/employees.service.ts` | Tenant-scoped queries, number allocation, audit writes |
| `apps/api/src/routes/employees.routes.ts` | Express router, role guard, HTTP status mapping |
| `apps/api/src/routes/departments.routes.ts` | Department list endpoint |
| `apps/api/src/lib/employeeNumber.ts` | Pure `parseEmployeeNumber` / `formatEmployeeNumber` helpers |
| `apps/api/src/routes/index.ts` | Register both routers |
| `apps/api/src/routes/employees.schema.test.ts` | Unit tests for validation and query parsing |
| `apps/api/src/lib/employeeNumber.test.ts` | Unit tests for number parsing/formatting |
| `apps/api/src/routes/employees.integration.test.ts` | Real-PostgreSQL CRUD, RBAC, and tenant tests |

Services take a `Prisma.TransactionClient` argument; they never import the global
client. Route handlers stay thin and delegate to services so tests can call
services directly where practical.

## 9. Frontend

### 9.1 API client

Add typed helpers in `apps/web/src/lib/employees.ts` (or extend `lib/api.ts`) that
call the existing `api` client. Types mirror `EmployeeDto` and `DepartmentDto`.
No new dependencies.

### 9.2 Employees page

`apps/web/src/pages/EmployeesPage.tsx` is rewritten to use live data:

- Initial load and refetch on filter/page change.
- 300 ms debounced search input.
- Department and status filters, page size selector, previous/next pagination.
- Stat cards read `summary` from the list response.
- Table columns: employee (initials avatar + name + number), email/phone, job
  title, department, employment type, status badge, joined date, salary, actions.
- Loading skeleton rows, empty state with "Add employee", and an inline error
  banner with retry.
- A `403` response renders a "You don't have access to the employee directory"
  state instead of the table, because `MANAGER` and `EMPLOYEE` cannot list.
- Row action menu: Edit, Change status. Terminated rows remain visible but the
  edit action is still available.
- The table scrolls horizontally inside its card on narrow screens; the modal
  becomes full-width below the `sm` breakpoint.
- `DemoDisclaimer` replaced by a "Live data" note; the mock-specific copy about
  read-only data is removed.

### 9.3 Modal form

New `apps/web/src/components/ui/Modal.tsx`: accessible overlay, Escape to close,
focus trap on first field, `role="dialog"` and `aria-modal="true"`. No dependency.

`apps/web/src/components/employees/EmployeeFormModal.tsx` handles create and edit:

- Fields: first name, last name, email, phone, job title, department, employment
  type, joined date, base salary.
- Status is not editable here; new employees start `ACTIVE`, and changes use the
  row action dialog.
- Employee number is displayed read-only in edit mode and hidden in create mode.
- Client-side required/format checks mirror the server; server field errors are
  shown next to the matching input when `details[].path` matches.
- Submit disables the button and shows a spinner; success closes the modal and
  refetches the list.
- Status changes use a separate small confirmation modal from the row action.

### 9.4 Files

| File | Change |
|---|---|
| `apps/web/src/pages/EmployeesPage.tsx` | Rewrite to live data |
| `apps/web/src/components/employees/EmployeeFormModal.tsx` | New |
| `apps/web/src/components/employees/EmployeeStatusDialog.tsx` | New |
| `apps/web/src/components/ui/Modal.tsx` | New |
| `apps/web/src/lib/employees.ts` | New typed API helpers |
| `apps/web/src/types/index.ts` | Add `EmployeeDto`, `DepartmentDto`, pagination/summary types |
| `apps/web/src/components/ui/Table.tsx` | Only if a loading/skeleton variant is needed |

`mockEmployees` remains in `mockData.ts` for pages that still use it; this page no
longer imports it.

## 10. Seed data

New `scripts/seed-dev-data.ts`, exposed as `npm run seed:dev`:

1. Connect with `DIRECT_URL` (migrator role) so RLS does not hide the demo org.
2. Find the organization by `SEED_ORGANIZATION_SLUG` (default `paypilot-demo`).
   Fail with a clear message if it does not exist; do not create organizations.
3. Upsert the six departments from the existing mock list by
   `(organizationId, code)`, updating name and description.
4. Print a summary. Safe to run repeatedly.
5. Do not seed employees, so the empty state and create flow are exercised.

## 11. Testing

### Unit (`npm test`)

- Zod schema accepts a complete valid payload and applies defaults.
- Rejects: empty names, invalid email, future `joinedAt`, zero/negative salary,
  more than 2 decimal places, unknown keys, invalid enum, oversized `pageSize`.
- Query parser clamps `pageSize` to 100, clamps `page` to 1, and defaults to 25.
- Employee number parser extracts the integer from `PP-1001` and returns `1001`
  for an empty list; ignores non-matching values.
- DTO mapper serializes `Decimal` to a 2-dp string and dates to `YYYY-MM-DD`.

### Integration (`npm run test:integration`, real PostgreSQL, `paypilot_app`)

Fixtures create two organizations with departments and users using the migrator
client, then exercise the runtime path:

- Create → list → get → update → status change within org A.
- Generated numbers are sequential (`PP-1001`, `PP-1002`).
- Two concurrent creates in the same org produce distinct numbers.
- `search` matches name/email/number/title; filters and pagination return the
  expected subset; `summary` is unfiltered.
- Duplicate email in the same org → `409`; the same email in org B is allowed.
- `departmentId` from org B → `400 INVALID_DEPARTMENT`.
- Cross-tenant `GET`/`PATCH`/status by id → `404`.
- No tenant context → no rows / rejected writes.
- `MANAGER` and `EMPLOYEE` roles → `403` at the middleware layer.
- Audit rows written with the expected action names and no salary values.
- List response never includes another tenant's employees.

Tests clean up their own rows and use unique emails/numbers per run.

### Manual

Login as `admin@paypilot.local`, open Employees, create an employee, search for it,
edit the job title and salary, change status to `ON_LEAVE`, then `TERMINATED`,
confirm the audit rows in PostgreSQL, and confirm MANAGER/EMPLOYEE tokens receive
`403` from the API.

## 12. Documentation

- `README.md`: replace the mock-data note, add the new endpoints to section 10,
  mark milestone 2 complete, document `npm run seed:dev`.
- `docs/architecture.md`: add the employee module to the API component list if it
  lists routes.

No other documents are required.

## 13. Migration and rollback

- Apply with `npm run db:migrate`.
- Rollback is a manual forward fix: drop the two indexes if they must be removed.
  No data is dropped by the migration itself.
- The migration must run against both a fresh database and the rehearsal database
  before merge.

## 14. Risks

- The unique email index can fail on legacy duplicates; that is intentional and
  must be resolved by data cleanup, not by weakening the constraint.
- Per-tenant advisory locking serializes bulk creation; acceptable for HR-scale
  volumes and simpler than adding a counter table.
- Employee numbers are not guaranteed gapless, only unique.
- Salary is visible to all roles allowed to read employees
  (`SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`), which is intended for this milestone.

## 15. Acceptance criteria

1. Employees page shows database records for the logged-in organization.
2. Create, edit, search, filter, paginate, and status change all work in the UI.
3. Cross-tenant access and missing tenant context are denied by the database.
4. Only `SUPER_ADMIN`, `ADMIN`, and `HR_MANAGER` can call the endpoints.
5. Every mutation produces an audit row.
6. `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:integration`
   pass.
7. No new runtime dependencies.
