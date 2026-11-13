# India Payroll Statutory Deductions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add India new-regime PF, ESI, professional tax, and TDS to payroll runs, with effective-dated HR-editable configuration and a tabbed Payroll Settings UI.

**Architecture:** A pure `payroll.statutory.ts` module computes statutory deductions from integer-cent configuration. The existing pure engine calls it after gross pay. `payroll.service.ts` resolves effective configuration and gates statutory math on `Organization.currency = 'INR'`. Five tenant-scoped config tables store effective-dated slabs and rates; a new Payroll Settings page manages them.

**Tech Stack:** TypeScript, Express, Prisma/PostgreSQL with RLS, Zod, React, React Router, Vite, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-13-india-payroll-statutory-deductions-design.md`

---

## Task 1: Schema, migration, and seeded configuration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261113120000_india_statutory_deductions/migration.sql`

- [ ] **Step 1: Add the employee statutory fields**

In `Employee`, add:

```prisma
  state          String?        @db.VarChar(2)
  pfApplicable   Boolean        @default(true) @map("pf_applicable")
  esiApplicable  Boolean        @default(true) @map("esi_applicable")
```

- [ ] **Step 2: Add the five configuration models**

Add `PayrollStatutorySetting`, `PayrollTaxSlabSet`, `PayrollTaxSlab`,
`PayrollProfessionalTaxSlabSet`, and `PayrollProfessionalTaxSlab` exactly as
specified in the design. Add their relations to `Organization`.

- [ ] **Step 3: Write the migration**

Create the tables, indexes, and foreign keys. Enable and force RLS, add
tenant-scoped policies, and grant:

- `payroll_statutory_settings`: SELECT, INSERT, UPDATE
- `payroll_tax_slab_sets`: SELECT, INSERT, UPDATE, DELETE
- `payroll_tax_slabs`: SELECT, INSERT, DELETE
- `payroll_professional_tax_slab_sets`: SELECT, INSERT, UPDATE, DELETE
- `payroll_professional_tax_slabs`: SELECT, INSERT, DELETE
- `paypilot_migrator`: ALL with `USING (true) WITH CHECK (true)` on all five

Seed every existing organization with the statutory setting, the seven
new-regime slabs, and the MH/KA professional-tax sets from the spec. Deactivate
the exact legacy `Income tax`/`Pension` rules for INR organizations only.

- [ ] **Step 4: Validate and apply**

```bash
npm run prisma:validate
npx prisma migrate dev --name india_statutory_deductions
npx prisma generate
```

Expected: schema valid, migration applied, client regenerated.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261113120000_india_statutory_deductions
git commit -m "feat(db): add effective-dated India statutory payroll configuration"
```

---

## Task 2: Pure statutory calculation module

**Files:**
- Create: `apps/api/src/features/payroll/payroll.money.ts`
- Modify: `apps/api/src/features/payroll/payroll.calc.ts`
- Create: `apps/api/src/features/payroll/payroll.statutory.ts`
- Create: `apps/api/src/features/payroll/payroll.statutory.test.ts`

- [ ] **Step 1: Move `roundHalfUp` into a shared module**

`payroll.money.ts`:

```ts
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}
```

`payroll.calc.ts` imports it and re-exports it so existing tests keep working.

- [ ] **Step 2: Write the failing statutory tests**

Cover PF below/above the ceiling, PF disabled, ESI at/below/above the ceiling,
ESI disabled, MH and KA PT, MH February PT, unknown state, zero gross, TDS below
the rebate threshold, TDS at a slab boundary, TDS with cess, high-salary
multi-slab TDS, and exact half-up rounding.

- [ ] **Step 3: Implement `payroll.statutory.ts`**

Types and function signature:

```ts
export interface StatutoryTaxSlab {
  lowerCents: number;
  upperCents: number | null;
  rateBps: number;
}

export interface StatutoryPtSlab {
  lowerCents: number;
  upperCents: number | null;
  amountCents: number;
  februaryAmountCents: number | null;
}

export interface StatutoryConfig {
  standardDeductionCents: number;
  rebateThresholdCents: number;
  rebateMaxCents: number;
  cessRateBps: number;
  pfEmployeeRateBps: number;
  pfWageCeilingCents: number;
  esiEmployeeRateBps: number;
  esiGrossCeilingCents: number;
  taxSlabs: StatutoryTaxSlab[];
  ptSlabs: StatutoryPtSlab[] | null;
}

