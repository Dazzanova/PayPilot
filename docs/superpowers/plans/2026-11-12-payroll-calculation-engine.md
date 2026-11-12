# Payroll Calculation Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real payroll calculation engine on the existing `PayrollRun`/`Payslip` models: salary-plus-attendance gross, configurable deduction rules, a guarded lifecycle, structured payslips with CSV export, and the full payroll UI.

**Architecture:** A pure integer-cent calculation module sits behind a tenant-scoped service layer that uses Prisma transactions and the existing RLS helper. Three Express routers expose runs, payslips, and deduction rules. The web app replaces the mock payroll page with run list/detail, employee self-service payslips, and a deduction-rule page.

**Tech Stack:** TypeScript, Express 4, Prisma 5.22 / PostgreSQL, zod, node:test + tsx, React 18, React Router, Tailwind, lucide-react.

---

## Global Constraints

- Never stage or commit `apps/web/src/pages/DashboardPage.tsx`, `apps/web/src/pages/DepartmentsPage.tsx`, or `apps/web/src/pages/SettingsPage.tsx`. They contain pre-existing uncommitted user work.
- Do not edit `SettingsPage.tsx`. Deduction-rule management goes on its own page.
- Money arithmetic uses integer cents; store `Decimal`.
- Every route runs through `tenantRouteHandler` so RLS context is set.
- Run `git status --short` before every commit and stage only the files named in the task.
- Commands run from the repository root `/home/dazzanova/project/course_projects/Payroll`.

---

## File Structure

**API**
- `prisma/schema.prisma` — enums, new models, new columns.
- `prisma/migrations/20261112120000_payroll_calculation/migration.sql` — tables, columns, RLS, grants.
- `apps/api/src/features/payroll/payroll.calc.ts` — pure calculation engine.
- `apps/api/src/features/payroll/payroll.calc.test.ts` — engine unit tests.
- `apps/api/src/features/payroll/payroll.schema.ts` — zod input schemas.
- `apps/api/src/features/payroll/payroll.schema.test.ts` — schema tests.
- `apps/api/src/features/payroll/payroll.dto.ts` — Prisma→DTO mapping.
- `apps/api/src/features/payroll/payroll.csv.ts` — CSV row builder.
- `apps/api/src/features/payroll/payroll.csv.test.ts` — CSV tests.
- `apps/api/src/features/payroll/payroll.service.ts` — tenant-scoped data access and lifecycle.
- `apps/api/src/features/payroll/payroll.routes.ts` — runs, payslips, rules routers.
- `apps/api/src/features/payroll/payroll.integration.test.ts` — DB integration tests.
- `apps/api/src/routes/index.ts` — mount the routers.

**Web**
- `apps/web/src/types/index.ts` — payroll DTO types and `CALCULATED`.
- `apps/web/src/lib/utils.ts` — `formatMoney`.
- `apps/web/src/lib/payroll.ts` — API client.
- `apps/web/src/pages/PayrollPage.tsx` — run list (replace mock).
- `apps/web/src/pages/PayrollRunDetailPage.tsx` — new.
- `apps/web/src/pages/MyPayslipsPage.tsx` — new.
- `apps/web/src/pages/PayrollDeductionRulesPage.tsx` — new.
- `apps/web/src/app/router.tsx` — routes.
- `apps/web/src/components/layout/Sidebar.tsx` — nav.
- `apps/web/src/components/layout/TopNav.tsx` — titles.

**Docs**
- `README.md`, `docs/PAYROLL.md`.

---

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261112120000_payroll_calculation/migration.sql`

- [ ] **Step 1: Add the new enum values and models to `prisma/schema.prisma`**

In `enum PayrollStatus`, insert `CALCULATED` after `CALCULATING`:

```prisma
enum PayrollStatus {
  DRAFT
  CALCULATING
  CALCULATED
  APPROVED
  PAID
  VOID
}
```

Add two enums after `PayslipStatus`:

```prisma
enum DeductionRuleType {
  RATE
  FIXED
}

enum PayslipLineKind {
  EARNING
  DEDUCTION
}
```

Add relations to `model Organization`:

```prisma
  payrollDeductionRules  PayrollDeductionRule[]
  payslipLineItems       PayslipLineItem[]
```

Add transition columns to `model PayrollRun`:

```prisma
  calculatedAt    DateTime?     @map("calculated_at")
  approvedAt      DateTime?     @map("approved_at")
  paidAt          DateTime?     @map("paid_at")
  voidedAt        DateTime?     @map("voided_at")
  voidReason      String?       @map("void_reason")
```

Add snapshot columns and the line-item relation to `model Payslip`:

```prisma
  baseSalary      Decimal         @default(0) @map("base_salary") @db.Decimal(12, 2)
  workingDays     Decimal         @default(0) @map("working_days") @db.Decimal(5, 2)
  paidDays        Decimal         @default(0) @map("paid_days") @db.Decimal(5, 2)
  unpaidDays      Decimal         @default(0) @map("unpaid_days") @db.Decimal(5, 2)
  absentDays      Decimal         @default(0) @map("absent_days") @db.Decimal(5, 2)
  lineItems       PayslipLineItem[]
```

Add the two new models at the end of the payroll section:

```prisma
model PayrollDeductionRule {
  id             String            @id @default(uuid())
  organizationId String            @map("organization_id")
  name           String
  type           DeductionRuleType
  value          Decimal           @db.Decimal(12, 2)
  taxable        Boolean           @default(true)
  active         Boolean           @default(true)
  createdAt      DateTime          @default(now()) @map("created_at")
  updatedAt      DateTime          @updatedAt @map("updated_at")

  organization Organization     @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  lineItems    PayslipLineItem[]

  @@unique([organizationId, name])
  @@index([organizationId, active])
  @@map("payroll_deduction_rules")
}

model PayslipLineItem {
  id             String          @id @default(uuid())
  organizationId String          @map("organization_id")
  payslipId      String          @map("payslip_id")
  kind           PayslipLineKind
  label          String
  amount         Decimal         @db.Decimal(12, 2)
  ruleId         String?         @map("rule_id")
  sortOrder      Int             @map("sort_order")
  createdAt      DateTime        @default(now()) @map("created_at")

  organization Organization          @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  payslip      Payslip               @relation(fields: [payslipId], references: [id], onDelete: Cascade)
  rule         PayrollDeductionRule? @relation(fields: [ruleId], references: [id], onDelete: SetNull)

  @@index([organizationId, payslipId])
  @@map("payslip_line_items")
}
```

- [ ] **Step 2: Create the migration SQL**

Create `prisma/migrations/20261112120000_payroll_calculation/migration.sql`:

```sql
-- Add the post-calculation state. The value is added in its own statement and
-- is not used inside this migration transaction.
ALTER TYPE "PayrollStatus" ADD VALUE 'CALCULATED';

-- CreateEnum
CREATE TYPE "DeductionRuleType" AS ENUM ('RATE', 'FIXED');
CREATE TYPE "PayslipLineKind" AS ENUM ('EARNING', 'DEDUCTION');

-- AlterTable
ALTER TABLE "payroll_runs"
  ADD COLUMN "calculated_at" TIMESTAMP(3),
  ADD COLUMN "approved_at" TIMESTAMP(3),
  ADD COLUMN "paid_at" TIMESTAMP(3),
  ADD COLUMN "voided_at" TIMESTAMP(3),
  ADD COLUMN "void_reason" TEXT;

-- AlterTable
ALTER TABLE "payslips"
  ADD COLUMN "base_salary" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "working_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paid_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "unpaid_days" DECIMAL(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN "absent_days" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "payroll_deduction_rules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "DeductionRuleType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "taxable" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_deduction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_line_items" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "kind" "PayslipLineKind" NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "rule_id" TEXT,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslip_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_deduction_rules_organization_id_name_key"
  ON "payroll_deduction_rules"("organization_id", "name");
CREATE INDEX "payroll_deduction_rules_organization_id_active_idx"
  ON "payroll_deduction_rules"("organization_id", "active");
CREATE INDEX "payslip_line_items_organization_id_payslip_id_idx"
  ON "payslip_line_items"("organization_id", "payslip_id");

-- AddForeignKey
ALTER TABLE "payroll_deduction_rules" ADD CONSTRAINT "payroll_deduction_rules_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_payslip_id_fkey"
  FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payslip_line_items" ADD CONSTRAINT "payslip_line_items_rule_id_fkey"
  FOREIGN KEY ("rule_id") REFERENCES "payroll_deduction_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Row-level security. Deduction rules are tenant data that HR manages, so the
-- runtime role can select/insert/update/delete within its organization. Line
-- items are written with their payslip and removed by the payslip cascade.
ALTER TABLE public.payroll_deduction_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payroll_deduction_rules FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payslip_line_items FORCE ROW LEVEL SECURITY;

CREATE POLICY payroll_deduction_rules_app_select ON public.payroll_deduction_rules
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_deduction_rules_app_insert ON public.payroll_deduction_rules
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_deduction_rules_app_update ON public.payroll_deduction_rules
  FOR UPDATE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id())
  WITH CHECK (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payroll_deduction_rules_app_delete ON public.payroll_deduction_rules
  FOR DELETE TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payslip_line_items_app_select ON public.payslip_line_items
  FOR SELECT TO paypilot_app
  USING (organization_id = public.paypilot_current_organization_id());
CREATE POLICY payslip_line_items_app_insert ON public.payslip_line_items
  FOR INSERT TO paypilot_app
  WITH CHECK (organization_id = public.paypilot_current_organization_id());

CREATE POLICY payroll_deduction_rules_migrator_all ON public.payroll_deduction_rules
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);
CREATE POLICY payslip_line_items_migrator_all ON public.payslip_line_items
  FOR ALL TO paypilot_migrator USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_deduction_rules TO paypilot_app;
GRANT SELECT, INSERT ON public.payslip_line_items TO paypilot_app;
```

- [ ] **Step 3: Generate the client and validate the schema**

Run:

```bash
npx prisma generate
npm run prisma:validate
```

Expected: `Prisma schema loaded from prisma/schema.prisma` and `The schema at prisma/schema.prisma is valid 🚀`.

- [ ] **Step 4: Apply the migration**

Run (requires the local Postgres on port 5433):

```bash
npx prisma migrate deploy
```

Expected: `Applying migration 20261112120000_payroll_calculation` and `All migrations have been successfully applied.`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261112120000_payroll_calculation/migration.sql
git commit -m "feat(db): add payroll calculation schema, deduction rules, and line items"
```

---

## Task 2: Calculation engine

**Files:**
- Create: `apps/api/src/features/payroll/payroll.calc.ts`
- Test: `apps/api/src/features/payroll/payroll.calc.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/features/payroll/payroll.calc.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceStatus, LeaveType } from '@prisma/client';
import {
  PayrollCalculationError,
  calculatePayroll,
  roundHalfUp,
  workingDaysIn,
  type CalcEmployee,
  type CalcRule,
} from './payroll.calc';

const OCTOBER = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };

function employee(overrides: Partial<CalcEmployee> = {}): CalcEmployee {
  return {
    id: 'employee-1',
    baseSalaryCents: 5_000_000,
    joinedAt: '2020-01-01',
    attendance: [],
    approvedLeave: [],
    ...overrides,
  };
}

function input(employees: CalcEmployee[], rules: CalcRule[] = []) {
  return { ...OCTOBER, currency: 'USD', rules, employees };
}

function run(employees: CalcEmployee[], rules: CalcRule[] = []) {
  return calculatePayroll(input(employees, rules));
}

describe('workingDaysIn', () => {
  it('counts Monday through Friday', () => {
    assert.equal(workingDaysIn('2026-10-01', '2026-10-31'), 22);
  });

  it('returns zero for a weekend-only range', () => {
    assert.equal(workingDaysIn('2026-10-03', '2026-10-04'), 0);
  });
});

describe('roundHalfUp', () => {
  it('rounds .5 upward', () => {
    assert.equal(roundHalfUp(2.5), 3);
    assert.equal(roundHalfUp(2.49), 2);
  });
});

describe('calculatePayroll', () => {
  it('pays full salary for a full, fully attended period', () => {
    const result = run([employee()]);
    assert.equal(result.payslips[0].grossCents, 5_000_000);
    assert.equal(result.payslips[0].unpaidDays, 0);
  });

  it('deducts half a day for HALF_DAY', () => {
    const result = run([
      employee({ attendance: [{ workDate: '2026-10-05', status: AttendanceStatus.HALF_DAY }] }),
    ]);
    assert.equal(result.payslips[0].unpaidDays, 0.5);
    assert.equal(result.payslips[0].grossCents, 4_886_364);
  });

  it('deducts a full day for ABSENT', () => {
    const result = run([
      employee({ attendance: [{ workDate: '2026-10-05', status: AttendanceStatus.ABSENT }] }),
    ]);
    assert.equal(result.payslips[0].grossCents, 4_772_727);
    assert.equal(result.payslips[0].absentDays, 1);
  });

  it('deducts approved unpaid leave', () => {
    const result = run([
      employee({
        approvedLeave: [
          { leaveType: LeaveType.UNPAID, startDate: '2026-10-05', endDate: '2026-10-06' },
        ],
      }),
    ]);
    assert.equal(result.payslips[0].unpaidDays, 2);
    assert.equal(result.payslips[0].grossCents, 4_545_455);
  });

  it('does not deduct pending or rejected unpaid leave', () => {
    const result = run([
      employee({
        approvedLeave: [
          { leaveType: LeaveType.UNPAID, startDate: '2026-10-05', endDate: '2026-10-06' },
        ],
      }),
    ]);
    assert.equal(result.payslips[0].grossCents, 4_545_455);

    const ignored = run([
      employee({
        approvedLeave: [],
        attendance: [],
      }),
    ]);
    assert.equal(ignored.payslips[0].grossCents, 5_000_000);
  });

  it('does not deduct paid leave types', () => {
    const result = run([
      employee({
        approvedLeave: [
          { leaveType: LeaveType.ANNUAL, startDate: '2026-10-05', endDate: '2026-10-09' },
        ],
      }),
    ]);
    assert.equal(result.payslips[0].grossCents, 5_000_000);
  });

  it('counts a date only once when unpaid leave and absence overlap', () => {
    const result = run([
      employee({
        approvedLeave: [
          { leaveType: LeaveType.UNPAID, startDate: '2026-10-05', endDate: '2026-10-06' },
        ],
        attendance: [{ workDate: '2026-10-05', status: AttendanceStatus.ABSENT }],
      }),
    ]);
    assert.equal(result.payslips[0].unpaidDays, 2);
  });

  it('caps unpaid days at the eligible working days', () => {
    const attendance = Array.from({ length: 31 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return { workDate: `2026-10-${day}`, status: AttendanceStatus.ABSENT };
    });
    const result = run([employee({ attendance })]);
    assert.equal(result.payslips[0].unpaidDays, 22);
    assert.equal(result.payslips[0].grossCents, 0);
  });

  it('applies a rate deduction to gross', () => {
    const result = run([employee()], [
      { id: 'rule-tax', name: 'Income tax', type: 'RATE', valueCents: 1000 },
    ]);
    assert.equal(result.payslips[0].totalDeductionsCents, 500_000);
    assert.equal(result.payslips[0].netCents, 4_500_000);
  });

  it('applies a fixed deduction exactly', () => {
    const result = run([employee()], [
      { id: 'rule-health', name: 'Health', type: 'FIXED', valueCents: 5000 },
    ]);
    assert.equal(result.payslips[0].totalDeductionsCents, 5000);
    assert.equal(result.payslips[0].netCents, 4_995_000);
  });

  it('rounds a rate deduction half-up', () => {
    const result = run([employee({ baseSalaryCents: 1 })], [
      { id: 'rule-tax', name: 'Tax', type: 'RATE', valueCents: 5000 },
    ]);
    assert.equal(result.payslips[0].totalDeductionsCents, 1);
  });

  it('rejects a run when deductions exceed gross', () => {
    assert.throws(
      () =>
        run([employee()], [
          { id: 'rule-huge', name: 'Huge', type: 'FIXED', valueCents: 6_000_000 },
        ]),
      (error: unknown) =>
        error instanceof PayrollCalculationError && error.code === 'DEDUCTIONS_EXCEED_GROSS'
    );
  });

  it('pays zero and skips deductions when no days are paid', () => {
    const attendance = Array.from({ length: 31 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return { workDate: `2026-10-${day}`, status: AttendanceStatus.ABSENT };
    });
    const result = run([employee({ attendance })], [
      { id: 'rule-health', name: 'Health', type: 'FIXED', valueCents: 5000 },
    ]);
    assert.equal(result.payslips[0].grossCents, 0);
    assert.equal(result.payslips[0].totalDeductionsCents, 0);
    assert.equal(result.payslips[0].netCents, 0);
  });

  it('rejects a period with no weekdays', () => {
    assert.throws(
      () =>
        calculatePayroll({
          periodStart: '2026-10-03',
          periodEnd: '2026-10-04',
          currency: 'USD',
          rules: [],
          employees: [employee()],
        }),
      (error: unknown) =>
        error instanceof PayrollCalculationError && error.code === 'NO_WORKING_DAYS'
    );
  });

  it('prorates a mid-month hire against the full period', () => {
    const result = run([employee({ joinedAt: '2026-10-19' })]);
    assert.equal(result.payslips[0].grossCents, 2_272_727);
  });

  it('skips employees who joined after the period', () => {
    const result = run([employee({ joinedAt: '2026-11-01' })]);
    assert.equal(result.payslips.length, 0);
  });

  it('returns zero totals for no employees', () => {
    const result = run([]);
    assert.deepEqual(result.payslips, []);
    assert.equal(result.totalGrossCents, 0);
    assert.equal(result.totalDeductionsCents, 0);
    assert.equal(result.totalNetCents, 0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace=apps/api -- --test-name-pattern="calculatePayroll"
```

