import { PayrollImportStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { HttpError } from '../../lib/httpError';
import {
  parsePayrollRegister,
  validateParsedRegister,
  type RegisterParseResult,
} from './validation';
import {
  buildStorageKey,
  deleteImportFileQuietly,
  hashBuffer,
  sanitizeFilename,
  saveImportFile,
} from './storage';
import {
  RETENTION_DAYS,
  RULESET_VERSION,
  RULE_SEVERITY,
  type EmployeeReference,
  type FindingDraft,
  type NormalizedRecord,
} from './payrollImport.types';
import {
  toBatchDto,
  toFindingDto,
  toRecordDto,
  type BatchWithCreator,
  type RecordWithEmployee,
} from './payrollImport.dto';
import type {
  FindingListQuery,
  ImportedRecordListQuery,
  PayrollImportListQuery,
} from './payrollImport.schema';
import type { ExceptionReportRow } from './export';

type Tx = Prisma.TransactionClient;
type PendingRecord = NormalizedRecord & { id: string };
type RegisterSuccess = Extract<RegisterParseResult, { ok: true }>;

function isRegisterSuccess(result: RegisterParseResult): result is RegisterSuccess {
  return result.ok === true;
}

const CREATOR_INCLUDE = {
  createdBy: { select: { id: true, email: true } },
} as const;

const EMPLOYEE_INCLUDE = {
  employee: { select: { firstName: true, lastName: true } },
} as const;

function pagination(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

async function acquireImportLock(
  tx: Tx,
  organizationId: string,
  fileHash: string
): Promise<void> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${organizationId}::text),
      hashtext(${`payroll_import:${fileHash}`}::text)
    )
  `;
}

async function requireBatch(tx: Tx, organizationId: string, batchId: string) {
  const batch = await tx.payrollImportBatch.findFirst({
    where: { id: batchId, organizationId },
    select: { id: true },
  });
  if (!batch) {
    throw new HttpError(404, 'PAYROLL_IMPORT_NOT_FOUND', 'Payroll import not found');
  }
}

async function lookupEmployees(
  tx: Tx,
  organizationId: string,
  numbers: string[]
): Promise<Map<string, EmployeeReference>> {
  if (numbers.length === 0) return new Map();

  const employees = await tx.employee.findMany({
    where: { organizationId, employeeNumber: { in: numbers } },
    select: { id: true, employeeNumber: true, status: true, joinedAt: true },
  });

  return new Map(
    employees.map((employee) => [
      employee.employeeNumber,
      {
        ...employee,
        joinedAt: employee.joinedAt.toISOString().slice(0, 10),
      },
    ])
  );
}

export async function importPayrollCsv(
  tx: Tx,
  input: {
    organizationId: string;
    userId: string;
    filename: string | undefined;
    buffer: Buffer;
  }
) {
  const fileHash = hashBuffer(input.buffer);
  const filename = sanitizeFilename(input.filename);
  const batchId = randomUUID();
  const storageKey = buildStorageKey(input.organizationId, batchId);

  await acquireImportLock(tx, input.organizationId, fileHash);

  const duplicate = await tx.payrollImportBatch.findFirst({
    where: {
      organizationId: input.organizationId,
      fileHash,
      status: PayrollImportStatus.COMPLETED,
    },
    select: { id: true },
  });
  if (duplicate) {
    throw new HttpError(
      409,
      'DUPLICATE_IMPORT',
      'This payroll file has already been imported.',
      [{ path: 'file', message: `Existing batch: ${duplicate.id}` }]
    );
  }

  await saveImportFile({
    organizationId: input.organizationId,
    batchId,
    buffer: input.buffer,
  });

  try {
    const parsed = parsePayrollRegister(input.buffer.toString('utf8'));
    let batchFindings: FindingDraft[] = [];
    let records: PendingRecord[] = [];
    let currency: string | null = null;
    let payPeriodStart: string | null = null;
    let payPeriodEnd: string | null = null;
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    let validRowCount = 0;
    let invalidRowCount = 0;
    let status: PayrollImportStatus = PayrollImportStatus.COMPLETED;

    if (!isRegisterSuccess(parsed)) {
      batchFindings = parsed.findings;
      status = PayrollImportStatus.FAILED;
      errorCount = parsed.findings.filter(
        (entry) => RULE_SEVERITY[entry.ruleCode] === 'ERROR'
      ).length;
      warningCount = parsed.findings.filter(
        (entry) => RULE_SEVERITY[entry.ruleCode] === 'WARNING'
      ).length;
      infoCount = parsed.findings.filter(
        (entry) => RULE_SEVERITY[entry.ruleCode] === 'INFO'
      ).length;
    } else {
      const employeeNumbers = [
        ...new Set(
          parsed.register.rows
            .map((row) =>
              (row.values[parsed.register.columns.employee_number] ?? '')
                .trim()
                .toUpperCase()
            )
            .filter(Boolean)
        ),
      ];

      const employees = await lookupEmployees(tx, input.organizationId, employeeNumbers);
      const result = validateParsedRegister(parsed.register, employees);

      batchFindings = result.batchFindings;
      currency = result.currency;
      payPeriodStart = result.payPeriodStart;
      payPeriodEnd = result.payPeriodEnd;
      errorCount = result.errorCount;
      warningCount = result.warningCount;
      infoCount = result.infoCount;
      validRowCount = result.validRowCount;
      invalidRowCount = result.invalidRowCount;
      records = result.records.map((record) => ({ ...record, id: randomUUID() }));
    }

    await tx.payrollImportBatch.create({
      data: {
        id: batchId,
        organizationId: input.organizationId,
        createdById: input.userId,
        originalFilename: filename,
        storageKey,
        fileHash,
        fileSizeBytes: input.buffer.length,
        rulesetVersion: RULESET_VERSION,
        status,
        rowCount: records.length,
        validRowCount,
        invalidRowCount,
        errorCount,
        warningCount,
        infoCount,
        currency,
        payPeriodStart: payPeriodStart
          ? new Date(`${payPeriodStart}T00:00:00.000Z`)
          : null,
        payPeriodEnd: payPeriodEnd ? new Date(`${payPeriodEnd}T00:00:00.000Z`) : null,
        retentionUntil: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
        completedAt: new Date(),
      },
    });

    for (let index = 0; index < records.length; index += 500) {
      await tx.importedPayrollRecord.createMany({
        data: records.slice(index, index + 500).map((record) => ({
          id: record.id,
          organizationId: input.organizationId,
          batchId,
          employeeId: record.employeeId,
          employeeNumber: record.employeeNumber,
          rowNumber: record.rowNumber,
          payPeriodStart: record.payPeriodStart
            ? new Date(`${record.payPeriodStart}T00:00:00.000Z`)
            : null,
          payPeriodEnd: record.payPeriodEnd
            ? new Date(`${record.payPeriodEnd}T00:00:00.000Z`)
            : null,
          currency: record.currency,
          grossPay: record.grossPay,
          totalDeductions: record.totalDeductions,
          netPay: record.netPay,
          isValid: record.isValid,
        })),
      });
    }

    const findingRows = [
      ...batchFindings.map((entry) => ({ ...entry, recordId: null as string | null })),
      ...records.flatMap((record) =>
        record.findings.map((entry) => ({ ...entry, recordId: record.id as string | null }))
      ),
    ];

    for (let index = 0; index < findingRows.length; index += 1000) {
      await tx.validationFinding.createMany({
        data: findingRows.slice(index, index + 1000).map((entry) => ({
          organizationId: input.organizationId,
          batchId,
          recordId: entry.recordId,
          rowNumber: entry.rowNumber ?? null,
          field: entry.field ?? null,
          ruleCode: entry.ruleCode,
          severity: RULE_SEVERITY[entry.ruleCode],
          message: entry.message,
          expected: entry.expected ?? null,
          actual: entry.actual ?? null,
        })),
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        actorId: input.userId,
        action: 'payroll_import.created',
        entityType: 'PayrollImportBatch',
        entityId: batchId,
        metadata: {
          status,
          rowCount: records.length,
          validRowCount,
          invalidRowCount,
          errorCount,
          warningCount,
          rulesetVersion: RULESET_VERSION,
        },
      },
    });

    const batch = await tx.payrollImportBatch.findUniqueOrThrow({
      where: { id: batchId },
      include: CREATOR_INCLUDE,
    });

    return toBatchDto(batch as BatchWithCreator);
  } catch (error) {
    await deleteImportFileQuietly(storageKey);
    throw error;
  }
}

export async function listPayrollImports(
  tx: Tx,
  organizationId: string,
  query: PayrollImportListQuery
) {
  const where: Prisma.PayrollImportBatchWhereInput = { organizationId };
  if (query.status) where.status = query.status;

  const [total, batches] = await Promise.all([
    tx.payrollImportBatch.count({ where }),
    tx.payrollImportBatch.findMany({
      where,
      include: CREATOR_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    batches: batches.map((batch) => toBatchDto(batch as BatchWithCreator)),
    pagination: pagination(query.page, query.pageSize, total),
  };
}

export async function getPayrollImport(tx: Tx, organizationId: string, batchId: string) {
  const batch = await tx.payrollImportBatch.findFirst({
    where: { id: batchId, organizationId },
    include: CREATOR_INCLUDE,
  });
  if (!batch) {
    throw new HttpError(404, 'PAYROLL_IMPORT_NOT_FOUND', 'Payroll import not found');
  }
  return toBatchDto(batch as BatchWithCreator);
}

export async function listImportedRecords(
  tx: Tx,
  organizationId: string,
  batchId: string,
  query: ImportedRecordListQuery
) {
  await requireBatch(tx, organizationId, batchId);

  const where: Prisma.ImportedPayrollRecordWhereInput = { organizationId, batchId };
  if (query.valid !== undefined) where.isValid = query.valid;

  const [total, records] = await Promise.all([
    tx.importedPayrollRecord.count({ where }),
    tx.importedPayrollRecord.findMany({
      where,
      include: EMPLOYEE_INCLUDE,
      orderBy: { rowNumber: 'asc' },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    records: records.map((record) => toRecordDto(record as RecordWithEmployee)),
    pagination: pagination(query.page, query.pageSize, total),
  };
}

export async function listFindings(
  tx: Tx,
  organizationId: string,
  batchId: string,
  query: FindingListQuery
) {
  await requireBatch(tx, organizationId, batchId);

  const where: Prisma.ValidationFindingWhereInput = { organizationId, batchId };
  if (query.severity) where.severity = query.severity;
  if (query.ruleCode) where.ruleCode = query.ruleCode;

  const [total, findings] = await Promise.all([
    tx.validationFinding.count({ where }),
    tx.validationFinding.findMany({
      where,
      orderBy: [{ rowNumber: 'asc' }, { ruleCode: 'asc' }, { field: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    findings: findings.map((finding) => toFindingDto(finding)),
    pagination: pagination(query.page, query.pageSize, total),
  };
}

export async function buildExceptionReportRows(
  tx: Tx,
  organizationId: string,
  batchId: string
): Promise<ExceptionReportRow[]> {
  await requireBatch(tx, organizationId, batchId);

  const findings = await tx.validationFinding.findMany({
    where: { organizationId, batchId },
    include: { record: true },
    orderBy: [{ rowNumber: 'asc' }, { ruleCode: 'asc' }, { field: 'asc' }],
  });

  return findings.map((finding) => ({
    rowNumber: finding.rowNumber,
    employeeNumber: finding.record?.employeeNumber ?? null,
    payPeriodStart: finding.record?.payPeriodStart?.toISOString().slice(0, 10) ?? null,
    payPeriodEnd: finding.record?.payPeriodEnd?.toISOString().slice(0, 10) ?? null,
    currency: finding.record?.currency ?? null,
    grossPay: finding.record?.grossPay?.toFixed(2) ?? null,
    totalDeductions: finding.record?.totalDeductions?.toFixed(2) ?? null,
    netPay: finding.record?.netPay?.toFixed(2) ?? null,
    severity: finding.severity,
    ruleCode: finding.ruleCode,
    field: finding.field,
    message: finding.message,
    expected: finding.expected,
    actual: finding.actual,
  }));
}
