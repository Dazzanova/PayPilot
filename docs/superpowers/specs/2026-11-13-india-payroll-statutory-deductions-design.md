# India Payroll Statutory Deductions — Design

**Date:** 2026-11-13
**Status:** Approved for planning
**Scope:** Stage 1 of payroll enhancements (tax and statutory deductions)

## 1. Summary

Extend the payroll engine with India-specific statutory deductions under the
new income-tax regime:

- Employee Provident Fund (PF)
- Employee Employee's State Insurance (ESI)
- Professional tax (PT) for Maharashtra and Karnataka
- Monthly Tax Deducted at Source (TDS) from annualized new-regime slabs,
  the standard deduction, the section 87A rebate, and health-and-education cess

Rates, slabs, and ceilings are stored per organization with effective dates and
are editable by HR. The existing payroll run lifecycle, payslip model, CSV
export, and role model remain unchanged.

Out of scope for this stage: the old tax regime, investment declarations,
year-to-date tax reconciliation, marginal relief, employer PF/ESI contributions,
PDF payslips, and a holiday calendar.

## 2. Goals and non-goals

**Goals**

- Produce correct employee-side PF, ESI, PT, and TDS amounts for a payroll run.
- Keep all money math in integer cents with half-up rounding.
- Make statutory configuration effective-dated and editable without a deploy.
- Preserve tenant isolation through RLS and tenant-scoped service queries.
- Show statutory lines on payslips and in the existing CSV export.
- Let HR maintain configuration from one Payroll Settings page.

**Non-goals**

- Old-regime TDS, 80C/80D/HRA declarations, or proof verification.
- YTD gross/TDS tracking, revised projections, or Form 16/24Q generation.
- Employer PF/ESI contributions or CTC breakdowns.
- State-specific PT beyond Maharashtra and Karnataka.
- PDF payslips or email delivery.

## 3. Current state

The payroll engine in `apps/api/src/features/payroll/payroll.calc.ts` is pure and
takes base salary, attendance, approved leave, and custom deduction rules. It
produces one prorated earning line plus custom deduction lines. All money is
integer cents and totals are persisted as `Decimal`.

The current default deduction rules include `Income tax` (10% rate) and
`Pension` (5% rate). Once TDS and PF are computed by the statutory layer, those
defaults would double-deduct.

## 4. Architecture

```
calculatePayroll (existing pure engine)
  ├─ attendance/proration → gross cents
  ├─ custom rules → deduction lines
  └─ calculateStatutoryDeductions (new pure module)
        ├─ PF
        ├─ ESI
        ├─ PT
        └─ TDS
```

`apps/api/src/features/payroll/payroll.statutory.ts` is a pure module. It
receives gross cents, monthly base salary cents, employee statutory fields, the
reference date, and resolved configuration. It returns deduction lines and a
total. It performs no database access.

`payroll.service.ts` resolves the effective configuration and passes it into the
engine. This keeps the tax math unit-testable without a database and mirrors the
existing pure-engine pattern.

### Why a separate module

- Statutory rules change independently of attendance/proration.
- Unit tests can cover slabs, ceilings, and rounding without fixtures.
- `payroll.calc.ts` stays focused on gross pay and custom rules.

## 5. Data model

All new money columns store integer cents; all rates store basis points
(1% = 100 bps). Config rows are tenant-scoped.

### 5.1 Employee fields

Add to `Employee`:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `state` | `String? @db.VarChar(2)` | `null` | Indian state code for PT, uppercase |
| `pf_applicable` | `Boolean` | `true` | Whether employee PF is deducted |
| `esi_applicable` | `Boolean` | `true` | Whether employee ESI is deducted |

`state` is nullable so existing employees are unaffected. PT is zero when the
state is null or has no configured slabs.

### 5.2 PayrollStatutorySetting

One row per organization and effective date.

| Column | Type | Meaning |
|---|---|---|
| `id` | `String @id` | UUID |
| `organization_id` | `String` | Tenant |
| `effective_from` | `Date @db.Date` | First pay date the row applies to |
| `standard_deduction_cents` | `Int` | Annual standard deduction |
| `rebate_threshold_cents` | `Int` | Section 87A taxable-income threshold |
| `rebate_max_cents` | `Int` | Maximum section 87A rebate |
| `cess_rate_bps` | `Int` | Health-and-education cess |
| `pf_employee_rate_bps` | `Int` | Employee PF rate |
| `pf_wage_ceiling_cents` | `Int` | Monthly PF wage ceiling |
| `esi_employee_rate_bps` | `Int` | Employee ESI rate |
| `esi_gross_ceiling_cents` | `Int` | Monthly gross ceiling for ESI |
| `created_at`, `updated_at` | `DateTime` | Timestamps |

