# Employee Directory CRUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock employee directory with tenant-scoped PostgreSQL records managed through a validated API and a create/edit modal.

**Architecture:** Express routes guarded by Keycloak authentication and role checks delegate to services that receive a Prisma transaction client already scoped by `withOrganizationContext`. PostgreSQL RLS enforces tenant isolation independently of the API. The React page consumes typed API helpers and keeps no employee state beyond the current query.

**Tech Stack:** TypeScript, Express 4, Zod 3, Prisma 5.22, PostgreSQL 16 with RLS, React 18, Vite, Tailwind, Keycloak.

**Spec:** `docs/superpowers/specs/2026-11-06-employee-directory-crud-design.md`

## Implementation status

- [x] Tasks 1–7: database constraints, numbering helpers, validation, service, routers, integration tests, seed.
- [x] Tasks 8–11: typed API client, modal, employee form, status dialog, live employees page.
- [x] Task 12: README endpoints and seed documentation.
- [x] Task 13 (automated): schema validation, both typechecks, API + web builds, unit tests, integration tests, migration status.
- [ ] Task 13 (manual): browser walkthrough of create, edit, status, duplicate email, filters, and the MANAGER/EMPLOYEE restricted state.
- [ ] Task 14: final review and branch handoff.

Automated verification at `bb73dc9` before the manual step:

- `npm run prisma:validate` — schema valid.
- `npm run db:status` — 5 migrations, database up to date.
- `npm run typecheck` — API and web pass.
- `npm run typecheck:tests --workspace=apps/api` — pass.
- `npm run build` — API and web pass.
- `npm test` — 53/53 API unit tests pass; web typecheck passes.
- `npm run test:integration` — 98/98 pass, including HTTP route coverage.
- `npm run seed:dev` twice — six departments, idempotent.
- Demo organization `paypilot-demo` — 6 departments, 0 employees.

---

## File Map

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | Add employee email uniqueness and status index |
| `prisma/migrations/20261106090300_employee_directory_constraints/migration.sql` | Apply those indexes |
| `apps/api/src/lib/employeeNumber.ts` | Pure `PP-<n>` parse/format/next helpers |
| `apps/api/src/lib/httpError.ts` | `HttpError` carrying `statusCode`, `code`, `details` |
| `apps/api/src/routes/employees.schema.ts` | Zod create/update/status/list schemas |
| `apps/api/src/routes/employees.dto.ts` | `EmployeeDto` and Prisma mapper |
| `apps/api/src/routes/employees.service.ts` | List/get/create/update/status, numbering, audit |
| `apps/api/src/routes/employees.routes.ts` | HTTP router and status-code mapping |
| `apps/api/src/routes/departments.routes.ts` | Read-only department list |
| `apps/api/src/routes/index.ts` | Mount both routers |
| `apps/api/src/routes/employees.schema.test.ts` | Schema unit tests |
| `apps/api/src/lib/employeeNumber.test.ts` | Numbering unit tests |
| `apps/api/src/routes/employees.integration.test.ts` | Real-PostgreSQL service tests |
| `scripts/seed-dev-data.ts` | Idempotent department seed |
| `apps/web/src/types/index.ts` | DTO and list-response types |
| `apps/web/src/lib/api.ts` | Preserve server error `details` |
| `apps/web/src/lib/employees.ts` | Typed API helpers |
| `apps/web/src/components/ui/Modal.tsx` | Accessible modal primitive |
| `apps/web/src/components/employees/EmployeeFormModal.tsx` | Create/edit form |
| `apps/web/src/components/employees/EmployeeStatusDialog.tsx` | Status confirmation |
| `apps/web/src/pages/EmployeesPage.tsx` | Live list, filters, pagination, actions |
| `README.md` | Endpoints, seed command, milestone status |

---

## Task 1: Database constraints and migration

**Files:**
- Modify: `prisma/schema.prisma:148-177`
- Create: `prisma/migrations/20261106090300_employee_directory_constraints/migration.sql`

- [ ] **Step 1: Add the constraints to the Prisma schema**

In `model Employee`, replace the index block:

```prisma
  @@unique([organizationId, employeeNumber])
  @@index([organizationId])
  @@index([departmentId])
  @@map("employees")
```

with:

```prisma
  @@unique([organizationId, employeeNumber])
  @@unique([organizationId, email])
  @@index([organizationId])
  @@index([organizationId, status])
  @@index([departmentId])
  @@map("employees")
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20261106090300_employee_directory_constraints/migration.sql`:

```sql
-- Employee directory constraints.
-- The unique email index fails loudly if legacy rows contain duplicates;
-- resolve duplicates in data, do not weaken the constraint.

CREATE UNIQUE INDEX "employees_organization_id_email_key"
  ON "employees" ("organization_id", "email");

CREATE INDEX "employees_organization_id_status_idx"
  ON "employees" ("organization_id", "status");
```

- [ ] **Step 3: Validate the schema and generate the client**

Run:

```bash
npm run prisma:validate
npm run prisma:generate
```

Expected: `The schema at prisma/schema.prisma is valid` and `Generated Prisma Client`.

- [ ] **Step 4: Apply the migration to the local database**

Run:

```bash
npm run db:migrate
npm run db:status
```

Expected: migration `20261106090300_employee_directory_constraints` applied; `Database schema is up to date!`.

- [ ] **Step 5: Verify the indexes exist**

Run:

```bash
APP_DB=$(grep '^PAYPILOT_DB_NAME=' .env | cut -d= -f2- | tr -d '"')
MIG_USER=$(grep '^PAYPILOT_MIGRATOR_USER=' .env | cut -d= -f2- | tr -d '"')
MIG_PW=$(grep '^PAYPILOT_MIGRATOR_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
PGPASSWORD="$MIG_PW" psql -h localhost -p 5433 -U "$MIG_USER" -d "$APP_DB" -c "\d employees"
```

Expected: `employees_organization_id_email_key` (unique) and `employees_organization_id_status_idx` are listed.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261106090300_employee_directory_constraints/migration.sql
git commit -m "feat(db): add employee directory constraints"
```

---

## Task 2: Employee number helpers

**Files:**
- Create: `apps/api/src/lib/employeeNumber.ts`
- Test: `apps/api/src/lib/employeeNumber.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/employeeNumber.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatEmployeeNumber,
  nextEmployeeNumber,
  parseEmployeeNumber,
} from './employeeNumber';

