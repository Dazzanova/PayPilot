import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { RequestHandler } from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EmployeeStatus,
  EmploymentType,
  PayrollImportStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { withOrganizationContext } from '../../lib/tenant';
import { errorHandler } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types/auth';
import { createPayrollImportsRouter } from './payrollImport.routes';
import { importPayrollCsv } from './payrollImport.service';
import { hashBuffer } from './storage';
import { MAX_FILE_BYTES } from './payrollImport.types';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

// Dedicated fixtures: other integration files own 1111/2222, 3333, and
// 5555/6666/7777. This suite owns 8888/9999 so parallel test processes never
// share mutable payroll data.
const orgD = '88888888-8888-4888-8888-888888888888';
const orgE = '99999999-9999-4999-8999-999999999999';
const userD = '88888888-8888-4888-8888-888888888801';
const userE = '99999999-9999-4999-8999-999999999901';

const HEADER =
  'employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions,net_pay';

const payRow = (
  employee = 'PP-3001',
  start = '2026-10-01',
  end = '2026-10-31',
  currency = 'INR',
  gross = '75000.00',
  deductions = '12500.00',
  net = '62500.00'
) => `${employee},${start},${end},${currency},${gross},${deductions},${net}`;

const fileWith = (...rows: string[]) => `${[HEADER, ...rows].join('\n')}\n`;

type JsonResponse = {
  status: number;
  body: any;
  headers: Headers;
  text: string;
};

let adminPrisma: PrismaClient;
let httpServer: http.Server;
let baseUrl: string;
let storageRoot: string;
let employeeD1: string;
let employeeD2: string;
let employeeD3: string;
let employeeE1: string;

const testUserByOrg: Record<string, string> = {
  [orgD]: userD,
  [orgE]: userE,
};

const fakeAuth: RequestHandler = (req, res, next) => {
  const organizationId = req.header('x-test-org') ?? '';
  const userId = testUserByOrg[organizationId];

  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Test auth requires a known x-test-org' },
    });
    return;
  }

  const role = (req.header('x-test-role') ?? UserRole.HR_MANAGER) as UserRole;

  (req as AuthenticatedRequest).auth = {
    user: {
      id: userId,
      identityIssuer: 'test',
      identitySubject: `subject-${userId}`,
      email: `test-${userId}@example.com`,
      role,
      isActive: true,
      organizationId,
    },
    organization: {
      id: organizationId,
      name: `Test Org ${organizationId.slice(0, 4)}`,
      slug: `test-org-${organizationId.slice(0, 4)}`,
      currency: 'USD',
      timezone: 'UTC',
    },
  };

  next();
};

async function upload(
  body: string,
  options: { org?: string; role?: UserRole; name?: string } = {}
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}/api/payroll-imports`, {
    method: 'POST',
    headers: {
      'content-type': 'text/csv',
      'x-test-org': options.org ?? orgD,
      'x-test-role': options.role ?? UserRole.HR_MANAGER,
      'x-file-name': encodeURIComponent(options.name ?? 'register.csv'),
    },
    body,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
    text,
  };
}

async function getJson(
  pathName: string,
  options: { org?: string; role?: UserRole; token?: boolean } = {}
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}/api/payroll-imports${pathName}`, {
    headers: {
      ...(options.token === false ? {} : { 'x-test-org': options.org ?? orgD }),
      'x-test-role': options.role ?? UserRole.HR_MANAGER,
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
    text,
  };
}

async function getText(
  pathName: string,
  options: { org?: string } = {}
): Promise<{ status: number; headers: Headers; text: string }> {
  const response = await fetch(`${baseUrl}/api/payroll-imports${pathName}`, {
    headers: {
      'x-test-org': options.org ?? orgD,
      'x-test-role': UserRole.HR_MANAGER,
    },
  });
  return { status: response.status, headers: response.headers, text: await response.text() };
}

function batchOf(response: JsonResponse) {
  assert.equal(response.status, 201, response.text);
  return response.body.data.batch as {
    id: string;
    status: string;
    rowCount: number;
    validRowCount: number;
    invalidRowCount: number;
    errorCount: number;
    warningCount: number;
    currency: string | null;
    payPeriodStart: string | null;
    payPeriodEnd: string | null;
  };
}

