# PayPilot Payroll Calculation Engine — Design

**Status:** Approved 2026-11-12
**Branch:** `feat/payroll-calculation` (from `main`)
**Scope:** A real payroll backend on the existing `PayrollRun`/`Payslip` models, a pure calculation engine driven by salary plus attendance/leave, configurable per-organization deduction rules, a guarded run lifecycle, structured payslips with CSV export, and the payroll UI.

---

## 1. Goals

- Calculate gross pay from an employee's base salary, prorated over Monday–Friday working days using attendance records and approved leave.
- Apply configurable per-organization deduction rules (percentage or fixed amount).
- Persist structured payslips with earning/deduction line items and run totals.
- Enforce a guarded run lifecycle: `DRAFT → CALCULATING → CALCULATED → APPROVED → PAID`, with `VOID` from `APPROVED`/`PAID`.
- Expose tenant-scoped REST endpoints with role-based access, plus CSV export of a run.
- Replace the mock `PayrollPage` with a real run list, run detail, employee self-service payslips, and deduction-rule management.
- Keep money arithmetic in integer cents with half-up rounding; store results as `Decimal`.

**Out of scope:** progressive tax brackets, holiday calendar, PDF payslip generation, geo/device attendance, timesheet export, retroactive pay, per-employee currency, payslip emailing, multi-step approval, and any change to attendance or leave behavior.

---

## 2. Decisions

- **Calculation source:** base salary + attendance/leave. A completed payroll import batch is not used to seed or override a run.
- **Proration basis:** Monday–Friday working days in the period. No holiday calendar yet.
- **Deductions:** per-organization flat-rate rules stored in a new `PayrollDeductionRule` table, seeded with sensible defaults on first use.
- **Payslip output:** structured payslips with line items, on-screen detail, and CSV export. No PDF in this stage.
- **Lifecycle:** add a `CALCULATED` enum value. Recalculation is allowed only from `DRAFT` or `CALCULATED`. `APPROVED` freezes amounts. `PAID` is terminal. `VOID` is audited and requires a reason.
- **Permissions:** `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER` mutate. All roles read within the tenant; `EMPLOYEE` sees only their own payslips.
- **Money:** integer cents internally, half-up rounding, `Decimal(12,2)`/`Decimal(14,2)` at rest.
- **Currency:** snapshotted from `Organization.currency` onto each payslip at calculation time.
- **Protected files:** `apps/web/src/pages/DashboardPage.tsx`, `DepartmentsPage.tsx`, and `SettingsPage.tsx` are pre-existing uncommitted user work. They must never be staged or committed. `SettingsPage.tsx` is not edited; deduction-rule management lives on its own page.

---

## 3. Data model

### 3.1 Enum change

`PayrollStatus` gains `CALCULATED`:

```
DRAFT | CALCULATING | CALCULATED | APPROVED | PAID | VOID
```

`PayslipStatus` stays `DRAFT | ISSUED | PAID`.

### 3.2 New table `PayrollDeductionRule`

| Column | Type | Notes |
|---|---|---|
| `id` | `String` uuid | PK |
| `organizationId` | `String` | FK → `organizations`, cascade |
| `name` | `String` | Human label, unique per organization |
| `type` | `DeductionRuleType` | `RATE` or `FIXED` |
| `value` | `Decimal(12,2)` | Percent for `RATE` (0–100), amount for `FIXED` |
| `taxable` | `Boolean` default `true` | Informational in this stage |
| `active` | `Boolean` default `true` | Inactive rules are skipped |
| `createdAt` / `updatedAt` | timestamps | |

- `@@unique([organizationId, name])`
- `@@index([organizationId, active])`
- `@@map("payroll_deduction_rules")`
- New enum `DeductionRuleType { RATE FIXED }`

**Seed defaults** (created lazily on first rule list or first calculation, inside the tenant transaction, only when the organization has zero rules):

| Name | Type | Value |
|---|---|---|
| Income tax | `RATE` | `10.00` |
| Pension | `RATE` | `5.00` |
| Health insurance | `FIXED` | `50.00` |