describe('employeeNumber', () => {
  it('parses a formatted number', () => {
    assert.equal(parseEmployeeNumber('PP-1001'), 1001);
    assert.equal(parseEmployeeNumber(' PP-42 '), 42);
  });

  it('returns null for values outside the format', () => {
    assert.equal(parseEmployeeNumber('TEMP-1001'), null);
    assert.equal(parseEmployeeNumber('PP-XYZ'), null);
    assert.equal(parseEmployeeNumber('PP-'), null);
    assert.equal(parseEmployeeNumber('1001'), null);
  });

  it('formats a sequence', () => {
    assert.equal(formatEmployeeNumber(1001), 'PP-1001');
    assert.equal(formatEmployeeNumber(7), 'PP-7');
  });

  it('rejects invalid sequences', () => {
    assert.throws(() => formatEmployeeNumber(0));
    assert.throws(() => formatEmployeeNumber(-1));
    assert.throws(() => formatEmployeeNumber(1.5));
  });

  it('starts at PP-1001 for an empty organization', () => {
    assert.equal(nextEmployeeNumber([]), 'PP-1001');
  });

  it('increments past the highest matching number', () => {
    assert.equal(nextEmployeeNumber(['PP-1001', 'PP-1003', 'PP-1002']), 'PP-1004');
  });

  it('ignores values that do not match the format', () => {
    assert.equal(nextEmployeeNumber(['TEMP-5', 'PP-XYZ', 'PP-1001']), 'PP-1002');
  });

  it('never drops below the starting number', () => {
    assert.equal(nextEmployeeNumber(['PP-4']), 'PP-1001');
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
npx tsx --test apps/api/src/lib/employeeNumber.test.ts
```

Expected: FAIL because `./employeeNumber` cannot be resolved.

- [ ] **Step 3: Implement the helpers**

Create `apps/api/src/lib/employeeNumber.ts`:

```ts
const PREFIX = 'PP-';
const STARTING_SEQUENCE = 1001;
const PATTERN = /^PP-([0-9]+)$/;

export function parseEmployeeNumber(value: string): number | null {
  const match = PATTERN.exec(value.trim());
  if (!match) {
    return null;
  }

  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatEmployeeNumber(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error(`Invalid employee number sequence: ${sequence}`);
  }
  return `${PREFIX}${sequence}`;
}

export function nextEmployeeNumber(existing: readonly string[]): string {
  const highest = existing.reduce((max, value) => {
    const parsed = parseEmployeeNumber(value);
    return parsed !== null && parsed > max ? parsed : max;
  }, STARTING_SEQUENCE - 1);

  return formatEmployeeNumber(Math.max(highest + 1, STARTING_SEQUENCE));
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
npx tsx --test apps/api/src/lib/employeeNumber.test.ts
```

Expected: 8 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/employeeNumber.ts apps/api/src/lib/employeeNumber.test.ts
git commit -m "feat(api): add employee number helpers"
```

---

## Task 3: HTTP error type, schemas, and DTO

**Files:**
- Create: `apps/api/src/lib/httpError.ts`
- Create: `apps/api/src/routes/employees.schema.ts`
- Create: `apps/api/src/routes/employees.dto.ts`
- Test: `apps/api/src/routes/employees.schema.test.ts`

- [ ] **Step 1: Add the error type**

Create `apps/api/src/lib/httpError.ts`:

```ts
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}
```

`errorHandler` already reads `statusCode`, `code`, and `details`, so no change is needed there.

- [ ] **Step 2: Write the failing schema tests**

Create `apps/api/src/routes/employees.schema.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmploymentType, EmployeeStatus, Prisma } from '@prisma/client';
import {
  employeeCreateSchema,
  employeeListQuerySchema,
  employeeStatusSchema,
  employeeUpdateSchema,
} from './employees.schema';
import { toEmployeeDto } from './employees.dto';

const valid = {
  firstName: 'Alex',
  lastName: 'Mercer',
  email: 'Alex.Mercer@Example.com',
  phone: '+1 (555) 234-5678',
  jobTitle: 'VP of Engineering',
  employmentType: EmploymentType.FULL_TIME,
  joinedAt: '2026-01-15',
  baseSalary: '145000.00',
  departmentId: null,
};

describe('employeeCreateSchema', () => {
  it('normalizes email and phone', () => {
    const parsed = employeeCreateSchema.parse(valid);
    assert.equal(parsed.email, 'alex.mercer@example.com');
    assert.equal(parsed.baseSalary, '145000.00');
  });

  it('turns an empty phone into null', () => {
    const parsed = employeeCreateSchema.parse({ ...valid, phone: '  ' });
    assert.equal(parsed.phone, null);
  });

  it('rejects unknown keys such as employeeNumber', () => {
    const result = employeeCreateSchema.safeParse({ ...valid, employeeNumber: 'PP-1' });
    assert.equal(result.success, false);
  });

  it('rejects a future joinedAt', () => {
    const result = employeeCreateSchema.safeParse({ ...valid, joinedAt: '2999-01-01' });
    assert.equal(result.success, false);
  });

  it('rejects an invalid calendar date', () => {
    const result = employeeCreateSchema.safeParse({ ...valid, joinedAt: '2026-02-30' });
    assert.equal(result.success, false);
  });

  it('rejects zero, negative, and over-precise salaries', () => {
    for (const baseSalary of ['0', '-10', '1.005', '10000000000']) {
      assert.equal(employeeCreateSchema.safeParse({ ...valid, baseSalary }).success, false);
    }
  });

  it('rejects empty names and invalid emails', () => {
    assert.equal(employeeCreateSchema.safeParse({ ...valid, firstName: '  ' }).success, false);
    assert.equal(employeeCreateSchema.safeParse({ ...valid, email: 'nope' }).success, false);
  });
});

describe('employeeUpdateSchema', () => {
  it('accepts a single field', () => {
    assert.deepEqual(employeeUpdateSchema.parse({ jobTitle: 'CTO' }), { jobTitle: 'CTO' });
  });

  it('rejects an empty object and status changes', () => {
    assert.equal(employeeUpdateSchema.safeParse({}).success, false);
    assert.equal(employeeUpdateSchema.safeParse({ status: EmployeeStatus.ACTIVE }).success, false);
  });
});

describe('employeeStatusSchema', () => {
  it('accepts a known status', () => {
    assert.deepEqual(employeeStatusSchema.parse({ status: 'ON_LEAVE' }), {
      status: EmployeeStatus.ON_LEAVE,
    });
  });
});

describe('employeeListQuerySchema', () => {
  it('applies defaults', () => {
    const parsed = employeeListQuerySchema.parse({});
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 25);
    assert.equal(parsed.sort, 'lastName');
    assert.equal(parsed.order, 'asc');
  });

  it('clamps page and pageSize instead of rejecting', () => {
    assert.equal(employeeListQuerySchema.parse({ page: '0', pageSize: '500' }).page, 1);
    assert.equal(employeeListQuerySchema.parse({ page: '0', pageSize: '500' }).pageSize, 100);
  });

  it('falls back to defaults for unparseable paging values', () => {
    const parsed = employeeListQuerySchema.parse({ page: 'abc', pageSize: 'abc' });
    assert.equal(parsed.page, 1);
    assert.equal(parsed.pageSize, 25);
  });

  it('trims search and rejects an invalid department id', () => {
    assert.equal(employeeListQuerySchema.parse({ search: '  alex  ' }).search, 'alex');
    assert.equal(
      employeeListQuerySchema.safeParse({ departmentId: 'not-a-uuid' }).success,
      false
    );
  });
});

describe('toEmployeeDto', () => {
  it('serializes dates and decimals for the API shape', () => {
    const dto = toEmployeeDto({
      id: 'e1',
      organizationId: 'o1',
      departmentId: 'd1',
      userId: null,
      employeeNumber: 'PP-1001',
      firstName: 'Alex',
      lastName: 'Mercer',
      email: 'alex@example.com',
      phone: null,
      jobTitle: 'VP of Engineering',
      employmentType: EmploymentType.FULL_TIME,
      status: EmployeeStatus.ACTIVE,
      joinedAt: new Date('2026-01-15T00:00:00.000Z'),
      baseSalary: new Prisma.Decimal('145000'),
      createdAt: new Date('2026-01-01T10:00:00.000Z'),
      updatedAt: new Date('2026-01-02T10:00:00.000Z'),
      department: {
        id: 'd1',
        organizationId: 'o1',
        name: 'Engineering',
        code: 'ENG',
        description: null,
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
        updatedAt: new Date('2026-01-02T10:00:00.000Z'),
      },
    });

    assert.equal(dto.joinedAt, '2026-01-15');
    assert.equal(dto.baseSalary, '145000.00');
    assert.equal(dto.departmentName, 'Engineering');
    assert.equal(dto.createdAt, '2026-01-01T10:00:00.000Z');
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

```bash
npx tsx --test apps/api/src/routes/employees.schema.test.ts
```

Expected: FAIL because `./employees.schema` cannot be resolved.

- [ ] **Step 4: Implement the schemas**

Create `apps/api/src/routes/employees.schema.ts`:

```ts
import { z } from 'zod';
import { EmployeeStatus, EmploymentType } from '@prisma/client';

const MIN_JOIN_DATE = '1900-01-01';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date')
  .refine((value) => value >= MIN_JOIN_DATE, 'Date is too far in the past')
  .refine((value) => {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);
    return value <= today;
  }, 'Joined date cannot be in the future');

const baseSalarySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Enter a valid salary')
  .refine(
    (value) => Number(value) > 0 && Number(value) <= 9_999_999_999.99,
    'Salary must be greater than zero and fit 12 digits with 2 decimals'
  );

const employeeFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    })
    .refine(
      (value) => value === undefined || value === null || value.length <= 30,
      'Phone must be 30 characters or fewer'
    )
    .refine(
      (value) =>
        value === undefined || value === null || /^[+0-9 ().-]+$/.test(value),
      'Phone contains unsupported characters'
    ),
  jobTitle: z.string().trim().min(1).max(120),
  departmentId: z.string().uuid().nullable().optional(),
  employmentType: z.nativeEnum(EmploymentType),
  joinedAt: dateOnlySchema,
  baseSalary: baseSalarySchema,
};

export const employeeCreateSchema = z.object(employeeFields).strict();

export const employeeUpdateSchema = z
  .object(employeeFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const employeeStatusSchema = z
  .object({ status: z.nativeEnum(EmployeeStatus) })
  .strict();

export const employeeListQuerySchema = z
  .object({
    page: z.coerce.number().int().catch(1).transform((value) => Math.max(1, value)),
    pageSize: z.coerce
      .number()
      .int()
      .catch(25)
      .transform((value) => Math.min(100, Math.max(1, value))),
    search: z.string().trim().max(100).optional(),
    departmentId: z.string().uuid().optional(),
    status: z.nativeEnum(EmployeeStatus).optional(),
    sort: z.enum(['lastName', 'joinedAt', 'employeeNumber', 'createdAt']).catch('lastName'),
    order: z.enum(['asc', 'desc']).catch('asc'),
  });

export const employeeIdSchema = z.string().uuid();

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
```

- [ ] **Step 5: Implement the DTO mapper**

Create `apps/api/src/routes/employees.dto.ts`:

```ts
import { Prisma } from '@prisma/client';

export type EmployeeWithDepartment = Prisma.EmployeeGetPayload<{
  include: { department: true };
}>;

export interface EmployeeDto {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string;
  employmentType: string;
  status: string;
  joinedAt: string;
  baseSalary: string;
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toEmployeeDto(employee: EmployeeWithDepartment): EmployeeDto {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone,
    jobTitle: employee.jobTitle,
    employmentType: employee.employmentType,
    status: employee.status,
    joinedAt: employee.joinedAt.toISOString().slice(0, 10),
    baseSalary: employee.baseSalary.toFixed(2),
    departmentId: employee.departmentId,
    departmentName: employee.department?.name ?? null,
    userId: employee.userId,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
npx tsx --test apps/api/src/routes/employees.schema.test.ts
```

Expected: all schema tests pass. If `toLowerCase` is rejected by the installed Zod types, replace `z.string().trim().toLowerCase().email()` with `z.string().trim().email().transform((value) => value.toLowerCase())`.

- [ ] **Step 7: Typecheck**

```bash
npm run typecheck --workspace=apps/api
npm run typecheck:tests --workspace=apps/api
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/lib/httpError.ts apps/api/src/routes/employees.schema.ts apps/api/src/routes/employees.dto.ts apps/api/src/routes/employees.schema.test.ts
git commit -m "feat(api): add employee validation and DTO mapping"
```

---

## Task 4: Employee service

**Files:**
- Create: `apps/api/src/routes/employees.service.ts`

- [ ] **Step 1: Implement the service**

Create `apps/api/src/routes/employees.service.ts`:

```ts
import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/httpError';
import { nextEmployeeNumber } from '../lib/employeeNumber';
import {
  EmployeeCreateInput,
  EmployeeListQuery,
  EmployeeUpdateInput,
} from './employees.schema';
import { EmployeeWithDepartment, toEmployeeDto } from './employees.dto';

const DEPARTMENT_INCLUDE = { department: true } as const;

type Tx = Prisma.TransactionClient;

async function allocateEmployeeNumber(tx: Tx, organizationId: string): Promise<string> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${organizationId}::text),
      hashtext('employee_number')
    )
  `;

  const existing = await tx.employee.findMany({
    where: { organizationId },
    select: { employeeNumber: true },
  });

  return nextEmployeeNumber(existing.map((row) => row.employeeNumber));
}

async function requireEmployee(
  tx: Tx,
  organizationId: string,
  employeeId: string
): Promise<EmployeeWithDepartment> {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: DEPARTMENT_INCLUDE,
  });

  if (!employee) {
    throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
  }

  return employee;
}

async function assertDepartment(
  tx: Tx,
  organizationId: string,
  departmentId: string | null | undefined
): Promise<void> {
  if (!departmentId) {
    return;
  }

  const department = await tx.department.findFirst({
    where: { id: departmentId, organizationId },
    select: { id: true },
  });

  if (!department) {
    throw new HttpError(400, 'INVALID_DEPARTMENT', 'Department does not exist in this organization');
  }
}

function isUniqueViolation(error: unknown, target: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    String(error.meta?.target ?? '').includes(target)
  );
}

async function writeAudit(
  tx: Tx,
  organizationId: string,
  actorId: string,
  action: string,
  employeeId: string,
  metadata: Prisma.InputJsonValue
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId,
      actorId,
      action,
      entityType: 'Employee',
      entityId: employeeId,
      metadata,
    },
  });
}

export interface EmployeeListResult {
  employees: ReturnType<typeof toEmployeeDto>[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    active: number;
    onLeave: number;
    suspended: number;
    terminated: number;
  };
  sort: { field: string; order: string };
}

export async function listEmployees(
  tx: Tx,
  organizationId: string,
  query: EmployeeListQuery
): Promise<EmployeeListResult> {
  const where: Prisma.EmployeeWhereInput = { organizationId };

  const orderBy: Record<
    EmployeeListQuery['sort'],
    Prisma.EmployeeOrderByWithRelationInput
  > = {
    lastName: { lastName: query.order },
    joinedAt: { joinedAt: query.order },
    employeeNumber: { employeeNumber: query.order },
    createdAt: { createdAt: query.order },
  };

  if (query.search) {
    where.OR = [
      { firstName: { contains: query.search, mode: 'insensitive' } },
      { lastName: { contains: query.search, mode: 'insensitive' } },
      { email: { contains: query.search, mode: 'insensitive' } },
      { employeeNumber: { contains: query.search, mode: 'insensitive' } },
      { jobTitle: { contains: query.search, mode: 'insensitive' } },
    ];
  }
  if (query.departmentId) {
    where.departmentId = query.departmentId;
  }
  if (query.status) {
    where.status = query.status;
  }

  const [total, employees, grouped, summaryTotal] = await Promise.all([
    tx.employee.count({ where }),
    tx.employee.findMany({
      where,
      include: DEPARTMENT_INCLUDE,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,    }),
    tx.employee.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    }),
    tx.employee.count({ where: { organizationId } }),
  ]);

  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));

  return {
    employees: employees.map(toEmployeeDto),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary: {
      total: summaryTotal,
      active: counts.get('ACTIVE') ?? 0,
      onLeave: counts.get('ON_LEAVE') ?? 0,
      suspended: counts.get('SUSPENDED') ?? 0,
      terminated: counts.get('TERMINATED') ?? 0,
    },
    sort: { field: query.sort, order: query.order },
  };
}

export async function getEmployee(tx: Tx, organizationId: string, employeeId: string) {
  const employee = await requireEmployee(tx, organizationId, employeeId);
  return toEmployeeDto(employee);
}

export async function createEmployee(
  tx: Tx,
  organizationId: string,
  actorId: string,
  input: EmployeeCreateInput
) {
  await assertDepartment(tx, organizationId, input.departmentId);

  const employeeNumber = await allocateEmployeeNumber(tx, organizationId);

  try {
    const employee = await tx.employee.create({
      data: {
        organizationId,
        employeeNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle,
        employmentType: input.employmentType,
        joinedAt: new Date(`${input.joinedAt}T00:00:00.000Z`),
        baseSalary: new Prisma.Decimal(input.baseSalary),
        departmentId: input.departmentId ?? null,
      },
      include: DEPARTMENT_INCLUDE,
    });

    await writeAudit(tx, organizationId, actorId, 'employee.created', employee.id, {
      employeeNumber: employee.employeeNumber,
    });

    return toEmployeeDto(employee);
  } catch (error) {
    if (isUniqueViolation(error, 'email')) {
      throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'An employee with this email already exists');
    }
    if (isUniqueViolation(error, 'employee_number')) {
      throw new HttpError(409, 'DUPLICATE_EMPLOYEE_NUMBER', 'Could not allocate a unique employee number');
    }
    throw error;
  }
}

export async function updateEmployee(
  tx: Tx,
  organizationId: string,
  actorId: string,
  employeeId: string,
  input: EmployeeUpdateInput
) {
  const existing = await requireEmployee(tx, organizationId, employeeId);

  if (input.departmentId !== undefined) {
    await assertDepartment(tx, organizationId, input.departmentId);
  }

  const data: Prisma.EmployeeUpdateInput = {};
  const changedFields: string[] = [];

  if (input.firstName !== undefined && input.firstName !== existing.firstName) {
    data.firstName = input.firstName;
    changedFields.push('firstName');
  }
  if (input.lastName !== undefined && input.lastName !== existing.lastName) {
    data.lastName = input.lastName;
    changedFields.push('lastName');
  }
  if (input.email !== undefined && input.email !== existing.email) {
    data.email = input.email;
    changedFields.push('email');
  }
  if (input.phone !== undefined && input.phone !== existing.phone) {
    data.phone = input.phone;
    changedFields.push('phone');
  }
  if (input.jobTitle !== undefined && input.jobTitle !== existing.jobTitle) {
    data.jobTitle = input.jobTitle;
    changedFields.push('jobTitle');
  }
  if (
    input.employmentType !== undefined &&
    input.employmentType !== existing.employmentType
  ) {
    data.employmentType = input.employmentType;
    changedFields.push('employmentType');
  }
  if (input.joinedAt !== undefined) {
    const joinedAt = new Date(`${input.joinedAt}T00:00:00.000Z`);
    if (joinedAt.getTime() !== existing.joinedAt.getTime()) {
      data.joinedAt = joinedAt;
      changedFields.push('joinedAt');
    }
  }
  if (input.baseSalary !== undefined) {
    const baseSalary = new Prisma.Decimal(input.baseSalary);
    if (!baseSalary.equals(existing.baseSalary)) {
      data.baseSalary = baseSalary;
      changedFields.push('baseSalary');
    }
  }
  if (input.departmentId !== undefined && input.departmentId !== existing.departmentId) {
    data.department = input.departmentId
      ? { connect: { id: input.departmentId } }
      : { disconnect: true };
    changedFields.push('departmentId');
  }

  if (changedFields.length === 0) {
    return toEmployeeDto(existing);
  }

  try {
    const employee = await tx.employee.update({
      where: { id: employeeId },
      data,
      include: DEPARTMENT_INCLUDE,
    });

    await writeAudit(tx, organizationId, actorId, 'employee.updated', employee.id, {
      changedFields,
    });

    return toEmployeeDto(employee);
  } catch (error) {
    if (isUniqueViolation(error, 'email')) {
      throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'An employee with this email already exists');
    }
    throw error;
  }
}

export async function changeEmployeeStatus(
  tx: Tx,
  organizationId: string,
  actorId: string,
  employeeId: string,
  status: EmployeeWithDepartment['status']
) {
  const existing = await requireEmployee(tx, organizationId, employeeId);

  if (existing.status === status) {
    return toEmployeeDto(existing);
  }

  const employee = await tx.employee.update({
    where: { id: employeeId },
    data: { status },
    include: DEPARTMENT_INCLUDE,
  });

  await writeAudit(tx, organizationId, actorId, 'employee.status_changed', employee.id, {
    from: existing.status,
    to: status,
  });

  return toEmployeeDto(employee);
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=apps/api
```

Expected: pass. If `Prisma.EmployeeUpdateInput` rejects `data.phone = null`, change the annotation to `Prisma.EmployeeUncheckedUpdateInput`.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/employees.service.ts
git commit -m "feat(api): add tenant-scoped employee service"
```

---

## Task 5: Employee and department routers

**Files:**
- Create: `apps/api/src/routes/employees.routes.ts`
- Create: `apps/api/src/routes/departments.routes.ts`
- Modify: `apps/api/src/routes/index.ts`

- [ ] **Step 1: Implement the employee router**

Create `apps/api/src/routes/employees.routes.ts`:

```ts
import { Response, Router } from 'express';
import { ZodTypeAny } from 'zod';
import { UserRole } from '@prisma/client';
import { requireAuth, requireRole, tenantRouteHandler } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/auth';
import { HttpError } from '../lib/httpError';
import {
  employeeCreateSchema,
  employeeIdSchema,
  employeeListQuerySchema,
  employeeStatusSchema,
  employeeUpdateSchema,
} from './employees.schema';
import {
  changeEmployeeStatus,
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from './employees.service';

export const employeesRouter = Router();

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

employeesRouter.use(requireAuth, requireRole(...HR_ROLES));

function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T['parse']> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
    );
  }
  return result.data;
}

