import { EmployeeStatus } from '@prisma/client';
import { parseCsv, type CsvParseResult } from './csv';
import {
  MAX_DATA_ROWS,
  REQUIRED_COLUMNS,
  RULE_ORDER,
  RULE_SEVERITY,
  type EmployeeReference,
  type FindingDraft,
  type NormalizedRecord,
  type ParsedRegister,
  type RequiredColumn,
  type RuleCode,
  type ValidationResult,
} from './payrollImport.types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;
const MONEY = /^-?\d{1,12}(?:\.\d{1,2})?$/;
const MONEY_PRECISION = /^-?\d{1,12}\.\d{3,}$/;

export type RegisterParseResult =
  | { ok: true; register: ParsedRegister }
  | { ok: false; findings: FindingDraft[] };

type CsvFailure = Extract<CsvParseResult, { ok: false }>;

function isCsvFailure(result: CsvParseResult): result is CsvFailure {
  return result.ok === false;
}

export function parseDateOnly(value: string): string | null {
  if (!ISO_DATE.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10) === value ? value : null;
}

export type MoneyResult =
  | { ok: true; amount: string; cents: bigint }
  | { ok: false; reason: 'MISSING' | 'PRECISION' | 'INVALID' };

type MoneyFailure = Extract<MoneyResult, { ok: false }>;

function isMoneyFailure(result: MoneyResult): result is MoneyFailure {
  return result.ok === false;
}

export function formatCents(cents: bigint): string {
  const absolute = cents < 0n ? -cents : cents;
  const whole = absolute / 100n;
  const fraction = (absolute % 100n).toString().padStart(2, '0');
  return `${cents < 0n ? '-' : ''}${whole}.${fraction}`;
}

export function parseMoney(value: string): MoneyResult {
  const trimmed = value.trim();
  if (trimmed === '') return { ok: false, reason: 'MISSING' };
  if (MONEY_PRECISION.test(trimmed)) return { ok: false, reason: 'PRECISION' };
  if (!MONEY.test(trimmed)) return { ok: false, reason: 'INVALID' };

  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  const [whole, fraction = ''] = unsigned.split('.');
  const cents = BigInt(whole + fraction.padEnd(2, '0')) * (negative ? -1n : 1n);
  return { ok: true, amount: formatCents(cents), cents };
}

function finding(
  ruleCode: RuleCode,
  message: string,
  details: Omit<FindingDraft, 'ruleCode' | 'message'> = {}
): FindingDraft {
  return { ruleCode, message, ...details };
}

function sortFindings(findings: FindingDraft[]): FindingDraft[] {
  return [...findings].sort((a, b) => {
    const rule = RULE_ORDER.indexOf(a.ruleCode) - RULE_ORDER.indexOf(b.ruleCode);
    if (rule !== 0) return rule;
    return (a.field ?? '').localeCompare(b.field ?? '');
  });
}

function resolveColumns(
  headers: string[]
):
  | { ok: true; columns: Record<RequiredColumn, number>; findings: FindingDraft[] }
  | { ok: false; findings: FindingDraft[] } {
  const normalized = headers.map((header) => header.trim());
  const duplicates = normalized.filter(
    (header, index) => header !== '' && normalized.indexOf(header) !== index
  );

  if (duplicates.length > 0) {
    const unique = [...new Set(duplicates)];
    return {
      ok: false,
      findings: [
        finding('INVALID_HEADER', `Duplicate column headers: ${unique.join(', ')}`, {
          expected: 'Each required column appears once',
          actual: unique.join(','),
        }),
      ],
    };
  }

  const columns = {} as Record<RequiredColumn, number>;
  const missing: string[] = [];

  for (const column of REQUIRED_COLUMNS) {
    const index = normalized.indexOf(column);
    if (index === -1) missing.push(column);
    else columns[column] = index;
  }

  if (missing.length > 0) {
    return {
      ok: false,
      findings: [
        finding('INVALID_HEADER', `Missing required columns: ${missing.join(', ')}`, {
          expected: REQUIRED_COLUMNS.join(','),
          actual: missing.join(','),
        }),
      ],
    };
  }

  const extras = normalized.filter(
    (header) => header !== '' && !(REQUIRED_COLUMNS as readonly string[]).includes(header)
  );
  const findings =
    extras.length > 0
      ? [
          finding('UNEXPECTED_COLUMN', `Ignoring unexpected columns: ${extras.join(', ')}`, {
            expected: REQUIRED_COLUMNS.join(','),
            actual: extras.join(','),
          }),
        ]
      : [];

  return { ok: true, columns, findings };
}

