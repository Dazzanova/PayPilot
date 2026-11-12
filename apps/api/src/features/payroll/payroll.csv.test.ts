import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildPayrollCsv, toPayrollCsvRow } from './payroll.csv';
import type { PayslipDto } from './payroll.dto';

const payslip: PayslipDto = {
  id: 'payslip-1',
  employeeId: 'employee-1',
  employeeName: 'Dana, Iyer',
  employeeNumber: 'PP-3001',
  departmentName: 'Engineering',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  payDate: '2026-10-31',
  baseSalary: '5000.00',
  workingDays: '22.0',
  paidDays: '21.0',
  unpaidDays: '1.0',
  absentDays: '1.0',
  grossPay: '4772.73',
  totalDeductions: '800.00',
  netPay: '3972.73',
  currency: 'USD',
  status: 'DRAFT',
  lines: [
    { id: 'line-1', kind: 'EARNING', label: 'Base salary (prorated)', amount: '4772.73', ruleId: null, sortOrder: 0 },
    { id: 'line-2', kind: 'DEDUCTION', label: 'Income tax', amount: '477.27', ruleId: 'rule-1', sortOrder: 1 },
    { id: 'line-3', kind: 'DEDUCTION', label: 'Pension', amount: '322.73', ruleId: 'rule-2', sortOrder: 2 },
  ],
};

describe('payroll CSV', () => {
  it('emits the expected header and one row per payslip', () => {
    const csv = buildPayrollCsv([toPayrollCsvRow(payslip)]);
    const lines = csv.trim().split('\r\n');
    assert.equal(lines.length, 2);
    assert.equal(
      lines[0],
      '"employee_number","employee_name","department","currency","base_salary","working_days","paid_days","unpaid_days","absent_days","gross_pay","total_deductions","net_pay","deductions"'
    );
    assert.ok(lines[1].includes('"PP-3001"'));
    assert.ok(lines[1].includes('"Dana, Iyer"'));
    assert.ok(lines[1].includes('"Income tax: 477.27; Pension: 322.73"'));
  });

  it('guards spreadsheet formula characters', () => {
    const csv = buildPayrollCsv([
      toPayrollCsvRow({ ...payslip, employeeName: '=SUM(A1)' }),
    ]);
    assert.ok(csv.includes('"\'=SUM(A1)"'));
  });
});