function actor(req: AuthenticatedRequest): { organizationId: string; userId: string } {
  if (!req.auth) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Authentication required');
  }
  return { organizationId: req.auth.organization.id, userId: req.auth.user.id };
}

employeesRouter.get(
  '/',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId } = actor(req);
    const query = parse(employeeListQuerySchema, req.query);
    const result = await listEmployees(tx, organizationId, query);
    res.json({ success: true, data: result });
  })
);

employeesRouter.get(
  '/:id',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId } = actor(req);
    const id = parse(employeeIdSchema, req.params.id);
    const employee = await getEmployee(tx, organizationId, id);
    res.json({ success: true, data: { employee } });
  })
);

employeesRouter.post(
  '/',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId, userId } = actor(req);
    const input = parse(employeeCreateSchema, req.body);
    const employee = await createEmployee(tx, organizationId, userId, input);
    res.status(201).location(`/api/employees/${employee.id}`).json({
      success: true,
      data: { employee },
    });
  })
);

employeesRouter.patch(
  '/:id/status',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId, userId } = actor(req);
    const id = parse(employeeIdSchema, req.params.id);
    const { status } = parse(employeeStatusSchema, req.body);
    const employee = await changeEmployeeStatus(tx, organizationId, userId, id, status);
    res.json({ success: true, data: { employee } });
  })
);

