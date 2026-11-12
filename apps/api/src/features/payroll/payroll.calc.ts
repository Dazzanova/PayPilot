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