Unique: `(organization_id, effective_from)`.

### 5.3 PayrollTaxSlabSet and PayrollTaxSlab

`PayrollTaxSlabSet` identifies one income-tax slab table for an effective date.

| Column | Type | Meaning |
|---|---|---|
| `id` | `String @id` | UUID |
| `organization_id` | `String` | Tenant |
| `effective_from` | `Date @db.Date` | First pay date the set applies to |
| `created_at`, `updated_at` | `DateTime` | Timestamps |

Unique: `(organization_id, effective_from)`.

`PayrollTaxSlab` rows belong to a set.

| Column | Type | Meaning |
|---|---|---|
| `id` | `String @id` | UUID |
| `organization_id` | `String` | Tenant, duplicated for RLS |
| `set_id` | `String` | Parent set |
| `lower_cents` | `Int` | Inclusive lower bound |
| `upper_cents` | `Int?` | Exclusive upper bound; null means unbounded |
| `rate_bps` | `Int` | Marginal rate |
| `created_at` | `DateTime` | Timestamp |

Unique: `(set_id, lower_cents)`. Index: `(organization_id, set_id)`.

### 5.4 PayrollProfessionalTaxSlabSet and PayrollProfessionalTaxSlab

`PayrollProfessionalTaxSlabSet` identifies one state's PT table for an
effective date.

| Column | Type | Meaning |
|---|---|---|
| `id` | `String @id` | UUID |
| `organization_id` | `String` | Tenant |
| `state` | `String @db.VarChar(2)` | State code |
| `effective_from` | `Date @db.Date` | First pay date the set applies to |
| `created_at`, `updated_at` | `DateTime` | Timestamps |

Unique: `(organization_id, state, effective_from)`.

`PayrollProfessionalTaxSlab` rows belong to a set.

| Column | Type | Meaning |
|---|---|---|
| `id` | `String @id` | UUID |
| `organization_id` | `String` | Tenant, duplicated for RLS |
| `set_id` | `String` | Parent set |
| `lower_cents` | `Int` | Inclusive lower bound |
| `upper_cents` | `Int?` | Exclusive upper bound; null means unbounded |
| `amount_cents` | `Int` | Monthly PT amount |
| `february_amount_cents` | `Int?` | February override, when applicable |
| `created_at` | `DateTime` | Timestamp |

Unique: `(set_id, lower_cents)`. Index: `(organization_id, set_id)`.

### 5.5 RLS and grants

Every new table enables and forces row-level security. `paypilot_app` gets
tenant-scoped policies for the operations it needs:

- `payroll_statutory_settings`: SELECT, INSERT, UPDATE
- `payroll_tax_slab_sets`: SELECT, INSERT, UPDATE, DELETE
- `payroll_tax_slabs`: SELECT, INSERT, DELETE
- `payroll_professional_tax_slab_sets`: SELECT, INSERT, UPDATE, DELETE
- `payroll_professional_tax_slabs`: SELECT, INSERT, DELETE

`paypilot_migrator` gets `ALL` with `USING (true)` on every table. Policies use
`public.paypilot_current_organization_id()` like the existing payroll tables.
The runtime role cannot delete statutory settings, preserving an audit trail.

## 6. Calculation rules

### 6.1 Currency gate and reference date

Indian statutory deductions are applied only when `Organization.currency` is
`INR`. For any other currency, `calculatePayroll` skips the statutory module and
behaves exactly as it does today, using only custom deduction rules. This keeps
non-Indian tenants correct and avoids applying PF/ESI/PT/TDS to unrelated
currencies. Configuration rows are still seeded for every organization so an
organization can switch to INR without a data migration.

The service resolves configuration effective on `PayrollRun.payDate`:

- latest `PayrollStatutorySetting` with `effective_from <= payDate`
- latest `PayrollTaxSlabSet` with `effective_from <= payDate`
- latest `PayrollProfessionalTaxSlabSet` for the employee's state with
  `effective_from <= payDate`

If no statutory setting or tax slab set exists for an INR organization, the run
fails with `422 STATUTORY_CONFIG_MISSING`. Missing PT configuration is not an
error; PT is zero and the payslip shows no PT line.

### 6.2 PF

When `pfApplicable` is true and gross is greater than zero:

```
pfWage = min(monthlyBaseSalaryCents, pfWageCeilingCents)
pf = roundHalfUp(pfWage * pfEmployeeRateBps / 10000)
```

`monthlyBaseSalaryCents` is `Employee.baseSalary` in cents, not the prorated
gross. This matches the decision that base salary is basic pay.