employeesRouter.patch(
  '/:id',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId, userId } = actor(req);
    const id = parse(employeeIdSchema, req.params.id);
    const input = parse(employeeUpdateSchema, req.body);
    const employee = await updateEmployee(tx, organizationId, userId, id, input);
    res.json({ success: true, data: { employee } });
  })
);
```

- [ ] **Step 2: Implement the department router**

Create `apps/api/src/routes/departments.routes.ts`:

```ts
import { Response, Router } from 'express';
import { UserRole } from '@prisma/client';
import { requireAuth, requireRole, tenantRouteHandler } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/auth';

export const departmentsRouter = Router();

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

departmentsRouter.use(requireAuth, requireRole(...HR_ROLES));

departmentsRouter.get(
  '/',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const organizationId = req.auth?.organization.id;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        error: { code: 'NO_TENANT_CONTEXT', message: 'Tenant context is required' },
      });
      return;
    }

    const departments = await tx.department.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, description: true },
    });

    res.json({ success: true, data: { departments } });
  })
);
```

- [ ] **Step 3: Mount the routers**

Replace `apps/api/src/routes/index.ts` with:

```ts
import { Router } from 'express';
import { healthRouter } from './health.routes';
import { authRouter } from './auth.routes';
import { employeesRouter } from './employees.routes';
import { departmentsRouter } from './departments.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/auth', authRouter);
apiRouter.use('/employees', employeesRouter);
apiRouter.use('/departments', departmentsRouter);

apiRouter.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'PayPilot HRMS & Payroll API Service',
    version: '0.1.0',
    docs: '/api/health',
  });
});
```

- [ ] **Step 4: Typecheck and build**

```bash
npm run typecheck --workspace=apps/api
npm run build --workspace=apps/api
```

Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/employees.routes.ts apps/api/src/routes/departments.routes.ts apps/api/src/routes/index.ts
git commit -m "feat(api): expose employee and department endpoints"
```

---

## Task 6: Integration tests

**Files:**
- Create: `apps/api/src/routes/employees.integration.test.ts`

- [ ] **Step 1: Write the integration tests**