Expected: FAIL because `./payroll.calc` cannot be found.

- [ ] **Step 3: Implement the engine**

Create `apps/api/src/features/payroll/payroll.calc.ts`:

```ts
import { AttendanceStatus, LeaveType } from '@prisma/client';

const DAY_MS = 86_400_000;

export type CalcErrorCode = 'NO_WORKING_DAYS' | 'DEDUCTIONS_EXCEED_GROSS';

export class PayrollCalculationError extends Error {
  constructor(
    public readonly code: CalcErrorCode,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'PayrollCalculationError';
  }
}

export interface CalcRule {
  id: string;
  name: string;
  type: 'RATE' | 'FIXED';
  /** Percent x 100 for RATE, cents for FIXED. */
  valueCents: number;
}

export interface CalcEmployee {
  id: string;
  baseSalaryCents: number;
  joinedAt: string;
  attendance: Array<{ workDate: string; status: AttendanceStatus }>;
  approvedLeave: Array<{ leaveType: LeaveType; startDate: string; endDate: string }>;
}

export interface CalcInput {
  periodStart: string;
  periodEnd: string;
  currency: string;
  rules: CalcRule[];
  employees: CalcEmployee[];
}

export interface CalcLine {
  kind: 'EARNING' | 'DEDUCTION';
  label: string;
  amountCents: number;
  ruleId: string | null;
  sortOrder: number;
}

export interface CalcPayslip {
  employeeId: string;
  baseSalaryCents: number;
  workingDays: number;
  paidDays: number;
  unpaidDays: number;
  absentDays: number;
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
  lines: CalcLine[];
}

export interface CalcResult {
  payslips: CalcPayslip[];
  totalGrossCents: number;
  totalDeductionsCents: number;
  totalNetCents: number;
}

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6;
}

export function workingDaysIn(start: string, end: string): number {
  let count = 0;
  const endDate = toUtcDate(end);
  for (let cursor = toUtcDate(start); cursor <= endDate; cursor = addDays(cursor, 1)) {
    if (isWeekday(cursor)) count += 1;
  }
  return count;
}

export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

function unpaidFractions(
  employee: CalcEmployee,
  start: string,
  end: string
): Map<string, number> {
  const fractions = new Map<string, number>();
  const setMax = (date: string, value: number) => {
    fractions.set(date, Math.max(fractions.get(date) ?? 0, value));
  };

  for (const leave of employee.approvedLeave) {
    if (leave.leaveType !== LeaveType.UNPAID) continue;
    const leaveStart = leave.startDate > start ? leave.startDate : start;
    const leaveEnd = leave.endDate < end ? leave.endDate : end;
    if (leaveStart > leaveEnd) continue;
    for (
      let cursor = toUtcDate(leaveStart);
      cursor <= toUtcDate(leaveEnd);
      cursor = addDays(cursor, 1)
    ) {
      if (isWeekday(cursor)) setMax(toDateOnly(cursor), 1);
    }
  }

  for (const record of employee.attendance) {
    if (record.workDate < start || record.workDate > end) continue;
    if (!isWeekday(toUtcDate(record.workDate))) continue;
    if (record.status === AttendanceStatus.ABSENT) setMax(record.workDate, 1);
    if (record.status === AttendanceStatus.HALF_DAY) setMax(record.workDate, 0.5);
  }

  return fractions;
}

export function calculatePayroll(input: CalcInput): CalcResult {
  const fullWorkingDays = workingDaysIn(input.periodStart, input.periodEnd);
  if (fullWorkingDays === 0) {
    throw new PayrollCalculationError(
      'NO_WORKING_DAYS',
      'The pay period contains no Monday-Friday working days'
    );
  }

  const rules = [...input.rules].sort((a, b) => a.name.localeCompare(b.name));
  const payslips: CalcPayslip[] = [];

  for (const employee of input.employees) {
    const eligibleStart =
      employee.joinedAt > input.periodStart ? employee.joinedAt : input.periodStart;
    if (eligibleStart > input.periodEnd) continue;

    const eligibleWorkingDays = workingDaysIn(eligibleStart, input.periodEnd);
    if (eligibleWorkingDays === 0) continue;

    const fractions = unpaidFractions(employee, eligibleStart, input.periodEnd);
    let unpaidDays = 0;
    for (const value of fractions.values()) unpaidDays += value;
    unpaidDays = Math.min(unpaidDays, eligibleWorkingDays);

    const absentDays = employee.attendance.filter(
      (record) =>
        record.status === AttendanceStatus.ABSENT &&
        record.workDate >= eligibleStart &&
        record.workDate <= input.periodEnd &&
        isWeekday(toUtcDate(record.workDate))
    ).length;

    const paidDays = eligibleWorkingDays - unpaidDays;
    const grossCents = roundHalfUp(
      (employee.baseSalaryCents * paidDays) / fullWorkingDays
    );

    const lines: CalcLine[] = [
      {
        kind: 'EARNING',
        label: 'Base salary (prorated)',
        amountCents: grossCents,
        ruleId: null,
        sortOrder: 0,
      },
    ];

    let totalDeductionsCents = 0;
    if (grossCents > 0) {
      rules.forEach((rule, index) => {
        const amountCents =
          rule.type === 'RATE'
            ? roundHalfUp((grossCents * rule.valueCents) / 10_000)
            : rule.valueCents;
        totalDeductionsCents += amountCents;
        lines.push({
          kind: 'DEDUCTION',
          label: rule.name,
          amountCents,
          ruleId: rule.id,
          sortOrder: index + 1,
        });
      });
    }

    if (grossCents > 0 && totalDeductionsCents > grossCents) {
      throw new PayrollCalculationError(
        'DEDUCTIONS_EXCEED_GROSS',
        `Deductions exceed gross pay for employee ${employee.id}`,
        { employeeId: employee.id, grossCents, totalDeductionsCents }
      );
    }

    payslips.push({
      employeeId: employee.id,
      baseSalaryCents: employee.baseSalaryCents,
      workingDays: fullWorkingDays,
      paidDays,
      unpaidDays,
      absentDays,
      grossCents,
      totalDeductionsCents,
      netCents: grossCents - totalDeductionsCents,
      lines,
    });
  }

  return {
    payslips,
    totalGrossCents: payslips.reduce((sum, payslip) => sum + payslip.grossCents, 0),
    totalDeductionsCents: payslips.reduce(
      (sum, payslip) => sum + payslip.totalDeductionsCents,
      0
    ),
    totalNetCents: payslips.reduce((sum, payslip) => sum + payslip.netCents, 0),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace=apps/api -- --test-name-pattern="calculatePayroll"
```

Expected: all calculation tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payroll/payroll.calc.ts apps/api/src/features/payroll/payroll.calc.test.ts
git commit -m "feat(api): add integer-cent payroll calculation engine"
```

---

## Task 3: Validation schemas

**Files:**
- Create: `apps/api/src/features/payroll/payroll.schema.ts`
- Test: `apps/api/src/features/payroll/payroll.schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/features/payroll/payroll.schema.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deductionRuleCreateSchema,
  deductionRuleUpdateSchema,
  payrollRunCreateSchema,
  payrollRunVoidSchema,
} from './payroll.schema';

describe('payrollRunCreateSchema', () => {
  it('accepts a valid period', () => {
    const result = payrollRunCreateSchema.parse({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      payDate: '2026-10-31',
    });
    assert.equal(result.periodStart, '2026-10-01');
  });

  it('rejects a non-calendar date', () => {
    assert.throws(() =>
      payrollRunCreateSchema.parse({
        periodStart: '2026-02-30',
        periodEnd: '2026-03-31',
        payDate: '2026-03-31',
      })
    );
  });

  it('rejects an inverted period', () => {
    assert.throws(() =>
      payrollRunCreateSchema.parse({
        periodStart: '2026-10-31',
        periodEnd: '2026-10-01',
        payDate: '2026-10-31',
      })
    );
  });

  it('rejects a pay date before the period end', () => {
    assert.throws(() =>
      payrollRunCreateSchema.parse({
        periodStart: '2026-10-01',
        periodEnd: '2026-10-31',
        payDate: '2026-10-30',
      })
    );
  });
});

describe('payrollRunVoidSchema', () => {
  it('requires a non-empty reason', () => {
    assert.throws(() => payrollRunVoidSchema.parse({ reason: '   ' }));
    assert.equal(payrollRunVoidSchema.parse({ reason: 'Duplicate run' }).reason, 'Duplicate run');
  });

  it('caps the reason length', () => {
    assert.throws(() => payrollRunVoidSchema.parse({ reason: 'x'.repeat(501) }));
  });
});

describe('deductionRuleCreateSchema', () => {
  it('accepts a rate at or below 100', () => {
    const result = deductionRuleCreateSchema.parse({
      name: 'Income tax',
      type: 'RATE',
      value: 100,
    });
    assert.equal(result.taxable, true);
    assert.equal(result.active, true);
  });

  it('rejects a rate above 100', () => {
    assert.throws(() =>
      deductionRuleCreateSchema.parse({ name: 'Tax', type: 'RATE', value: 101 })
    );
  });

  it('rejects a non-positive fixed value', () => {
    assert.throws(() =>
      deductionRuleCreateSchema.parse({ name: 'Health', type: 'FIXED', value: 0 })
    );
  });
});

describe('deductionRuleUpdateSchema', () => {
  it('accepts a partial update', () => {
    assert.deepEqual(deductionRuleUpdateSchema.parse({ active: false }), { active: false });
  });

  it('rejects a rate above 100 on update', () => {
    assert.throws(() => deductionRuleUpdateSchema.parse({ type: 'RATE', value: 150 }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
npm test --workspace=apps/api -- --test-name-pattern="deductionRule|payrollRun"
```

Expected: FAIL because `./payroll.schema` cannot be found.

- [ ] **Step 3: Implement the schemas**

Create `apps/api/src/features/payroll/payroll.schema.ts`:

```ts
import { DeductionRuleType, PayrollStatus } from '@prisma/client';
import { z } from 'zod';
import { isDateOnly } from '../../lib/dateOnly';

const dateString = z.string().refine(isDateOnly, 'Expected a real YYYY-MM-DD date');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const payrollRunIdSchema = z.string().uuid();

export const payrollRunListQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(PayrollStatus).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

export const payrollRunCreateSchema = z
  .object({
    periodStart: dateString,
    periodEnd: dateString,
    payDate: dateString,
  })
  .superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodEnd'],
        message: 'Period end must be on or after period start',
      });
    }
    if (value.payDate < value.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payDate'],
        message: 'Pay date must be on or after period end',
      });
    }
  });

export const payrollRunVoidSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const deductionRuleFields = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.nativeEnum(DeductionRuleType),
  value: z.coerce.number().positive(),
  taxable: z.boolean(),
  active: z.boolean(),
});

export const deductionRuleCreateSchema = deductionRuleFields
  .extend({
    taxable: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === DeductionRuleType.RATE && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Rate must be between 0 and 100',
      });
    }
  });

export const deductionRuleUpdateSchema = deductionRuleFields
  .partial()
  .superRefine((value, ctx) => {
    if (value.type === DeductionRuleType.RATE && value.value !== undefined && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Rate must be between 0 and 100',
      });
    }
  });

export type PayrollRunListQuery = z.infer<typeof payrollRunListQuerySchema>;
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;
export type PayrollRunVoidInput = z.infer<typeof payrollRunVoidSchema>;
export type DeductionRuleCreateInput = z.infer<typeof deductionRuleCreateSchema>;
export type DeductionRuleUpdateInput = z.infer<typeof deductionRuleUpdateSchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
npm test --workspace=apps/api -- --test-name-pattern="deductionRule|payrollRun"
```

Expected: all schema tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payroll/payroll.schema.ts apps/api/src/features/payroll/payroll.schema.test.ts
git commit -m "feat(api): add payroll request validation schemas"
```

---

## Task 4: DTOs and CSV export

**Files:**
- Create: `apps/api/src/features/payroll/payroll.dto.ts`
- Create: `apps/api/src/features/payroll/payroll.csv.ts`
- Test: `apps/api/src/features/payroll/payroll.csv.test.ts`

- [ ] **Step 1: Write the failing CSV test**

Create `apps/api/src/features/payroll/payroll.csv.test.ts`:

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollCsv, toPayrollCsvRow } from './payroll.csv';
import type { PayslipDto } from './payroll.dto';

const payslip: PayslipDto = {
  id: 'payslip-1',
  employeeId: 'employee-1',
  employeeName: 'Dana, Iyer',
  employeeNumber: 'PP-3001',
  departmentName: 'Engineering',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  payDate: '2026-10-31',
  baseSalary: '5000.00',
  workingDays: '22.0',
  paidDays: '21.0',
  unpaidDays: '1.0',
  absentDays: '1.0',
  grossPay: '4772.73',
  totalDeductions: '800.00',
  netPay: '3972.73',
  currency: 'USD',
  status: 'DRAFT',
  lines: [
    { id: 'line-1', kind: 'EARNING', label: 'Base salary (prorated)', amount: '4772.73', ruleId: null, sortOrder: 0 },
    { id: 'line-2', kind: 'DEDUCTION', label: 'Income tax', amount: '477.27', ruleId: 'rule-1', sortOrder: 1 },
    { id: 'line-3', kind: 'DEDUCTION', label: 'Pension', amount: '322.73', ruleId: 'rule-2', sortOrder: 2 },
  ],
};

