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
