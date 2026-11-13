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