Seeding is idempotent: re-checking the count after insert and using the unique constraint prevents duplicates.

### 3.3 New table `PayslipLineItem`

| Column | Type | Notes |
|---|---|---|
| `id` | `String` uuid | PK |
| `organizationId` | `String` | FK → `organizations`, cascade |
| `payslipId` | `String` | FK → `payslips`, cascade |
| `kind` | `PayslipLineKind` | `EARNING` or `DEDUCTION` |
| `label` | `String` | e.g. "Base salary (prorated)" |
| `amount` | `Decimal(12,2)` | Non-negative |
| `ruleId` | `String?` | FK → `payroll_deduction_rules`, `SET NULL` |
| `sortOrder` | `Int` | Earnings first, then rules in stable order |

- `@@index([organizationId, payslipId])`
- `@@map("payslip_line_items")`
- New enum `PayslipLineKind { EARNING DEDUCTION }`

### 3.4 `Payslip` additions

Snapshot fields so approved payslips never drift when salary or attendance changes later:

| Column | Type |
|---|---|
| `baseSalary` | `Decimal(12,2)` |
| `workingDays` | `Decimal(5,2)` |
| `paidDays` | `Decimal(5,2)` |
| `unpaidDays` | `Decimal(5,2)` |
| `absentDays` | `Decimal(5,2)` |

`workingDays` is the full-period Monday–Friday count; `paidDays`/`unpaidDays` are within the employee's eligibility window. `absentDays` is the `ABSENT` count (diagnostic). Line items carry the money breakdown.

All five columns are added `NOT NULL DEFAULT 0` in the migration so existing rows upgrade cleanly; Prisma mirrors this with `@default(0)`.

### 3.5 `PayrollRun` additions

| Column | Type | Notes |
|---|---|---|
| `calculatedAt` | `DateTime?` | Last successful calculation |
| `approvedAt` | `DateTime?` | |
| `paidAt` | `DateTime?` | |
| `voidedAt` | `DateTime?` | |
| `voidReason` | `String?` | Required when voiding |

`processedById` already exists and is updated on every transition. `createdById` is not added; the audit log records the actor.

### 3.6 Migration

One migration `20261112xxxxxx_payroll_calculation`:

- `ALTER TYPE "PayrollStatus" ADD VALUE 'CALCULATED'` (before `APPROVED` ordering is irrelevant in Postgres; the app treats states explicitly).
- `CREATE TYPE "DeductionRuleType"`, `CREATE TYPE "PayslipLineKind"`.
- Create both tables, indexes, and foreign keys.
- `ALTER TABLE "payroll_runs"` / `"payslips"` add the new columns (`payslips` new columns are `NOT NULL` with defaults of `0` so the migration applies cleanly to existing rows).
- RLS: `ENABLE` + `FORCE ROW LEVEL SECURITY` on `payroll_deduction_rules` and `payslip_line_items`; select/insert/update policies for `payroll_deduction_rules`, select/insert policies for `payslip_line_items` (line items are replaced only by deleting payslips, which cascades; the runtime role does not update them), plus migrator `FOR ALL` policies.
- `GRANT SELECT, INSERT, UPDATE ON payroll_deduction_rules TO paypilot_app;`
- `GRANT SELECT, INSERT ON payslip_line_items TO paypilot_app;`
- `payroll_runs` and `payslips` already have select/insert/update/delete policies from the native RLS migration, which covers recalculation and lifecycle updates. No policy change is needed there.

> Note: Postgres cannot add an enum value and use it in the same transaction. The migration adds the value first; runtime code only reads/writes `CALCULATED` after deploy, so this is safe.

---

## 4. Calculation engine

`apps/api/src/features/payroll/payroll.calc.ts` is pure: no Prisma, no Express, no clock. It takes a plain input object and returns either a result or a typed failure.

### 4.1 Inputs