describe('payroll CSV', () => {
  it('emits the expected header and one row per payslip', () => {
    const csv = buildPayrollCsv([toPayrollCsvRow(payslip)]);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.equal(
      lines[0],
      '"employee_number","employee_name","department","currency","base_salary","working_days","paid_days","unpaid_days","absent_days","gross_pay","total_deductions","net_pay","deductions"'
    );
    assert.ok(lines[1].includes('"PP-3001"'));
    assert.ok(lines[1].includes('"Dana, Iyer"'));
    assert.ok(lines[1].includes('"Income tax: 477.27; Pension: 322.73"'));
  });

  it('guards spreadsheet formula characters', () => {
    const csv = buildPayrollCsv([
      toPayrollCsvRow({ ...payslip, employeeName: '=SUM(A1)' }),
    ]);
    assert.ok(csv.includes('"\'=SUM(A1)"'));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npm test --workspace=apps/api -- --test-name-pattern="payroll CSV"
```

Expected: FAIL because `./payroll.csv` and `./payroll.dto` cannot be found.

- [ ] **Step 3: Implement the DTOs**

Create `apps/api/src/features/payroll/payroll.dto.ts`:

```ts
import { Prisma } from '@prisma/client';

export type PayslipWithRelations = Prisma.PayslipGetPayload<{
  include: {
    employee: {
      select: {
        firstName: true;
        lastName: true;
        employeeNumber: true;
        department: { select: { name: true } };
      };
    };
    payrollRun: { select: { periodStart: true; periodEnd: true; payDate: true } };
    lineItems: true;
  };
}>;

export type PayrollRunWithPayslips = Prisma.PayrollRunGetPayload<{
  include: {
    payslips: {
      include: {
        employee: {
          select: {
            firstName: true;
            lastName: true;
            employeeNumber: true;
            department: { select: { name: true } };
          };
        };
        payrollRun: { select: { periodStart: true; periodEnd: true; payDate: true } };
        lineItems: true;
      };
    };
  };
}>;

export type RunSummaryRow = Prisma.PayrollRunGetPayload<{
  include: { _count: { select: { payslips: true } } };
}>;

export const PAYSLIP_INCLUDE = {
  employee: {
    select: {
      firstName: true,
      lastName: true,
      employeeNumber: true,
      department: { select: { name: true } },
    },
  },
  payrollRun: { select: { periodStart: true, periodEnd: true, payDate: true } },
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
} as const;

export const RUN_INCLUDE = {
  payslips: {
    include: PAYSLIP_INCLUDE,
    orderBy: { employee: { employeeNumber: 'asc' as const } },
  },
} as const;

export interface PayslipLineItemDto {
  id: string;
  kind: 'EARNING' | 'DEDUCTION';
  label: string;
  amount: string;
  ruleId: string | null;
  sortOrder: number;
}

export interface PayslipDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  baseSalary: string;
  workingDays: string;
  paidDays: string;
  unpaidDays: string;
  absentDays: string;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  currency: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID';
  lines: PayslipLineItemDto[];
}

export interface PayrollRunSummaryDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: 'DRAFT' | 'CALCULATING' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'VOID';
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  payslipCount: number;
  createdAt: string;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PayrollRunDto extends PayrollRunSummaryDto {
  payslips: PayslipDto[];
}

export interface DeductionRuleDto {
  id: string;
  name: string;
  type: 'RATE' | 'FIXED';
  value: string;
  taxable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function toPayslipDto(row: PayslipWithRelations): PayslipDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    employeeNumber: row.employee.employeeNumber,
    departmentName: row.employee.department?.name ?? null,
    periodStart: dateOnly(row.payrollRun.periodStart),
    periodEnd: dateOnly(row.payrollRun.periodEnd),
    payDate: dateOnly(row.payrollRun.payDate),
    baseSalary: row.baseSalary.toFixed(2),
    workingDays: row.workingDays.toFixed(1),
    paidDays: row.paidDays.toFixed(1),
    unpaidDays: row.unpaidDays.toFixed(1),
    absentDays: row.absentDays.toFixed(1),
    grossPay: row.grossPay.toFixed(2),
    totalDeductions: row.totalDeductions.toFixed(2),
    netPay: row.netPay.toFixed(2),
    currency: row.currency,
    status: row.status,
    lines: row.lineItems.map((line) => ({
      id: line.id,
      kind: line.kind,
      label: line.label,
      amount: line.amount.toFixed(2),
      ruleId: line.ruleId,
      sortOrder: line.sortOrder,
    })),
  };
}

export function toRunSummaryDto(row: RunSummaryRow): PayrollRunSummaryDto {
  return {
    id: row.id,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    payDate: dateOnly(row.payDate),
    status: row.status,
    totalGross: row.totalGross.toFixed(2),
    totalDeductions: row.totalDeductions.toFixed(2),
    totalNet: row.totalNet.toFixed(2),
    payslipCount: row._count.payslips,
    createdAt: row.createdAt.toISOString(),
    calculatedAt: row.calculatedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
  };
}

export function toRunDto(row: PayrollRunWithPayslips): PayrollRunDto {
  return {
    id: row.id,
    periodStart: dateOnly(row.periodStart),
    periodEnd: dateOnly(row.periodEnd),
    payDate: dateOnly(row.payDate),
    status: row.status,
    totalGross: row.totalGross.toFixed(2),
    totalDeductions: row.totalDeductions.toFixed(2),
    totalNet: row.totalNet.toFixed(2),
    payslipCount: row.payslips.length,
    createdAt: row.createdAt.toISOString(),
    calculatedAt: row.calculatedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    payslips: row.payslips.map(toPayslipDto),
  };
}

export function toDeductionRuleDto(
  row: Prisma.PayrollDeductionRuleGetPayload<object>
): DeductionRuleDto {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    value: row.value.toFixed(2),
    taxable: row.taxable,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Implement the CSV builder**

Create `apps/api/src/features/payroll/payroll.csv.ts`:

```ts
import { safeCsvCell } from '../payrollImport/export';
import type { PayslipDto } from './payroll.dto';

export interface PayrollCsvRow {
  employeeNumber: string;
  employeeName: string;
  departmentName: string | null;
  currency: string;
  baseSalary: string;
  workingDays: string;
  paidDays: string;
  unpaidDays: string;
  absentDays: string;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  deductions: string;
}

const HEADERS = [
  'employee_number',
  'employee_name',
  'department',
  'currency',
  'base_salary',
  'working_days',
  'paid_days',
  'unpaid_days',
  'absent_days',
  'gross_pay',
  'total_deductions',
  'net_pay',
  'deductions',
] as const;

export function toPayrollCsvRow(payslip: PayslipDto): PayrollCsvRow {
  const deductions = payslip.lines
    .filter((line) => line.kind === 'DEDUCTION')
    .map((line) => `${line.label}: ${line.amount}`)
    .join('; ');

  return {
    employeeNumber: payslip.employeeNumber,
    employeeName: payslip.employeeName,
    departmentName: payslip.departmentName,
    currency: payslip.currency,
    baseSalary: payslip.baseSalary,
    workingDays: payslip.workingDays,
    paidDays: payslip.paidDays,
    unpaidDays: payslip.unpaidDays,
    absentDays: payslip.absentDays,
    grossPay: payslip.grossPay,
    totalDeductions: payslip.totalDeductions,
    netPay: payslip.netPay,
    deductions,
  };
}

export function buildPayrollCsv(rows: readonly PayrollCsvRow[]): string {
  const lines = [HEADERS.map(safeCsvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.employeeNumber,
        row.employeeName,
        row.departmentName,
        row.currency,
        row.baseSalary,
        row.workingDays,
        row.paidDays,
        row.unpaidDays,
        row.absentDays,
        row.grossPay,
        row.totalDeductions,
        row.netPay,
        row.deductions,
      ]
        .map(safeCsvCell)
        .join(',')
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
npm test --workspace=apps/api -- --test-name-pattern="payroll CSV"
```

Expected: both CSV tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payroll/payroll.dto.ts apps/api/src/features/payroll/payroll.csv.ts apps/api/src/features/payroll/payroll.csv.test.ts
git commit -m "feat(api): add payroll DTOs and CSV export builder"
```

---

## Task 5: Integration harness and deduction rules

**Files:**
- Create: `apps/api/src/features/payroll/payroll.service.ts`
- Create: `apps/api/src/features/payroll/payroll.routes.ts`
- Create: `apps/api/src/features/payroll/payroll.integration.test.ts`

- [ ] **Step 1: Write the integration harness and the failing rule tests**

Create `apps/api/src/features/payroll/payroll.integration.test.ts`:

```ts
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { RequestHandler } from 'express';
import {
  AttendanceStatus,
  EmployeeStatus,
  EmploymentType,
  LeaveStatus,
  LeaveType,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { errorHandler } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types/auth';
import {
  createDeductionRulesRouter,
  createPayrollRunsRouter,
  createPayslipsRouter,
} from './payroll.routes';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

// Dedicated fixtures. Other integration suites own 1111/2222, 3333,
// 5555/6666/7777, and 8888/9999.
const orgA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orgB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const userHrA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const userMgrA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const userEmpA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
const userHrB = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

const USER_BY_ROLE: Record<string, Record<string, string>> = {
  [orgA]: {
    [UserRole.HR_MANAGER]: userHrA,
    [UserRole.MANAGER]: userMgrA,
    [UserRole.EMPLOYEE]: userEmpA,
  },
  [orgB]: {
    [UserRole.HR_MANAGER]: userHrB,
  },
};

const fakeAuth: RequestHandler = (req, res, next) => {
  const organizationId = req.header('x-test-org') ?? '';
  const role = (req.header('x-test-role') ?? UserRole.HR_MANAGER) as UserRole;
  const userId = req.header('x-test-user') ?? USER_BY_ROLE[organizationId]?.[role];

  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Test auth requires a known x-test-org and role' },
    });
    return;
  }

  (req as AuthenticatedRequest).auth = {
    user: {
      id: userId,
      identityIssuer: 'test',
      identitySubject: `subject-${userId}`,
      email: `test-${userId}@example.com`,
      role,
      isActive: true,
      organizationId,
    },
    organization: {
      id: organizationId,
      name: `Payroll Test ${organizationId.slice(0, 4)}`,
      slug: `payroll-test-${organizationId.slice(0, 4)}`,
      currency: 'USD',
      timezone: 'UTC',
    },
  };

  next();
};

type JsonResponse = {
  status: number;
  body: any;
  headers: Headers;
  text: string;
};

let adminPrisma: PrismaClient;
let httpServer: http.Server;
let baseUrl: string;

let empFull: string;
let empAbsent: string;
let empLeave: string;
let empTerminated: string;
let empSelf: string;
let empB: string;

async function request(
  method: string,
  path: string,
  options: { org?: string; role?: UserRole; user?: string; body?: unknown } = {}
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-org': options.org ?? orgA,
      'x-test-role': options.role ?? UserRole.HR_MANAGER,
      ...(options.user ? { 'x-test-user': options.user } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
    text,
  };
}

before(async () => {
  if (!dbIntegration) return;
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  for (const org of [
    { id: orgA, name: 'Payroll Calc Org A', slug: 'payroll-calc-org-a' },
    { id: orgB, name: 'Payroll Calc Org B', slug: 'payroll-calc-org-b' },
  ]) {
    await adminPrisma.organization.upsert({
      where: { id: org.id },
      update: {},
      create: { ...org, currency: 'USD', timezone: 'UTC' },
    });
  }

  for (const [id, organizationId, role] of [
    [userHrA, orgA, UserRole.HR_MANAGER],
    [userMgrA, orgA, UserRole.MANAGER],
    [userEmpA, orgA, UserRole.EMPLOYEE],
    [userHrB, orgB, UserRole.HR_MANAGER],
  ] as const) {
    await adminPrisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId,
        email: `payroll-${id.slice(-4)}@example.com`,
        role,
        identityIssuer: 'test',
        identitySubject: `subject-${id}`,
      },
    });
  }

  const tenantIds = [orgA, orgB];
  await adminPrisma.payslipLineItem.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollRun.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollDeductionRule.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.attendanceRecord.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.leaveRequest.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });

  const createEmployee = (
    organizationId: string,
    employeeNumber: string,
    firstName: string,
    baseSalary: string,
    status: EmployeeStatus,
    userId?: string
  ) =>
    adminPrisma.employee.create({
      data: {
        organizationId,
        employeeNumber,
        firstName,
        lastName: 'Tester',
        email: `${employeeNumber.toLowerCase()}@example.com`,
        jobTitle: 'Payroll Test',
        employmentType: EmploymentType.FULL_TIME,
        status,
        joinedAt: new Date('2020-01-01T00:00:00.000Z'),
        baseSalary,
        ...(userId ? { userId } : {}),
      },
    });

  empFull = (await createEmployee(orgA, 'PC-1001', 'Full', '5000.00', EmployeeStatus.ACTIVE)).id;
  empAbsent = (await createEmployee(orgA, 'PC-1002', 'Absent', '3000.00', EmployeeStatus.ACTIVE)).id;
  empLeave = (await createEmployee(orgA, 'PC-1003', 'Leave', '4000.00', EmployeeStatus.ON_LEAVE)).id;
  empTerminated = (await createEmployee(orgA, 'PC-1004', 'Gone', '9000.00', EmployeeStatus.TERMINATED)).id;
  empSelf = (await createEmployee(orgA, 'PC-1005', 'Self', '2000.00', EmployeeStatus.ACTIVE, userEmpA)).id;
  empB = (await createEmployee(orgB, 'PC-2001', 'Other', '7000.00', EmployeeStatus.ACTIVE)).id;

  await adminPrisma.attendanceRecord.create({
    data: {
      organizationId: orgA,
      employeeId: empAbsent,
      workDate: new Date('2026-10-05T00:00:00.000Z'),
      status: AttendanceStatus.ABSENT,
    },
  });

  await adminPrisma.leaveRequest.create({
    data: {
      organizationId: orgA,
      employeeId: empLeave,
      leaveType: LeaveType.UNPAID,
      startDate: new Date('2026-10-05T00:00:00.000Z'),
      endDate: new Date('2026-10-09T00:00:00.000Z'),
      totalDays: '5.0',
      reason: 'Unpaid leave for integration test',
      status: LeaveStatus.APPROVED,
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/payroll-runs', createPayrollRunsRouter(fakeAuth));
  app.use('/api/payslips', createPayslipsRouter(fakeAuth));
  app.use('/api/payroll-deduction-rules', createDeductionRulesRouter(fakeAuth));
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, () => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        baseUrl = `http://localhost:${address.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (!dbIntegration) return;

  if (httpServer) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  const tenantIds = [orgA, orgB];
  await adminPrisma.payslipLineItem.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollRun.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollDeductionRule.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.attendanceRecord.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.leaveRequest.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: tenantIds } } });

  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

describeDb('payroll deduction rules', () => {
  it('seeds the default rules once on first read', async () => {
    const first = await request('GET', '/api/payroll-deduction-rules');
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.data.rules.length, 3);
    assert.deepEqual(
      first.body.data.rules.map((rule: any) => rule.name).sort(),
      ['Health insurance', 'Income tax', 'Pension']
    );

    const second = await request('GET', '/api/payroll-deduction-rules');
    assert.equal(second.body.data.rules.length, 3);
  });

  it('creates, updates, and deletes a rule', async () => {
    const created = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Union dues', type: 'FIXED', value: 25, taxable: false, active: true },
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.data.rule.value, '25.00');
    assert.equal(created.body.data.rule.taxable, false);
    const id = created.body.data.rule.id;

    const updated = await request('PATCH', `/api/payroll-deduction-rules/${id}`, {
      body: { active: false, value: 30 },
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.body.data.rule.active, false);
    assert.equal(updated.body.data.rule.value, '30.00');

    const deleted = await request('DELETE', `/api/payroll-deduction-rules/${id}`);
    assert.equal(deleted.status, 200, deleted.text);

    const list = await request('GET', '/api/payroll-deduction-rules');
    assert.equal(list.body.data.rules.some((rule: any) => rule.id === id), false);
  });

  it('rejects a duplicate rule name', async () => {
    const duplicate = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Income tax', type: 'RATE', value: 11 },
    });
    assert.equal(duplicate.status, 409, duplicate.text);
    assert.equal(duplicate.body.error.code, 'DEDUCTION_RULE_EXISTS');
  });

  it('rejects a rate above 100', async () => {
    const response = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Too high', type: 'RATE', value: 150 },
    });
    assert.equal(response.status, 400, response.text);
  });

  it('forbids employees and managers from managing rules', async () => {
    for (const role of [UserRole.EMPLOYEE, UserRole.MANAGER]) {
      const response = await request('GET', '/api/payroll-deduction-rules', { role });
      assert.equal(response.status, 403, `${role}: ${response.text}`);
    }
  });

  it('scopes rules to the tenant', async () => {
    const orgBRules = await request('GET', '/api/payroll-deduction-rules', { org: orgB });
    assert.equal(orgBRules.status, 200, orgBRules.text);
    assert.equal(orgBRules.body.data.rules.length, 3);
    assert.equal(
      orgBRules.body.data.rules.some((rule: any) => rule.name === 'Union dues'),
      false
    );
  });
});

// Later tasks append run, calculation, lifecycle, and payslip tests here.
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: FAIL because `./payroll.routes` does not exist.

- [ ] **Step 3: Implement the deduction-rule service**

Create `apps/api/src/features/payroll/payroll.service.ts`:

```ts
import { DeductionRuleType, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import { toDeductionRuleDto, type DeductionRuleDto } from './payroll.dto';
import type {
  DeductionRuleCreateInput,
  DeductionRuleUpdateInput,
} from './payroll.schema';

type Tx = Prisma.TransactionClient;

const DEFAULT_RULES: Array<{
  name: string;
  type: DeductionRuleType;
  value: string;
}> = [
  { name: 'Income tax', type: DeductionRuleType.RATE, value: '10.00' },
  { name: 'Pension', type: DeductionRuleType.RATE, value: '5.00' },
  { name: 'Health insurance', type: DeductionRuleType.FIXED, value: '50.00' },
];

export async function ensureDeductionRules(tx: Tx, organizationId: string): Promise<void> {
  const count = await tx.payrollDeductionRule.count({ where: { organizationId } });
  if (count > 0) return;

  await tx.payrollDeductionRule.createMany({
    data: DEFAULT_RULES.map((rule) => ({
      organizationId,
      name: rule.name,
      type: rule.type,
      value: new Prisma.Decimal(rule.value),
    })),
    skipDuplicates: true,
  });
}

export async function listDeductionRules(
  tx: Tx,
  organizationId: string
): Promise<DeductionRuleDto[]> {
  await ensureDeductionRules(tx, organizationId);
  const rules = await tx.payrollDeductionRule.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  });
  return rules.map(toDeductionRuleDto);
}

function ruleData(input: DeductionRuleCreateInput) {
  return {
    name: input.name,
    type: input.type,
    value: new Prisma.Decimal(input.value),
    taxable: input.taxable,
    active: input.active,
  };
}

export async function createDeductionRule(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: DeductionRuleCreateInput
): Promise<DeductionRuleDto> {
  try {
    const rule = await tx.payrollDeductionRule.create({
      data: { organizationId, ...ruleData(input) },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: userId,
        action: 'payroll.deduction_rule_created',
        entityType: 'PayrollDeductionRule',
        entityId: rule.id,
        metadata: { name: rule.name, type: rule.type, value: rule.value.toFixed(2) },
      },
    });

    return toDeductionRuleDto(rule);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'DEDUCTION_RULE_EXISTS', 'A deduction rule with that name already exists');
    }
    throw error;
  }
}