Create `apps/api/src/routes/employees.integration.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withOrganizationContext } from '../lib/tenant';
import { HttpError } from '../lib/httpError';
import {
  changeEmployeeStatus,
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from './employees.service';
import { EmployeeListQuery } from './employees.schema';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

const orgA = '33333333-3333-4333-8333-333333333333';
const orgB = '44444444-4444-4444-8444-444444444444';
const userA = '33333333-3333-4333-8333-333333333301';
const userB = '44444444-4444-4444-8444-444444444401';

let adminPrisma: PrismaClient;
let deptA: string;
let deptB: string;

const baseQuery: EmployeeListQuery = {
  page: 1,
  pageSize: 25,
  sort: 'lastName',
  order: 'asc',
};

const input = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Alex',
  lastName: 'Mercer',
  email: 'alex.mercer@example.com',
  phone: '+1 (555) 234-5678',
  jobTitle: 'VP of Engineering',
  employmentType: 'FULL_TIME' as const,
  joinedAt: '2026-01-15',
  baseSalary: '145000.00',
  departmentId: null,
  ...overrides,
});

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    return true;
  });
}

before(async () => {
  if (!dbIntegration) {
    return;
  }
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  for (const org of [
    { id: orgA, name: 'Employee Org A', slug: 'employee-org-a' },
    { id: orgB, name: 'Employee Org B', slug: 'employee-org-b' },
  ]) {
    await adminPrisma.organization.upsert({
      where: { id: org.id },
      update: {},
      create: { ...org, currency: 'USD', timezone: 'UTC' },
    });
  }

  for (const [id, organizationId, email] of [
    [userA, orgA, 'hr-a@example.com'],
    [userB, orgB, 'hr-b@example.com'],
  ]) {
    await adminPrisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId,
        email,
        role: UserRole.HR_MANAGER,
        identityIssuer: 'test',
        identitySubject: `subject-${id}`,
      },
    });
  }

  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.department.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });

  deptA = (
    await adminPrisma.department.create({
      data: { organizationId: orgA, name: 'Engineering', code: 'ENG' },
    })
  ).id;
  deptB = (
    await adminPrisma.department.create({
      data: { organizationId: orgB, name: 'Finance', code: 'FIN' },
    })
  ).id;
});

after(async () => {
  if (!dbIntegration) {
    return;
  }
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.department.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

describeDb('Employee directory service', () => {
  it('creates employees with sequential numbers and audits the create', async () => {
    const first = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'first@example.com' }))
    );
    const second = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'second@example.com' }))
    );

    assert.equal(first.employeeNumber, 'PP-1001');
    assert.equal(second.employeeNumber, 'PP-1002');

    const audits = await adminPrisma.auditLog.findMany({
      where: { organizationId: orgA, action: 'employee.created' },
    });
    assert.equal(audits.length, 2);
    assert.equal(audits[0].actorId, userA);
  });

  it('allocates distinct numbers for concurrent creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        withOrganizationContext(orgA, (tx) =>
          createEmployee(
            tx,
            orgA,
            userA,
            input({ email: `concurrent-${index}@example.com` })
          )
        )
      )
    );

    const numbers = results.map((row) => row.employeeNumber);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  it('lists, searches, filters, paginates, and summarizes', async () => {
    const result = await withOrganizationContext(orgA, (tx) =>
      listEmployees(tx, orgA, { ...baseQuery, search: 'second' })
    );
    assert.equal(result.employees.length, 1);
    assert.equal(result.employees[0].email, 'second@example.com');
    assert.equal(result.pagination.total, 1);
    assert.ok(result.summary.total >= 6);

    const byDepartment = await withOrganizationContext(orgA, (tx) =>
      listEmployees(tx, orgA, { ...baseQuery, departmentId: deptA })
    );
    assert.equal(byDepartment.pagination.total, 0);

    const paged = await withOrganizationContext(orgA, (tx) =>
      listEmployees(tx, orgA, { ...baseQuery, pageSize: 2, page: 2 })
    );
    assert.equal(paged.employees.length, 2);
    assert.equal(paged.pagination.page, 2);
  });

  it('updates fields and records changed fields without salary values', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'update@example.com' }))
    );

    const updated = await withOrganizationContext(orgA, (tx) =>
      updateEmployee(tx, orgA, userA, created.id, {
        jobTitle: 'CTO',
        baseSalary: '155000.00',
        departmentId: deptA,
      })
    );

    assert.equal(updated.jobTitle, 'CTO');
    assert.equal(updated.baseSalary, '155000.00');
    assert.equal(updated.departmentName, 'Engineering');

    const audit = await adminPrisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'employee.updated' },
      orderBy: { createdAt: 'desc' },
    });
    assert.deepEqual(audit?.metadata, {
      changedFields: ['jobTitle', 'baseSalary', 'departmentId'],
    });
    assert.equal(JSON.stringify(audit?.metadata).includes('155000'), false);
  });

  it('changes status and audits the transition', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'status@example.com' }))
    );

    const updated = await withOrganizationContext(orgA, (tx) =>
      changeEmployeeStatus(tx, orgA, userA, created.id, 'ON_LEAVE')
    );
    assert.equal(updated.status, 'ON_LEAVE');

    const audit = await adminPrisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'employee.status_changed' },
    });
    assert.deepEqual(audit?.metadata, { from: 'ACTIVE', to: 'ON_LEAVE' });
  });

  it('rejects duplicate email in the same organization but allows it in another', async () => {
    await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'shared@example.com' }))
    );

    await expectHttpError(
      withOrganizationContext(orgA, (tx) =>
        createEmployee(tx, orgA, userA, input({ email: 'shared@example.com' }))
      ),
      409,
      'EMAIL_ALREADY_EXISTS'
    );

    const other = await withOrganizationContext(orgB, (tx) =>
      createEmployee(tx, orgB, userB, input({ email: 'shared@example.com' }))
    );
    assert.equal(other.email, 'shared@example.com');
  });

  it('rejects a department from another organization', async () => {
    await expectHttpError(
      withOrganizationContext(orgA, (tx) =>
        createEmployee(tx, orgA, userA, input({ email: 'foreign@example.com', departmentId: deptB }))
      ),
      400,
      'INVALID_DEPARTMENT'
    );
  });

  it('hides employees from other tenants', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'hidden@example.com' }))
    );

    await expectHttpError(
      withOrganizationContext(orgB, (tx) => getEmployee(tx, orgB, created.id)),
      404,
      'EMPLOYEE_NOT_FOUND'
    );

    await expectHttpError(
      withOrganizationContext(orgB, (tx) =>
        updateEmployee(tx, orgB, userB, created.id, { jobTitle: 'Hijacked' })
      ),
      404,
      'EMPLOYEE_NOT_FOUND'
    );

    await expectHttpError(
      withOrganizationContext(orgB, (tx) =>
        changeEmployeeStatus(tx, orgB, userB, created.id, 'TERMINATED')
      ),
      404,
      'EMPLOYEE_NOT_FOUND'
    );
  });

  it('returns nothing without tenant context', async () => {
    const rows = await prisma.employee.findMany({ where: { organizationId: orgA } });
    assert.equal(rows.length, 0);
  });
});
```

- [ ] **Step 2: Run the integration tests**

Ensure the Docker stack is up, then:

```bash
npm run test:integration --workspace=apps/api 2>&1 | tail -40
```

Expected: the new `Employee directory service` block passes; no failures.

RBAC is already covered by `apps/api/src/middleware/auth.test.ts` (`Role authorization middleware`). The repository has no HTTP test harness, so the mounted employee routes are verified manually in Task 13.

- [ ] **Step 3: Fix any failures before continuing**

Common causes:

- `P2002` target text differs by Prisma version → log `error.meta?.target` and match on the index name.
- `Decimal.equals` is unavailable → compare `baseSalary.toString()` values instead.
- Concurrency test flakiness → confirm `pg_advisory_xact_lock` is called with `$executeRaw` inside the same transaction as the insert. Use `$executeRaw`, not `$queryRaw`: the function returns PostgreSQL `void`, which Prisma cannot deserialize. Do not add an in-transaction retry after a unique violation; PostgreSQL aborts that transaction.

Do not weaken assertions to make the tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/employees.integration.test.ts
git commit -m "test(api): cover employee CRUD and tenant isolation"
```

---

## Task 7: Development seed script

**Files:**
- Create: `scripts/seed-dev-data.ts`
- Modify: `package.json` (root scripts)

- [ ] **Step 1: Implement the seed script**

Create `scripts/seed-dev-data.ts`:

```ts
#!/usr/bin/env tsx

import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', description: 'Software development, cloud infrastructure, and QA' },
  { name: 'Product & Design', code: 'PROD', description: 'Product strategy, UX/UI design, and user research' },
  { name: 'Sales & Marketing', code: 'S&M', description: 'Enterprise sales, demand generation, and marketing' },
  { name: 'Human Resources', code: 'HR', description: 'Talent acquisition, employee relations, and compliance' },
  { name: 'Operations & Finance', code: 'OPS', description: 'Financial management, payroll, accounting, and legal' },
  { name: 'Customer Success', code: 'CS', description: 'Client onboarding, technical support, and retention' },
];

