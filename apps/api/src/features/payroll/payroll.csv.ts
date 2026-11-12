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