before(async () => {
  if (!dbIntegration) return;
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  storageRoot = await mkdtemp(path.join(os.tmpdir(), 'payroll-import-integration-'));
  process.env.PAYROLL_IMPORT_STORAGE_DIR = storageRoot;

  adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  for (const org of [
    { id: orgD, name: 'Payroll Import Org D', slug: 'payroll-import-org-d' },
    { id: orgE, name: 'Payroll Import Org E', slug: 'payroll-import-org-e' },
  ]) {
    await adminPrisma.organization.upsert({
      where: { id: org.id },
      update: {},
      create: { ...org, currency: 'USD', timezone: 'UTC' },
    });
  }

  for (const [id, organizationId, email] of [
    [userD, orgD, 'hr-payroll-d@example.com'],
    [userE, orgE, 'hr-payroll-e@example.com'],
  ]) {
    await adminPrisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId,
        email,
        role: UserRole.HR_MANAGER,
        identityIssuer: 'test',
        identitySubject: `subject-${id}`,
      },
    });
  }

  const tenantIds = [orgD, orgE];
  await adminPrisma.payrollImportBatch.deleteMany({
    where: { organizationId: { in: tenantIds } },
  });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });

  const createEmployee = (
    organizationId: string,
    employeeNumber: string,
    firstName: string,
    lastName: string,
    status: EmployeeStatus,
    joinedAt: string
  ) =>
    adminPrisma.employee.create({
      data: {
        organizationId,
        employeeNumber,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        jobTitle: 'Payroll Test',
        employmentType: EmploymentType.FULL_TIME,
        status,
        joinedAt: new Date(`${joinedAt}T00:00:00.000Z`),
        baseSalary: '50000.00',
      },
    });

  employeeD1 = (
    await createEmployee(orgD, 'PP-3001', 'Dana', 'Iyer', EmployeeStatus.ACTIVE, '2020-01-01')
  ).id;
  employeeD2 = (
    await createEmployee(orgD, 'PP-3002', 'Eli', 'Nakamura', EmployeeStatus.TERMINATED, '2019-01-01')
  ).id;
  employeeD3 = (
    await createEmployee(orgD, 'PP-3003', 'Farah', 'Osei', EmployeeStatus.ON_LEAVE, '2021-06-01')
  ).id;
  employeeE1 = (
    await createEmployee(orgE, 'PP-4001', 'Gina', 'Park', EmployeeStatus.ACTIVE, '2020-01-01')
  ).id;

  const app = express();
  app.use(express.json());
  app.use('/api/payroll-imports', createPayrollImportsRouter(fakeAuth));
  app.use(errorHandler);

  await new Promise<void>((resolve) => {
    httpServer = app.listen(0, () => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        baseUrl = `http://localhost:${address.port}`;
      }
      resolve();
    });
  });
});

after(async () => {
  if (!dbIntegration) return;

  if (httpServer) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  const tenantIds = [orgD, orgE];
  await adminPrisma.payrollImportBatch.deleteMany({
    where: { organizationId: { in: tenantIds } },
  });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: tenantIds } } });

  await rm(storageRoot, { recursive: true, force: true });
  delete process.env.PAYROLL_IMPORT_STORAGE_DIR;
  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

let arithmeticBatchId = '';
let mixedBatchId = '';
let failedBatchId = '';