async function main() {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL is required to seed development data');
  }

  const slug = process.env.SEED_ORGANIZATION_SLUG ?? 'paypilot-demo';
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

  try {
    const organization = await prisma.organization.findUnique({ where: { slug } });
    if (!organization) {
      throw new Error(
        `Organization "${slug}" not found. Run "npm run provision:user" first or set SEED_ORGANIZATION_SLUG.`
      );
    }

    for (const department of DEPARTMENTS) {
      await prisma.department.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: department.code,
          },
        },
        update: { name: department.name, description: department.description },
        create: { organizationId: organization.id, ...department },
      });
    }

    console.log(
      `Seeded ${DEPARTMENTS.length} departments for ${organization.name} (${organization.id}).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In the root `package.json` scripts, add after `provision:user`:

```json
    "seed:dev": "tsx scripts/seed-dev-data.ts",
```

- [ ] **Step 3: Run the seed twice to prove idempotency**

```bash
npm run seed:dev
npm run seed:dev
```

Expected: both runs print `Seeded 6 departments ...`.

- [ ] **Step 4: Verify the rows**

```bash
APP_DB=$(grep '^PAYPILOT_DB_NAME=' .env | cut -d= -f2- | tr -d '"')
MIG_USER=$(grep '^PAYPILOT_MIGRATOR_USER=' .env | cut -d= -f2- | tr -d '"')
MIG_PW=$(grep '^PAYPILOT_MIGRATOR_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
PGPASSWORD="$MIG_PW" psql -h localhost -p 5433 -U "$MIG_USER" -d "$APP_DB" \
  -c "SELECT code, name FROM departments ORDER BY code;"
```

Expected: six rows, one per code, no duplicates.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-dev-data.ts package.json
git commit -m "feat(dev): seed demo departments"
```

---

## Task 8: Frontend types and API helpers

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/employees.ts`

- [ ] **Step 1: Add DTO types**

Append to `apps/web/src/types/index.ts`:

```ts
export interface EmployeeDto {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinedAt: string;
  baseSalary: string;
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  description: string | null;
}

export interface EmployeeListResult {
  employees: EmployeeDto[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    active: number;
    onLeave: number;
    suspended: number;
    terminated: number;
  };
  sort: { field: string; order: string };
}

export interface EmployeeCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  jobTitle: string;
  departmentId?: string | null;
  employmentType: EmploymentType;
  joinedAt: string;
  baseSalary: string;
}

export type EmployeeUpdateInput = Partial<EmployeeCreateInput>;

export interface EmployeeFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  departmentId?: string;
  status?: EmployeeStatus;
  sort?: 'lastName' | 'joinedAt' | 'employeeNumber' | 'createdAt';
  order?: 'asc' | 'desc';
}
```

- [ ] **Step 2: Preserve server error details**

In `apps/web/src/lib/api.ts`, replace the `ApiError` class and the error throw in `handleResponse`:

```ts
export interface ApiErrorDetail {
  path: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: ApiErrorDetail[]
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
```

and inside `handleResponse`:

```ts
    if (!response.ok) {
      throw new ApiError(
        data.error?.message || 'Request failed',
        response.status,
        data.error?.code,
        (data.error as { details?: ApiErrorDetail[] } | undefined)?.details
      );
    }
```

Also widen the `ApiResponse.error` type:

```ts
  error?: {
    code: string;
    message: string;
    details?: ApiErrorDetail[];
  };
```

- [ ] **Step 3: Add typed helpers**

Create `apps/web/src/lib/employees.ts`:

```ts
import { api } from './api';
import type {
  DepartmentDto,
  EmployeeCreateInput,
  EmployeeDto,
  EmployeeFilters,
  EmployeeListResult,
  EmployeeStatus,
  EmployeeUpdateInput,
} from '../types';

function toQueryString(filters: EmployeeFilters): string {
  const params = new URLSearchParams();
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  if (filters.status) params.set('status', filters.status);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function listEmployees(filters: EmployeeFilters): Promise<EmployeeListResult> {
  return api.get<EmployeeListResult>(`/employees${toQueryString(filters)}`);
}

export function getEmployee(id: string): Promise<{ employee: EmployeeDto }> {
  return api.get<{ employee: EmployeeDto }>(`/employees/${id}`);
}

export function createEmployee(input: EmployeeCreateInput): Promise<{ employee: EmployeeDto }> {
  return api.post<{ employee: EmployeeDto }>('/employees', input);
}

export function updateEmployee(
  id: string,
  input: EmployeeUpdateInput
): Promise<{ employee: EmployeeDto }> {
  return api.patch<{ employee: EmployeeDto }>(`/employees/${id}`, input);
}

export function changeEmployeeStatus(
  id: string,
  status: EmployeeStatus
): Promise<{ employee: EmployeeDto }> {
  return api.patch<{ employee: EmployeeDto }>(`/employees/${id}/status`, { status });
}

export function listDepartments(): Promise<{ departments: DepartmentDto[] }> {
  return api.get<{ departments: DepartmentDto[] }>('/departments');
}
```

- [ ] **Step 4: Typecheck the web app**

```bash
npm run typecheck --workspace=apps/web
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/lib/api.ts apps/web/src/lib/employees.ts
git commit -m "feat(web): add employee API client and types"
```

---

## Task 9: Modal primitive

**Files:**
- Create: `apps/web/src/components/ui/Modal.tsx`

- [ ] **Step 1: Implement the modal**

Create `apps/web/src/components/ui/Modal.tsx`:

```tsx
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  className,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCloseRef.current();
      }
      if (event.key !== 'Tab' || !panelRef.current) {
        return;
      }

      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    firstFieldRef.current =
      panelRef.current?.querySelector<HTMLElement>(
        'input, select, textarea, [data-autofocus]'
      ) ?? null;
    firstFieldRef.current?.focus();

    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          'bg-white rounded-xl w-full max-w-2xl shadow-xl border border-slate-200 max-h-[90vh] overflow-y-auto',
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="px-6 py-4 bg-slate-50/75 border-t border-slate-100 flex justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck --workspace=apps/web
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/Modal.tsx
git commit -m "feat(web): add accessible modal primitive"
```

---

## Task 10: Employee form and status dialogs

**Files:**
- Create: `apps/web/src/components/employees/EmployeeFormModal.tsx`
- Create: `apps/web/src/components/employees/EmployeeStatusDialog.tsx`

- [ ] **Step 1: Implement the form modal**

Create `apps/web/src/components/employees/EmployeeFormModal.tsx`:

```tsx
import React, { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ApiError } from '../../lib/api';
import { createEmployee, updateEmployee } from '../../lib/employees';
import type {
  DepartmentDto,
  EmployeeCreateInput,
  EmployeeDto,
  EmploymentType,
} from '../../types';

const EMPLOYMENT_TYPES: EmploymentType[] = ['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN'];

interface EmployeeFormModalProps {
  open: boolean;
  employee: EmployeeDto | null;
  departments: DepartmentDto[];
  onClose: () => void;
  onSaved: () => void;
}

type FormState = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  departmentId: string;
  employmentType: EmploymentType;
  joinedAt: string;
  baseSalary: string;
};

function toFormState(employee: EmployeeDto | null): FormState {
  if (!employee) {
    return {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      jobTitle: '',
      departmentId: '',
      employmentType: 'FULL_TIME',
      joinedAt: new Date().toISOString().slice(0, 10),
      baseSalary: '',
    };
  }

  return {
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone ?? '',
    jobTitle: employee.jobTitle,
    departmentId: employee.departmentId ?? '',
    employmentType: employee.employmentType,
    joinedAt: employee.joinedAt,
    baseSalary: employee.baseSalary,
  };
}

function validate(form: FormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.firstName.trim()) errors.firstName = 'First name is required';
  if (!form.lastName.trim()) errors.lastName = 'Last name is required';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email';
  }
  if (!form.jobTitle.trim()) errors.jobTitle = 'Job title is required';
  if (!form.joinedAt) errors.joinedAt = 'Joined date is required';
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(form.baseSalary.trim()) || Number(form.baseSalary) <= 0) {
    errors.baseSalary = 'Enter a positive salary with up to 2 decimals';
  }
  return errors;
}

const fieldClass =
  'w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500';

const labelClass = 'block text-xs font-medium text-slate-600 mb-1.5';

