import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EmployeeStatus } from '@prisma/client';
import {
  parseDateOnly,
  parseMoney,
  parsePayrollRegister,
  validateParsedRegister,
} from './validation';
import type { EmployeeReference } from './payrollImport.types';

const header =
  'employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions,net_pay';
const row = (
  employee = 'PP-1001',
  start = '2026-10-01',
  end = '2026-10-31',
  currency = 'INR',
  gross = '75000.00',
  deductions = '12500.00',
  net = '62500.00'
) => `${employee},${start},${end},${currency},${gross},${deductions},${net}`;

const employees = new Map<string, EmployeeReference>([
  [
    'PP-1001',
    {
      id: '11111111-1111-4111-8111-111111111111',
      employeeNumber: 'PP-1001',
      status: EmployeeStatus.ACTIVE,
      joinedAt: '2025-01-01',
    },
  ],
  [
    'PP-1002',
    {
      id: '22222222-2222-4222-8222-222222222222',
      employeeNumber: 'PP-1002',
      status: EmployeeStatus.TERMINATED,
      joinedAt: '2020-01-01',
    },
  ],
]);

function validate(lines: string[]) {
  const parsed = parsePayrollRegister([header, ...lines].join('\n'));
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error('parse failed');
  return validateParsedRegister(parsed.register, employees);
}

const codes = (findings: { ruleCode: string }[]) => findings.map((f) => f.ruleCode);

describe('parseDateOnly', () => {
  it('accepts real ISO dates only', () => {
    assert.equal(parseDateOnly('2026-10-31'), '2026-10-31');
    assert.equal(parseDateOnly('2026-02-30'), null);
    assert.equal(parseDateOnly('31-10-2026'), null);
    assert.equal(parseDateOnly('2026-1-1'), null);
  });
});

describe('parseMoney', () => {
  it('parses two-decimal money exactly', () => {
    assert.deepEqual(parseMoney('75000.00'), { ok: true, amount: '75000.00', cents: 7500000n });
    assert.deepEqual(parseMoney('0.5'), { ok: true, amount: '0.50', cents: 50n });
    assert.deepEqual(parseMoney('-12.34'), { ok: true, amount: '-12.34', cents: -1234n });
    assert.deepEqual(parseMoney('7'), { ok: true, amount: '7.00', cents: 700n });
  });

  it('distinguishes precision from invalid input', () => {
    assert.deepEqual(parseMoney('1.234'), { ok: false, reason: 'PRECISION' });
    assert.deepEqual(parseMoney('abc'), { ok: false, reason: 'INVALID' });
    assert.deepEqual(parseMoney('1,000.00'), { ok: false, reason: 'INVALID' });
    assert.deepEqual(parseMoney('  '), { ok: false, reason: 'MISSING' });
  });
});