export interface StatutoryEmployee {
  baseSalaryCents: number;
  grossCents: number;
  state: string | null;
  pfApplicable: boolean;
  esiApplicable: boolean;
}

export interface StatutoryLine {
  label: string;
  amountCents: number;
  sortOrder: number;
}

export interface StatutoryResult {
  pfCents: number;
  esiCents: number;
  ptCents: number;
  tdsCents: number;
  totalCents: number;
  lines: StatutoryLine[];
}

export function calculateStatutoryDeductions(input: {
  employee: StatutoryEmployee;
  config: StatutoryConfig;
  payDate: string;
}): StatutoryResult;
```

Implementation follows the spec: PF on capped base salary, ESI on prorated gross,
PT from the matching state slab with the February override, TDS from annualized
base salary with standard deduction, annual PT, slab tax, 87A rebate, and cess.
Return only non-zero lines, ordered PF, ESI, PT, TDS with sort orders 1–4.

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=apps/api -- --test-name-pattern="statutory"
```

Expected: all statutory tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/features/payroll/payroll.money.ts \
  apps/api/src/features/payroll/payroll.calc.ts \
  apps/api/src/features/payroll/payroll.statutory.ts \
  apps/api/src/features/payroll/payroll.statutory.test.ts
git commit -m "feat(api): add pure India statutory deduction calculator"
```

---

## Task 3: Integrate statutory lines into the payroll engine

**Files:**
- Modify: `apps/api/src/features/payroll/payroll.calc.ts`
- Modify: `apps/api/src/features/payroll/payroll.calc.test.ts`

- [ ] **Step 1: Extend the engine input**

Add `payDate: string` and `statutory: StatutoryConfig | null` to `CalcInput`.
Add `state`, `pfApplicable`, and `esiApplicable` to `CalcEmployee`.

- [ ] **Step 2: Write failing engine tests**

Add an INR case that asserts the earning line, four statutory deduction lines in
order, custom rules after them, and the expected total/net. Add a null-statutory
case that preserves the existing custom-rule ordering.

- [ ] **Step 3: Update `calculatePayroll`**

After gross and before custom rules:

```ts
const statutory = input.statutory
  ? calculateStatutoryDeductions({
      employee: {
        baseSalaryCents: employee.baseSalaryCents,
        grossCents,
        state: employee.state,
        pfApplicable: employee.pfApplicable,
        esiApplicable: employee.esiApplicable,
      },
      config: input.statutory,
      payDate: input.payDate,
    })
  : null;

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
if (statutory) {
  for (const line of statutory.lines) {
    totalDeductionsCents += line.amountCents;
    lines.push({
      kind: 'DEDUCTION',
      label: line.label,
      amountCents: line.amountCents,
      ruleId: null,
      sortOrder: line.sortOrder,
    });
  }
}

const customOffset = statutory ? 5 : 1;
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
      sortOrder: customOffset + index,
    });
  });
}
```

Keep the existing `DEDUCTIONS_EXCEED_GROSS` guard after the totals.

- [ ] **Step 4: Update existing tests**

Add `payDate` and `statutory: null` to every `calculatePayroll` call.

- [ ] **Step 5: Run and commit**

```bash
npm test --workspace=apps/api -- --test-name-pattern="payroll"
git add apps/api/src/features/payroll/payroll.calc.ts apps/api/src/features/payroll/payroll.calc.test.ts
git commit -m "feat(api): emit statutory deduction lines from the payroll engine"
```

---

## Task 4: Configuration validation schemas

**Files:**
- Create: `apps/api/src/features/payroll/payrollTax.schema.ts`
- Create: `apps/api/src/features/payroll/payrollTax.schema.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Cover valid tax slab sets, gaps, overlaps, a non-zero first lower bound, a null
upper in the middle, invalid rates, statutory payload bounds, PT state format,
and PT February amounts.

- [ ] **Step 2: Implement the schemas**

Use `isDateOnly` for effective dates. Money fields accept decimal strings and
transform to integer cents. Slab arrays must start at zero, be contiguous, have
only the last `upper` null, and contain at least one row. Rates are 0–100; PT
amounts are zero or positive.

Export:

```ts
export type TaxSlabSetInput = z.infer<typeof taxSlabSetSchema>;
export type StatutorySettingsInput = z.infer<typeof statutorySettingsSchema>;
export type ProfessionalTaxInput = z.infer<typeof professionalTaxSchema>;
```

- [ ] **Step 3: Run and commit**