export function parsePayrollRegister(text: string): RegisterParseResult {
  if (text.trim() === '') {
    return { ok: false, findings: [finding('EMPTY_FILE', 'The uploaded file is empty.')] };
  }

  const parsed = parseCsv(text);
  if (isCsvFailure(parsed)) {
    return {
      ok: false,
      findings: [finding('CSV_PARSE_ERROR', parsed.message, { rowNumber: parsed.rowNumber })],
    };
  }

  const resolved = resolveColumns(parsed.headers);
  if (!resolved.ok) return { ok: false, findings: resolved.findings };

  if (parsed.rows.length === 0) {
    return {
      ok: false,
      findings: [
        ...resolved.findings,
        finding('EMPTY_FILE', 'The file contains a header but no data rows.'),
      ],
    };
  }

  if (parsed.rows.length > MAX_DATA_ROWS) {
    return {
      ok: false,
      findings: [
        ...resolved.findings,
        finding(
          'TOO_MANY_ROWS',
          `The file contains ${parsed.rows.length} data rows; the limit is ${MAX_DATA_ROWS}.`,
          { expected: String(MAX_DATA_ROWS), actual: String(parsed.rows.length) }
        ),
      ],
    };
  }

  return {
    ok: true,
    register: { columns: resolved.columns, rows: parsed.rows, headerFindings: resolved.findings },
  };
}