### 6.3 ESI

When `esiApplicable` is true, gross is greater than zero, and
`gross <= esiGrossCeilingCents`:

```
esi = roundHalfUp(grossCents * esiEmployeeRateBps / 10000)
```

ESI uses the prorated gross for the period. Above the ceiling, ESI is zero.

### 6.4 Professional tax

When the employee has a state with an effective slab set:

- Find the slab where `gross >= lowerCents` and
  (`upperCents` is null or `gross < upperCents`).
- If the pay date is in February and `februaryAmountCents` is not null, use it;
  otherwise use `amountCents`.
- No matching slab or no state/config: PT is zero.

PT uses prorated gross. This keeps the slab lookup deterministic for partial
months.

### 6.5 TDS

TDS is computed from the full monthly base salary, independent of attendance:

```
annualGross = monthlyBaseSalaryCents * 12
annualPt = ptCents * 12
taxable = max(0, annualGross - standardDeductionCents - annualPt)
tax = 0
for each slab in ascending lowerCents:
  portion = max(0, min(taxable, upperCents ?? taxable) - lowerCents)
  tax += roundHalfUp(portion * rateBps / 10000)
if taxable <= rebateThresholdCents:
  tax = max(0, tax - min(tax, rebateMaxCents))
cess = roundHalfUp(tax * cessRateBps / 10000)
annualTax = tax + cess
monthlyTds = roundHalfUp(annualTax / 12)
```

The annual PT projection uses the regular monthly amount, not the February
override. TDS is zero when gross is zero or when `annualTax` is zero.

### 6.6 Line order and labels

`calculatePayroll` emits:

| Sort | Kind | Label |
|---|---|---|
| 0 | EARNING | `Base salary (prorated)` |
| 1 | DEDUCTION | `Provident Fund (employee)` |
| 2 | DEDUCTION | `ESI (employee)` |
| 3 | DEDUCTION | `Professional tax` |
| 4 | DEDUCTION | `Income tax (TDS)` |
| 5+ | DEDUCTION | Custom rule names, alphabetical |

Statutory lines with a zero amount are omitted. `ruleId` is null for statutory
lines. Custom rules keep their existing `ruleId`.

The existing `DEDUCTIONS_EXCEED_GROSS` guard runs after all deductions are
summed. Statutory deductions participate in the total.

### 6.7 Rounding

All statutory calculations use `roundHalfUp` from the existing engine and remain
in integer cents. Slab tax is rounded per slab, then summed. Cess and monthly TDS
are rounded after their respective divisions.

## 7. Seeded defaults

`ensurePayrollTaxConfig(tx, organizationId)` seeds configuration once per
organization on first read or calculation, mirroring `ensureDeductionRules`.

Effective `2025-04-01`:

**Statutory settings**

| Field | Value |
|---|---|
| Standard deduction | ₹75,000 |
| Rebate threshold | ₹12,00,000 |
| Rebate maximum | ₹60,000 |
| Cess | 4% |
| PF employee rate | 12% |
| PF wage ceiling | ₹15,000/month |
| ESI employee rate | 0.75% |
| ESI gross ceiling | ₹21,000/month |

**New-regime income-tax slabs**

| Taxable income | Rate |
|---|---|
| 0 – 4,00,000 | 0% |
| 4,00,000 – 8,00,000 | 5% |
| 8,00,000 – 12,00,000 | 10% |
| 12,00,000 – 16,00,000 | 15% |
| 16,00,000 – 20,00,000 | 20% |
| 20,00,000 – 24,00,000 | 25% |
| Above 24,00,000 | 30% |

**Professional tax**

| State | Gross range | Monthly amount | February |
|---|---|---|---|
| MH | 0 – 7,500 | ₹0 | ₹0 |
| MH | 7,500 – 10,000 | ₹175 | ₹175 |
| MH | Above 10,000 | ₹200 | ₹300 |
| KA | 0 – 15,000 | ₹0 | ₹0 |
| KA | Above 15,000 | ₹200 | ₹200 |

These values are the last known new-regime figures and are effective-dated so HR
can add a later set for a new financial year through the UI. The settings page
must display the effective date so operators can confirm which rates apply.

## 8. Compatibility and migration

1. Add the employee columns with safe defaults.
2. Create the five config tables, indexes, foreign keys, RLS policies, and grants.
3. Seed config for every existing organization by inserting one statutory row,
   one tax slab set with seven slabs, and PT sets for MH and KA.
4. Deactivate the old seeded rules for INR organizations only, to prevent double
   deduction:

```sql
UPDATE payroll_deduction_rules r
SET active = false
FROM organizations o
WHERE o.id = r.organization_id
  AND o.currency = 'INR'
  AND (
    (r.name = 'Income tax' AND r.type = 'RATE' AND r.value = 10.00)
    OR (r.name = 'Pension' AND r.type = 'RATE' AND r.value = 5.00)
  );
```

Only exact matches in INR organizations are deactivated; custom rules with the
same names or different values are untouched. Non-INR organizations keep their
existing defaults.

5. `ensureDeductionRules` seeds only the `Health insurance` ₹50 example rule for
   new organizations. Existing active `Health insurance` rules remain.

Existing payroll runs and payslips are not recalculated or rewritten.

## 9. API

All configuration endpoints require `SUPER_ADMIN`, `ADMIN`, or `HR_MANAGER`.
Every mutation writes an audit log entry.

### 9.1 Income-tax slabs

`GET /api/payroll-tax-slabs?effectiveFrom=YYYY-MM-DD`

- `effectiveFrom` optional; defaults to the latest set.
- Resolves the latest set with `effective_from <= effectiveFrom`.
- Response: `{ effectiveFrom, slabs: [{ lower, upper, rate }] }`
- `lower` and `upper` are decimal strings; `upper` is null for the last slab;
  `rate` is a number (percent).

`PUT /api/payroll-tax-slabs`

```json
{
  "effectiveFrom": "2025-04-01",
  "slabs": [
    { "lower": "0.00", "upper": "400000.00", "rate": 0 },
    { "lower": "400000.00", "upper": "800000.00", "rate": 5 }
  ]
}
```

Replaces the entire slab set for that effective date. If the set exists, its
slabs are deleted and recreated in one transaction; otherwise a new set is
created. Response is the stored set.

### 9.2 Statutory settings

`GET /api/payroll-statutory-settings?effectiveFrom=YYYY-MM-DD`

Response:

```json
{
  "effectiveFrom": "2025-04-01",
  "standardDeduction": "75000.00",
  "rebateThreshold": "1200000.00",
  "rebateMax": "60000.00",
  "cessRate": 4,
  "pfEmployeeRate": 12,
  "pfWageCeiling": "15000.00",
  "esiEmployeeRate": 0.75,
  "esiGrossCeiling": "21000.00"
}
```

`PUT /api/payroll-statutory-settings` accepts the same shape and upserts by
`effectiveFrom`. Statutory rows are never deleted.

### 9.3 Professional tax

`GET /api/payroll-professional-tax?state=MH&effectiveFrom=YYYY-MM-DD`

- `state` required, two uppercase letters.
- Response: `{ state, effectiveFrom, slabs: [{ lower, upper, amount, februaryAmount }] }`
- `upper` and `februaryAmount` may be null.

`PUT /api/payroll-professional-tax`

```json
{
  "state": "MH",
  "effectiveFrom": "2025-04-01",
  "slabs": [
    { "lower": "0.00", "upper": "7500.00", "amount": "0.00", "februaryAmount": null },
    { "lower": "7500.00", "upper": "10000.00", "amount": "175.00", "februaryAmount": "175.00" },
    { "lower": "10000.00", "upper": null, "amount": "200.00", "februaryAmount": "300.00" }
  ]
}
```

Replaces the set for `(state, effectiveFrom)`.

### 9.4 Validation

Slab sets must satisfy:

- first `lower` is `0`
- each `upper` is greater than its `lower`
- the next `lower` equals the previous `upper`
- only the last slab may have a null `upper`
- rates are between 0 and 100
- amounts are zero or positive
- at least one slab is present

Invalid payloads return `400 VALIDATION_ERROR` with field paths.

### 9.5 Employee API

`POST` and `PATCH /api/employees` accept:

- `state`: two uppercase letters or null
- `pfApplicable`: boolean
- `esiApplicable`: boolean

The employee DTO returns these fields. Existing clients that omit them keep the
defaults.

### 9.6 Audit actions

- `payroll.tax_slabs_updated`
- `payroll.statutory_settings_updated`
- `payroll.professional_tax_updated`

Each entry records the effective date and, for PT, the state.

## 10. UI

### 10.1 Payroll Settings page

Replace `PayrollDeductionRulesPage` with `PayrollSettingsPage` at
`/payroll/settings`. The old `/payroll/deduction-rules` route redirects to
`/payroll/settings?tab=deductions`.

Tabs:

1. **Deductions** — existing custom-rule CRUD, unchanged behavior.
2. **Income tax** — effective-date picker, editable slab rows (lower, upper,
   rate), add/remove row, Save.