```bash
npm test --workspace=apps/api -- --test-name-pattern="payrollTax"
git add apps/api/src/features/payroll/payrollTax.schema.ts \
  apps/api/src/features/payroll/payrollTax.schema.test.ts
git commit -m "feat(api): validate India payroll tax configuration payloads"
```

---

## Task 5: Configuration service and DTOs

**Files:**
- Create: `apps/api/src/features/payroll/payrollTax.dto.ts`
- Create: `apps/api/src/features/payroll/payrollTax.service.ts`

- [ ] **Step 1: Define DTOs**

Money fields serialize as `toFixed(2)` strings; rates serialize as numbers
(percent). Include `effectiveFrom`, `state` for PT, and `februaryAmount` as a
nullable string.

- [ ] **Step 2: Implement seeding**

`ensurePayrollTaxConfig(tx, organizationId)` upserts the 2025-04-01 statutory
setting, tax slab set, and MH/KA PT sets, using `createMany({ skipDuplicates: true })`
for slabs. It is idempotent.

- [ ] **Step 3: Implement reads**

- `getEffectiveTaxConfig(tx, organizationId, payDate)` returns the latest
  statutory row and tax slab set at or before `payDate`, plus a `Map<string,
  StatutoryPtSlab[]>` of the latest PT set per state.
- `listTaxSlabs`, `listStatutorySettings`, and `listProfessionalTax` return the
  latest version at or before an optional date.

- [ ] **Step 4: Implement writes**

`saveTaxSlabs`, `saveStatutorySettings`, and `saveProfessionalTax` upsert by
their unique keys, replace slab rows in the same transaction, and write the
audit actions from the spec.

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck --workspace=apps/api
git add apps/api/src/features/payroll/payrollTax.dto.ts \
  apps/api/src/features/payroll/payrollTax.service.ts
git commit -m "feat(api): add effective-dated statutory configuration service"
```

---

## Task 6: Configuration routes

**Files:**
- Create: `apps/api/src/features/payroll/payrollTax.routes.ts`
- Modify: `apps/api/src/routes/index.ts`

- [ ] **Step 1: Implement three HR-only routers**

- `payrollTaxSlabsRouter`: `GET /`, `PUT /`
- `payrollStatutorySettingsRouter`: `GET /`, `PUT /`
- `payrollProfessionalTaxRouter`: `GET /`, `PUT /`

All use `requireAuth`, `requireRole(...HR_ROLES)`, and `tenantRouteHandler`.

- [ ] **Step 2: Mount them**

```ts
apiRouter.use('/payroll-tax-slabs', payrollTaxSlabsRouter);
apiRouter.use('/payroll-statutory-settings', payrollStatutorySettingsRouter);
apiRouter.use('/payroll-professional-tax', payrollProfessionalTaxRouter);
```

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck --workspace=apps/api
npm run typecheck:tests --workspace=apps/api
git add apps/api/src/features/payroll/payrollTax.routes.ts apps/api/src/routes/index.ts
git commit -m "feat(api): expose statutory configuration endpoints"
```

---

## Task 7: Employee statutory fields

**Files:**
- Modify: `apps/api/src/routes/employees.schema.ts`
- Modify: `apps/api/src/routes/employees.dto.ts`
- Modify: `apps/api/src/routes/employees.service.ts`
- Modify: `apps/api/src/routes/employees.schema.test.ts`
- Modify: `apps/api/src/routes/employees.integration.test.ts`

- [ ] **Step 1: Extend the schemas**

Add `state` (two uppercase letters or null), `pfApplicable`, and `esiApplicable`
to `employeeFields`. Update the create defaults and partial update behavior.

- [ ] **Step 2: Extend the DTO and service**

Return the three fields from `toEmployeeDto`. Write them on create and update,
and include changed-field names in the audit metadata.

- [ ] **Step 3: Add tests**

Schema tests for valid/invalid state codes and booleans. Integration tests that
create and update an employee with `state: 'MH'`, `pfApplicable: false`, and
`esiApplicable: false`, then read them back.

- [ ] **Step 4: Run and commit**

```bash
npm run typecheck:tests --workspace=apps/api
git add apps/api/src/routes/employees.schema.ts apps/api/src/routes/employees.dto.ts \
  apps/api/src/routes/employees.service.ts apps/api/src/routes/employees.schema.test.ts \
  apps/api/src/routes/employees.integration.test.ts
git commit -m "feat(api): store employee state and PF/ESI eligibility"
```

---

## Task 8: Wire configuration into payroll calculation