```ts
interface CalcInput {
  periodStart: string;          // YYYY-MM-DD
  periodEnd: string;            // YYYY-MM-DD
  currency: string;
  rules: Array<{ id: string; name: string; type: 'RATE' | 'FIXED'; valueCents: number }>;
  employees: Array<{
    id: string;
    baseSalaryCents: number;
    joinedAt: string;           // YYYY-MM-DD
    attendance: Array<{ workDate: string; status: AttendanceStatus }>;
    approvedLeave: Array<{ leaveType: LeaveType; startDate: string; endDate: string }>;
  }>;
}
```

All dates are normalized to UTC midnight. `valueCents` is the rule value scaled by 100 (e.g. `10.00%` → `1000`).

### 4.2 Working days

- `workingDaysIn(start, end)` counts Monday–Friday dates in `[start, end]` inclusive.
- `fullWorkingDays = workingDaysIn(periodStart, periodEnd)`.
- If `fullWorkingDays === 0`, the run fails with `NO_WORKING_DAYS` (422).

### 4.3 Per-employee eligibility

- Eligible window starts at `max(periodStart, joinedAt)` and ends at `periodEnd`.
- Employees with `joinedAt > periodEnd`, or with zero working days in the eligible window, are skipped (no payslip).
- `eligibleWorkingDays = workingDaysIn(eligibleStart, periodEnd)`.

### 4.4 Unpaid days

Compute a per-date unpaid fraction inside the eligible window, then sum:

- **Approved `UNPAID` leave:** for each Monday–Friday date in the intersection of the leave range and the eligible window, fraction `1`.
- **Attendance:** `ABSENT` → `1`; `HALF_DAY` → `0.5`; `PRESENT`, `REMOTE`, `ON_LEAVE` → `0`.
- **Per-date rule:** `unpaid(date) = max(leaveFraction, attendanceFraction)`. This prevents double counting when a date is both unpaid leave and absent.
- `unpaidDays = min(sum(unpaid(date)), eligibleWorkingDays)`.
- `absentDays` = count of `ABSENT` dates (diagnostic only).
- Only `APPROVED` leave counts. `PENDING`, `REJECTED`, and `CANCELLED` are ignored.
- Paid leave types (`ANNUAL`, `SICK`, `CASUAL`, `MATERNITY`, `PATERNITY`, `BEREAVEMENT`) count as paid and do not reduce gross.

### 4.5 Gross

```
paidDays = eligibleWorkingDays - unpaidDays
grossCents = roundHalfUp(baseSalaryCents * paidDays / fullWorkingDays)
```

- Full-period, fully paid employee → `grossCents === baseSalaryCents`.
- A mid-month hire is prorated by the eligible window against the full period.
- A zero-paid-days employee → `grossCents = 0`; deductions are forced to `0` and net to `0` (no negative or nonsense payslip).

### 4.6 Deductions

For each active rule, in `name` ascending order (stable and deterministic):

- `RATE` → `roundHalfUp(grossCents * valueCents / 10_000)` (percent × cents).
- `FIXED` → `valueCents`.

```
totalDeductionsCents = sum(rule deductions)
netCents = grossCents - totalDeductionsCents
```

- If `grossCents > 0` and `totalDeductionsCents > grossCents`, the **whole run fails** with `DEDUCTIONS_EXCEED_GROSS` (422). The error details name the employee.
- `taxable` does not change the arithmetic this stage.

### 4.7 Rounding

- All arithmetic is in integer cents (`number`, safe for these magnitudes).
- `roundHalfUp(n) = Math.floor(n + 0.5)` for non-negative values.
- Rounding happens once per gross and once per `RATE` deduction; sums are exact integers afterward.

### 4.8 Output

```ts
interface CalcPayslip {
  employeeId: string;
  baseSalaryCents: number;
  workingDays: number;      // full period, one decimal
  paidDays: number;
  unpaidDays: number;
  absentDays: number;
  grossCents: number;
  totalDeductionsCents: number;
  netCents: number;
  lines: Array<{ kind: 'EARNING' | 'DEDUCTION'; label: string; amountCents: number; ruleId: string | null; sortOrder: number }>;
}
```

The earning line is `"Base salary (prorated)"` with `amountCents = grossCents`. Each rule produces a `DEDUCTION` line with the rule name. Line `sortOrder` starts at 0 for the earning and increments per rule.

