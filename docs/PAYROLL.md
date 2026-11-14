# Payroll Calculation Engine

## Overview

A payroll run pays every employee whose status is `ACTIVE` or `ON_LEAVE` during
the selected period. Gross pay is prorated from `Employee.baseSalary` over
Monday–Friday working days. Approved unpaid leave and `ABSENT`/`HALF_DAY`
attendance reduce paid days; paid leave and `PRESENT`/`REMOTE` attendance count
fully. Deductions come from the organization's active `PayrollDeductionRule`
rows. For organizations whose currency is `INR`, employee-side statutory
deductions (PF, ESI, professional tax, and TDS) are calculated first from
effective-dated configuration. Results are stored as `Payslip` rows with
`PayslipLineItem` breakdowns.

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
8. For INR organizations, statutory employee deductions are computed in the
   order PF, ESI, professional tax, TDS (see below).
9. Custom deduction rules, in rule-name order:
   - `RATE` → `roundHalfUp(gross × ratePercent / 100)`
   - `FIXED` → the rule amount
10. If gross is zero, deductions and net are zero. If deductions exceed gross, the
    whole run fails with `DEDUCTIONS_EXCEED_GROSS`.
11. `net = gross - totalDeductions`.

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
non-INR organizations get Income tax 10%, Pension 5%, and Health insurance 50.00
fixed. INR organizations get only Health insurance 50.00 because income tax and
PF are handled by the statutory layer; seeding the legacy examples would
double-deduct. The migration also deactivates the exact legacy `Income tax`
(10%) and `Pension` (5%) rules for existing INR organizations.

## India statutory deductions

Statutory deductions apply only when `Organization.currency = 'INR'`. Other
currencies keep the custom-rule behavior described above and never receive PF,
ESI, professional-tax, or TDS lines.

`Employee.baseSalary` is treated as monthly basic pay. No separate salary
component model exists. `Employee.state` selects the professional-tax table, and
`Employee.pfApplicable` / `Employee.esiApplicable` opt an employee out of PF or
ESI respectively.

| Deduction | Calculation |
|---|---|
| Provident Fund (employee) | `pfEmployeeRate` of monthly basic pay capped at `pfWageCeiling`, independent of attendance. |
| ESI (employee) | `esiEmployeeRate` of prorated gross when prorated gross is at or below `esiGrossCeiling`; zero above it. |
| Professional tax | State slab selected by prorated gross. `februaryAmount` replaces `amount` in February when set. No state or no state configuration means zero. |
| Income tax (TDS) | Annualise monthly basic pay × 12, subtract the standard deduction, apply the new-regime slabs, apply the §87A rebate, add cess, then divide by 12. Independent of attendance. |

Line order is PF, ESI, professional tax, TDS, then custom rules in alphabetical
order. Zero statutory lines are omitted. When statutory configuration exists,
custom rules start at `sortOrder` 5.

### Effective-dated configuration

Configuration lives in five tables and is versioned by `effectiveFrom`:

| Table | Purpose |
|---|---|
| `payroll_statutory_settings` | Standard deduction, rebate threshold/max, cess, PF rate/ceiling, ESI rate/ceiling |
| `payroll_tax_slab_sets` / `payroll_tax_slabs` | One income-tax slab table per effective date |
| `payroll_professional_tax_slab_sets` / `payroll_professional_tax_slabs` | One professional-tax table per state and effective date |

A payroll run resolves the newest version whose `effectiveFrom` is on or before
the run's pay date. A missing statutory setting or income-tax slab set fails the
run with `422 STATUTORY_CONFIG_MISSING`. Missing professional-tax configuration
for an employee's state yields zero PT instead of failing.

### Seeded values

The migration seeds every existing organization with `effectiveFrom`
`2025-04-01`, and new organizations are seeded on first configuration read:

| Setting | Seeded value |
|---|---|
| Standard deduction | ₹75,000 |
| Income-tax slabs | 0–4L 0%, 4–8L 5%, 8–12L 10%, 12–16L 15%, 16–20L 20%, 20–24L 25%, above 24L 30% |
| §87A rebate | Threshold ₹12,00,000, maximum ₹60,000 |
| Health & education cess | 4% |
| Employee PF | 12%, wage ceiling ₹15,000 |
| Employee ESI | 0.75%, gross ceiling ₹21,000 |
| Maharashtra PT | 0–7,500 ₹0; 7,500–10,000 ₹175; above 10,000 ₹200 (February ₹300) |
| Karnataka PT | 0–15,000 ₹0; above 15,000 ₹200 |

These are last-known FY 2025-26 figures. They are effective-dated and editable so
HR can add later versions without a deploy, but they must be reviewed against
current statute before production use.

### Configuration UI and API

HR manages configuration at **Payroll Settings** (`/payroll/settings`) with
Deductions, Income tax, Statutory, and Professional tax tabs. The old
`/payroll/deduction-rules` route redirects to the Deductions tab. The page shows
a banner when the organization currency is not INR.

| Method | Path | Roles |
|---|---|---|
| GET/PUT | `/api/payroll-tax-slabs` | HR |
| GET/PUT | `/api/payroll-statutory-settings` | HR |
| GET/PUT | `/api/payroll-professional-tax?state=MH` | HR |

`PUT` replaces the full slab set for the supplied effective date. Money is
serialized as decimal strings and rates as percentages.

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
Statutory configuration endpoints are listed under [India statutory deductions](#india-statutory-deductions).

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
`payroll.deduction_rule_updated`, `payroll.deduction_rule_deleted`,
`payroll.tax_slabs_updated`, `payroll.statutory_settings_updated`,
`payroll.professional_tax_updated`.

## Limitations

- No holiday calendar; public holidays count as working days.
- Missing attendance counts as paid; only explicit absence or approved unpaid
  leave reduces pay.
- Non-INR organizations use flat-rate custom deductions only; there is no
  progressive bracket or statutory jurisdiction logic for them.
- India support is new-regime only: no old regime, investment declarations,
  year-to-date reconciliation, or marginal relief.
- TDS is a monthly projection from base salary and does not reconcile against
  actual annual income at year end.
- Only employee-side PF and ESI are deducted; employer contributions are not
  modelled.
- Professional tax is seeded only for Maharashtra and Karnataka. Other states
  produce zero PT until configuration is added.
- `taxable` is stored but does not change arithmetic.
- Dates are treated as UTC calendar dates; `Organization.timezone` is not applied
  to period boundaries.
- No PDF payslips.