export function validateParsedRegister(
  register: ParsedRegister,
  employees: ReadonlyMap<string, EmployeeReference>
): ValidationResult {
  const records: NormalizedRecord[] = [];
  const batchFindings = [...register.headerFindings];
  const seenPeriods = new Set<string>();
  let batchCurrency: string | null = null;
  let batchStart: string | null = null;
  let batchEnd: string | null = null;

  for (const row of register.rows) {
    const findings: FindingDraft[] = [];
    const get = (column: RequiredColumn) => (row.values[register.columns[column]] ?? '').trim();

    const employeeNumber = get('employee_number').toUpperCase();
    if (!employeeNumber) {
      findings.push(
        finding('MISSING_VALUE', 'Employee number is required.', { field: 'employee_number' })
      );
    }

    const startValue = get('pay_period_start');
    const endValue = get('pay_period_end');
    const start = startValue ? parseDateOnly(startValue) : null;
    const end = endValue ? parseDateOnly(endValue) : null;

    if (!startValue) {
      findings.push(
        finding('MISSING_VALUE', 'Pay period start is required.', { field: 'pay_period_start' })
      );
    } else if (!start) {
      findings.push(
        finding('INVALID_DATE', 'Pay period start is not a valid ISO date.', {
          field: 'pay_period_start',
          expected: 'YYYY-MM-DD',
          actual: startValue,
        })
      );
    }

    if (!endValue) {
      findings.push(
        finding('MISSING_VALUE', 'Pay period end is required.', { field: 'pay_period_end' })
      );
    } else if (!end) {
      findings.push(
        finding('INVALID_DATE', 'Pay period end is not a valid ISO date.', {
          field: 'pay_period_end',
          expected: 'YYYY-MM-DD',
          actual: endValue,
        })
      );
    }

    const periodIsOrdered = Boolean(start && end && start <= end);
    if (start && end && !periodIsOrdered) {
      findings.push(
        finding('INVALID_PERIOD', 'Pay period start must not be after the end.', {
          expected: `<= ${end}`,
          actual: start,
        })
      );
    }

    const currencyValue = get('currency');
    let currency: string | null = null;
    if (!currencyValue) {
      findings.push(finding('MISSING_VALUE', 'Currency is required.', { field: 'currency' }));
    } else if (!CURRENCY.test(currencyValue)) {
      findings.push(
        finding('INVALID_CURRENCY', 'Currency must be a three-letter uppercase code.', {
          field: 'currency',
          expected: 'AAA',
          actual: currencyValue,
        })
      );
    } else {
      currency = currencyValue;
      if (batchCurrency === null) batchCurrency = currencyValue;
      else if (batchCurrency !== currencyValue) {
        findings.push(
          finding('INCONSISTENT_CURRENCY', 'All rows in a batch must use the same currency.', {
            field: 'currency',
            expected: batchCurrency,
            actual: currencyValue,
          })
        );
      }
    }

    const moneyColumns = ['gross_pay', 'total_deductions', 'net_pay'] as const;
    const amounts: Partial<
      Record<(typeof moneyColumns)[number], { amount: string; cents: bigint }>
    > = {};

    for (const column of moneyColumns) {
      const raw = get(column);
      if (!raw) {
        findings.push(finding('MISSING_VALUE', `${column} is required.`, { field: column }));
        continue;
      }

      const parsed = parseMoney(raw);
      if (isMoneyFailure(parsed)) {
        if (parsed.reason === 'PRECISION') {
          findings.push(
            finding('UNSUPPORTED_PRECISION', 'Monetary values support at most two decimals.', {
              field: column,
              expected: '0.00',
              actual: raw,
            })
          );
        } else {
          findings.push(
            finding('INVALID_AMOUNT', 'Monetary value is not a valid decimal amount.', {
              field: column,
              expected: '0.00',
              actual: raw,
            })
          );
        }
        continue;
      }

      amounts[column] = { amount: parsed.amount, cents: parsed.cents };
      if (parsed.cents < 0n) {
        findings.push(
          finding('NEGATIVE_AMOUNT', 'Monetary values cannot be negative.', {
            field: column,
            expected: '>= 0.00',
            actual: parsed.amount,
          })
        );
      }
    }

    if (periodIsOrdered && start && end) {
      if (batchStart === null) {
        batchStart = start;
        batchEnd = end;
      } else if (batchStart !== start || batchEnd !== end) {
        findings.push(
          finding('INCONSISTENT_PAY_PERIOD', 'All rows in a batch must use the same pay period.', {
            expected: `${batchStart}..${batchEnd}`,
            actual: `${start}..${end}`,
          })
        );
      }
    }

    let employeeId: string | null = null;
    if (employeeNumber) {
      const employee = employees.get(employeeNumber);
      if (!employee) {
        findings.push(
          finding('UNKNOWN_EMPLOYEE', 'Employee number was not found in this organization.', {
            field: 'employee_number',
            actual: employeeNumber,
          })
        );
      } else {
        employeeId = employee.id;
        if (employee.status !== EmployeeStatus.ACTIVE) {
          findings.push(
            finding(
              'EMPLOYEE_INACTIVE',
              'Employee is not currently active; historical payroll may still be valid.',
              { field: 'employee_number', actual: employee.status }
            )
          );
        }
        if (start && start < employee.joinedAt) {
          findings.push(
            finding('PERIOD_BEFORE_JOIN_DATE', 'Pay period starts before the employee joined.', {
              expected: `>= ${employee.joinedAt}`,
              actual: start,
            })
          );
        }
      }
    }

    if (employeeNumber && start && end) {
      const key = `${employeeNumber}|${start}|${end}`;
      if (seenPeriods.has(key)) {
        findings.push(
          finding(
            'DUPLICATE_EMPLOYEE_PERIOD',
            'Employee appears more than once for the same pay period.',
            { actual: `${employeeNumber} ${start}..${end}` }
          )
        );
      } else {
        seenPeriods.add(key);
      }
    }

    const gross = amounts.gross_pay;
    const deductions = amounts.total_deductions;
    const net = amounts.net_pay;
    if (gross && deductions && net) {
      const expected = gross.cents - deductions.cents;
      if (expected !== net.cents) {
        findings.push(
          finding('ARITHMETIC_MISMATCH', 'gross_pay minus total_deductions does not equal net_pay.', {
            expected: formatCents(expected),
            actual: net.amount,
          })
        );
      }
    }

    records.push({
      rowNumber: row.rowNumber,
      employeeId,
      employeeNumber,
      payPeriodStart: start,
      payPeriodEnd: end,
      currency,
      grossPay: gross?.amount ?? null,
      totalDeductions: deductions?.amount ?? null,
      netPay: net?.amount ?? null,
      isValid: !findings.some((entry) => RULE_SEVERITY[entry.ruleCode] === 'ERROR'),
      findings: sortFindings(findings),
    });
  }

  const allFindings = [...batchFindings, ...records.flatMap((record) => record.findings)];
  const count = (severity: string) =>
    allFindings.filter((entry) => RULE_SEVERITY[entry.ruleCode] === severity).length;

  return {
    records,
    batchFindings: sortFindings(batchFindings),
    currency: batchCurrency,
    payPeriodStart: batchStart,
    payPeriodEnd: batchEnd,
    errorCount: count('ERROR'),
    warningCount: count('WARNING'),
    infoCount: count('INFO'),
    validRowCount: records.filter((record) => record.isValid).length,
    invalidRowCount: records.filter((record) => !record.isValid).length,
  };
}