Run totals are the integer sums of payslip gross/deductions/net, written to `Decimal(14,2)`.

---

## 5. API

New module `apps/api/src/features/payroll/` mirroring `payrollImport`: `payroll.routes.ts`, `payroll.schema.ts`, `payroll.service.ts`, `payroll.dto.ts`, `payroll.calc.ts`, `payroll.csv.ts`, plus tests. Mount in `apps/api/src/routes/index.ts`:

```ts
apiRouter.use('/payroll-runs', payrollRunsRouter);
apiRouter.use('/payslips', payslipsRouter);
apiRouter.use('/payroll-deduction-rules', payrollDeductionRulesRouter);
```

### 5.1 Endpoints

| Method | Path | Access | Behavior |
|---|---|---|---|
| GET | `/api/payroll-runs` | MANAGER + HR | List runs, newest period first; `status`, `from`, `to` filters |
| POST | `/api/payroll-runs` | HR | Create `DRAFT`; 409 `PAYROLL_RUN_EXISTS` on duplicate period |
| GET | `/api/payroll-runs/:id` | MANAGER + HR | Run + payslips + line items |
| POST | `/api/payroll-runs/:id/calculate` | HR | `DRAFT`/`CALCULATED` → `CALCULATED` |
| POST | `/api/payroll-runs/:id/approve` | HR | `CALCULATED` → `APPROVED` |
| POST | `/api/payroll-runs/:id/pay` | HR | `APPROVED` → `PAID` |
| POST | `/api/payroll-runs/:id/void` | HR | `APPROVED`/`PAID` → `VOID`; body requires `reason` |
| GET | `/api/payroll-runs/:id/export` | MANAGER + HR | CSV attachment |
| GET | `/api/payslips/me` | all roles | Own payslips only |
| GET | `/api/payslips/:id` | owner, MANAGER, or HR | Single payslip + lines |
| GET | `/api/payroll-deduction-rules` | HR | List; seeds defaults when empty |
| POST | `/api/payroll-deduction-rules` | HR | Create |
| PATCH | `/api/payroll-deduction-rules/:id` | HR | Update name/type/value/taxable/active |
| DELETE | `/api/payroll-deduction-rules/:id` | HR | Delete; 409 if referenced? No — line items use `SET NULL` |

- `HR` = `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER` (`HR_ROLES`).
- `MANAGER + HR` = `MANAGER` plus `HR_ROLES`. `EMPLOYEE` has no access to run list, run detail, or export; it uses `/payslips/me`.
- Employee self-service resolves the employee by `Employee.userId === req.user.id`; if no employee record exists, `/payslips/me` returns an empty list.
- Cross-tenant IDs return `404` (not `403`) to avoid existence leaks.
- All handlers use `tenantRouteHandler` and `withOrganizationContext`; RLS enforces tenant scope.

### 5.2 Validation (`payroll.schema.ts`, zod)

- Run create: `periodStart`, `periodEnd`, `payDate` as `YYYY-MM-DD`; `periodStart <= periodEnd`; `payDate >= periodEnd`; no future-only restriction (historical runs allowed).
- Void: `reason` trimmed, 1–500 chars.
- Rule create/update: `name` 1–100 chars; `type` in `RATE`/`FIXED`; `value` > 0; for `RATE`, `value <= 100`; `taxable`/`active` booleans.
- Dates are validated as real calendar dates, not just the regex.

### 5.3 Service behavior

- `createRun`: inserts `DRAFT` with zero totals; unique conflict → 409.
- Decimal conversion: `baseSalary` and rule values are converted to cents with `decimal.mul(100).toDecimalPlaces(0).toNumber()`, never `Number(decimal) * 100`, to avoid binary-float drift. Results are written back with `new Prisma.Decimal(cents).div(100)`.
- `calculateRun`: inside one `withOrganizationContext` transaction:
  1. Guard and set `CALCULATING` atomically with `updateMany({ where: { id, status: { in: [DRAFT, CALCULATED] } }, data: { status: CALCULATING } })`. If the count is 0, throw `409 INVALID_PAYROLL_TRANSITION`; this also prevents two concurrent calculations.
  2. Load active employees (`status IN (ACTIVE, ON_LEAVE)`), their attendance in the period, approved leave overlapping the period, and the org's rules (seeding defaults if none).
  3. Run `calculatePayroll`.
  4. On engine failure, throw `HttpError` → transaction rolls back, run stays in its prior state.  5. Delete existing payslips for the run (cascades line items), insert payslips + line items, update run totals and `calculatedAt`, set status `CALCULATED`.