export async function updateDeductionRule(
  tx: Tx,
  organizationId: string,
  userId: string,
  ruleId: string,
  input: DeductionRuleUpdateInput
): Promise<DeductionRuleDto> {
  const existing = await tx.payrollDeductionRule.findFirst({
    where: { id: ruleId, organizationId },
    select: { id: true },
  });
  if (!existing) throw new HttpError(404, 'DEDUCTION_RULE_NOT_FOUND', 'Deduction rule not found');

  try {
    const rule = await tx.payrollDeductionRule.update({
      where: { id: ruleId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.value !== undefined ? { value: new Prisma.Decimal(input.value) } : {}),
        ...(input.taxable !== undefined ? { taxable: input.taxable } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: userId,
        action: 'payroll.deduction_rule_updated',
        entityType: 'PayrollDeductionRule',
        entityId: rule.id,
        metadata: { name: rule.name, active: rule.active, value: rule.value.toFixed(2) },
      },
    });

    return toDeductionRuleDto(rule);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'DEDUCTION_RULE_EXISTS', 'A deduction rule with that name already exists');
    }
    throw error;
  }
}

export async function deleteDeductionRule(
  tx: Tx,
  organizationId: string,
  userId: string,
  ruleId: string
): Promise<void> {
  const existing = await tx.payrollDeductionRule.findFirst({
    where: { id: ruleId, organizationId },
    select: { id: true, name: true },
  });
  if (!existing) throw new HttpError(404, 'DEDUCTION_RULE_NOT_FOUND', 'Deduction rule not found');

  await tx.payrollDeductionRule.delete({ where: { id: ruleId } });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.deduction_rule_deleted',
      entityType: 'PayrollDeductionRule',
      entityId: ruleId,
      metadata: { name: existing.name },
    },
  });
}
```

- [ ] **Step 4: Implement the rules router and shared route helpers**

Create `apps/api/src/features/payroll/payroll.routes.ts`:

```ts
import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny, z } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { AuthenticatedRequest } from '../../types/auth';
import {
  deductionRuleCreateSchema,
  deductionRuleUpdateSchema,
  payrollRunIdSchema,
} from './payroll.schema';
import {
  createDeductionRule,
  deleteDeductionRule,
  listDeductionRules,
  updateDeductionRule,
} from './payroll.service';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;
const READ_ROLES = [UserRole.MANAGER, ...HR_ROLES] as const;

function parse<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
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

function actor(req: AuthenticatedRequest) {
  if (!req.auth) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Authentication required');
  }
  return {
    organizationId: req.auth.organization.id,
    userId: req.auth.user.id,
    role: req.auth.user.role,
  };
}

export function createDeductionRulesRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const rules = await listDeductionRules(tx, organizationId);
      return { body: { success: true, data: { rules } } };
    })
  );

  router.post(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(deductionRuleCreateSchema, req.body);
      const rule = await createDeductionRule(tx, organizationId, userId, input);
      return { status: 201, body: { success: true, data: { rule } } };
    })
  );

  router.patch(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const input = parse(deductionRuleUpdateSchema, req.body);
      const rule = await updateDeductionRule(tx, organizationId, userId, id, input);
      return { body: { success: true, data: { rule } } };
    })
  );

  router.delete(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      await deleteDeductionRule(tx, organizationId, userId, id);
      return { body: { success: true, data: { deleted: true } } };
    })
  );

  return router;
}

export const payrollDeductionRulesRouter = createDeductionRulesRouter();

// Placeholder factories are replaced in later tasks.
export function createPayrollRunsRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...READ_ROLES));
  return router;
}

export function createPayslipsRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware);
  return router;
}
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the `payroll deduction rules` suite PASSES. Other payroll suites do not exist yet.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payroll/payroll.service.ts apps/api/src/features/payroll/payroll.routes.ts apps/api/src/features/payroll/payroll.integration.test.ts
git commit -m "feat(api): add tenant-scoped deduction rule management"
```

---

## Task 6: Run creation, listing, and detail

**Files:**
- Modify: `apps/api/src/features/payroll/payroll.service.ts`
- Modify: `apps/api/src/features/payroll/payroll.routes.ts`
- Modify: `apps/api/src/features/payroll/payroll.integration.test.ts`

- [ ] **Step 1: Append the failing run tests**

In `payroll.integration.test.ts`, replace the trailing comment with:

```ts
let octoberRunId = '';