**Files:**
- Modify: `apps/api/src/features/payroll/payroll.service.ts`
- Modify: `apps/api/src/features/payroll/payroll.integration.test.ts`

- [ ] **Step 1: Resolve configuration and gate on currency**

In `calculatePayrollRun`, read `organization.currency`. When it is `INR`, call
`ensurePayrollTaxConfig` and `getEffectiveTaxConfig(tx, organizationId,
dateOnly(run.payDate))`. When it is not INR, pass `statutory: null`. Throw
`422 STATUTORY_CONFIG_MISSING` if an INR organization has no config.

- [ ] **Step 2: Pass employee statutory fields**

Select `state`, `pfApplicable`, and `esiApplicable` for each employee and include
them in the engine input along with `payDate`.

- [ ] **Step 3: Update default custom rules**

Change `DEFAULT_RULES` to only the `Health insurance` ₹50 fixed rule.

- [ ] **Step 4: Add INR integration tests**

Create a separate INR organization fixture with employees in MH and KA and no
custom rules. Calculate a run and assert:

- PF, ESI, PT, and TDS lines in order
- exact gross, deduction, and net totals
- an MH February run uses ₹300 PT
- a USD organization gets no statutory lines and keeps its existing totals
- missing config returns `STATUTORY_CONFIG_MISSING` (delete the seeded rows in
  the fixture to test this)

- [ ] **Step 5: Run and commit**

```bash
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')" npm run test:integration --workspace=apps/api
git add apps/api/src/features/payroll/payroll.service.ts \
  apps/api/src/features/payroll/payroll.integration.test.ts
git commit -m "feat(api): calculate India statutory deductions during payroll runs"
```

---

## Task 9: Web types and API client

**Files:**
- Modify: `apps/web/src/types/index.ts`
- Modify: `apps/web/src/lib/payroll.ts`
- Modify: `apps/web/src/lib/employees.ts` (only if its input types live there)
- Modify: `apps/web/src/types/index.ts` employee input types

- [ ] **Step 1: Add DTOs**

Add `PayrollTaxSlabDto`, `PayrollTaxSlabsDto`, `PayrollStatutorySettingsDto`, and
`PayrollProfessionalTaxDto`. Add `state`, `pfApplicable`, and `esiApplicable` to
`EmployeeDto`, `EmployeeCreateInput`, and the update input.

- [ ] **Step 2: Add client functions**

```ts
export function getTaxSlabs(effectiveFrom?: string)
export function saveTaxSlabs(input: TaxSlabSetInput)
export function getStatutorySettings(effectiveFrom?: string)
export function saveStatutorySettings(input: StatutorySettingsInput)
export function getProfessionalTax(state: string, effectiveFrom?: string)
export function saveProfessionalTax(input: ProfessionalTaxInput)
```

Use `api.get` and `api.put`.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck --workspace=apps/web
git add apps/web/src/types/index.ts apps/web/src/lib/payroll.ts apps/web/src/lib/employees.ts
git commit -m "feat(web): add statutory configuration types and API client"
```

---

## Task 10: Payroll Settings page

**Files:**
- Create: `apps/web/src/pages/PayrollSettingsPage.tsx`
- Create: `apps/web/src/components/payroll/DeductionRulesTab.tsx`
- Create: `apps/web/src/components/payroll/IncomeTaxTab.tsx`
- Create: `apps/web/src/components/payroll/StatutorySettingsTab.tsx`
- Create: `apps/web/src/components/payroll/ProfessionalTaxTab.tsx`
- Delete: `apps/web/src/pages/PayrollDeductionRulesPage.tsx`

- [ ] **Step 1: Extract the deduction rules tab**

Move the existing deduction-rule CRUD UI into `DeductionRulesTab` unchanged.

- [ ] **Step 2: Build the income-tax tab**

Effective-date picker, editable slab rows (`lower`, `upper`, `rate`), add/remove
row, Save, inline validation. Load the latest set on mount and on date change.

- [ ] **Step 3: Build the statutory tab**

Effective-date picker and fields for standard deduction, rebate threshold,
rebate max, cess, PF rate/ceiling, and ESI rate/ceiling. Save with the same
effective date.

- [ ] **Step 4: Build the professional-tax tab**

State selector (MH/KA), effective-date picker, slab rows (`lower`, `upper`,
`amount`, `februaryAmount`), Save.

- [ ] **Step 5: Build the page shell**

Tabs: Deductions, Income tax, Statutory, Professional tax. Read the initial tab
from `?tab=` and keep it in sync. Show a banner when the organization currency
is not INR.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck --workspace=apps/web
npm run build:web
git add apps/web/src/pages/PayrollSettingsPage.tsx apps/web/src/components/payroll \
  apps/web/src/pages/PayrollDeductionRulesPage.tsx
git commit -m "feat(web): add tabbed payroll settings for tax and statutory rates"
```

