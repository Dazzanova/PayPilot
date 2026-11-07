export interface ExceptionReportRow {
  rowNumber: number | null;
  employeeNumber: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  severity: string;
  ruleCode: string;
  field: string | null;
  message: string;
  expected: string | null;
  actual: string | null;
}

const HEADERS = [
  'row_number',
  'employee_number',
  'pay_period_start',
  'pay_period_end',
  'currency',
  'gross_pay',
  'total_deductions',
  'net_pay',
  'severity',
  'rule_code',
  'field',
  'message',
  'expected',
  'actual',
] as const;

/**
 * Quote a single CSV cell. Values that start with a spreadsheet formula
 * character are prefixed with a single quote so exported reports cannot be
 * used for formula injection when opened in Excel or another spreadsheet tool.
 */
export function safeCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function buildExceptionReportCsv(rows: readonly ExceptionReportRow[]): string {
  const lines = [HEADERS.map(safeCsvCell).join(',')];

  for (const row of rows) {
    lines.push(
      [
        row.rowNumber,
        row.employeeNumber,
        row.payPeriodStart,
        row.payPeriodEnd,
        row.currency,
        row.grossPay,
        row.totalDeductions,
        row.netPay,
        row.severity,
        row.ruleCode,
        row.field,
        row.message,
        row.expected,
        row.actual,
      ]
        .map(safeCsvCell)
        .join(',')
    );
  }

  return `${lines.join('\r\n')}\r\n`;
}