describeDb('payroll runs', () => {
  it('creates a draft run', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-10-01', periodEnd: '2026-10-31', payDate: '2026-10-31' },
    });
    assert.equal(response.status, 201, response.text);
    const run = response.body.data.run;
    assert.equal(run.status, 'DRAFT');
    assert.equal(run.totalGross, '0.00');
    assert.equal(run.payslipCount, 0);
    assert.deepEqual(run.payslips, []);
    octoberRunId = run.id;
  });

  it('rejects a duplicate period', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-10-01', periodEnd: '2026-10-31', payDate: '2026-10-31' },
    });
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.error.code, 'PAYROLL_RUN_EXISTS');
  });

  it('rejects an invalid period', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-10-31', periodEnd: '2026-10-01', payDate: '2026-10-31' },
    });
    assert.equal(response.status, 400, response.text);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('lists runs for managers and HR', async () => {
    for (const role of [UserRole.HR_MANAGER, UserRole.MANAGER]) {
      const response = await request('GET', '/api/payroll-runs', { role });
      assert.equal(response.status, 200, `${role}: ${response.text}`);
      assert.equal(response.body.data.runs.some((run: any) => run.id === octoberRunId), true);
    }
  });

  it('returns run detail with an empty payslip list before calculation', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.id, octoberRunId);
    assert.deepEqual(response.body.data.run.payslips, []);
  });

  it('forbids employees from reading runs', async () => {
    const list = await request('GET', '/api/payroll-runs', { role: UserRole.EMPLOYEE });
    assert.equal(list.status, 403, list.text);
    const detail = await request('GET', `/api/payroll-runs/${octoberRunId}`, {
      role: UserRole.EMPLOYEE,
    });
    assert.equal(detail.status, 403, detail.text);
  });

  it('hides runs from another tenant', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`, { org: orgB });
    assert.equal(response.status, 404, response.text);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the `payroll runs` suite FAILS because the run routes are placeholders (404 or 405).

- [ ] **Step 3: Add run service functions**

Append to `payroll.service.ts` (and add the new imports):

```ts
import { EmployeeStatus, PayrollStatus, PayslipStatus } from '@prisma/client';
import {
  RUN_INCLUDE,
  toRunDto,
  toRunSummaryDto,
  type PayrollRunDto,
  type PayrollRunSummaryDto,
} from './payroll.dto';
import type {
  PayrollRunCreateInput,
  PayrollRunListQuery,
} from './payroll.schema';

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function pageResult(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listPayrollRuns(
  tx: Tx,
  organizationId: string,
  query: PayrollRunListQuery
): Promise<{ runs: PayrollRunSummaryDto[]; pagination: ReturnType<typeof pageResult> }> {
  const where: Prisma.PayrollRunWhereInput = { organizationId };
  if (query.status) where.status = query.status;
  if (query.from) where.periodEnd = { gte: dateValue(query.from) };
  if (query.to) where.periodStart = { lte: dateValue(query.to) };

  const [total, runs] = await Promise.all([
    tx.payrollRun.count({ where }),
    tx.payrollRun.findMany({
      where,
      include: { _count: { select: { payslips: true } } },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    runs: runs.map(toRunSummaryDto),
    pagination: pageResult(query.page, query.pageSize, total),
  };
}

export async function createPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: PayrollRunCreateInput
): Promise<PayrollRunDto> {
  try {
    const created = await tx.payrollRun.create({
      data: {
        organizationId,
        periodStart: dateValue(input.periodStart),
        periodEnd: dateValue(input.periodEnd),
        payDate: dateValue(input.payDate),
        status: PayrollStatus.DRAFT,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: userId,
        action: 'payroll.run_created',
        entityType: 'PayrollRun',
        entityId: created.id,
        metadata: {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          payDate: input.payDate,
        },
      },
    });

    const run = await tx.payrollRun.findFirstOrThrow({
      where: { id: created.id, organizationId },
      include: RUN_INCLUDE,
    });
    return toRunDto(run);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(
        409,
        'PAYROLL_RUN_EXISTS',
        'A payroll run already exists for this period'
      );
    }
    throw error;
  }
}

export async function getPayrollRun(
  tx: Tx,
  organizationId: string,
  runId: string
): Promise<PayrollRunDto> {
  const run = await tx.payrollRun.findFirst({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });
  if (!run) throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
  return toRunDto(run);
}
```

- [ ] **Step 4: Replace the runs router placeholder**

In `payroll.routes.ts`, add imports:

```ts
import {
  createPayrollRun,
  getPayrollRun,
  listPayrollRuns,
} from './payroll.service';
import {
  payrollRunCreateSchema,
  payrollRunListQuerySchema,
} from './payroll.schema';
```

Replace `createPayrollRunsRouter` with:

```ts
export function createPayrollRunsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get(
    '/',
    requireRole(...READ_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(payrollRunListQuerySchema, req.query);
      const result = await listPayrollRuns(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

  router.post(
    '/',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(payrollRunCreateSchema, req.body);
      const run = await createPayrollRun(tx, organizationId, userId, input);
      return { status: 201, body: { success: true, data: { run } } };
    })
  );

  router.get(
    '/:id',
    requireRole(...READ_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await getPayrollRun(tx, organizationId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  return router;
}
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: both `payroll deduction rules` and `payroll runs` suites PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payroll/payroll.service.ts apps/api/src/features/payroll/payroll.routes.ts apps/api/src/features/payroll/payroll.integration.test.ts
git commit -m "feat(api): add payroll run creation, listing, and detail"
```

---

## Task 7: Calculation endpoint

**Files:**
- Modify: `apps/api/src/features/payroll/payroll.service.ts`
- Modify: `apps/api/src/features/payroll/payroll.routes.ts`
- Modify: `apps/api/src/features/payroll/payroll.integration.test.ts`

- [ ] **Step 1: Append the failing calculation tests**

Append to `payroll.integration.test.ts`:

```ts
describeDb('payroll calculation', () => {
  it('calculates payslips for active employees', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`);
    assert.equal(response.status, 200, response.text);
    const run = response.body.data.run;
    assert.equal(run.status, 'CALCULATED');
    assert.equal(run.payslipCount, 4);
    assert.equal(run.totalGross, '12954.55');
    assert.equal(run.totalDeductions, '2143.18');
    assert.equal(run.totalNet, '10811.37');
    assert.equal(
      run.payslips.some((payslip: any) => payslip.employeeId === empTerminated),
      false
    );
  });

  it('prorates attendance and approved unpaid leave', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const payslips = response.body.data.run.payslips;
    const byEmployee = new Map(payslips.map((payslip: any) => [payslip.employeeId, payslip]));

    assert.equal((byEmployee.get(empFull) as any).grossPay, '5000.00');
    assert.equal((byEmployee.get(empAbsent) as any).grossPay, '2863.64');
    assert.equal((byEmployee.get(empAbsent) as any).absentDays, '1.0');
    assert.equal((byEmployee.get(empLeave) as any).grossPay, '3090.91');
    assert.equal((byEmployee.get(empLeave) as any).unpaidDays, '5.0');
    assert.equal((byEmployee.get(empSelf) as any).grossPay, '2000.00');
  });

  it('writes earning and deduction line items', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const payslip = response.body.data.run.payslips.find(
      (row: any) => row.employeeId === empFull
    );
    assert.equal(payslip.lines.length, 4);
    assert.equal(payslip.lines[0].kind, 'EARNING');
    assert.equal(payslip.lines[0].label, 'Base salary (prorated)');
    assert.deepEqual(
      payslip.lines.slice(1).map((line: any) => line.kind),
      ['DEDUCTION', 'DEDUCTION', 'DEDUCTION']
    );
  });

  it('replaces payslips when recalculating', async () => {
    const before = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const beforeIds = before.body.data.run.payslips.map((payslip: any) => payslip.id).sort();

    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`);
    assert.equal(response.status, 200, response.text);
    const afterIds = response.body.data.run.payslips
      .map((payslip: any) => payslip.id)
      .sort();

    assert.equal(afterIds.length, beforeIds.length);
    assert.notDeepEqual(afterIds, beforeIds);
  });

  it('forbids employees and managers from calculating', async () => {
    for (const role of [UserRole.EMPLOYEE, UserRole.MANAGER]) {
      const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`, {
        role,
      });
      assert.equal(response.status, 403, `${role}: ${response.text}`);
    }
  });

  it('returns 404 for a run in another tenant', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`, {
      org: orgB,
    });
    assert.equal(response.status, 404, response.text);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the `payroll calculation` suite FAILS with 404 because the calculate route does not exist.

- [ ] **Step 3: Add the calculation service function**

Add these imports at the top of `payroll.service.ts`:

```ts
import { AttendanceStatus, LeaveStatus } from '@prisma/client';
import {
  PayrollCalculationError,
  calculatePayroll,
  type CalcEmployee,
} from './payroll.calc';
```

Append the calculation function:

```ts
function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

export async function calculatePayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string
): Promise<PayrollRunDto> {
  const guard = await tx.payrollRun.updateMany({
    where: {
      id: runId,
      organizationId,
      status: { in: [PayrollStatus.DRAFT, PayrollStatus.CALCULATED] },
    },
    data: { status: PayrollStatus.CALCULATING, processedById: userId },
  });

  if (guard.count === 0) {
    const existing = await tx.payrollRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (!existing) {
      throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    }
    throw new HttpError(
      409,
      'INVALID_PAYROLL_TRANSITION',
      `Cannot calculate a payroll run in ${existing.status} status`,
      { from: existing.status, action: 'calculate' }
    );
  }

  const run = await tx.payrollRun.findFirstOrThrow({
    where: { id: runId, organizationId },
  });
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { currency: true },
  });

  await ensureDeductionRules(tx, organizationId);
  const rules = await tx.payrollDeductionRule.findMany({
    where: { organizationId, active: true },
    orderBy: { name: 'asc' },
  });

  const employees = await tx.employee.findMany({
    where: {
      organizationId,
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] },
    },
    select: { id: true, baseSalary: true, joinedAt: true },
  });
  const employeeIds = employees.map((employee) => employee.id);

  const [attendance, leave] = await Promise.all([
    tx.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        workDate: { gte: run.periodStart, lte: run.periodEnd },
      },
      select: { employeeId: true, workDate: true, status: true },
    }),
    tx.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        status: LeaveStatus.APPROVED,
        startDate: { lte: run.periodEnd },
        endDate: { gte: run.periodStart },
      },
      select: { employeeId: true, leaveType: true, startDate: true, endDate: true },
    }),
  ]);

  const attendanceByEmployee = new Map<string, CalcEmployee['attendance']>();
  for (const record of attendance) {
    const list = attendanceByEmployee.get(record.employeeId) ?? [];
    list.push({ workDate: dateOnly(record.workDate), status: record.status });
    attendanceByEmployee.set(record.employeeId, list);
  }

  const leaveByEmployee = new Map<string, CalcEmployee['approvedLeave']>();
  for (const request of leave) {
    const list = leaveByEmployee.get(request.employeeId) ?? [];
    list.push({
      leaveType: request.leaveType,
      startDate: dateOnly(request.startDate),
      endDate: dateOnly(request.endDate),
    });
    leaveByEmployee.set(request.employeeId, list);
  }

  let result;
  try {
    result = calculatePayroll({
      periodStart: dateOnly(run.periodStart),
      periodEnd: dateOnly(run.periodEnd),
      currency: organization.currency,
      rules: rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        type: rule.type,
        valueCents: rule.value.mul(100).toDecimalPlaces(0).toNumber(),
      })),
      employees: employees.map((employee) => ({
        id: employee.id,
        baseSalaryCents: employee.baseSalary.mul(100).toDecimalPlaces(0).toNumber(),
        joinedAt: dateOnly(employee.joinedAt),
        attendance: attendanceByEmployee.get(employee.id) ?? [],
        approvedLeave: leaveByEmployee.get(employee.id) ?? [],
      })),
    });
  } catch (error) {
    if (error instanceof PayrollCalculationError) {
      throw new HttpError(422, error.code, error.message, error.details);
    }
    throw error;
  }

  await tx.payslip.deleteMany({ where: { organizationId, payrollRunId: runId } });

  for (const payslip of result.payslips) {
    await tx.payslip.create({
      data: {
        organizationId,
        payrollRunId: runId,
        employeeId: payslip.employeeId,
        baseSalary: centsToDecimal(payslip.baseSalaryCents),
        workingDays: new Prisma.Decimal(payslip.workingDays),
        paidDays: new Prisma.Decimal(payslip.paidDays),
        unpaidDays: new Prisma.Decimal(payslip.unpaidDays),
        absentDays: new Prisma.Decimal(payslip.absentDays),
        grossPay: centsToDecimal(payslip.grossCents),
        totalDeductions: centsToDecimal(payslip.totalDeductionsCents),
        netPay: centsToDecimal(payslip.netCents),
        currency: organization.currency,
        status: PayslipStatus.DRAFT,
        lineItems: {
          create: payslip.lines.map((line) => ({
            organizationId,
            kind: line.kind,
            label: line.label,
            amount: centsToDecimal(line.amountCents),
            ruleId: line.ruleId,
            sortOrder: line.sortOrder,
          })),
        },
      },
    });
  }

  const updated = await tx.payrollRun.update({
    where: { id: runId },
    data: {
      status: PayrollStatus.CALCULATED,
      totalGross: centsToDecimal(result.totalGrossCents),
      totalDeductions: centsToDecimal(result.totalDeductionsCents),
      totalNet: centsToDecimal(result.totalNetCents),
      calculatedAt: new Date(),
      processedById: userId,
    },
    include: RUN_INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.run_calculated',
      entityType: 'PayrollRun',
      entityId: runId,
      metadata: {
        payslipCount: result.payslips.length,
        totalGross: updated.totalGross.toFixed(2),
        totalDeductions: updated.totalDeductions.toFixed(2),
        totalNet: updated.totalNet.toFixed(2),
      },
    },
  });

  return toRunDto(updated);
}
```

- [ ] **Step 4: Add the calculate route**

In `payroll.routes.ts`, import `calculatePayrollRun` and add this route inside `createPayrollRunsRouter`, after the `POST '/'` route:

```ts
  router.post(
    '/:id/calculate',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await calculatePayrollRun(tx, organizationId, userId, id);
      return { body: { success: true, data: { run } } };
    })
  );
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the `payroll calculation` suite PASSES with the four-employee totals.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payroll/payroll.service.ts apps/api/src/features/payroll/payroll.routes.ts apps/api/src/features/payroll/payroll.integration.test.ts
git commit -m "feat(api): calculate payroll runs from salary, attendance, and leave"
```

---

## Task 8: Lifecycle transitions

**Files:**
- Modify: `apps/api/src/features/payroll/payroll.service.ts`
- Modify: `apps/api/src/features/payroll/payroll.routes.ts`
- Modify: `apps/api/src/features/payroll/payroll.integration.test.ts`

- [ ] **Step 1: Append the failing lifecycle tests**

Append to `payroll.integration.test.ts`:

```ts
let novemberRunId = '';

describeDb('payroll lifecycle', () => {
  it('creates a second draft run for transition checks', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-11-01', periodEnd: '2026-11-30', payDate: '2026-11-30' },
    });
    assert.equal(response.status, 201, response.text);
    novemberRunId = response.body.data.run.id;
  });

  it('rejects approving a draft run', async () => {
    const response = await request('POST', `/api/payroll-runs/${novemberRunId}/approve`);
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.error.code, 'INVALID_PAYROLL_TRANSITION');
  });

  it('approves a calculated run and issues payslips', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/approve`);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.status, 'APPROVED');
    assert.equal(
      response.body.data.run.payslips.every((payslip: any) => payslip.status === 'ISSUED'),
      true
    );
  });

  it('freezes an approved run', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`);
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.error.code, 'INVALID_PAYROLL_TRANSITION');
  });

  it('rejects paying a run that is not approved', async () => {
    const response = await request('POST', `/api/payroll-runs/${novemberRunId}/pay`);
    assert.equal(response.status, 409, response.text);
  });

  it('marks an approved run paid', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/pay`);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.status, 'PAID');
    assert.equal(
      response.body.data.run.payslips.every((payslip: any) => payslip.status === 'PAID'),
      true
    );
  });

  it('requires a reason to void', async () => {
    const missing = await request('POST', `/api/payroll-runs/${octoberRunId}/void`, {
      body: {},
    });
    assert.equal(missing.status, 400, missing.text);
  });

  it('voids a paid run with a reason', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/void`, {
      body: { reason: 'Duplicate cycle' },
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.status, 'VOID');
    assert.equal(response.body.data.run.voidReason, 'Duplicate cycle');
  });

  it('rejects voiding a draft run', async () => {
    const response = await request('POST', `/api/payroll-runs/${novemberRunId}/void`, {
      body: { reason: 'Not needed' },
    });
    assert.equal(response.status, 409, response.text);
  });

  it('forbids employees and managers from transitioning', async () => {
    for (const role of [UserRole.EMPLOYEE, UserRole.MANAGER]) {
      for (const action of ['approve', 'pay', 'void']) {
        const response = await request(
          'POST',
          `/api/payroll-runs/${novemberRunId}/${action}`,
          { role, body: { reason: 'test' } }
        );
        assert.equal(response.status, 403, `${role}/${action}: ${response.text}`);
      }
    }
  });

  it('writes an audit entry for each transition', async () => {
    const actions = await adminPrisma.auditLog.findMany({
      where: {
        organizationId: orgA,
        action: { in: ['payroll.run_created', 'payroll.run_calculated', 'payroll.run_approved', 'payroll.run_paid', 'payroll.run_voided'] },
      },
      select: { action: true },
    });
    const unique = new Set(actions.map((row) => row.action));
    for (const action of ['payroll.run_created', 'payroll.run_calculated', 'payroll.run_approved', 'payroll.run_paid', 'payroll.run_voided']) {
      assert.equal(unique.has(action), true, `missing ${action}`);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the `payroll lifecycle` suite FAILS with 404 on approve/pay/void.

- [ ] **Step 3: Add the transition service functions**

Append to `payroll.service.ts`:

```ts
async function transitionPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string,
  action: 'approve' | 'pay',
  from: PayrollStatus[],
  to: PayrollStatus,
  payslipStatus: PayslipStatus,
  auditAction: string
): Promise<PayrollRunDto> {
  const data: Prisma.PayrollRunUpdateManyMutationInput = {
    status: to,
    processedById: userId,
  };
  if (action === 'approve') data.approvedAt = new Date();
  if (action === 'pay') data.paidAt = new Date();

  const guard = await tx.payrollRun.updateMany({
    where: { id: runId, organizationId, status: { in: from } },
    data,
  });

  if (guard.count === 0) {
    const existing = await tx.payrollRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (!existing) {
      throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    }
    throw new HttpError(
      409,
      'INVALID_PAYROLL_TRANSITION',
      `Cannot ${action} a payroll run in ${existing.status} status`,
      { from: existing.status, action }
    );
  }

  await tx.payslip.updateMany({
    where: { organizationId, payrollRunId: runId },
    data: { status: payslipStatus },
  });

  const run = await tx.payrollRun.findFirstOrThrow({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: auditAction,
      entityType: 'PayrollRun',
      entityId: runId,
      metadata: { status: to },
    },
  });

  return toRunDto(run);
}

export function approvePayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string
): Promise<PayrollRunDto> {
  return transitionPayrollRun(
    tx,
    organizationId,
    userId,
    runId,
    'approve',
    [PayrollStatus.CALCULATED],
    PayrollStatus.APPROVED,
    PayslipStatus.ISSUED,
    'payroll.run_approved'
  );
}

export function payPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string
): Promise<PayrollRunDto> {
  return transitionPayrollRun(
    tx,
    organizationId,
    userId,
    runId,
    'pay',
    [PayrollStatus.APPROVED],
    PayrollStatus.PAID,
    PayslipStatus.PAID,
    'payroll.run_paid'
  );
}

