import type { EmployeeStatus } from '@prisma/client';

export const RULESET_VERSION = 'payroll-import-rules/v1';
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 10_000;
export const RETENTION_DAYS = 90;

export const REQUIRED_COLUMNS = [
  'employee_number',
  'pay_period_start',
  'pay_period_end',
  'currency',
  'gross_pay',
  'total_deductions',
  'net_pay',
] as const;

export type RequiredColumn = (typeof REQUIRED_COLUMNS)[number];

export type RuleCode =
  | 'EMPTY_FILE'
  | 'INVALID_HEADER'
  | 'CSV_PARSE_ERROR'
  | 'TOO_MANY_ROWS'
  | 'UNEXPECTED_COLUMN'
  | 'MISSING_VALUE'
  | 'INVALID_DATE'
  | 'INVALID_PERIOD'
  | 'INVALID_CURRENCY'
  | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_PRECISION'
  | 'UNKNOWN_EMPLOYEE'
  | 'NEGATIVE_AMOUNT'
  | 'ARITHMETIC_MISMATCH'
  | 'DUPLICATE_EMPLOYEE_PERIOD'
  | 'INCONSISTENT_CURRENCY'
  | 'INCONSISTENT_PAY_PERIOD'
  | 'EMPLOYEE_INACTIVE'
  | 'PERIOD_BEFORE_JOIN_DATE';

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export const RULE_SEVERITY: Record<RuleCode, Severity> = {
  EMPTY_FILE: 'ERROR',
  INVALID_HEADER: 'ERROR',
  CSV_PARSE_ERROR: 'ERROR',
  TOO_MANY_ROWS: 'ERROR',
  UNEXPECTED_COLUMN: 'WARNING',
  MISSING_VALUE: 'ERROR',
  INVALID_DATE: 'ERROR',
  INVALID_PERIOD: 'ERROR',
  INVALID_CURRENCY: 'ERROR',
  INVALID_AMOUNT: 'ERROR',
  UNSUPPORTED_PRECISION: 'ERROR',
  UNKNOWN_EMPLOYEE: 'ERROR',
  NEGATIVE_AMOUNT: 'ERROR',
  ARITHMETIC_MISMATCH: 'ERROR',
  DUPLICATE_EMPLOYEE_PERIOD: 'ERROR',
  INCONSISTENT_CURRENCY: 'ERROR',
  INCONSISTENT_PAY_PERIOD: 'ERROR',
  EMPLOYEE_INACTIVE: 'WARNING',
  PERIOD_BEFORE_JOIN_DATE: 'WARNING',
};

export const RULE_ORDER = Object.keys(RULE_SEVERITY) as RuleCode[];

export interface FindingDraft {
  rowNumber?: number;
  field?: string;
  ruleCode: RuleCode;
  message: string;
  expected?: string;
  actual?: string;
}

export interface EmployeeReference {
  id: string;
  employeeNumber: string;
  status: EmployeeStatus;
  joinedAt: string;
}

export interface ParsedRow {
  rowNumber: number;
  values: string[];
}

export interface ParsedRegister {
  columns: Record<RequiredColumn, number>;
  rows: ParsedRow[];
  headerFindings: FindingDraft[];
}

export interface NormalizedRecord {
  rowNumber: number;
  employeeId: string | null;
  employeeNumber: string;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  isValid: boolean;
  findings: FindingDraft[];
}

export interface ValidationResult {
  records: NormalizedRecord[];
  batchFindings: FindingDraft[];
  currency: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  validRowCount: number;
  invalidRowCount: number;
}