describeDb('Payroll import pipeline', () => {
  it('imports a valid register and exposes detail, records, findings, and history', async () => {
    const response = await upload(
      fileWith(payRow('PP-3001', '2026-10-01', '2026-10-31', 'INR', '75000.00', '12500.00', '62500.00')),
      { name: 'october.csv' }
    );
    const batch = batchOf(response);

    assert.equal(batch.status, 'COMPLETED');
    assert.equal(batch.rowCount, 1);
    assert.equal(batch.validRowCount, 1);
    assert.equal(batch.invalidRowCount, 0);
    assert.equal(batch.errorCount, 0);
    assert.equal(batch.warningCount, 0);
    assert.equal(batch.currency, 'INR');
    assert.equal(batch.payPeriodStart, '2026-10-01');
    assert.equal(batch.payPeriodEnd, '2026-10-31');
    assert.equal(response.body.data.batch.originalFilename, 'october.csv');

    const detail = await getJson(`/${batch.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.batch.id, batch.id);
    assert.equal(detail.body.data.batch.createdBy.email, 'hr-payroll-d@example.com');

    const records = await getJson(`/${batch.id}/records`);
    assert.equal(records.status, 200);
    assert.equal(records.body.data.pagination.total, 1);
    const record = records.body.data.records[0];
    assert.equal(record.employeeId, employeeD1);
    assert.equal(record.employeeName, 'Dana Iyer');
    assert.equal(record.grossPay, '75000.00');
    assert.equal(record.netPay, '62500.00');
    assert.equal(record.isValid, true);

    const findings = await getJson(`/${batch.id}/findings`);
    assert.equal(findings.status, 200);
    assert.equal(findings.body.data.pagination.total, 0);
    assert.deepEqual(findings.body.data.findings, []);

    const history = await getJson('?page=1&pageSize=100');
    assert.equal(history.status, 200);
    assert.ok(history.body.data.batches.some((entry: { id: string }) => entry.id === batch.id));
  });

  it('does not expose another organization\'s batch', async () => {
    const created = batchOf(
      await upload(
        fileWith(payRow('PP-3001', '2026-10-01', '2026-10-31', 'INR', '76000.00', '13000.00', '63000.00'))
      )
    );

    for (const suffix of ['', '/records', '/findings', '/exception-report']) {
      const response = await getJson(`/${created.id}${suffix}`, { org: orgE });
      assert.equal(response.status, 404, `org E should not see ${suffix || 'batch'}`);
      assert.equal(response.body.error.code, 'PAYROLL_IMPORT_NOT_FOUND');
    }
  });

  it('records unknown employees without creating them', async () => {
    const response = await upload(
      fileWith(payRow('PP-9999', '2026-12-01', '2026-12-31', 'INR', '100.00', '0.00', '100.00'))
    );
    const batch = batchOf(response);

    assert.equal(batch.status, 'COMPLETED');
    assert.equal(batch.rowCount, 1);
    assert.equal(batch.validRowCount, 0);
    assert.equal(batch.invalidRowCount, 1);
    assert.equal(batch.errorCount, 1);

    const findings = await getJson(`/${batch.id}/findings`);
    assert.deepEqual(
      findings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['UNKNOWN_EMPLOYEE']
    );

    const employee = await adminPrisma.employee.findFirst({
      where: { organizationId: orgD, employeeNumber: 'PP-9999' },
    });
    assert.equal(employee, null);
  });

  it('accepts a historical period for an inactive employee with only a warning', async () => {
    const response = await upload(
      fileWith(payRow('PP-3002', '2026-02-01', '2026-02-28', 'INR', '50000.00', '5000.00', '45000.00'))
    );
    const batch = batchOf(response);

    assert.equal(batch.status, 'COMPLETED');
    assert.equal(batch.errorCount, 0);
    assert.equal(batch.warningCount, 1);
    assert.equal(batch.invalidRowCount, 0);
    assert.equal(batch.validRowCount, 1);

    const findings = await getJson(`/${batch.id}/findings`);
    assert.deepEqual(
      findings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['EMPLOYEE_INACTIVE']
    );
  });

  it('flags arithmetic mismatches with expected and actual values', async () => {
    const response = await upload(
      fileWith(payRow('PP-3001', '2026-04-01', '2026-04-30', 'INR', '75000.00', '12500.00', '63000.00')),
      { name: 'arithmetic.csv' }
    );
    const batch = batchOf(response);
    arithmeticBatchId = batch.id;

    assert.equal(batch.errorCount, 1);
    assert.equal(batch.invalidRowCount, 1);

    const findings = await getJson(`/${batch.id}/findings`);
    const finding = findings.body.data.findings[0];
    assert.equal(finding.ruleCode, 'ARITHMETIC_MISMATCH');
    assert.equal(finding.severity, 'ERROR');
    assert.equal(finding.expected, '62500.00');
    assert.equal(finding.actual, '63000.00');
  });

  it('flags unsupported monetary precision', async () => {
    const response = await upload(
      fileWith(payRow('PP-3001', '2026-05-01', '2026-05-31', 'INR', '1.234', '0.00', '1.23'))
    );
    const batch = batchOf(response);

    const findings = await getJson(`/${batch.id}/findings`);
    assert.ok(
      findings.body.data.findings.some(
        (entry: { ruleCode: string }) => entry.ruleCode === 'UNSUPPORTED_PRECISION'
      )
    );
  });

  it('flags mixed currencies and mixed pay periods within one batch', async () => {
    const response = await upload(
      fileWith(
        payRow('PP-3001', '2026-06-01', '2026-06-30', 'INR', '1.00', '0.00', '1.00'),
        payRow('PP-3002', '2026-06-01', '2026-06-30', 'USD', '1.00', '0.00', '1.00'),
        payRow('PP-3003', '2026-07-01', '2026-07-31', 'INR', '1.00', '0.00', '1.00')
      )
    );
    const batch = batchOf(response);
    mixedBatchId = batch.id;

    assert.equal(batch.currency, 'INR');
    assert.equal(batch.payPeriodStart, '2026-06-01');
    assert.equal(batch.payPeriodEnd, '2026-06-30');

    const findings = await getJson(`/${batch.id}/findings?pageSize=100`);
    const ruleCodes = findings.body.data.findings.map(
      (entry: { ruleCode: string }) => entry.ruleCode
    );
    assert.ok(ruleCodes.includes('INCONSISTENT_CURRENCY'));
    assert.ok(ruleCodes.includes('INCONSISTENT_PAY_PERIOD'));
  });

  it('flags duplicate employee periods after the first occurrence', async () => {
    const response = await upload(
      fileWith(
        payRow('PP-3001', '2026-07-01', '2026-07-31', 'INR', '10.00', '0.00', '10.00'),
        payRow('PP-3001', '2026-07-01', '2026-07-31', 'INR', '20.00', '0.00', '20.00')
      )
    );
    const batch = batchOf(response);

    assert.equal(batch.validRowCount, 1);
    assert.equal(batch.invalidRowCount, 1);

    const findings = await getJson(`/${batch.id}/findings`);
    assert.deepEqual(
      findings.body.data.findings.map(
        (entry: { rowNumber: number; ruleCode: string }) => [entry.rowNumber, entry.ruleCode]
      ),
      [[2, 'DUPLICATE_EMPLOYEE_PERIOD']]
    );
  });

  it('warns about unexpected columns and still completes', async () => {
    const response = await upload(`${HEADER},notes\n${payRow('PP-3001', '2026-08-01', '2026-08-31')},hello\n`);
    const batch = batchOf(response);

    assert.equal(batch.status, 'COMPLETED');
    assert.equal(batch.warningCount, 1);
    assert.equal(batch.validRowCount, 1);

    const findings = await getJson(`/${batch.id}/findings`);
    assert.deepEqual(
      findings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['UNEXPECTED_COLUMN']
    );
  });

  it('persists file-level failures as FAILED batches', async () => {
    const missingColumn = await upload(
      'employee_number,pay_period_start,pay_period_end,currency,gross_pay,total_deductions\nPP-3001,2026-01-01,2026-01-31,INR,1.00,0.00\n'
    );
    const missingBatch = batchOf(missingColumn);
    failedBatchId = missingBatch.id;
    assert.equal(missingBatch.status, 'FAILED');
    assert.equal(missingBatch.rowCount, 0);
    assert.equal(missingBatch.errorCount, 1);

    const missingFindings = await getJson(`/${missingBatch.id}/findings`);
    assert.deepEqual(
      missingFindings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['INVALID_HEADER']
    );

    const empty = await upload('');
    const emptyBatch = batchOf(empty);
    assert.equal(emptyBatch.status, 'FAILED');

    const emptyFindings = await getJson(`/${emptyBatch.id}/findings`);
    assert.deepEqual(
      emptyFindings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['EMPTY_FILE']
    );

    const tooMany = await upload(
      fileWith(
        ...Array.from({ length: 10_001 }, (_, index) =>
          payRow(`PP-${20_000 + index}`, '2026-01-01', '2026-01-31', 'INR', '1.00', '0.00', '1.00')
        )
      )
    );
    const tooManyBatch = batchOf(tooMany);
    assert.equal(tooManyBatch.status, 'FAILED');
    const tooManyFindings = await getJson(`/${tooManyBatch.id}/findings`);
    assert.deepEqual(
      tooManyFindings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['TOO_MANY_ROWS']
    );
  });

  it('rejects payloads over the configured size limit', async () => {
    const response = await upload('a'.repeat(MAX_FILE_BYTES + 1));
    assert.equal(response.status, 413);
    assert.equal(response.body.error.code, 'PAYLOAD_TOO_LARGE');
  });

  it('filters records by validity and findings by severity', async () => {
    const invalidRecords = await getJson(`/${mixedBatchId}/records?valid=false`);
    assert.equal(invalidRecords.status, 200);
    assert.ok(invalidRecords.body.data.records.length > 0);
    assert.ok(invalidRecords.body.data.records.every((entry: { isValid: boolean }) => !entry.isValid));

    const validRecords = await getJson(`/${mixedBatchId}/records?valid=true`);
    assert.ok(validRecords.body.data.records.every((entry: { isValid: boolean }) => entry.isValid));

    const warnings = await getJson(`/${mixedBatchId}/findings?severity=WARNING`);
    assert.ok(warnings.body.data.findings.length > 0);
    assert.ok(
      warnings.body.data.findings.every(
        (entry: { severity: string }) => entry.severity === 'WARNING'
      )
    );

    const errors = await getJson(`/${mixedBatchId}/findings?severity=ERROR`);
    assert.ok(errors.body.data.findings.length > 0);
    assert.ok(
      errors.body.data.findings.every((entry: { severity: string }) => entry.severity === 'ERROR')
    );
  });
});

describeDb('Duplicate detection, concurrency, rollback, and audit', () => {
  it('rejects an identical completed file even when the filename changes', async () => {
    const bytes = fileWith(
      payRow('PP-3001', '2026-09-01', '2026-09-30', 'INR', '900.00', '100.00', '800.00')
    );
    const first = await upload(bytes, { name: 'one.csv' });
    assert.equal(first.status, 201);

    const second = await upload(bytes, { name: 'two.csv' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'DUPLICATE_IMPORT');
    assert.match(second.body.error.details[0].message, new RegExp(batchOf(first).id));
  });

  it('allows retrying a failed file with the same bytes', async () => {
    const bytes = 'employee_number,currency\nPP-RETRY-1,INR\n';
    const first = await upload(bytes);
    assert.equal(first.status, 201);
    assert.equal(batchOf(first).status, 'FAILED');

    const second = await upload(bytes);
    assert.equal(second.status, 201);
    assert.equal(batchOf(second).status, 'FAILED');
  });

  it('serializes concurrent identical uploads so only one batch completes', async () => {
    const bytes = fileWith(
      payRow('PP-3001', '2027-01-01', '2027-01-31', 'INR', '1100.00', '100.00', '1000.00')
    );
    const responses = await Promise.all([
      upload(bytes, { name: 'concurrent-a.csv' }),
      upload(bytes, { name: 'concurrent-b.csv' }),
    ]);

    assert.deepEqual(
      responses.map((response) => response.status).sort(),
      [201, 409]
    );

    const completed = await adminPrisma.payrollImportBatch.count({
      where: {
        organizationId: orgD,
        fileHash: hashBuffer(Buffer.from(bytes)),
        status: PayrollImportStatus.COMPLETED,
      },
    });
    assert.equal(completed, 1);
  });

  it('rolls back batches, records, and findings when the transaction fails', async () => {
    const existing = await adminPrisma.payrollImportBatch.findMany({
      where: { organizationId: orgD },
      select: { id: true },
    });
    const existingIds = existing.map((entry) => entry.id);
    const bytes = fileWith(
      payRow('PP-3001', '2027-02-01', '2027-02-28', 'INR', '1234.56', '34.56', '1200.00')
    );

    await assert.rejects(
      withOrganizationContext(orgD, async (tx) => {
        await importPayrollCsv(tx, {
          organizationId: orgD,
          userId: userD,
          filename: 'rollback.csv',
          buffer: Buffer.from(bytes),
        });
        throw new Error('force rollback');
      }),
      /force rollback/
    );

    const batch = await adminPrisma.payrollImportBatch.findFirst({
      where: { organizationId: orgD, fileHash: hashBuffer(Buffer.from(bytes)) },
    });
    assert.equal(batch, null);

    const orphanRecords = await adminPrisma.importedPayrollRecord.count({
      where: { organizationId: orgD, batchId: { notIn: existingIds } },
    });
    const orphanFindings = await adminPrisma.validationFinding.count({
      where: { organizationId: orgD, batchId: { notIn: existingIds } },
    });
    assert.equal(orphanRecords, 0);
    assert.equal(orphanFindings, 0);
  });

  it('writes audit metadata without salaries, names, or employee numbers', async () => {
    assert.notEqual(arithmeticBatchId, '');

    const audit = await adminPrisma.auditLog.findFirst({
      where: {
        organizationId: orgD,
        action: 'payroll_import.created',
        entityId: arithmeticBatchId,
      },
    });
    assert.ok(audit);
    assert.equal(audit.entityType, 'PayrollImportBatch');
    assert.equal(audit.actorId, userD);

    const metadata = audit.metadata as Record<string, unknown>;
    assert.equal(metadata.rulesetVersion, 'payroll-import-rules/v1');
    assert.equal(metadata.status, 'COMPLETED');
    assert.equal(metadata.rowCount, 1);
    assert.equal(metadata.invalidRowCount, 1);

    const serialized = JSON.stringify(metadata);
    for (const secret of ['75000', '63000', '62500', 'PP-3001', 'Dana']) {
      assert.equal(serialized.includes(secret), false, `metadata leaked ${secret}`);
    }
  });
});

describeDb('Row-level security for payroll imports', () => {
  it('hides other tenants\' batches, records, and findings', async () => {
    const created = batchOf(
      await upload(
        fileWith(payRow('PP-3001', '2027-03-01', '2027-03-31', 'INR', '1300.00', '100.00', '1200.00'))
      )
    );

    const visible = await withOrganizationContext(orgE, async (tx) => {
      const batches = await tx.payrollImportBatch.findMany({
        where: { organizationId: orgD },
      });
      const records = await tx.importedPayrollRecord.findMany({
        where: { organizationId: orgD, batchId: created.id },
      });
      const findings = await tx.validationFinding.findMany({
        where: { organizationId: orgD, batchId: created.id },
      });
      return { batches, records, findings };
    });

    assert.deepEqual(visible.batches, []);
    assert.deepEqual(visible.records, []);
    assert.deepEqual(visible.findings, []);
  });

  it('rejects cross-tenant inserts', async () => {
    await assert.rejects(
      withOrganizationContext(orgE, (tx) =>
        tx.payrollImportBatch.create({
          data: {
            id: randomUUID(),
            organizationId: orgD,
            originalFilename: 'forged.csv',
            fileHash: 'f'.repeat(64),
            fileSizeBytes: 1,
            rulesetVersion: 'payroll-import-rules/v1',
            retentionUntil: new Date(),
          },
        })
      )
    );
  });

  it('does not let the runtime role delete batches', async () => {
    const created = batchOf(
      await upload(
        fileWith(payRow('PP-3001', '2027-04-01', '2027-04-30', 'INR', '1400.00', '100.00', '1300.00'))
      )
    );

    const result = await withOrganizationContext(orgD, (tx) =>
      tx.payrollImportBatch.deleteMany({ where: { id: created.id } })
    );
    assert.equal(result.count, 0);

    const stillThere = await adminPrisma.payrollImportBatch.findUnique({
      where: { id: created.id },
    });
    assert.ok(stillThere);
  });

  it('scopes employee resolution to the authenticated organization', async () => {
    const foreignLookup = await withOrganizationContext(orgD, (tx) =>
      tx.employee.findFirst({
        where: { organizationId: orgD, employeeNumber: 'PP-4001' },
      })
    );
    assert.equal(foreignLookup, null);

    const response = await upload(
      fileWith(payRow('PP-4001', '2027-05-01', '2027-05-31', 'INR', '1500.00', '100.00', '1400.00'))
    );
    const batch = batchOf(response);
    const findings = await getJson(`/${batch.id}/findings`);
    assert.deepEqual(
      findings.body.data.findings.map((entry: { ruleCode: string }) => entry.ruleCode),
      ['UNKNOWN_EMPLOYEE']
    );
    assert.notEqual(employeeE1, employeeD1);
  });
});

describeDb('Payroll import HTTP boundary and exports', () => {
  it('requires authentication and an HR role', async () => {
    const unauthenticated = await getJson('', { token: false });
    assert.equal(unauthenticated.status, 401);

    for (const role of [UserRole.MANAGER, UserRole.EMPLOYEE]) {
      const list = await getJson('', { role });
      assert.equal(list.status, 403);
      assert.equal(list.body.error.code, 'INSUFFICIENT_PERMISSIONS');

      const create = await upload(fileWith(payRow()), { role });
      assert.equal(create.status, 403);

      if (arithmeticBatchId) {
        const report = await getJson(`/${arithmeticBatchId}/exception-report`, { role });
        assert.equal(report.status, 403);
      }
    }
  });

  it('downloads an exception report as a non-cacheable attachment', async () => {
    assert.notEqual(arithmeticBatchId, '');
    const report = await getText(`/${arithmeticBatchId}/exception-report`);

    assert.equal(report.status, 200);
    assert.match(report.headers.get('content-type') ?? '', /^text\/csv/);
    assert.match(
      report.headers.get('content-disposition') ?? '',
      /^attachment; filename="payroll-exceptions-.+\.csv"$/
    );
    assert.equal(report.headers.get('cache-control'), 'no-store');

    const lines = report.text.split('\r\n');
    assert.match(lines[0], /^"row_number"/);
    assert.ok(lines.some((line) => line.includes('ARITHMETIC_MISMATCH')));
    assert.ok(lines.some((line) => line.includes('"62500.00"')));
    assert.ok(lines.some((line) => line.includes('"63000.00"')));
  });

  it('neutralizes spreadsheet formulas in exported cells', async () => {
    const batch = batchOf(
      await upload(
        fileWith(payRow('PP-3001', '2027-06-01', '2027-06-30', 'INR', '=SUM(A1)', '0.00', '0.00'))
      )
    );
    const report = await getText(`/${batch.id}/exception-report`);
    assert.equal(report.status, 200);
    assert.ok(report.text.includes("'=SUM(A1)"));
  });

  it('caps pagination and validates ids', async () => {
    const capped = await getJson('?pageSize=1000');
    assert.equal(capped.status, 200);
    assert.equal(capped.body.data.pagination.pageSize, 100);

    const fallback = await getJson('?pageSize=not-a-number&page=0');
    assert.equal(fallback.body.data.pagination.pageSize, 25);
    assert.equal(fallback.body.data.pagination.page, 1);

    const invalidId = await getJson('/not-a-uuid');
    assert.equal(invalidId.status, 400);
    assert.equal(invalidId.body.error.code, 'VALIDATION_ERROR');

    const missing = await getJson(`/${randomUUID()}`);
    assert.equal(missing.status, 404);
    assert.equal(missing.body.error.code, 'PAYROLL_IMPORT_NOT_FOUND');
  });

  it('filters import history by status', async () => {
    assert.notEqual(failedBatchId, '');
    const failed = await getJson('?status=FAILED&pageSize=100');
    assert.equal(failed.status, 200);
    assert.ok(failed.body.data.pagination.total > 0);
    assert.ok(
      failed.body.data.batches.every((entry: { status: string }) => entry.status === 'FAILED')
    );
    assert.ok(
      failed.body.data.batches.some((entry: { id: string }) => entry.id === failedBatchId)
    );
  });
});