3. **Statutory** — effective-date picker and the statutory fields (standard
   deduction, rebate threshold/max, cess, PF rate/ceiling, ESI rate/ceiling).
4. **Professional tax** — state selector (MH/KA), effective-date picker, slab
   rows with amount and optional February amount, Save.

The page loads the latest configuration for each tab. Changing the effective
date loads that version. Saving a new effective date creates a new version.
Validation errors from the API render inline above the form.

If the organization currency is not `INR`, the page shows a banner explaining
that statutory deductions are skipped for non-INR payroll until the organization
currency is changed to INR.

### 10.2 Sidebar and titles

- Sidebar entry changes from “Deduction Rules” to “Payroll Settings”, HR-only.
- `TopNav` title: “Payroll Settings” / “Deductions, income tax, and statutory rates”.
- My Payslips and payroll run pages are unchanged except they now show the new
  statutory line items.

### 10.3 Employee form

`EmployeesPage` create/edit form gains:

- State select: blank, Maharashtra (MH), Karnataka (KA)
- PF applicable checkbox
- ESI applicable checkbox

The employee detail view shows state and PF/ESI eligibility.

### 10.4 Types and API client

`apps/web/src/types/index.ts` adds config DTOs and the employee fields.
`apps/web/src/lib/payroll.ts` adds config list/save functions.

## 11. Error handling

| Code | Status | When |
|---|---|---|
| `STATUTORY_CONFIG_MISSING` | 422 | No effective statutory setting or tax slab set for an INR organization's pay date |
| `VALIDATION_ERROR` | 400 | Invalid slab set, state, or statutory payload |
| `INSUFFICIENT_PERMISSIONS` | 403 | Non-HR role calls a config endpoint |
| `DEDUCTIONS_EXCEED_GROSS` | 422 | Existing guard after statutory lines |

A missing PT configuration is not an error; PT is zero.

## 12. Testing

### 12.1 Unit tests (`payroll.statutory.test.ts`)

- PF on base salary below and above the ₹15,000 ceiling
- PF skipped when `pfApplicable` is false
- ESI at, below, and above the ₹21,000 ceiling
- ESI skipped when `esiApplicable` is false
- PT for MH and KA, including the MH February amount
- PT zero for null/unknown state
- TDS zero below the rebate threshold
- TDS at a slab boundary
- TDS with the 4% cess
- TDS for a high salary crossing several slabs
- Zero gross produces no statutory lines
- Missing config throws `STATUTORY_CONFIG_MISSING`
- Half-up rounding at exact half-cent values

### 12.2 Schema tests

- Valid and invalid tax slab sets (gap, overlap, missing zero start, null upper
  in the middle)
- Statutory payload bounds
- PT payload bounds and state format
- Employee state/PF/ESI fields

### 12.3 Integration tests

- GET returns seeded defaults for a new organization
- PUT creates a new effective-dated version; GET resolves the latest
- PUT replaces slabs without duplicating rows
- HR-only access; employees and managers get 403
- Cross-tenant reads and writes return 404 or write nothing
- Direct SQL access without tenant context returns no config rows
- Employee create/update persists state and PF/ESI flags
- October calculation for an INR organization includes PF, ESI, PT, and TDS
  lines in the defined order
- Totals and net pay match hand-calculated values
- A USD organization keeps its existing custom-rule totals and gets no statutory
  lines
- Deactivated legacy rules no longer appear on new INR payslips
- Existing lifecycle, payslip, CSV, and tenant tests still pass

Existing USD fixtures keep their current payroll totals. The plan adds a new INR
fixture with exact expected statutory amounts rather than rewriting the USD
expectations. Deduction-rule seeding tests are updated to the single
`Health insurance` default for newly created organizations.

### 12.4 Manual verification

- Configure a new effective date and confirm the next calculation uses it.
- Toggle PF/ESI on an employee and confirm the payslip lines disappear.
- Change an employee's state and confirm PT changes.
- Download the CSV and confirm statutory lines appear in the deductions column.

## 13. Limitations

- Indian statutory deductions require `Organization.currency = 'INR'`.
- New income-tax regime only; no old-regime declarations.
- TDS is an annualized monthly estimate from current base salary. It ignores
  YTD pay, variable pay, mid-year salary changes, and marginal relief.
- Annual PT projection uses the regular monthly amount, not the February
  override.
- PF uses base salary as basic pay; employer PF/ESI is not shown.
- PT is seeded for Maharashtra and Karnataka only. Other states return zero
  until configured.
- Configuration is effective-dated but there is no scheduled activation or
  approval workflow.
- No PDF payslips or email delivery.
