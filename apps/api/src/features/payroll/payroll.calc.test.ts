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
import type { StatutoryConfig } from './payroll.statutory';

const OCTOBER = { periodStart: '2026-10-01', periodEnd: '2026-10-31' };

const INR_CONFIG: StatutoryConfig = {
  standardDeductionCents: 7_500_000,
  rebateThresholdCents: 120_000_000,
  rebateMaxCents: 6_000_000,
  cessRateBps: 400,
  pfEmployeeRateBps: 1200,
  pfWageCeilingCents: 1_500_000,
  esiEmployeeRateBps: 75,
  esiGrossCeilingCents: 2_100_000,
  taxSlabs: [
    { lowerCents: 0, upperCents: 40_000_000, rateBps: 0 },
    { lowerCents: 40_000_000, upperCents: 80_000_000, rateBps: 500 },
    { lowerCents: 80_000_000, upperCents: 120_000_000, rateBps: 1000 },
    { lowerCents: 120_000_000, upperCents: 160_000_000, rateBps: 1500 },
    { lowerCents: 160_000_000, upperCents: 200_000_000, rateBps: 2000 },
    { lowerCents: 200_000_000, upperCents: 240_000_000, rateBps: 2500 },
    { lowerCents: 240_000_000, upperCents: null, rateBps: 3000 },
  ],
  ptSlabs: [
    { lowerCents: 0, upperCents: 750_000, amountCents: 0, februaryAmountCents: 0 },
    {
      lowerCents: 750_000,
      upperCents: 1_000_000,
      amountCents: 17_500,
      februaryAmountCents: 17_500,
    },
    {
      lowerCents: 1_000_000,
      upperCents: null,
      amountCents: 20_000,
      februaryAmountCents: 30_000,
    },
  ],
};

function employee(overrides: Partial<CalcEmployee> = {}): CalcEmployee {
  return {
    id: 'employee-1',
    baseSalaryCents: 5_000_000,
    joinedAt: '2020-01-01',
    state: null,
    pfApplicable: true,
    esiApplicable: true,
    attendance: [],
    approvedLeave: [],
    ...overrides,
  };
}

function input(
  employees: CalcEmployee[],
  rules: CalcRule[] = [],
  statutory: StatutoryConfig | null = null
) {
  return {
    ...OCTOBER,
    payDate: '2026-10-31',
    currency: 'USD',
    rules,
    employees,
    statutory,
  };
}

function run(
  employees: CalcEmployee[],
  rules: CalcRule[] = [],
  statutory: StatutoryConfig | null = null
) {
  return calculatePayroll(input(employees, rules, statutory));
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
          payDate: '2026-10-05',
          currency: 'USD',
          rules: [],
          employees: [employee()],
          statutory: null,
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

  it('emits statutory deductions before custom rules when configured', () => {
    const result = run(
      [
        employee({
          baseSalaryCents: 15_000_000,
          state: 'MH',
        }),
      ],
      [{ id: 'rule-health', name: 'Health insurance', type: 'FIXED', valueCents: 5_000 }],
      INR_CONFIG
    );

    const payslip = result.payslips[0];
    assert.equal(payslip.grossCents, 15_000_000);
    assert.equal(payslip.totalDeductionsCents, 1_457_507);
    assert.equal(payslip.netCents, 13_542_493);
    assert.deepEqual(
      payslip.lines.map((line) => [line.sortOrder, line.label, line.amountCents]),
      [
        [0, 'Base salary (prorated)', 15_000_000],
        [1, 'Provident Fund (employee)', 180_000],
        [3, 'Professional tax', 20_000],
        [4, 'Income tax (TDS)', 1_252_507],
        [5, 'Health insurance', 5_000],
      ]
    );
  });

  it('keeps custom-rule ordering when statutory config is absent', () => {
    const result = run([employee()], [
      { id: 'rule-health', name: 'Health', type: 'FIXED', valueCents: 5_000 },
      { id: 'rule-advance', name: 'Advance', type: 'FIXED', valueCents: 1_000 },
    ]);

    assert.deepEqual(
      result.payslips[0].lines.map((line) => [line.sortOrder, line.label]),
      [
        [0, 'Base salary (prorated)'],
        [1, 'Advance'],
        [2, 'Health'],
      ]
    );
  });
});