- `approveRun`: guard `CALCULATED`; set `APPROVED`, `approvedAt`, payslips `ISSUED`.
- `payRun`: guard `APPROVED`; set `PAID`, `paidAt`, payslips `PAID`.
- `voidRun`: guard `APPROVED`/`PAID`; set `VOID`, `voidedAt`, `voidReason`. Payslips are retained unchanged for audit.
- Illegal transitions return `409 INVALID_PAYROLL_TRANSITION` with `{ from, action }` details.
- Every transition and every rule mutation writes an `AuditLog`:
  - `payroll.run_created`, `payroll.run_calculated`, `payroll.run_approved`, `payroll.run_paid`, `payroll.run_voided`
  - `payroll.deduction_rule_created`, `payroll.deduction_rule_updated`, `payroll.deduction_rule_deleted`
- `entityType` is `PayrollRun` / `PayrollDeductionRule`; metadata holds status, totals, and reason where relevant. No secrets.

### 5.4 CSV export

`GET /api/payroll-runs/:id/export` returns `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="payroll-<periodStart>-<periodEnd>.csv"`.

Columns:

```
employee_number,employee_name,department,currency,base_salary,working_days,paid_days,unpaid_days,absent_days,gross_pay,total_deductions,net_pay,deductions
```

- `deductions` is `Label: amount; Label: amount` in rule order.
- RFC 4180 escaping: quote fields containing `,`, `"`, `\n`; double embedded quotes.
- Amounts are fixed to two decimals from integer cents.
- Employee-role callers cannot reach this endpoint at all (they receive `403`), so a run export never exposes other employees' pay to an `EMPLOYEE`. Managers and HR can export any run in their tenant.

### 5.5 DTOs

Follow `payrollImport.dto.ts`: `Decimal` → `.toFixed(2)` strings; dates as `YYYY-MM-DD`; include `employeeName`, `employeeNumber`, `departmentName`, and line items. Run DTO includes totals as strings, status, timestamps, and `payslipCount`.

---

## 6. Lifecycle and permissions

### 6.1 State machine

| Action | Allowed from | Result |
|---|---|---|
| `calculate` | `DRAFT`, `CALCULATED` | `CALCULATED` |
| `approve` | `CALCULATED` | `APPROVED` |
| `pay` | `APPROVED` | `PAID` |
| `void` | `APPROVED`, `PAID` | `VOID` |

- `CALCULATING` exists only inside the calculation transaction and is never an observable resting state; a rolled-back calculation leaves the previous status intact.
- `PAID` and `VOID` are terminal.
- Recalculation from `CALCULATED` replaces payslips and totals.
- `APPROVED`/`PAID` amounts and payslips are immutable.

### 6.2 Permissions

| Capability | SUPER_ADMIN | ADMIN | HR_MANAGER | MANAGER | EMPLOYEE |
|---|---|---|---|---|---|
| List/detail runs, export | yes | yes | yes | yes | no |
| Create/calculate/approve/pay/void | yes | yes | yes | no | no |
| Manage deduction rules | yes | yes | yes | no | no |
| Read own payslips | yes | yes | yes | yes | yes |
| Read another employee's payslip | yes | yes | yes | yes | no |

---

## 7. UI

All new pages use the existing `Card`, `Button`, `Badge`, `Table`, `Modal`/dialog, and `formatCurrency`/`formatDate` helpers.

### 7.1 `PayrollPage` (replace mock)