export async function voidPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string,
  reason: string
): Promise<PayrollRunDto> {
  const guard = await tx.payrollRun.updateMany({
    where: {
      id: runId,
      organizationId,
      status: { in: [PayrollStatus.APPROVED, PayrollStatus.PAID] },
    },
    data: {
      status: PayrollStatus.VOID,
      voidedAt: new Date(),
      voidReason: reason,
      processedById: userId,
    },
  });

  if (guard.count === 0) {
    const existing = await tx.payrollRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (!existing) {
      throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    }
    throw new HttpError(
      409,
      'INVALID_PAYROLL_TRANSITION',
      `Cannot void a payroll run in ${existing.status} status`,
      { from: existing.status, action: 'void' }
    );
  }

  const run = await tx.payrollRun.findFirstOrThrow({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.run_voided',
      entityType: 'PayrollRun',
      entityId: runId,
      metadata: { status: PayrollStatus.VOID, reason },
    },
  });

  return toRunDto(run);
}
```

- [ ] **Step 4: Add the lifecycle routes**

In `payroll.routes.ts`, import `approvePayrollRun`, `payPayrollRun`, `voidPayrollRun`, and `payrollRunVoidSchema`. Add these routes inside `createPayrollRunsRouter`, after the calculate route:

```ts
  router.post(
    '/:id/approve',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await approvePayrollRun(tx, organizationId, userId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  router.post(
    '/:id/pay',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await payPayrollRun(tx, organizationId, userId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  router.post(
    '/:id/void',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const input = parse(payrollRunVoidSchema, req.body);
      const run = await voidPayrollRun(tx, organizationId, userId, id, input.reason);
      return { body: { success: true, data: { run } } };
    })
  );
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the `payroll lifecycle` suite PASSES.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payroll/payroll.service.ts apps/api/src/features/payroll/payroll.routes.ts apps/api/src/features/payroll/payroll.integration.test.ts
git commit -m "feat(api): enforce payroll run lifecycle transitions"
```

---

## Task 9: Payslip access and CSV export

**Files:**
- Modify: `apps/api/src/features/payroll/payroll.service.ts`
- Modify: `apps/api/src/features/payroll/payroll.routes.ts`
- Modify: `apps/api/src/features/payroll/payroll.integration.test.ts`

- [ ] **Step 1: Append the failing payslip and CSV tests**

Append to `payroll.integration.test.ts`:

```ts
describeDb('payslip access and CSV export', () => {
  it('returns only the caller\'s payslips from /payslips/me', async () => {
    const response = await request('GET', '/api/payslips/me', {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.payslips.length, 1);
    assert.equal(response.body.data.payslips[0].employeeId, empSelf);
    assert.equal(response.body.data.payslips[0].lines.length, 4);
  });

  it('returns an empty list when no employee profile is linked', async () => {
    const response = await request('GET', '/api/payslips/me', {
      role: UserRole.MANAGER,
      user: userMgrA,
    });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.data.payslips, []);
  });

  it('lets an employee read their own payslip', async () => {
    const mine = await request('GET', '/api/payslips/me', {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    const id = mine.body.data.payslips[0].id;

    const response = await request('GET', `/api/payslips/${id}`, {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.payslip.id, id);
  });

  it('hides a colleague\'s payslip from an employee', async () => {
    const run = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const colleague = run.body.data.run.payslips.find(
      (payslip: any) => payslip.employeeId === empFull
    );

    const response = await request('GET', `/api/payslips/${colleague.id}`, {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    assert.equal(response.status, 404, response.text);
  });

  it('lets a manager read any payslip in the tenant', async () => {
    const run = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const anyPayslip = run.body.data.run.payslips[0];

    const response = await request('GET', `/api/payslips/${anyPayslip.id}`, {
      role: UserRole.MANAGER,
    });
    assert.equal(response.status, 200, response.text);
  });

  it('exports the run as CSV', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}/export`);
    assert.equal(response.status, 200, response.text);
    assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /payroll-2026-10-01-2026-10-31\.csv/
    );

    const lines = response.text.trim().split('\r\n');
    assert.equal(lines.length, 5);
    assert.ok(lines[0].startsWith('"employee_number","employee_name"'));
    assert.ok(response.text.includes('"PC-1001"'));
  });

  it('forbids employees from exporting a run', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}/export`, {
      role: UserRole.EMPLOYEE,
    });
    assert.equal(response.status, 403, response.text);
  });

  it('returns 404 for a payslip in another tenant', async () => {
    const run = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const anyPayslip = run.body.data.run.payslips[0];

    const response = await request('GET', `/api/payslips/${anyPayslip.id}`, { org: orgB });
    assert.equal(response.status, 404, response.text);
  });

  it('denies direct runtime access to deduction rules without tenant context', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM payroll_deduction_rules
    `;
    assert.equal(rows[0].count, 0n);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: the payslip and CSV suite FAILS because `/api/payslips` routes are missing and the export route does not exist.

- [ ] **Step 3: Add payslip and export service functions**

Add to the imports in `payroll.service.ts`:

```ts
import { UserRole } from '@prisma/client';
import {
  PAYSLIP_INCLUDE,
  toPayslipDto,
  type PayslipDto,
} from './payroll.dto';
import { buildPayrollCsv, toPayrollCsvRow } from './payroll.csv';
```

Append:

```ts
export async function listMyPayslips(
  tx: Tx,
  organizationId: string,
  userId: string
): Promise<PayslipDto[]> {
  const employee = await tx.employee.findFirst({
    where: { organizationId, userId },
    select: { id: true },
  });
  if (!employee) return [];

  const payslips = await tx.payslip.findMany({
    where: { organizationId, employeeId: employee.id },
    include: PAYSLIP_INCLUDE,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  return payslips.map(toPayslipDto);
}

export async function getPayslip(
  tx: Tx,
  organizationId: string,
  userId: string,
  role: UserRole,
  payslipId: string
): Promise<PayslipDto> {
  const payslip = await tx.payslip.findFirst({
    where: { id: payslipId, organizationId },
    include: PAYSLIP_INCLUDE,
  });
  if (!payslip) throw new HttpError(404, 'PAYSLIP_NOT_FOUND', 'Payslip not found');

  if (role === UserRole.EMPLOYEE) {
    const employee = await tx.employee.findFirst({
      where: { organizationId, userId },
      select: { id: true },
    });
    if (!employee || payslip.employeeId !== employee.id) {
      throw new HttpError(404, 'PAYSLIP_NOT_FOUND', 'Payslip not found');
    }
  }

  return toPayslipDto(payslip);
}

export async function buildPayrollExport(
  tx: Tx,
  organizationId: string,
  runId: string
): Promise<{ content: string; filename: string }> {
  const run = await tx.payrollRun.findFirst({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });
  if (!run) throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');

  const content = buildPayrollCsv(
    run.payslips.map((payslip) => toPayrollCsvRow(toPayslipDto(payslip)))
  );

  return {
    content,
    filename: `payroll-${dateOnly(run.periodStart)}-${dateOnly(run.periodEnd)}.csv`,
  };
}
```

- [ ] **Step 4: Implement the payslip router and the export route**

In `payroll.routes.ts`, import `buildPayrollExport`, `getPayslip`, and `listMyPayslips`. Add this route inside `createPayrollRunsRouter`, before the `GET '/:id'` route:

```ts
  router.get(
    '/:id/export',
    requireRole(...READ_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const file = await buildPayrollExport(tx, organizationId, id);
      return {
        file: {
          content: file.content,
          contentType: 'text/csv; charset=utf-8',
          filename: file.filename,
        },
      };
    })
  );
```

Replace `createPayslipsRouter` with:

```ts
export function createPayslipsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get(
    '/me',
    requireRole(...READ_ROLES, UserRole.EMPLOYEE),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const payslips = await listMyPayslips(tx, organizationId, userId);
      return { body: { success: true, data: { payslips } } };
    })
  );

  router.get(
    '/:id',
    requireRole(...READ_ROLES, UserRole.EMPLOYEE),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId, role } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const payslip = await getPayslip(tx, organizationId, userId, role, id);
      return { body: { success: true, data: { payslip } } };
    })
  );

  return router;
}
```

- [ ] **Step 5: Run the integration tests to verify they pass**

Run:

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected: all five payroll suites PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/features/payroll/payroll.service.ts apps/api/src/features/payroll/payroll.routes.ts apps/api/src/features/payroll/payroll.integration.test.ts
git commit -m "feat(api): add payslip self-service access and CSV export"
```

---

## Task 10: Mount the routers

**Files:**
- Modify: `apps/api/src/routes/index.ts`

- [ ] **Step 1: Add the router imports and mounts**

Edit `apps/api/src/routes/index.ts`:

```ts
import {
  payrollDeductionRulesRouter,
  payrollRunsRouter,
  payslipsRouter,
} from '../features/payroll/payroll.routes';
```

and add after the leave mount:

```ts
apiRouter.use('/payroll-runs', payrollRunsRouter);
apiRouter.use('/payslips', payslipsRouter);
apiRouter.use('/payroll-deduction-rules', payrollDeductionRulesRouter);
```

- [ ] **Step 2: Typecheck the API**

Run:

```bash
npm run typecheck --workspace=apps/api
npm run typecheck:tests --workspace=apps/api
```

Expected: both commands exit 0 with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/index.ts
git commit -m "feat(api): mount payroll run, payslip, and rule routers"
```

---

## Task 11: Web types, money helper, and API client

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/lib/utils.ts`
- Create: `apps/web/src/lib/payroll.ts`

- [ ] **Step 1: Add `CALCULATED` and the payroll DTOs**

In `apps/web/src/types/index.ts`, replace the `PayrollStatus` line:

```ts
export type PayrollStatus = 'DRAFT' | 'CALCULATING' | 'CALCULATED' | 'APPROVED' | 'PAID' | 'VOID';
```

Add after the existing `PayrollRun` interface:

```ts
export interface PayslipLineItemDto {
  id: string;
  kind: 'EARNING' | 'DEDUCTION';
  label: string;
  amount: string;
  ruleId: string | null;
  sortOrder: number;
}

export interface PayslipDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string | null;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  baseSalary: string;
  workingDays: string;
  paidDays: string;
  unpaidDays: string;
  absentDays: string;
  grossPay: string;
  totalDeductions: string;
  netPay: string;
  currency: string;
  status: 'DRAFT' | 'ISSUED' | 'PAID';
  lines: PayslipLineItemDto[];
}

export interface PayrollRunSummaryDto {
  id: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: PayrollStatus;
  totalGross: string;
  totalDeductions: string;
  totalNet: string;
  payslipCount: number;
  createdAt: string;
  calculatedAt: string | null;
  approvedAt: string | null;
  paidAt: string | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface PayrollRunDto extends PayrollRunSummaryDto {
  payslips: PayslipDto[];
}

export interface DeductionRuleDto {
  id: string;
  name: string;
  type: 'RATE' | 'FIXED';
  value: string;
  taxable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunsResult {
  runs: PayrollRunSummaryDto[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}
```

- [ ] **Step 2: Add a two-decimal money formatter**

In `apps/web/src/lib/utils.ts`, add after `formatCurrency`:

```ts
export function formatMoney(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
```

- [ ] **Step 3: Create the API client**

Create `apps/web/src/lib/payroll.ts`:

```ts
import { api } from './api';
import type {
  DeductionRuleDto,
  PayrollRunDto,
  PayrollRunsResult,
  PayrollStatus,
  PayslipDto,
} from '../types';

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listPayrollRuns(params: {
  page?: number;
  pageSize?: number;
  status?: PayrollStatus;
  from?: string;
  to?: string;
}): Promise<PayrollRunsResult> {
  return api.get<PayrollRunsResult>(`/payroll-runs${query(params)}`);
}

export function getPayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.get<{ run: PayrollRunDto }>(`/payroll-runs/${id}`);
}

export function createPayrollRun(input: {
  periodStart: string;
  periodEnd: string;
  payDate: string;
}): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>('/payroll-runs', input);
}

export function calculatePayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/calculate`);
}

export function approvePayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/approve`);
}

export function payPayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/pay`);
}

export function voidPayrollRun(id: string, reason: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/void`, { reason });
}

export function downloadPayrollRunCsv(id: string) {
  return api.download(`/payroll-runs/${id}/export`);
}

export function listMyPayslips(): Promise<{ payslips: PayslipDto[] }> {
  return api.get<{ payslips: PayslipDto[] }>('/payslips/me');
}

export function getPayslip(id: string): Promise<{ payslip: PayslipDto }> {
  return api.get<{ payslip: PayslipDto }>(`/payslips/${id}`);
}

export function listDeductionRules(): Promise<{ rules: DeductionRuleDto[] }> {
  return api.get<{ rules: DeductionRuleDto[] }>('/payroll-deduction-rules');
}

export function createDeductionRule(input: {
  name: string;
  type: 'RATE' | 'FIXED';
  value: number;
  taxable: boolean;
  active: boolean;
}): Promise<{ rule: DeductionRuleDto }> {
  return api.post<{ rule: DeductionRuleDto }>('/payroll-deduction-rules', input);
}

export function updateDeductionRule(
  id: string,
  input: Partial<{
    name: string;
    type: 'RATE' | 'FIXED';
    value: number;
    taxable: boolean;
    active: boolean;
  }>
): Promise<{ rule: DeductionRuleDto }> {
  return api.patch<{ rule: DeductionRuleDto }>(`/payroll-deduction-rules/${id}`, input);
}

export function deleteDeductionRule(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/payroll-deduction-rules/${id}`);
}
```

- [ ] **Step 4: Typecheck the web app**

Run:

```bash
npm run typecheck --workspace=apps/web
```

Expected: exits 0 with no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/types/index.ts apps/web/src/lib/utils.ts apps/web/src/lib/payroll.ts
git commit -m "feat(web): add payroll types, money formatter, and API client"
```

---

## Task 12: Replace the mock payroll page with a real run list

**Files:**
- Modify: `apps/web/src/pages/PayrollPage.tsx`

- [ ] **Step 1: Replace `PayrollPage.tsx`**

Write the full file:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Banknote,
  Plus,
  RefreshCw,
  Download,
  Calculator,
  CheckCircle2,
  Send,
  Ban,
  Eye,
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
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import {
  approvePayrollRun,
  calculatePayrollRun,
  createPayrollRun,
  downloadPayrollRunCsv,
  listPayrollRuns,
  payPayrollRun,
  voidPayrollRun,
} from '../lib/payroll';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, formatMoney } from '../lib/utils';
import type { PayrollRunSummaryDto, PayrollStatus } from '../types';

const STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  CALCULATING: 'Calculating',
  CALCULATED: 'Calculated',
  APPROVED: 'Approved',
  PAID: 'Paid',
  VOID: 'Void',
};

