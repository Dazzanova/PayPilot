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