- Real `GET /payroll-runs` list: period, pay date, status badge, headcount, gross/deductions/net, actions.
- "New run" modal: period start, period end, pay date; submits `POST`.
- Row actions gated by role and status: Calculate, Approve, Pay, Void (reason dialog), Export CSV, View detail.
- Empty state explains that no runs exist and offers "New run" for HR.
- Loading, error, and disabled states; no mock data import.

### 7.2 `PayrollRunDetailPage`

- Route `/payroll/payroll-runs/:id`.
- Run summary cards (status, period, pay date, totals, headcount).
- Payslip table: employee, department, days, gross, deductions, net.
- Expandable row or side panel with earning/deduction line items.
- Same lifecycle actions and CSV download.
- Void shows the reason and timestamp.

### 7.3 `MyPayslipsPage`

- Route `/payroll/my-payslips`.
- `GET /payslips/me`; table of period, pay date, gross, deductions, net, status.
- Detail panel with line items.
- Shown to `EMPLOYEE` (and available to all roles as a convenience).
- `PayrollPage` for `EMPLOYEE` renders this view instead of the run list.

### 7.4 `PayrollDeductionRulesPage`

- Route `/payroll/deduction-rules`.
- Table of rules: name, type, value (percent or currency), taxable, active.
- Create/edit modal and delete confirmation.
- Note that changes apply to future calculations only; approved runs are frozen.
- No edits to `SettingsPage.tsx`.

### 7.5 Routing and navigation

- Add the four routes in the existing router (`apps/web/src/app/`).
- Add nav entries: Payroll (run list), My payslips, Deduction rules (HR only).
- Extend web types with `PayrollRunDto`, `PayslipDto`, `PayslipLineItemDto`, `DeductionRuleDto`.
- Add a small API client module following the existing page fetch patterns.

---

## 8. Testing

### 8.1 Unit tests (`payroll.calc.test.ts`)