---

## Task 11: Employee form fields

**Files:**
- Modify: `apps/web/src/components/employees/EmployeeFormModal.tsx`
- Modify: `apps/web/src/pages/EmployeesPage.tsx`

- [ ] **Step 1: Add form fields**

Add a state select (blank, MH, KA), PF applicable checkbox, and ESI applicable
checkbox. Include them in the create/update payload and form state.

- [ ] **Step 2: Show the fields**

Show state and PF/ESI eligibility in the employee detail or row where practical.
Correct the base-salary label from “yearly” to “monthly” to match payroll.

- [ ] **Step 3: Typecheck and commit**

```bash
npm run typecheck --workspace=apps/web
git add apps/web/src/components/employees/EmployeeFormModal.tsx apps/web/src/pages/EmployeesPage.tsx
git commit -m "feat(web): capture employee state and PF/ESI eligibility"
```

---

## Task 12: Routes and navigation

**Files:**
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/components/layout/Sidebar.tsx`
- Modify: `apps/web/src/components/layout/TopNav.tsx`

- [ ] **Step 1: Add the settings route and redirect**

Lazy-load `PayrollSettingsPage` at `payroll/settings`. Replace the
`payroll/deduction-rules` element with a `<Navigate to="/payroll/settings?tab=deductions" replace />`.

- [ ] **Step 2: Update navigation**

Sidebar: replace “Deduction Rules” with HR-only “Payroll Settings” at
`/payroll/settings`. TopNav: add the title and subtitle.

- [ ] **Step 3: Typecheck, build, and commit**

```bash
npm run typecheck --workspace=apps/web
npm run build:web
git add apps/web/src/app/router.tsx apps/web/src/components/layout/Sidebar.tsx \
  apps/web/src/components/layout/TopNav.tsx
git commit -m "feat(web): route and navigate to payroll settings"
```

---

## Task 13: Documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/PAYROLL.md`

- [ ] **Step 1: Document the statutory layer**

Add an “India statutory deductions” section to `docs/PAYROLL.md` covering PF,
ESI, PT, TDS, the currency gate, effective-dated configuration, seeded values,
line order, and limitations. Update the README payroll section and milestone 6.

- [ ] **Step 2: Commit**

```bash
git add README.md docs/PAYROLL.md
git commit -m "docs: document India statutory payroll deductions"
```

---

## Task 14: Full verification and pull request

**Files:** none

- [ ] **Step 1: Confirm protected files are untouched**

```bash
git status --short
git diff --name-only origin/main...HEAD | grep -E 'DashboardPage|DepartmentsPage|SettingsPage' || echo "protected files not in branch"
```

Expected: protected files not in the branch.

- [ ] **Step 2: Run the full suite**

```bash
npm run prisma:validate
npx prisma generate
npm run typecheck
npm run typecheck:tests --workspace=apps/api
npm run build
npm test
RUN_DB_INTEGRATION=1 DIRECT_URL="$(grep '^DIRECT_URL=' .env | cut -d= -f2- | tr -d '\"')" npm run test:integration --workspace=apps/api
```

- [ ] **Step 3: Review, push, and open the PR**

```bash
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git push -u origin feat/india-statutory-deductions
gh pr create --base main --head feat/india-statutory-deductions \
  --title "India Payroll Statutory Deductions" \
  --body "Adds new-regime PF, ESI, professional tax, and TDS with effective-dated configuration and a tabbed Payroll Settings UI. See docs/superpowers/specs/2026-11-13-india-payroll-statutory-deductions-design.md."
```

Do not merge until review.

---

## Self-Review Notes

- Spec coverage: schema (Task 1), pure math (Task 2), engine (Task 3), validation
  (Task 4), service (Task 5), API (Task 6), employee fields (Task 7), service
  integration (Task 8), web types/client (Task 9), settings UI (Task 10),
  employee UI (Task 11), routing (Task 12), docs (Task 13), verification (Task 14).
- Currency gate is implemented in Task 8; non-INR organizations keep existing
  custom-rule behavior.
- All money remains integer cents; config money is serialized as decimal strings.
