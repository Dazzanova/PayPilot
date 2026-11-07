import { Prisma } from '@prisma/client';

export type BatchWithCreator = Prisma.PayrollImportBatchGetPayload<{
  include: { createdBy: { select: { id: true; email: true } } };
}>;

export type RecordWithEmployee = Prisma.ImportedPayrollRecordGetPayload<{
  include: { employee: { select: { firstName: true; lastName: true } } };
}>;

export interface PayrollImportBatchDto {
  id: string;
  originalFilename: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED';
  rulesetVersion: string;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  errorCount: number;
  warningCount: number;
  infoCount: number;
  currency: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  fileSizeBytes: number;
  retentionUntil: string;
  filePurgedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: { id: string; email: string } | null;
}

export function toBatchDto(batch: BatchWithCreator): PayrollImportBatchDto {
  return {
    id: batch.id,
    originalFilename: batch.originalFilename,
    status: batch.status,
    rulesetVersion: batch.rulesetVersion,
    rowCount: batch.rowCount,
    validRowCount: batch.validRowCount,
    invalidRowCount: batch.invalidRowCount,
    errorCount: batch.errorCount,
    warningCount: batch.warningCount,
    infoCount: batch.infoCount,
    currency: batch.currency,
    payPeriodStart: batch.payPeriodStart?.toISOString().slice(0, 10) ?? null,
    payPeriodEnd: batch.payPeriodEnd?.toISOString().slice(0, 10) ?? null,
    fileSizeBytes: batch.fileSizeBytes,
    retentionUntil: batch.retentionUntil.toISOString(),
    filePurgedAt: batch.filePurgedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
    completedAt: batch.completedAt?.toISOString() ?? null,
    createdBy: batch.createdBy,
  };
}

export interface ImportedRecordDto {
  id: string;
  rowNumber: number;
  employeeId: string | null;
  employeeNumber: string;
  employeeName: string | null;
  payPeriodStart: string | null;
  payPeriodEnd: string | null;
  currency: string | null;
  grossPay: string | null;
  totalDeductions: string | null;
  netPay: string | null;
  isValid: boolean;
}

export function toRecordDto(record: RecordWithEmployee): ImportedRecordDto {
  return {
    id: record.id,
    rowNumber: record.rowNumber,
    employeeId: record.employeeId,
    employeeNumber: record.employeeNumber,
    employeeName: record.employee
      ? `${record.employee.firstName} ${record.employee.lastName}`
      : null,
    payPeriodStart: record.payPeriodStart?.toISOString().slice(0, 10) ?? null,
    payPeriodEnd: record.payPeriodEnd?.toISOString().slice(0, 10) ?? null,
    currency: record.currency,
    grossPay: record.grossPay?.toFixed(2) ?? null,
    totalDeductions: record.totalDeductions?.toFixed(2) ?? null,
    netPay: record.netPay?.toFixed(2) ?? null,
    isValid: record.isValid,
  };
}

export interface FindingDto {
  id: string;
  rowNumber: number | null;
  field: string | null;
  ruleCode: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  expected: string | null;
  actual: string | null;
}

export function toFindingDto(finding: Prisma.ValidationFindingGetPayload<object>): FindingDto {
  return {
    id: finding.id,
    rowNumber: finding.rowNumber,
    field: finding.field,
    ruleCode: finding.ruleCode,
    severity: finding.severity,
    message: finding.message,
    expected: finding.expected,
    actual: finding.actual,
  };
}