describe('validateParsedRegister', () => {
  it('accepts a valid register and resolves the employee', () => {
    const result = validate([row()]);
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 0);
    assert.equal(result.validRowCount, 1);
    assert.equal(result.invalidRowCount, 0);
    assert.equal(result.records[0].employeeId, employees.get('PP-1001')!.id);
    assert.equal(result.records[0].currency, 'INR');
    assert.deepEqual(result.records[0].findings, []);
  });

  it('flags arithmetic mismatches', () => {
    const result = validate([
      row(undefined, undefined, undefined, undefined, '75000.00', '12500.00', '63000.00'),
    ]);
    assert.deepEqual(codes(result.records[0].findings), ['ARITHMETIC_MISMATCH']);
    assert.equal(result.records[0].isValid, false);
    assert.equal(result.records[0].findings[0].expected, '62500.00');
    assert.equal(result.records[0].findings[0].actual, '63000.00');
  });

  it('flags negative amounts and unsupported precision', () => {
    const result = validate([
      row(undefined, undefined, undefined, undefined, '-1.00', '0.00', '-1.00'),
    ]);
    assert.deepEqual(codes(result.records[0].findings), ['NEGATIVE_AMOUNT', 'NEGATIVE_AMOUNT']);
    const precision = validate([
      row(undefined, undefined, undefined, undefined, '1.234', '0.00', '1.23'),
    ]);
    assert.ok(codes(precision.records[0].findings).includes('UNSUPPORTED_PRECISION'));
  });

  it('flags unknown employees and never rejects inactive employees automatically', () => {
    const unknown = validate([row('PP-9999')]);
    assert.deepEqual(codes(unknown.records[0].findings), ['UNKNOWN_EMPLOYEE']);
    assert.equal(unknown.records[0].employeeId, null);

    const inactive = validate([row('PP-1002', '2026-10-01', '2026-10-31')]);
    assert.deepEqual(codes(inactive.records[0].findings), ['EMPLOYEE_INACTIVE']);
    assert.equal(inactive.records[0].isValid, true);
    assert.equal(inactive.errorCount, 0);
    assert.equal(inactive.warningCount, 1);
  });

  it('warns when the period starts before joining', () => {
    const result = validate([row('PP-1001', '2024-12-01', '2024-12-31')]);
    assert.deepEqual(codes(result.records[0].findings), ['PERIOD_BEFORE_JOIN_DATE']);
    assert.equal(result.records[0].isValid, true);
  });

  it('detects duplicate employee periods', () => {
    const result = validate([row(), row()]);
    assert.deepEqual(codes(result.records[0].findings), []);
    assert.deepEqual(codes(result.records[1].findings), ['DUPLICATE_EMPLOYEE_PERIOD']);
    assert.equal(result.records[1].findings[0].rowNumber, 2);
    assert.equal(result.validRowCount, 1);
    assert.equal(result.invalidRowCount, 1);
  });

  it('flags mixed currencies and periods after the first row', () => {
    const result = validate([
      row(),
      row('PP-1002', '2026-10-01', '2026-10-31', 'USD', '1.00', '0.00', '1.00'),
      row('PP-1002', '2026-11-01', '2026-11-30', 'INR', '1.00', '0.00', '1.00'),
    ]);
    assert.ok(codes(result.records[1].findings).includes('INCONSISTENT_CURRENCY'));
    assert.ok(codes(result.records[2].findings).includes('INCONSISTENT_PAY_PERIOD'));
    assert.equal(result.currency, 'INR');
    assert.equal(result.payPeriodStart, '2026-10-01');
    assert.equal(result.payPeriodEnd, '2026-10-31');
  });

  it('flags missing and invalid field values', () => {
    const result = validate(['PP-1001,,2026-10-31,INR,1.00,0.00,1.00']);
    assert.ok(codes(result.records[0].findings).includes('MISSING_VALUE'));
    const invalidDate = validate(['PP-1001,2026-13-01,2026-10-31,INR,1.00,0.00,1.00']);
    assert.ok(codes(invalidDate.records[0].findings).includes('INVALID_DATE'));
    const lowercaseCurrency = validate([
      'PP-1001,2026-10-01,2026-10-31,inr,1.00,0.00,1.00',
    ]);
    assert.ok(codes(lowercaseCurrency.records[0].findings).includes('INVALID_CURRENCY'));
    const reversedPeriod = validate([
      'PP-1001,2026-10-31,2026-10-01,INR,1.00,0.00,1.00',
    ]);
    assert.ok(codes(reversedPeriod.records[0].findings).includes('INVALID_PERIOD'));
  });

  it('sorts findings by rule order and field, not input order', () => {
    const result = validate(['PP-1001,,2026-10-31,INR,abc,0.00,1.234']);
    const recordCodes = codes(result.records[0].findings);
    assert.deepEqual(recordCodes, [
      'MISSING_VALUE',
      'INVALID_AMOUNT',
      'UNSUPPORTED_PRECISION',
    ]);
    assert.equal(result.records[0].findings[0].field, 'pay_period_start');
  });

  it('reports file-level failures', () => {
    const empty = parsePayrollRegister('');
    assert.equal(empty.ok, false);
    if (!empty.ok) assert.deepEqual(codes(empty.findings), ['EMPTY_FILE']);

    const headerOnly = parsePayrollRegister(header);
    assert.equal(headerOnly.ok, false);
    if (!headerOnly.ok) assert.deepEqual(codes(headerOnly.findings), ['EMPTY_FILE']);

    const missing = parsePayrollRegister('employee_number,currency\nPP-1001,INR');
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.deepEqual(codes(missing.findings), ['INVALID_HEADER']);

    const duplicateHeader = parsePayrollRegister(`${header},net_pay\n${row()},62500.00`);
    assert.equal(duplicateHeader.ok, false);
    if (!duplicateHeader.ok) assert.deepEqual(codes(duplicateHeader.findings), ['INVALID_HEADER']);

    const unclosed = parsePayrollRegister(`${header}\nPP-1001,2026-10-01\n"oops`);
    assert.equal(unclosed.ok, false);
    if (!unclosed.ok) assert.deepEqual(codes(unclosed.findings), ['CSV_PARSE_ERROR']);
  });

  it('warns about extra columns but still validates rows', () => {
    const parsed = parsePayrollRegister(`${header},notes\n${row()},hello`);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    const result = validateParsedRegister(parsed.register, employees);
    assert.deepEqual(codes(result.batchFindings), ['UNEXPECTED_COLUMN']);
    assert.equal(result.errorCount, 0);
    assert.equal(result.warningCount, 1);
    assert.equal(result.validRowCount, 1);
  });

  it('rejects registers above the row limit', () => {
    const rows = Array.from({ length: 10_001 }, (_, index) =>
      row(`PP-${10_000 + index}`)
    );
    const parsed = parsePayrollRegister([header, ...rows].join('\n'));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.deepEqual(codes(parsed.findings), ['TOO_MANY_ROWS']);
  });

  it('is deterministic', () => {
    const first = validate([row(), row('PP-9999')]);
    const second = validate([row(), row('PP-9999')]);
    assert.deepEqual(first, second);
  });
});
