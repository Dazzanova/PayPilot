import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildExceptionReportCsv, safeCsvCell } from './export';

describe('exception report CSV', () => {
  it('quotes fields and escapes quotes and commas', () => {
    assert.equal(safeCsvCell('say "hi", ok'), '"say ""hi"", ok"');
    assert.equal(safeCsvCell(null), '""');
    assert.equal(safeCsvCell(42), '"42"');
  });

  it('prefixes dangerous formula cells', () => {
    assert.equal(safeCsvCell('=SUM(A1)'), '"\'=SUM(A1)"');
    assert.equal(safeCsvCell('+1'), '"\'+1"');
    assert.equal(safeCsvCell('-1'), '"\'-1"');
    assert.equal(safeCsvCell('@cmd'), '"\'@cmd"');
    assert.equal(safeCsvCell('\tcmd'), '"\'\tcmd"');
  });

  it('builds a deterministic report with a header', () => {
    const csv = buildExceptionReportCsv([
      {
        rowNumber: 1,
        employeeNumber: 'PP-1001',
        payPeriodStart: '2026-10-01',
        payPeriodEnd: '2026-10-31',
        currency: 'INR',
        grossPay: '75000.00',
        totalDeductions: '12500.00',
        netPay: '63000.00',
        severity: 'ERROR',
        ruleCode: 'ARITHMETIC_MISMATCH',
        field: null,
        message: 'gross_pay minus total_deductions does not equal net_pay.',
        expected: '62500.00',
        actual: '63000.00',
      },
    ]);
    const lines = csv.split('\r\n');
    assert.match(lines[0], /^"row_number"/);
    assert.match(lines[1], /PP-1001/);
    assert.match(lines[1], /ARITHMETIC_MISMATCH/);
    assert.equal(lines.at(-1), '');
  });

  it('preserves finding order and exports file-level rows', () => {
    const csv = buildExceptionReportCsv([
      {
        rowNumber: null,
        employeeNumber: null,
        payPeriodStart: null,
        payPeriodEnd: null,
        currency: null,
        grossPay: null,
        totalDeductions: null,
        netPay: null,
        severity: 'ERROR',
        ruleCode: 'INVALID_HEADER',
        field: null,
        message: 'Missing required columns: net_pay',
        expected: null,
        actual: null,
      },
      {
        rowNumber: 1,
        employeeNumber: 'PP-1001',
        payPeriodStart: '2026-10-01',
        payPeriodEnd: '2026-10-31',
        currency: 'INR',
        grossPay: '1.00',
        totalDeductions: '0.00',
        netPay: '2.00',
        severity: 'ERROR',
        ruleCode: 'ARITHMETIC_MISMATCH',
        field: null,
        message: 'mismatch',
        expected: '1.00',
        actual: '2.00',
      },
    ]);
    const lines = csv.trimEnd().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /"row_number"/);
    assert.match(lines[1], /INVALID_HEADER/);
    assert.match(lines[2], /ARITHMETIC_MISMATCH/);
  });
});