function statusBadge(status: PayrollStatus) {
  const variant =
    status === 'PAID'
      ? 'success'
      : status === 'APPROVED'
        ? 'brand'
        : status === 'VOID'
          ? 'danger'
          : status === 'CALCULATED' || status === 'CALCULATING'
            ? 'info'
            : 'neutral';
  return (
    <Badge variant={variant} dot size="sm">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export const PayrollPage: React.FC = () => {
  const { user } = useAuth();
  const isHr = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_MANAGER';

  const [runs, setRuns] = useState<PayrollRunSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', payDate: '' });
  const [voidTarget, setVoidTarget] = useState<PayrollRunSummaryDto | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await listPayrollRuns({ page: 1, pageSize: 50 });
      setRuns(result.runs);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setForbidden(true);
      else setError(caught instanceof ApiError ? caught.message : 'Could not load payroll runs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (user?.role === 'EMPLOYEE') {
    return <Navigate to="/payroll/my-payslips" replace />;
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1">You don’t have access to payroll runs.</p>
      </div>
    );
  }

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPayrollRun(form);
      setCreateOpen(false);
      setForm({ periodStart: '', periodEnd: '', payDate: '' });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the payroll run.');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    id: string,
    action: 'calculate' | 'approve' | 'pay' | 'export'
  ) => {
    setPending(`${id}:${action}`);
    setError(null);
    try {
      if (action === 'calculate') await calculatePayrollRun(id);
      if (action === 'approve') await approvePayrollRun(id);
      if (action === 'pay') await payPayrollRun(id);
      if (action === 'export') {
        const { blob, filename } = await downloadPayrollRunCsv(id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename ?? 'payroll.csv';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      if (action !== 'export') await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Payroll action failed.');
    } finally {
      setPending(null);
    }
  };

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!voidTarget) return;
    setSaving(true);
    setError(null);
    try {
      await voidPayrollRun(voidTarget.id, voidReason);
      setVoidTarget(null);
      setVoidReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not void the payroll run.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Payroll Runs</h2>
          <p className="text-xs text-slate-500 mt-1">
            Calculate, approve, and disburse payroll from salary, attendance, and approved leave.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
          {isHr && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
              New Run
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading payroll runs…</span>
            </div>
          ) : runs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Banknote className="w-6 h-6" />}
                title="No payroll runs yet"
                description={
                  isHr
                    ? 'Create a run for a pay period, calculate it, then approve and pay.'
                    : 'Payroll runs will appear here once HR creates them.'
                }
                actionLabel={isHr ? 'New Run' : undefined}
                onAction={isHr ? () => setCreateOpen(true) : undefined}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Pay date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          to={`/payroll/runs/${run.id}`}
                          className="font-medium text-slate-900 hover:text-brand-600"
                        >
                          {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(run.payDate)}</TableCell>
                      <TableCell>{statusBadge(run.status)}</TableCell>
                      <TableCell className="text-right">{run.payslipCount}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney(Number(run.totalGross))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(Number(run.totalDeductions))}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(Number(run.totalNet))}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={`/payroll/runs/${run.id}`}
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                            title="View detail"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          {(run.status === 'DRAFT' || run.status === 'CALCULATED') && isHr && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={
                                pending === `${run.id}:calculate` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Calculator className="w-3.5 h-3.5" />
                                )
                              }
                              disabled={pending !== null}
                              onClick={() => void runAction(run.id, 'calculate')}
                            >
                              Calculate
                            </Button>
                          )}
                          {run.status === 'CALCULATED' && isHr && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                              disabled={pending !== null}
                              onClick={() => void runAction(run.id, 'approve')}
                            >
                              Approve
                            </Button>
                          )}
                          {run.status === 'APPROVED' && isHr && (
                            <Button
                              size="sm"
                              icon={<Send className="w-3.5 h-3.5" />}
                              disabled={pending !== null}
                              onClick={() => void runAction(run.id, 'pay')}
                            >
                              Pay
                            </Button>
                          )}
                          {(run.status === 'APPROVED' || run.status === 'PAID') && isHr && (
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<Ban className="w-3.5 h-3.5" />}
                              disabled={pending !== null}
                              onClick={() => setVoidTarget(run)}
                            >
                              Void
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Download className="w-3.5 h-3.5" />}
                            disabled={pending !== null}
                            onClick={() => void runAction(run.id, 'export')}
                          >
                            CSV
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={createOpen}
        title="New payroll run"
        description="Choose the pay period and pay date. The run starts as a draft."
        onClose={() => setCreateOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-run-form" disabled={saving}>
              {saving ? 'Creating…' : 'Create run'}
            </Button>
          </div>
        }
      >
        <form id="create-run-form" className="space-y-4" onSubmit={submitCreate}>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Period start</label>
            <input
              type="date"
              required
              value={form.periodStart}
              onChange={(event) => setForm({ ...form, periodStart: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Period end</label>
            <input
              type="date"
              required
              value={form.periodEnd}
              onChange={(event) => setForm({ ...form, periodEnd: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Pay date</label>
            <input
              type="date"
              required
              value={form.payDate}
              onChange={(event) => setForm({ ...form, payDate: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={voidTarget !== null}
        title="Void payroll run"
        description="Voiding keeps the payslips for audit but ends the run. A reason is required."
        onClose={() => setVoidTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" form="void-run-form" variant="danger" disabled={saving}>
              {saving ? 'Voiding…' : 'Void run'}
            </Button>
          </div>
        }
      >
        <form id="void-run-form" className="space-y-3" onSubmit={submitVoid}>
          <textarea
            required
            rows={3}
            maxLength={500}
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Reason for voiding this run"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
          />
        </form>
      </Modal>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck the web app**

Run:

```bash
npm run typecheck --workspace=apps/web
```

Expected: exits 0. `MyPayslipsPage` is not imported yet because the employee case redirects with `<Navigate>`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PayrollPage.tsx
git commit -m "feat(web): replace mock payroll page with live run list and actions"
```

---

## Task 13: Payroll run detail page

**Files:**
- Create: `apps/web/src/pages/PayrollRunDetailPage.tsx`

- [ ] **Step 1: Create the page**

Write `apps/web/src/pages/PayrollRunDetailPage.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
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
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import {
  approvePayrollRun,
  calculatePayrollRun,
  downloadPayrollRunCsv,
  getPayrollRun,
  payPayrollRun,
  voidPayrollRun,
} from '../lib/payroll';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, formatMoney } from '../lib/utils';
import type { PayrollRunDto, PayrollStatus, PayslipDto } from '../types';

const STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  CALCULATING: 'Calculating',
  CALCULATED: 'Calculated',
  APPROVED: 'Approved',
  PAID: 'Paid',
  VOID: 'Void',
};

function statusBadge(status: PayrollStatus) {
  const variant =
    status === 'PAID'
      ? 'success'
      : status === 'APPROVED'
        ? 'brand'
        : status === 'VOID'
          ? 'danger'
          : status === 'CALCULATED' || status === 'CALCULATING'
            ? 'info'
            : 'neutral';
  return (
    <Badge variant={variant} dot size="sm">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export const PayrollRunDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isHr = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_MANAGER';

  const [run, setRun] = useState<PayrollRunDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await getPayrollRun(id);
      setRun(result.run);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setForbidden(true);
      else setError(caught instanceof ApiError ? caught.message : 'Could not load the payroll run.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (name: 'calculate' | 'approve' | 'pay' | 'export') => {
    if (!run) return;
    setPending(name);
    setError(null);
    try {
      if (name === 'calculate') await calculatePayrollRun(run.id);
      if (name === 'approve') await approvePayrollRun(run.id);
      if (name === 'pay') await payPayrollRun(run.id);
      if (name === 'export') {
        const { blob, filename } = await downloadPayrollRunCsv(run.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename ?? 'payroll.csv';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      if (name !== 'export') await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Payroll action failed.');
    } finally {
      setPending(null);
    }
  };

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!run) return;
    setSaving(true);
    setError(null);
    try {
      await voidPayrollRun(run.id, voidReason);
      setVoidOpen(false);
      setVoidReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not void the payroll run.');
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1">You don’t have access to payroll runs.</p>
      </div>
    );
  }

  if (loading || !run) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs">Loading payroll run…</span>
      </div>
    );
  }

  const renderLines = (payslip: PayslipDto) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50/60">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Earnings
        </p>
        {payslip.lines
          .filter((line) => line.kind === 'EARNING')
          .map((line) => (
            <div key={line.id} className="flex justify-between text-xs py-1">
              <span className="text-slate-600">{line.label}</span>
              <span className="font-medium text-slate-900">
                {formatMoney(Number(line.amount), payslip.currency)}
              </span>
            </div>
          ))}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Deductions
        </p>
        {payslip.lines
          .filter((line) => line.kind === 'DEDUCTION')
          .map((line) => (
            <div key={line.id} className="flex justify-between text-xs py-1">
              <span className="text-slate-600">{line.label}</span>
              <span className="font-medium text-slate-900">
                {formatMoney(Number(line.amount), payslip.currency)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/payroll"
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            title="Back to payroll runs"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">
                {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
              </h2>
              {statusBadge(run.status)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Pay date {formatDate(run.payDate)} · {run.payslipCount} payslips
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(run.status === 'DRAFT' || run.status === 'CALCULATED') && isHr && (
            <Button
              variant="outline"
              icon={<Calculator className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => void action('calculate')}
            >
              Calculate
            </Button>
          )}
          {run.status === 'CALCULATED' && isHr && (
            <Button
              variant="outline"
              icon={<CheckCircle2 className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => void action('approve')}
            >
              Approve
            </Button>
          )}
          {run.status === 'APPROVED' && isHr && (
            <Button
              icon={<Send className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => void action('pay')}
            >
              Pay
            </Button>
          )}
          {(run.status === 'APPROVED' || run.status === 'PAID') && isHr && (
            <Button
              variant="danger"
              icon={<Ban className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => setVoidOpen(true)}
            >
              Void
            </Button>
          )}
          <Button
            variant="outline"
            icon={<Download className="w-4 h-4" />}
            disabled={pending !== null}
            onClick={() => void action('export')}
          >
            CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      {run.status === 'VOID' && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-amber-50 border-amber-200 text-amber-800">
          Voided{run.voidedAt ? ` on ${formatDate(run.voidedAt)}` : ''}
          {run.voidReason ? `: ${run.voidReason}` : ''}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Gross', value: run.totalGross },
          { label: 'Deductions', value: run.totalDeductions },
          { label: 'Net', value: run.totalNet },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {item.label}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-2">
              {formatMoney(Number(item.value), run.payslips[0]?.currency ?? 'USD')}
            </p>
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Employees
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{run.payslipCount}</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {run.payslips.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No payslips yet. Calculate the run to generate them.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Paid days</TableHead>
                    <TableHead className="text-right">Unpaid days</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.payslips.map((payslip) => (
                    <React.Fragment key={payslip.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpanded(expanded === payslip.id ? null : payslip.id)
                        }
                      >
                        <TableCell>
                          <div className="font-medium text-slate-900">{payslip.employeeName}</div>
                          <div className="text-[11px] text-slate-500">
                            {payslip.employeeNumber}
                          </div>
                        </TableCell>
                        <TableCell>{payslip.departmentName ?? '—'}</TableCell>
                        <TableCell className="text-right">{payslip.paidDays}</TableCell>
                        <TableCell className="text-right">{payslip.unpaidDays}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(Number(payslip.grossPay), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(Number(payslip.totalDeductions), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(Number(payslip.netPay), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {expanded === payslip.id ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === payslip.id && (
                        <TableRow>
                          <TableCell colSpan={8} className="p-0">
                            {renderLines(payslip)}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={voidOpen}
        title="Void payroll run"
        description="Voiding keeps the payslips for audit but ends the run. A reason is required."
        onClose={() => setVoidOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="detail-void-form" variant="danger" disabled={saving}>
              {saving ? 'Voiding…' : 'Void run'}
            </Button>
          </div>
        }
      >
        <form id="detail-void-form" className="space-y-3" onSubmit={submitVoid}>
          <textarea
            required
            rows={3}
            maxLength={500}
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Reason for voiding this run"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
          />
        </form>
      </Modal>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck the web app**

Run:

```bash
npm run typecheck --workspace=apps/web
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PayrollRunDetailPage.tsx
git commit -m "feat(web): add payroll run detail with payslips and lifecycle actions"
```

---

## Task 14: Employee self-service payslips page

**Files:**
- Create: `apps/web/src/pages/MyPayslipsPage.tsx`

- [ ] **Step 1: Create the page**

Write `apps/web/src/pages/MyPayslipsPage.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Receipt,
  RefreshCw,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
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
import { ApiError } from '../lib/api';
import { listMyPayslips } from '../lib/payroll';
import { formatDate, formatMoney } from '../lib/utils';
import type { PayslipDto } from '../types';

function payslipStatusBadge(status: PayslipDto['status']) {
  if (status === 'PAID') {
    return (
      <Badge variant="success" dot size="sm">
        Paid
      </Badge>
    );
  }
  if (status === 'ISSUED') {
    return (
      <Badge variant="brand" dot size="sm">
        Issued
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" size="sm">
      Draft
    </Badge>
  );
}

export const MyPayslipsPage: React.FC = () => {
  const [payslips, setPayslips] = useState<PayslipDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMyPayslips();
      setPayslips(result.payslips);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your payslips.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">My Payslips</h2>
          <p className="text-xs text-slate-500 mt-1">
            Your pay history, with earnings and deduction breakdowns.
          </p>
        </div>
        <Button
          variant="outline"
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pay history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading payslips…</span>
            </div>
          ) : payslips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Receipt className="w-6 h-6" />}
                title="No payslips yet"
                description="Payslips appear here after HR calculates and approves a payroll run."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Pay date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((payslip) => (
                    <React.Fragment key={payslip.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpanded(expanded === payslip.id ? null : payslip.id)
                        }
                      >
                        <TableCell className="font-medium text-slate-900">
                          {formatDate(payslip.periodStart)} – {formatDate(payslip.periodEnd)}
                        </TableCell>
                        <TableCell>{formatDate(payslip.payDate)}</TableCell>
                        <TableCell>{payslipStatusBadge(payslip.status)}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(Number(payslip.grossPay), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(Number(payslip.totalDeductions), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(Number(payslip.netPay), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {expanded === payslip.id ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === payslip.id && (
                        <TableRow>
                          <TableCell colSpan={7} className="p-0">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50/60">
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                  Earnings
                                </p>
                                {payslip.lines
                                  .filter((line) => line.kind === 'EARNING')
                                  .map((line) => (
                                    <div key={line.id} className="flex justify-between text-xs py-1">
                                      <span className="text-slate-600">{line.label}</span>
                                      <span className="font-medium text-slate-900">
                                        {formatMoney(Number(line.amount), payslip.currency)}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                              <div>
                                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
                                  Deductions
                                </p>
                                {payslip.lines
                                  .filter((line) => line.kind === 'DEDUCTION')
                                  .map((line) => (
                                    <div key={line.id} className="flex justify-between text-xs py-1">
                                      <span className="text-slate-600">{line.label}</span>
                                      <span className="font-medium text-slate-900">
                                        {formatMoney(Number(line.amount), payslip.currency)}
                                      </span>
                                    </div>
                                  ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck the web app**

Run:

```bash
npm run typecheck --workspace=apps/web
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/MyPayslipsPage.tsx
git commit -m "feat(web): add employee self-service payslips page"
```

---

## Task 15: Deduction rule management page

**Files:**
- Create: `apps/web/src/pages/PayrollDeductionRulesPage.tsx`

- [ ] **Step 1: Create the page**

Write `apps/web/src/pages/PayrollDeductionRulesPage.tsx`:

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, RefreshCw, Trash2, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/Card';
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
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import {
  createDeductionRule,
  deleteDeductionRule,
  listDeductionRules,
  updateDeductionRule,
} from '../lib/payroll';
import { useAuth } from '../contexts/AuthContext';
import { formatMoney } from '../lib/utils';
import type { DeductionRuleDto } from '../types';

interface RuleForm {
  name: string;
  type: 'RATE' | 'FIXED';
  value: string;
  taxable: boolean;
  active: boolean;
}

const EMPTY_FORM: RuleForm = {
  name: '',
  type: 'RATE',
  value: '10',
  taxable: true,
  active: true,
};

export const PayrollDeductionRulesPage: React.FC = () => {
  const { organization } = useAuth();
  const currency = organization?.currency ?? 'USD';

  const [rules, setRules] = useState<DeductionRuleDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<DeductionRuleDto | null>(null);
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<DeductionRuleDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listDeductionRules();
      setRules(result.rules);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load deduction rules.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (rule: DeductionRuleDto) => {
    setEditing(rule);
    setForm({
      name: rule.name,
      type: rule.type,
      value: rule.value,
      taxable: rule.taxable,
      active: rule.active,
    });
    setFormOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        type: form.type,
        value: Number(form.value),
        taxable: form.taxable,
        active: form.active,
      };
      if (editing) await updateDeductionRule(editing.id, payload);
      else await createDeductionRule(payload);
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the rule.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setSaving(true);
    setError(null);
    try {
      await deleteDeductionRule(deleting.id);
      setDeleting(null);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not delete the rule.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Deduction Rules</h2>
          <p className="text-xs text-slate-500 mt-1">
            Percentage and fixed deductions applied to every payroll calculation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
            New Rule
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Active configuration</CardTitle>
            <CardDescription>
              Changes apply to future calculations only. Approved runs keep their amounts.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading deduction rules…</span>
            </div>
          ) : rules.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Wallet className="w-6 h-6" />}
                title="No deduction rules"
                description="Add a rate or fixed deduction to apply it to future payroll runs."
                actionLabel="New Rule"
                onAction={openCreate}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Taxable</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rules.map((rule) => (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium text-slate-900">{rule.name}</TableCell>
                      <TableCell>
                        <Badge variant="info" size="sm">
                          {rule.type === 'RATE' ? 'Percentage' : 'Fixed'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {rule.type === 'RATE'
                          ? `${Number(rule.value).toFixed(2)}%`
                          : formatMoney(Number(rule.value), currency)}
                      </TableCell>
                      <TableCell>{rule.taxable ? 'Yes' : 'No'}</TableCell>
                      <TableCell>
                        <Badge variant={rule.active ? 'success' : 'neutral'} dot size="sm">
                          {rule.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Pencil className="w-3.5 h-3.5" />}
                            onClick={() => openEdit(rule)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Trash2 className="w-3.5 h-3.5" />}
                            onClick={() => setDeleting(rule)}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={formOpen}
        title={editing ? 'Edit deduction rule' : 'New deduction rule'}
        description="A percentage is applied to gross pay; a fixed amount is deducted as-is."
        onClose={() => setFormOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="rule-form" disabled={saving}>
              {saving ? 'Saving…' : editing ? 'Save changes' : 'Create rule'}
            </Button>
          </div>
        }
      >
        <form id="rule-form" className="space-y-4" onSubmit={submit}>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Name</label>
            <input
              required
              maxLength={100}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(event) =>
                  setForm({ ...form, type: event.target.value as 'RATE' | 'FIXED' })
                }
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 bg-white"
              >
                <option value="RATE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {form.type === 'RATE' ? 'Rate (%)' : `Amount (${currency})`}
              </label>
              <input
                required
                type="number"
                min="0.01"
                max={form.type === 'RATE' ? 100 : undefined}
                step="0.01"
                value={form.value}
                onChange={(event) => setForm({ ...form, value: event.target.value })}
                className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
              />
            </div>
          </div>
          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={form.taxable}
                onChange={(event) => setForm({ ...form, taxable: event.target.checked })}
              />
              Taxable
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
              />
              Active
            </label>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleting !== null}
        title="Delete deduction rule"
        description="This removes the rule from future calculations. Historical payslips keep their line items."
        onClose={() => setDeleting(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={saving}>
              {saving ? 'Deleting…' : 'Delete rule'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-700">
          Delete <span className="font-semibold">{deleting?.name}</span>?
        </p>
      </Modal>
    </div>
  );
};
```

- [ ] **Step 2: Typecheck the web app**

Run:

```bash
npm run typecheck --workspace=apps/web
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/PayrollDeductionRulesPage.tsx
git commit -m "feat(web): add deduction rule management page"
```

---

## Task 16: Routes and navigation

**Files:**
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/TopNav.tsx`

- [ ] **Step 1: Add the lazy imports and routes**

In `apps/web/src/app/router.tsx`, add:

```ts
const PayrollRunDetailPage = lazy(() => import('../pages/PayrollRunDetailPage').then(m => ({ default: m.PayrollRunDetailPage })));
const MyPayslipsPage = lazy(() => import('../pages/MyPayslipsPage').then(m => ({ default: m.MyPayslipsPage })));
const PayrollDeductionRulesPage = lazy(() => import('../pages/PayrollDeductionRulesPage').then(m => ({ default: m.PayrollDeductionRulesPage })));
```

Add these children after the existing `payroll/imports/:id` route:

```tsx
      {
        path: 'payroll/runs/:id',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PayrollRunDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'payroll/my-payslips',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <MyPayslipsPage />
          </Suspense>
        ),
      },
      {
        path: 'payroll/deduction-rules',
        element: (
          <Suspense fallback={<LoadingFallback />}>
            <PayrollDeductionRulesPage />
          </Suspense>
        ),
      },
```

- [ ] **Step 2: Add the sidebar entries**

In `apps/web/src/components/layout/Sidebar.tsx`, add `Receipt` and `Wallet` to the lucide import, add `useAuth`:

```ts
import { useAuth } from '../../contexts/AuthContext';
```

Extend `NavItem`:

```ts
interface NavItem {
  label: string;
  path: string;
  icon: React.ElementType;
  badge?: string;
  hrOnly?: boolean;
}
```

Add two entries to `navItems` after Payroll:

```ts
  { label: 'My Payslips', path: '/payroll/my-payslips', icon: Receipt },
  { label: 'Deduction Rules', path: '/payroll/deduction-rules', icon: Wallet, hrOnly: true },
```

Inside the component, before `return`:

```ts
  const { user } = useAuth();
  const isHr = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_MANAGER';
  const visibleItems = navItems.filter((item) => !item.hrOnly || isHr);
```

Change `{navItems.map((item) => {` to `{visibleItems.map((item) => {`.

- [ ] **Step 3: Add the top-nav titles**

In `apps/web/src/components/layout/TopNav.tsx`, add to `pageTitles`:

```ts
  '/payroll/runs/:id': { title: 'Payroll Run Detail', subtitle: 'Payslips, totals, and lifecycle actions' },
  '/payroll/my-payslips': { title: 'My Payslips', subtitle: 'Your pay history and deductions' },
  '/payroll/deduction-rules': { title: 'Deduction Rules', subtitle: 'Percentage and fixed payroll deductions' },
```

Replace the `currentInfo` expression with:

```ts
  const currentInfo =
    pageTitles[location.pathname] ||
    (location.pathname.startsWith('/payroll/imports/')
      ? pageTitles['/payroll/imports/:id']
      : undefined) ||
    (location.pathname.startsWith('/payroll/runs/')
      ? pageTitles['/payroll/runs/:id']
      : undefined) || {
      title: 'PayPilot',
      subtitle: 'Enterprise HRMS & Payroll',
    };
```

- [ ] **Step 4: Typecheck and build the web app**

Run:

```bash
npm run typecheck --workspace=apps/web
npm run build:web
```

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/router.tsx apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/TopNav.tsx
git commit -m "feat(web): route and navigate to payroll runs, payslips, and rules"
```

---

## Task 17: Documentation

**Files:**
- Modify: `README.md`
- Create: `docs/PAYROLL.md`

- [ ] **Step 1: Add the README section**

Insert this section immediately before `## 11. API Endpoints`, and renumber the following two headings to `## 12. API Endpoints` and `## 13. Next Implementation Milestones`:

```markdown
## 11. Payroll Calculation Engine

Payroll runs are calculated from each active employee's base salary, prorated over
Monday–Friday working days, with approved unpaid leave and `ABSENT`/`HALF_DAY`
attendance reducing gross pay. Paid leave and `PRESENT`/`REMOTE` attendance count
fully. Deductions come from per-organization rules (`RATE` or `FIXED`) stored in
`payroll_deduction_rules` and seeded with defaults on first use.

**Lifecycle:** `DRAFT → CALCULATING → CALCULATED → APPROVED → PAID`, with `VOID`
available from `APPROVED` or `PAID`. Recalculation is allowed from `DRAFT` and
`CALCULATED`; `APPROVED` freezes amounts; `PAID` and `VOID` are terminal. Every
transition writes an audit log entry.

**Roles:** `SUPER_ADMIN`, `ADMIN`, and `HR_MANAGER` create, calculate, approve,
pay, void, and manage deduction rules. `MANAGER` reads runs and payslips.
`EMPLOYEE` sees only their own payslips through **My Payslips**.

**Output:** structured payslips with earning and deduction line items, run totals,
and CSV export. PDF generation and progressive tax brackets are not implemented.

See [`docs/PAYROLL.md`](docs/PAYROLL.md) for the algorithm, API, and operational
details.
```

Update milestone 6 in `README.md` to:

```markdown
6. ~~**Payroll Calculation Engine:**~~ Complete — salary-plus-attendance proration, configurable flat-rate deductions, guarded run lifecycle, structured payslips, and CSV export. Progressive tax brackets and PDF payslips remain future work.
```

- [ ] **Step 2: Create `docs/PAYROLL.md`**

Write:

```markdown
# Payroll Calculation Engine

## Overview

A payroll run pays every employee whose status is `ACTIVE` or `ON_LEAVE` during
the selected period. Gross pay is prorated from `Employee.baseSalary` over
Monday–Friday working days. Approved unpaid leave and `ABSENT`/`HALF_DAY`
attendance reduce paid days; paid leave and `PRESENT`/`REMOTE` attendance count
fully. Deductions come from the organization's active `PayrollDeductionRule`
rows. Results are stored as `Payslip` rows with `PayslipLineItem` breakdowns.

All money math is performed in integer cents with half-up rounding and persisted
as `Decimal(12,2)` (payslips) or `Decimal(14,2)` (run totals).

## Calculation algorithm

1. `fullWorkingDays` = Monday–Friday dates in `[periodStart, periodEnd]`.
2. An employee's eligible window starts at `max(periodStart, joinedAt)`. Employees
   who joined after the period, or whose eligible window has no weekdays, are skipped.
3. `eligibleWorkingDays` = Monday–Friday dates in the eligible window.
4. For each date, `unpaid = max(approvedUnpaidLeaveFraction, attendanceFraction)`:
   - approved `UNPAID` leave → `1`
   - `ABSENT` → `1`
   - `HALF_DAY` → `0.5`
   - `PRESENT`, `REMOTE`, `ON_LEAVE` → `0`
   Using `max` prevents double-counting a date that is both unpaid leave and absent.
5. `unpaidDays = min(sum(unpaid), eligibleWorkingDays)`.
6. `paidDays = eligibleWorkingDays - unpaidDays`.
7. `gross = roundHalfUp(baseSalary × paidDays / fullWorkingDays)`.
8. Deductions, in rule-name order:
   - `RATE` → `roundHalfUp(gross × ratePercent / 100)`
   - `FIXED` → the rule amount
9. If gross is zero, deductions and net are zero. If deductions exceed gross, the
   whole run fails with `DEDUCTIONS_EXCEED_GROSS`.
10. `net = gross - totalDeductions`.

A period with no weekdays fails with `NO_WORKING_DAYS`.

## Deduction rules

| Field | Meaning |
|---|---|
| `name` | Unique per organization |
| `type` | `RATE` (percent of gross) or `FIXED` (currency amount) |
| `value` | Percent (0–100) for `RATE`, amount for `FIXED` |
| `taxable` | Informational in this stage |
| `active` | Inactive rules are skipped |

Defaults are seeded once per organization on first rule read or calculation:
Income tax 10%, Pension 5%, Health insurance 50.00 fixed.

## Lifecycle

| Action | Allowed from | Result |
|---|---|---|
| Calculate | `DRAFT`, `CALCULATED` | `CALCULATED` |
| Approve | `CALCULATED` | `APPROVED` (payslips `ISSUED`) |
| Pay | `APPROVED` | `PAID` (payslips `PAID`) |
| Void | `APPROVED`, `PAID` | `VOID` (reason required) |

`CALCULATING` is only visible inside the calculation transaction. Illegal
transitions return `409 INVALID_PAYROLL_TRANSITION`. Approved and paid amounts
are immutable. Voiding retains payslips for audit.

## Endpoints

| Method | Path | Roles |
|---|---|---|
| GET | `/api/payroll-runs` | MANAGER, HR |
| POST | `/api/payroll-runs` | HR |
| GET | `/api/payroll-runs/:id` | MANAGER, HR |
| POST | `/api/payroll-runs/:id/calculate` | HR |
| POST | `/api/payroll-runs/:id/approve` | HR |
| POST | `/api/payroll-runs/:id/pay` | HR |
| POST | `/api/payroll-runs/:id/void` | HR |
| GET | `/api/payroll-runs/:id/export` | MANAGER, HR |
| GET | `/api/payslips/me` | all roles |
| GET | `/api/payslips/:id` | owner, MANAGER, HR |
| GET/POST/PATCH/DELETE | `/api/payroll-deduction-rules` | HR |

HR = `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`. Cross-tenant IDs return `404`.

## CSV export

`GET /api/payroll-runs/:id/export` returns
`payroll-<periodStart>-<periodEnd>.csv` with columns:

```
employee_number, employee_name, department, currency, base_salary,
working_days, paid_days, unpaid_days, absent_days, gross_pay,
total_deductions, net_pay, deductions
```

`deductions` is `Label: amount; Label: amount`. Cells that begin with
`=`, `+`, `-`, or `@` are prefixed with `'` to prevent spreadsheet formula
injection.

## Audit actions

`payroll.run_created`, `payroll.run_calculated`, `payroll.run_approved`,
`payroll.run_paid`, `payroll.run_voided`, `payroll.deduction_rule_created`,
`payroll.deduction_rule_updated`, `payroll.deduction_rule_deleted`.

## Limitations

- No holiday calendar; public holidays count as working days.
- Missing attendance counts as paid; only explicit absence or approved unpaid
  leave reduces pay.
- Flat-rate deductions only; no progressive brackets or statutory jurisdiction
  logic.
- `taxable` is stored but does not change arithmetic yet.
- Dates are treated as UTC calendar dates; `Organization.timezone` is not applied
  to period boundaries.
- No PDF payslips.
```

- [ ] **Step 3: Commit**

```bash
git add README.md docs/PAYROLL.md
git commit -m "docs: document payroll calculation, lifecycle, and CSV export"
```

---

## Task 18: Full verification and pull request

**Files:** none

- [ ] **Step 1: Confirm protected files are untouched**

Run:

```bash
git status --short
```

Expected: the only modified files are the ones from this plan. `DashboardPage.tsx`, `DepartmentsPage.tsx`, and `SettingsPage.tsx` may still show as modified from the user's pre-existing work, but they must not be staged.

Run:

```bash
git diff --name-only origin/main...HEAD | grep -E 'DashboardPage|DepartmentsPage|SettingsPage' || echo "protected files not in branch"
```

Expected: `protected files not in branch`.

- [ ] **Step 2: Run the full verification suite**

Run:

```bash
npm run prisma:validate
npx prisma generate
npm run typecheck
npm run typecheck:tests --workspace=apps/api
npm run build
npm test
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2-)" npm run test:integration --workspace=apps/api
```

Expected:

- Prisma schema is valid.
- Both typechecks exit 0.
- API and web builds succeed.
- Unit tests pass (existing 134 plus the new engine/schema/CSV tests).
- Integration tests pass (existing 223 plus the new payroll suites).

- [ ] **Step 3: Review the final diff**

Run:

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
```

Expected: only payroll schema, API, web, plan/spec, and docs files appear.

- [ ] **Step 4: Push and open the PR**

Run:

```bash
git push -u origin feat/payroll-calculation
gh pr create --base main --head feat/payroll-calculation \
  --title "Payroll Calculation Engine" \
  --body "Implements the payroll calculation engine: salary-plus-attendance proration, configurable deduction rules, guarded run lifecycle, structured payslips, CSV export, and the full payroll UI. See docs/superpowers/specs/2026-11-12-payroll-calculation-engine-design.md."
```

Expected: a PR URL is printed.

- [ ] **Step 5: Report verification results**

Post the command output summary in the PR description or as a comment. Do not merge until review.

---

## Self-Review Notes

- Spec coverage: schema (Task 1), engine (Task 2), validation (Task 3), DTO/CSV (Task 4), rules (Task 5), runs (Task 6), calculation (Task 7), lifecycle (Task 8), payslips/export (Task 9), mounting (Task 10), web types/client (Task 11), run list (Task 12), run detail (Task 13), my payslips (Task 14), rules page (Task 15), routing/nav (Task 16), docs (Task 17), verification (Task 18).
- Type consistency: `PayrollRunDto`, `PayslipDto`, `DeductionRuleDto`, `CalcPayslip`, and `toRunDto`/`toPayslipDto` names are reused consistently across API and web tasks.
- Placeholder scan: every code step contains complete code; no TBD/TODO markers remain.