export const EmployeeFormModal: React.FC<EmployeeFormModalProps> = ({
  open,
  employee,
  departments,
  onClose,
  onSaved,
}) => {
  const [form, setForm] = useState<FormState>(() => toFormState(employee));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const title = employee ? 'Edit employee' : 'Add employee';

  const departmentOptions = useMemo(
    () => departments.map((department) => (
      <option key={department.id} value={department.id}>
        {department.name} ({department.code})
      </option>
    )),
    [departments]
  );

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    const payload: EmployeeCreateInput = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim().toLowerCase(),
      phone: form.phone.trim() === '' ? null : form.phone.trim(),
      jobTitle: form.jobTitle.trim(),
      departmentId: form.departmentId === '' ? null : form.departmentId,
      employmentType: form.employmentType,
      joinedAt: form.joinedAt,
      baseSalary: form.baseSalary.trim(),
    };

    setSaving(true);
    setSubmitError(null);
    try {
      if (employee) {
        await updateEmployee(employee.id, payload);
      } else {
        await createEmployee(payload);
      }
      onSaved();
      onClose();
    } catch (error) {
      if (error instanceof ApiError && error.details?.length) {
        setErrors(
          Object.fromEntries(error.details.map((detail) => [detail.path, detail.message]))
        );
        setSubmitError(error.message);
      } else if (error instanceof ApiError) {
        setSubmitError(error.message);
      } else {
        setSubmitError('Could not save the employee. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      description={
        employee
          ? `Employee ${employee.employeeNumber}. Status changes use the row action.`
          : 'Employee numbers are assigned automatically.'
      }
      onClose={saving ? () => undefined : onClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            form="employee-form"
            disabled={saving}
            icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {saving ? 'Saving…' : employee ? 'Save changes' : 'Create employee'}
          </Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelClass} htmlFor="firstName">First name</label>
          <input id="firstName" className={fieldClass} value={form.firstName}
            onChange={(event) => update('firstName', event.target.value)} />
          {errors.firstName && <p className="text-xs text-rose-600 mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="lastName">Last name</label>
          <input id="lastName" className={fieldClass} value={form.lastName}
            onChange={(event) => update('lastName', event.target.value)} />
          {errors.lastName && <p className="text-xs text-rose-600 mt-1">{errors.lastName}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="email">Email</label>
          <input id="email" type="email" className={fieldClass} value={form.email}
            onChange={(event) => update('email', event.target.value)} />
          {errors.email && <p className="text-xs text-rose-600 mt-1">{errors.email}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="phone">Phone (optional)</label>
          <input id="phone" className={fieldClass} value={form.phone}
            onChange={(event) => update('phone', event.target.value)} />
          {errors.phone && <p className="text-xs text-rose-600 mt-1">{errors.phone}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="jobTitle">Job title</label>
          <input id="jobTitle" className={fieldClass} value={form.jobTitle}
            onChange={(event) => update('jobTitle', event.target.value)} />
          {errors.jobTitle && <p className="text-xs text-rose-600 mt-1">{errors.jobTitle}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="departmentId">Department</label>
          <select id="departmentId" className={fieldClass} value={form.departmentId}
            onChange={(event) => update('departmentId', event.target.value)}>
            <option value="">Unassigned</option>
            {departmentOptions}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="employmentType">Employment type</label>
          <select id="employmentType" className={fieldClass} value={form.employmentType}
            onChange={(event) => update('employmentType', event.target.value as EmploymentType)}>
            {EMPLOYMENT_TYPES.map((type) => (
              <option key={type} value={type}>{type.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="joinedAt">Joined date</label>
          <input id="joinedAt" type="date" className={fieldClass} value={form.joinedAt}
            onChange={(event) => update('joinedAt', event.target.value)} />
          {errors.joinedAt && <p className="text-xs text-rose-600 mt-1">{errors.joinedAt}</p>}
        </div>
        <div>
          <label className={labelClass} htmlFor="baseSalary">Base salary (yearly)</label>
          <input id="baseSalary" inputMode="decimal" className={fieldClass} value={form.baseSalary}
            onChange={(event) => update('baseSalary', event.target.value)} />
          {errors.baseSalary && <p className="text-xs text-rose-600 mt-1">{errors.baseSalary}</p>}
        </div>
        {submitError && (
          <p className="sm:col-span-2 text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
            {submitError}
          </p>
        )}
      </form>
    </Modal>
  );
};
```

The parent must remount this component per open (use `key={employee?.id ?? 'new'}`) so the initial state reflects the selected employee.

- [ ] **Step 2: Implement the status dialog**

Create `apps/web/src/components/employees/EmployeeStatusDialog.tsx`:

```tsx
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ApiError } from '../../lib/api';
import { changeEmployeeStatus } from '../../lib/employees';
import type { EmployeeDto, EmployeeStatus } from '../../types';

const STATUSES: EmployeeStatus[] = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED'];

interface EmployeeStatusDialogProps {
  employee: EmployeeDto | null;
  onClose: () => void;
  onSaved: () => void;
}

export const EmployeeStatusDialog: React.FC<EmployeeStatusDialogProps> = ({
  employee,
  onClose,
  onSaved,
}) => {
  const [status, setStatus] = useState<EmployeeStatus>(employee?.status ?? 'ACTIVE');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!employee) {
    return null;
  }

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);
    try {
      await changeEmployeeStatus(employee.id, status);
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not change status');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Change employee status"
      description={`${employee.firstName} ${employee.lastName} (${employee.employeeNumber})`}
      onClose={saving ? () => undefined : onClose}
      className="max-w-md"
      footer={
        <>
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSubmit}
            disabled={saving || status === employee.status}
            icon={saving ? <Loader2 className="w-4 h-4 animate-spin" /> : undefined}
          >
            {saving ? 'Saving…' : 'Update status'}
          </Button>
        </>
      }
    >
      <label className="block text-xs font-medium text-slate-600 mb-1.5" htmlFor="status">
        New status
      </label>
      <select
        id="status"
        value={status}
        onChange={(event) => setStatus(event.target.value as EmployeeStatus)}
        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand-500"
      >
        {STATUSES.map((value) => (
          <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>
        ))}
      </select>
      {error && (
        <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mt-3">
          {error}
        </p>
      )}
    </Modal>
  );
};
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck --workspace=apps/web
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/employees/EmployeeFormModal.tsx apps/web/src/components/employees/EmployeeStatusDialog.tsx
git commit -m "feat(web): add employee form and status dialogs"
```

---

## Task 11: Live Employees page

**Files:**
- Modify: `apps/web/src/pages/EmployeesPage.tsx` (full replacement)

- [ ] **Step 1: Replace the page**

Replace `apps/web/src/pages/EmployeesPage.tsx` with:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  Users,
  Search,
  Filter,
  Plus,
  Briefcase,
  Mail,
  Pencil,
  RefreshCw,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { EmployeeFormModal } from '../components/employees/EmployeeFormModal';
import { EmployeeStatusDialog } from '../components/employees/EmployeeStatusDialog';
import { ApiError } from '../lib/api';
import { listDepartments, listEmployees } from '../lib/employees';
import { formatCurrency, formatDate } from '../lib/utils';
import type {
  DepartmentDto,
  EmployeeDto,
  EmployeeListResult,
  EmployeeStatus,
} from '../types';

const PAGE_SIZES = [10, 25, 50];

const statusVariant = (status: EmployeeStatus) => {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'ON_LEAVE') return 'warning' as const;
  if (status === 'TERMINATED') return 'danger' as const;
  return 'neutral' as const;
};

export const EmployeesPage: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState<'' | EmployeeStatus>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [data, setData] = useState<EmployeeListResult | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<EmployeeDto | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    listDepartments()
      .then((result) => setDepartments(result.departments))
      .catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await listEmployees({
        page,
        pageSize,
        search: search || undefined,
        departmentId: departmentId || undefined,
        status: status || undefined,
      });
      setData(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setForbidden(true);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not load employees');
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, departmentId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (employee: EmployeeDto) => {
    setEditing(employee);
    setFormOpen(true);
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          You don't have access to the employee directory. Contact an administrator if you need it.
        </p>
      </div>
    );
  }

  const summary = data?.summary;
  const pagination = data?.pagination;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Workforce Directory</h2>
          <p className="text-xs text-slate-500 mt-1">
            Live employee records for your organization.
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
          Add Employee
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Headcount</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{summary?.total ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Active Status</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{summary?.active ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">On Leave</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{summary?.onLeave ?? '—'}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Departments</p>
          <p className="text-2xl font-bold text-brand-600 mt-1">{departments.length}</p>
        </Card>
      </div>

      <Card>
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, email, ID, or job title..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={departmentId}
              onChange={(event) => { setDepartmentId(event.target.value); setPage(1); }}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} ({department.code})
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => { setStatus(event.target.value as '' | EmployeeStatus); setPage(1); }}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void load()}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
          </div>
        )}

        <CardContent className="p-0">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading employees…
            </div>
          ) : !loading && data && data.employees.length === 0 ? (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title={search || departmentId || status ? 'No matching employees' : 'No employees yet'}
              description={
                search || departmentId || status
                  ? 'Try clearing the search or filters.'
                  : 'Add your first employee to start building the directory.'
              }
              actionLabel={search || departmentId || status ? undefined : 'Add employee'}
              onAction={openCreate}
              className="m-4"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>ID Code</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Base Salary</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.employees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-semibold flex items-center justify-center text-xs shrink-0">
                          {employee.firstName[0]}{employee.lastName[0]}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 text-xs">
                            {employee.firstName} {employee.lastName}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {employee.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {employee.employeeNumber}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium text-slate-700">
                        {employee.departmentName ?? 'Unassigned'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                        {employee.jobTitle}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {employee.employmentType.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(employee.status)} dot size="sm">
                        {employee.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-slate-800 text-xs">
                      {formatCurrency(Number(employee.baseSalary))} / yr
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(employee.joinedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(employee)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusTarget(employee)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Change status for ${employee.firstName} ${employee.lastName}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            {pagination
              ? `Showing ${pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1}–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                )} of ${pagination.total}`
              : 'No results'}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>{size} / page</option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination || pagination.page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination || pagination.page >= pagination.totalPages || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {formOpen && (
        <EmployeeFormModal
          key={editing?.id ?? 'new'}
          open={formOpen}
          employee={editing}
          departments={departments}
          onClose={() => setFormOpen(false)}
          onSaved={() => void load()}
        />
      )}
      <EmployeeStatusDialog
        key={statusTarget?.id ?? 'none'}
        employee={statusTarget}
        onClose={() => setStatusTarget(null)}
        onSaved={() => void load()}
      />
    </div>
  );
};
```

- [ ] **Step 2: Typecheck and build**

```bash
npm run typecheck --workspace=apps/web
npm run build --workspace=apps/web
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/EmployeesPage.tsx
git commit -m "feat(web): load employee directory from the API"
```

---

## Task 12: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the phase note**

Replace the blockquote under section 1 with:

```markdown
> **Current phase:** Supabase has been replaced with independently managed PostgreSQL and Keycloak. Authentication uses Authorization Code + PKCE S256, the API verifies Keycloak JWTs through JWKS, and PostgreSQL RLS isolates tenants using transaction-local context. The employee directory is backed by live database records; attendance, leave, and payroll remain demo views.
```

- [ ] **Step 2: Document the seed command**

Insert a new `### 5.6 Seed demo departments` section after `### 5.5 Provision a development user` and renumber the existing `### 5.6 Run the applications` to `### 5.7 Run the applications`:

```markdown
### 5.6 Seed demo departments

Seed the demo departments (idempotent, requires the demo organization):

```bash
npm run seed:dev
```

Override the organization with `SEED_ORGANIZATION_SLUG`.
```

- [ ] **Step 3: Update the endpoint tables**

In section 10, add to the protected table:

```markdown
| `GET` | `/api/employees` | Paginated employee list with search, filters, and summary |
| `GET` | `/api/employees/:id` | Single employee |
| `POST` | `/api/employees` | Create an employee (HR roles) |
| `PATCH` | `/api/employees/:id` | Update employee fields (HR roles) |
| `PATCH` | `/api/employees/:id/status` | Change employee status (HR roles) |
| `GET` | `/api/departments` | Departments for the current organization |
```

Add below the table:

```markdown
Employee and department endpoints require `SUPER_ADMIN`, `ADMIN`, or `HR_MANAGER`.
```

- [ ] **Step 4: Update the milestone list**

Replace milestone 2 with:

```markdown
2. ~~**Employee Directory CRUD:**~~ Complete — validated API, tenant-scoped service, RLS enforcement, audit logging, live UI with create/edit and status changes.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: document employee directory endpoints"
```

---

## Task 13: Full verification

- [ ] **Step 1: Run every static check and test suite**

```bash
npm run prisma:validate
npm run typecheck
npm run typecheck:tests --workspace=apps/api
npm run build
npm test
npm run test:integration
npm run db:status
```

Expected:

- Prisma schema valid
- Typechecks pass
- Build produces `apps/api/dist/server.js` and `apps/web/dist/index.html`
- Unit tests: all pass
- Integration tests: all pass, including `Employee directory service`
- 5 migrations, database up to date

- [ ] **Step 2: Verify the live flow manually**

```bash
npm run dev
```

In the browser:

1. Sign in as `admin@paypilot.local`.
2. Open Employees; confirm six departments appear in the filter and the list is empty.
3. Create an employee; confirm `PP-1001` appears.
4. Create a second; confirm `PP-1002`.
5. Search by last name, filter by department and status, change page size.
6. Edit the job title and salary; confirm the table updates.
7. Change status to `ON_LEAVE`, then `TERMINATED`; confirm badges update.
8. Confirm duplicate email returns a field error.
9. Sign in as a MANAGER or EMPLOYEE user and confirm the access-restricted state. Provision one first with `npm run provision:user -- --email manager@paypilot.local --role MANAGER` if needed.

- [ ] **Step 3: Confirm audit rows**

```bash
APP_DB=$(grep '^PAYPILOT_DB_NAME=' .env | cut -d= -f2- | tr -d '"')
MIG_USER=$(grep '^PAYPILOT_MIGRATOR_USER=' .env | cut -d= -f2- | tr -d '"')
MIG_PW=$(grep '^PAYPILOT_MIGRATOR_PASSWORD=' .env | cut -d= -f2- | tr -d '"')
PGPASSWORD="$MIG_PW" psql -h localhost -p 5433 -U "$MIG_USER" -d "$APP_DB" \
  -c "SELECT action, entity_type, metadata FROM audit_logs ORDER BY created_at DESC LIMIT 10;"
```

Expected: `employee.created`, `employee.updated`, `employee.status_changed` rows with no salary values.

- [ ] **Step 4: Commit any verification fixes**

```bash
git status --short
git add -A
git commit -m "fix: address verification findings"
```

Only commit if Step 1 or 2 required changes. Do not commit generated `dist/` output (it is ignored).

---

## Task 14: Final review and handoff

- [ ] **Step 1: Review the diff against main**

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: only the files in the file map; `diff --check` reports no new whitespace errors.

- [ ] **Step 2: Confirm the spec is covered**

Check each acceptance criterion in the spec against the tests and manual results. If anything is missing, add the missing test or fix before finishing.

- [ ] **Step 3: Report**

Summarize:

- Files changed
- Commands run and their results
- Manual flow result
- Any remaining limitation (employee numbers are unique but not gapless; no account provisioning)
- Do not claim production readiness

- [ ] **Step 4: Hand off for review**

Use the `requesting-code-review` skill if available, or open a PR against `main` with the verification results. Do not merge without review.

---

## Execution notes (applied during implementation)

These reviewed changes supersede the snippets above:

- The advisory lock uses `$executeRaw`. `$queryRaw` cannot deserialize the `void` returned by `pg_advisory_xact_lock`.
- `updateEmployee` and `changeEmployeeStatus` use `where: { id, organizationId }` and map `P2025` to `404 EMPLOYEE_NOT_FOUND`.
- Pagination orders by the requested field plus `{ id: 'asc' }` for deterministic pages.
- `search` escapes `\`, `%`, and `_` before `contains`.
- `page` is clamped to `1..10000`.
- The list summary total is derived from the grouped status counts instead of an extra query.
- Prisma `P2003` is mapped to `400 INVALID_DEPARTMENT`.
- DTO `employmentType` and `status` use the Prisma enum types.
- `tenantRouteHandler` now receives `(req, tx)` and returns `{ status?, location?, body }`. The wrapper sends the response only after the transaction commits, so a rolled-back audit write can never produce a success response.
- The employee and department routers are factories that accept an injectable auth middleware. Production uses `requireAuth`; the integration tests inject a fake auth middleware to exercise the mounted routes over real HTTP.
- `changeEmployeeStatus` takes a per-employee advisory lock before reading, so concurrent transitions cannot record a stale audit `from`.
- Create and update wrap only the write in the error-mapping `try` block; audit writes happen after it, so an audit failure is a genuine 500 and not a misclassified unique violation.
- `updateEmployee` acquires the numbering lock only when an email is supplied.
- The email pre-check compares case-insensitively.
- The seed script resolves `.env` from the repository root and runs all upserts in one transaction.
- Integration tests also cover the mounted routes over HTTP: `201` + `Location`, validation `details`, `403`, cross-tenant `404`, list summary, and the departments envelope.