- Working-day counts across a normal month, a month starting on a weekend, and a single-day period.
- Full-period employee → gross equals base salary.
- Mid-month hire → prorated against the full period.
- `ABSENT` and `HALF_DAY` reduce gross; `PRESENT`/`REMOTE`/`ON_LEAVE` do not.
- Approved `UNPAID` leave reduces gross; `PENDING`/`REJECTED`/`CANCELLED` do not.
- Paid leave types do not reduce gross.
- Unpaid leave + absence on the same date counted once (`max`).
- Unpaid days capped at eligible working days.
- Half-up rounding on gross and on a `RATE` deduction (cases that would differ under banker's rounding).
- `FIXED` deduction applied exactly.
- Multiple rules summed in stable order.
- `DEDUCTIONS_EXCEED_GROSS` for a single employee and for one bad employee among many.
- Zero paid days → gross/deductions/net all zero.
- `NO_WORKING_DAYS` when the period has no weekdays.
- Employees joined after the period are skipped.
- Empty employee set → zero totals, no error.

### 8.2 Schema tests (`payroll.schema.test.ts`)

- Valid run create; invalid date format; `periodStart > periodEnd`; `payDate < periodEnd`.
- Void requires a non-empty reason and enforces length.
- Rule validation: `RATE > 100` rejected, `FIXED` any positive value, `value <= 0` rejected, name bounds.

### 8.3 Integration tests (`payroll.integration.test.ts`, `RUN_DB_INTEGRATION=1`)

Use the existing fixture style and a dedicated fixture range.

- Create run → `DRAFT`; duplicate period → `409`.
- Calculate → `CALCULATED`, payslips and line items persisted, totals match the sum.
- Recalculate from `CALCULATED` replaces payslips (count and IDs change).
- Approve → `APPROVED`, payslips `ISSUED`; approve from `DRAFT` → `409`.
- Pay → `PAID`; pay from `CALCULATED` → `409`.
- Void from `APPROVED` and from `PAID` → `VOID` with reason; void from `DRAFT`/`CALCULATED` → `409`.
- Approved run recalculation → `409`; approved amounts unchanged.
- Permission matrix: `EMPLOYEE` and `MANAGER` get `403` on create/calculate/approve/pay/void and rule mutations.
- `EMPLOYEE` gets `403` on run list/detail/export; `/payslips/me` returns only their payslips; `/payslips/:id` for a colleague → `404`.
- Tenant isolation: org B cannot read org A's run, payslip, or rules (`404`).
- Deduction rule CRUD; defaults seeded once; inactive rules skipped in calculation.
- CSV: correct header, row count, escaped fields, attachment header.
- Audit log rows written for each transition.
- RLS: direct query as `paypilot_app` without org context returns no rows.

### 8.4 Verification commands

```bash
npm run prisma:validate
npx prisma migrate deploy
npm run typecheck
npm run typecheck:tests --workspace=apps/api
npm run build
npm test
RUN_DB_INTEGRATION=1 DIRECT_URL=... npm run test:integration
```

### 8.5 Acceptance criteria

- A run can be created, calculated, approved, paid, and voided only through legal transitions.
- Gross pay reflects salary, working days, attendance, and approved unpaid leave as specified.
- Deductions come from the organization's active rules; a run with deductions above gross is rejected.
- Payslips and line items are persisted and returned by the API and CSV.
- Employees see only their own payslips; HR roles manage runs and rules; managers read only.
- Approved and paid amounts cannot change.
- All new tables have RLS enabled, forced, and granted to `paypilot_app`.
- The mock payroll UI is fully replaced; the three protected pages are untouched and unstaged.
- Typecheck, build, unit, and integration suites pass.

---

## 9. Documentation

- Add a **Payroll** section to `README.md`: calculation rules, lifecycle diagram, roles, endpoints, deduction rules, CSV export, and out-of-scope items.
- Add `docs/PAYROLL.md` with:
  - The proration and unpaid-day algorithm, including the `max` de-duplication rule.
  - Rounding and integer-cents policy.
  - The state machine and audit actions.
  - The endpoint and permission matrix.
  - The deduction-rule model and seed defaults.
  - CSV column reference.
  - How to add a deduction type (future) and why `taxable` is informational today.
- Update the milestone list: payroll calculation is complete; PDF and progressive tax remain future work.

---

## 10. Risks and limitations

- **No holiday calendar:** public holidays are treated as working days, so gross can be understated on holiday-heavy periods. Explicitly deferred.
- **Attendance gaps:** missing attendance records count as paid. Only `ABSENT`/`HALF_DAY` and approved unpaid leave reduce pay.
- **Flat-rate deductions:** not a statutory tax engine. Rates are per organization and applied to gross only; `taxable` is metadata.
- **Recalculation destroys prior payslips:** allowed only before approval; audit records each calculation, but the previous payslip rows are gone.
- **Integer-cents bounds:** safe for realistic salaries; extremely large values (> 2^53 cents) are not supported.
- **Enum migration ordering:** `CALCULATED` must be added in its own statement; the app must not write it during the same migration transaction.
- **Timezone:** dates are treated as UTC calendar dates; `Organization.timezone` is not applied to period boundaries this stage.
- **CSV injection:** values are employee-controlled text (names/departments). Prefix cells starting with `=`, `+`, `-`, or `@` with a single quote to prevent spreadsheet formula execution.
- **Protected files:** any broad formatting or import change in the web app could touch `DashboardPage.tsx`, `DepartmentsPage.tsx`, or `SettingsPage.tsx`. Stage files explicitly and verify with `git status` before every commit.

---

## 11. Delivery

- Branch `feat/payroll-calculation` from `main`.
- Suggested commits:
  1. `feat(db): add payroll calculation schema, deduction rules, and line items`
  2. `feat(api): add payroll calculation engine with integer-cent arithmetic`
  3. `feat(api): add payroll run lifecycle, payslip, rule, and CSV endpoints`
  4. `test(api): cover payroll calculation, lifecycle, permissions, and tenant isolation`
  5. `feat(web): replace mock payroll with real runs, payslips, and deduction rules`
  6. `docs: document payroll calculation engine and lifecycle`
- Never stage or commit `apps/web/src/pages/DashboardPage.tsx`, `DepartmentsPage.tsx`, or `SettingsPage.tsx`.
- Open a PR to `main` with verification output; do not merge until review.
- No history rewrites or force pushes.
