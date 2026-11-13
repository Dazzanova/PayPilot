import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { RequestHandler } from 'express';
import {
  AttendanceStatus,
  EmployeeStatus,
  EmploymentType,
  LeaveStatus,
  LeaveType,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { errorHandler } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types/auth';
import {
  createDeductionRulesRouter,
  createPayrollRunsRouter,
  createPayslipsRouter,
} from './payroll.routes';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

// Dedicated fixtures. Other integration suites own 1111/2222, 3333,
// 5555/6666/7777, and 8888/9999.
const orgA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orgB = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const userHrA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
const userMgrA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc02';
const userEmpA = 'cccccccc-cccc-4ccc-8ccc-cccccccccc03';
const userHrB = 'dddddddd-dddd-4ddd-8ddd-dddddddddd01';

const USER_BY_ROLE: Record<string, Record<string, string>> = {
  [orgA]: {
    [UserRole.HR_MANAGER]: userHrA,
    [UserRole.MANAGER]: userMgrA,
    [UserRole.EMPLOYEE]: userEmpA,
  },
  [orgB]: {
    [UserRole.HR_MANAGER]: userHrB,
  },
};

const fakeAuth: RequestHandler = (req, res, next) => {
  const organizationId = req.header('x-test-org') ?? '';
  const role = (req.header('x-test-role') ?? UserRole.HR_MANAGER) as UserRole;
  const userId = req.header('x-test-user') ?? USER_BY_ROLE[organizationId]?.[role];

  if (!userId) {
    res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Test auth requires a known x-test-org and role' },
    });
    return;
  }

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
      name: `Payroll Test ${organizationId.slice(0, 4)}`,
      slug: `payroll-test-${organizationId.slice(0, 4)}`,
      currency: 'USD',
      timezone: 'UTC',
    },
  };

  next();
};

type JsonResponse = {
  status: number;
  body: any;
  headers: Headers;
  text: string;
};

let adminPrisma: PrismaClient;
let httpServer: http.Server;
let baseUrl: string;

let empFull: string;
let empAbsent: string;
let empLeave: string;
let empTerminated: string;
let empSelf: string;
let empB: string;

async function request(
  method: string,
  path: string,
  options: { org?: string; role?: UserRole; user?: string; body?: unknown } = {}
): Promise<JsonResponse> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-test-org': options.org ?? orgA,
      'x-test-role': options.role ?? UserRole.HR_MANAGER,
      ...(options.user ? { 'x-test-user': options.user } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const contentType = response.headers.get('content-type') ?? '';
  return {
    status: response.status,
    body: text && contentType.includes('application/json') ? JSON.parse(text) : null,
    headers: response.headers,
    text,
  };
}

before(async () => {
  if (!dbIntegration) return;
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  for (const org of [
    { id: orgA, name: 'Payroll Calc Org A', slug: 'payroll-calc-org-a' },
    { id: orgB, name: 'Payroll Calc Org B', slug: 'payroll-calc-org-b' },
  ]) {
    await adminPrisma.organization.upsert({
      where: { id: org.id },
      update: {},
      create: { ...org, currency: 'USD', timezone: 'UTC' },
    });
  }

  for (const [id, organizationId, role] of [
    [userHrA, orgA, UserRole.HR_MANAGER],
    [userMgrA, orgA, UserRole.MANAGER],
    [userEmpA, orgA, UserRole.EMPLOYEE],
    [userHrB, orgB, UserRole.HR_MANAGER],
  ] as const) {
    await adminPrisma.user.upsert({
      where: { id },
      update: {},
      create: {
        id,
        organizationId,
        email: `payroll-${id.slice(-4)}@example.com`,
        role,
        identityIssuer: 'test',
        identitySubject: `subject-${id}`,
      },
    });
  }

  const tenantIds = [orgA, orgB];
  await adminPrisma.payslipLineItem.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollRun.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollDeductionRule.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.attendanceRecord.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.leaveRequest.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });

  const createEmployee = (
    organizationId: string,
    employeeNumber: string,
    firstName: string,
    baseSalary: string,
    status: EmployeeStatus,
    userId?: string
  ) =>
    adminPrisma.employee.create({
      data: {
        organizationId,
        employeeNumber,
        firstName,
        lastName: 'Tester',
        email: `${employeeNumber.toLowerCase()}@example.com`,
        jobTitle: 'Payroll Test',
        employmentType: EmploymentType.FULL_TIME,
        status,
        joinedAt: new Date('2020-01-01T00:00:00.000Z'),
        baseSalary,
        ...(userId ? { userId } : {}),
      },
    });

  empFull = (await createEmployee(orgA, 'PC-1001', 'Full', '5000.00', EmployeeStatus.ACTIVE)).id;
  empAbsent = (await createEmployee(orgA, 'PC-1002', 'Absent', '3000.00', EmployeeStatus.ACTIVE)).id;
  empLeave = (await createEmployee(orgA, 'PC-1003', 'Leave', '4000.00', EmployeeStatus.ON_LEAVE)).id;
  empTerminated = (await createEmployee(orgA, 'PC-1004', 'Gone', '9000.00', EmployeeStatus.TERMINATED)).id;
  empSelf = (await createEmployee(orgA, 'PC-1005', 'Self', '2000.00', EmployeeStatus.ACTIVE, userEmpA)).id;
  empB = (await createEmployee(orgB, 'PC-2001', 'Other', '7000.00', EmployeeStatus.ACTIVE)).id;

  await adminPrisma.attendanceRecord.create({
    data: {
      organizationId: orgA,
      employeeId: empAbsent,
      workDate: new Date('2026-10-05T00:00:00.000Z'),
      status: AttendanceStatus.ABSENT,
    },
  });

  await adminPrisma.leaveRequest.create({
    data: {
      organizationId: orgA,
      employeeId: empLeave,
      leaveType: LeaveType.UNPAID,
      startDate: new Date('2026-10-05T00:00:00.000Z'),
      endDate: new Date('2026-10-09T00:00:00.000Z'),
      totalDays: '5.0',
      reason: 'Unpaid leave for integration test',
      status: LeaveStatus.APPROVED,
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/payroll-runs', createPayrollRunsRouter(fakeAuth));
  app.use('/api/payslips', createPayslipsRouter(fakeAuth));
  app.use('/api/payroll-deduction-rules', createDeductionRulesRouter(fakeAuth));
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

  const tenantIds = [orgA, orgB];
  await adminPrisma.payslipLineItem.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollRun.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.payrollDeductionRule.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.attendanceRecord.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.leaveRequest.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: tenantIds } } });

  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

describeDb('payroll deduction rules', () => {
  it('seeds the default rules once on first read', async () => {
    const first = await request('GET', '/api/payroll-deduction-rules');
    assert.equal(first.status, 200, first.text);
    assert.equal(first.body.data.rules.length, 3);
    assert.deepEqual(
      first.body.data.rules.map((rule: any) => rule.name).sort(),
      ['Health insurance', 'Income tax', 'Pension']
    );

    const second = await request('GET', '/api/payroll-deduction-rules');
    assert.equal(second.body.data.rules.length, 3);
  });

  it('creates, updates, and deletes a rule', async () => {
    const created = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Union dues', type: 'FIXED', value: 25, taxable: false, active: true },
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.data.rule.value, '25.00');
    assert.equal(created.body.data.rule.taxable, false);
    const id = created.body.data.rule.id;

    const updated = await request('PATCH', `/api/payroll-deduction-rules/${id}`, {
      body: { active: false, value: 30 },
    });
    assert.equal(updated.status, 200, updated.text);
    assert.equal(updated.body.data.rule.active, false);
    assert.equal(updated.body.data.rule.value, '30.00');

    const deleted = await request('DELETE', `/api/payroll-deduction-rules/${id}`);
    assert.equal(deleted.status, 200, deleted.text);

    const list = await request('GET', '/api/payroll-deduction-rules');
    assert.equal(list.body.data.rules.some((rule: any) => rule.id === id), false);
  });

  it('rejects a duplicate rule name', async () => {
    const duplicate = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Income tax', type: 'RATE', value: 11 },
    });
    assert.equal(duplicate.status, 409, duplicate.text);
    assert.equal(duplicate.body.error.code, 'DEDUCTION_RULE_EXISTS');
  });

  it('rejects a rate above 100', async () => {
    const response = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Too high', type: 'RATE', value: 150 },
    });
    assert.equal(response.status, 400, response.text);
  });

  it('rejects an update that pushes an existing rate above 100', async () => {
    const created = await request('POST', '/api/payroll-deduction-rules', {
      body: { name: 'Rate guard', type: 'RATE', value: 10 },
    });
    assert.equal(created.status, 201, created.text);
    const id = created.body.data.rule.id;

    const updated = await request('PATCH', `/api/payroll-deduction-rules/${id}`, {
      body: { value: 150 },
    });
    assert.equal(updated.status, 400, updated.text);
    assert.equal(updated.body.error.code, 'VALIDATION_ERROR');

    const list = await request('GET', '/api/payroll-deduction-rules');
    const stored = list.body.data.rules.find((rule: any) => rule.id === id);
    assert.equal(stored.value, '10.00');

    const deleted = await request('DELETE', `/api/payroll-deduction-rules/${id}`);
    assert.equal(deleted.status, 200, deleted.text);
  });

  it('forbids employees and managers from managing rules', async () => {
    for (const role of [UserRole.EMPLOYEE, UserRole.MANAGER]) {
      const response = await request('GET', '/api/payroll-deduction-rules', { role });
      assert.equal(response.status, 403, `${role}: ${response.text}`);
    }
  });

  it('scopes rules to the tenant', async () => {
    const orgBRules = await request('GET', '/api/payroll-deduction-rules', { org: orgB });
    assert.equal(orgBRules.status, 200, orgBRules.text);
    assert.equal(orgBRules.body.data.rules.length, 3);
    assert.equal(
      orgBRules.body.data.rules.some((rule: any) => rule.name === 'Union dues'),
      false
    );
  });
});

let octoberRunId = '';

describeDb('payroll runs', () => {
  it('creates a draft run', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-10-01', periodEnd: '2026-10-31', payDate: '2026-10-31' },
    });
    assert.equal(response.status, 201, response.text);
    const run = response.body.data.run;
    assert.equal(run.status, 'DRAFT');
    assert.equal(run.totalGross, '0.00');
    assert.equal(run.payslipCount, 0);
    assert.deepEqual(run.payslips, []);
    octoberRunId = run.id;
  });

  it('rejects a duplicate period', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-10-01', periodEnd: '2026-10-31', payDate: '2026-10-31' },
    });
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.error.code, 'PAYROLL_RUN_EXISTS');
  });

  it('rejects an invalid period', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-10-31', periodEnd: '2026-10-01', payDate: '2026-10-31' },
    });
    assert.equal(response.status, 400, response.text);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('lists runs for managers and HR', async () => {
    for (const role of [UserRole.HR_MANAGER, UserRole.MANAGER]) {
      const response = await request('GET', '/api/payroll-runs', { role });
      assert.equal(response.status, 200, `${role}: ${response.text}`);
      assert.equal(response.body.data.runs.some((run: any) => run.id === octoberRunId), true);
    }
  });

  it('returns run detail with an empty payslip list before calculation', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.id, octoberRunId);
    assert.deepEqual(response.body.data.run.payslips, []);
  });

  it('forbids employees from reading runs', async () => {
    const list = await request('GET', '/api/payroll-runs', { role: UserRole.EMPLOYEE });
    assert.equal(list.status, 403, list.text);
    const detail = await request('GET', `/api/payroll-runs/${octoberRunId}`, {
      role: UserRole.EMPLOYEE,
    });
    assert.equal(detail.status, 403, detail.text);
  });

  it('hides runs from another tenant', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`, { org: orgB });
    assert.equal(response.status, 404, response.text);
  });
});


describeDb('payroll calculation', () => {
  it('calculates payslips for active employees', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`);
    assert.equal(response.status, 200, response.text);
    const run = response.body.data.run;
    assert.equal(run.status, 'CALCULATED');
    assert.equal(run.payslipCount, 4);
    assert.equal(run.totalGross, '12954.55');
    assert.equal(run.totalDeductions, '2143.18');
    assert.equal(run.totalNet, '10811.37');
    assert.equal(
      run.payslips.some((payslip: any) => payslip.employeeId === empTerminated),
      false
    );
  });

  it('prorates attendance and approved unpaid leave', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const payslips = response.body.data.run.payslips;
    const byEmployee = new Map(payslips.map((payslip: any) => [payslip.employeeId, payslip]));

    assert.equal((byEmployee.get(empFull) as any).grossPay, '5000.00');
    assert.equal((byEmployee.get(empAbsent) as any).grossPay, '2863.64');
    assert.equal((byEmployee.get(empAbsent) as any).absentDays, '1.0');
    assert.equal((byEmployee.get(empLeave) as any).grossPay, '3090.91');
    assert.equal((byEmployee.get(empLeave) as any).unpaidDays, '5.0');
    assert.equal((byEmployee.get(empSelf) as any).grossPay, '2000.00');
  });

  it('writes earning and deduction line items', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const payslip = response.body.data.run.payslips.find(
      (row: any) => row.employeeId === empFull
    );
    assert.equal(payslip.lines.length, 4);
    assert.equal(payslip.lines[0].kind, 'EARNING');
    assert.equal(payslip.lines[0].label, 'Base salary (prorated)');
    assert.deepEqual(
      payslip.lines.slice(1).map((line: any) => line.kind),
      ['DEDUCTION', 'DEDUCTION', 'DEDUCTION']
    );
  });

  it('replaces payslips when recalculating', async () => {
    const before = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const beforeIds = before.body.data.run.payslips.map((payslip: any) => payslip.id).sort();

    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`);
    assert.equal(response.status, 200, response.text);
    const afterIds = response.body.data.run.payslips
      .map((payslip: any) => payslip.id)
      .sort();

    assert.equal(afterIds.length, beforeIds.length);
    assert.notDeepEqual(afterIds, beforeIds);
  });

  it('forbids employees and managers from calculating', async () => {
    for (const role of [UserRole.EMPLOYEE, UserRole.MANAGER]) {
      const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`, {
        role,
      });
      assert.equal(response.status, 403, `${role}: ${response.text}`);
    }
  });

  it('returns 404 for a run in another tenant', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`, {
      org: orgB,
    });
    assert.equal(response.status, 404, response.text);
  });
});

let novemberRunId = '';

describeDb('payroll lifecycle', () => {
  it('creates a second draft run for transition checks', async () => {
    const response = await request('POST', '/api/payroll-runs', {
      body: { periodStart: '2026-11-01', periodEnd: '2026-11-30', payDate: '2026-11-30' },
    });
    assert.equal(response.status, 201, response.text);
    novemberRunId = response.body.data.run.id;
  });

  it('rejects approving a draft run', async () => {
    const response = await request('POST', `/api/payroll-runs/${novemberRunId}/approve`);
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.error.code, 'INVALID_PAYROLL_TRANSITION');
  });

  it('approves a calculated run and issues payslips', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/approve`);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.status, 'APPROVED');
    assert.equal(
      response.body.data.run.payslips.every((payslip: any) => payslip.status === 'ISSUED'),
      true
    );
  });

  it('freezes an approved run', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/calculate`);
    assert.equal(response.status, 409, response.text);
    assert.equal(response.body.error.code, 'INVALID_PAYROLL_TRANSITION');
  });

  it('rejects paying a run that is not approved', async () => {
    const response = await request('POST', `/api/payroll-runs/${novemberRunId}/pay`);
    assert.equal(response.status, 409, response.text);
  });

  it('marks an approved run paid', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/pay`);
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.status, 'PAID');
    assert.equal(
      response.body.data.run.payslips.every((payslip: any) => payslip.status === 'PAID'),
      true
    );
  });

  it('requires a reason to void', async () => {
    const missing = await request('POST', `/api/payroll-runs/${octoberRunId}/void`, {
      body: {},
    });
    assert.equal(missing.status, 400, missing.text);
  });

  it('voids a paid run with a reason', async () => {
    const response = await request('POST', `/api/payroll-runs/${octoberRunId}/void`, {
      body: { reason: 'Duplicate cycle' },
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.run.status, 'VOID');
    assert.equal(response.body.data.run.voidReason, 'Duplicate cycle');
  });

  it('rejects voiding a draft run', async () => {
    const response = await request('POST', `/api/payroll-runs/${novemberRunId}/void`, {
      body: { reason: 'Not needed' },
    });
    assert.equal(response.status, 409, response.text);
  });

  it('forbids employees and managers from transitioning', async () => {
    for (const role of [UserRole.EMPLOYEE, UserRole.MANAGER]) {
      for (const action of ['approve', 'pay', 'void']) {
        const response = await request(
          'POST',
          `/api/payroll-runs/${novemberRunId}/${action}`,
          { role, body: { reason: 'test' } }
        );
        assert.equal(response.status, 403, `${role}/${action}: ${response.text}`);
      }
    }
  });

  it('writes an audit entry for each transition', async () => {
    const actions = await adminPrisma.auditLog.findMany({
      where: {
        organizationId: orgA,
        action: { in: ['payroll.run_created', 'payroll.run_calculated', 'payroll.run_approved', 'payroll.run_paid', 'payroll.run_voided'] },
      },
      select: { action: true },
    });
    const unique = new Set(actions.map((row) => row.action));
    for (const action of ['payroll.run_created', 'payroll.run_calculated', 'payroll.run_approved', 'payroll.run_paid', 'payroll.run_voided']) {
      assert.equal(unique.has(action), true, `missing ${action}`);
    }
  });
});

describeDb('payslip access and CSV export', () => {
  it("returns only the caller's payslips from /payslips/me", async () => {
    const response = await request('GET', '/api/payslips/me', {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.payslips.length, 1);
    assert.equal(response.body.data.payslips[0].employeeId, empSelf);
    assert.equal(response.body.data.payslips[0].lines.length, 4);
  });

  it('returns an empty list when no employee profile is linked', async () => {
    const response = await request('GET', '/api/payslips/me', {
      role: UserRole.MANAGER,
      user: userMgrA,
    });
    assert.equal(response.status, 200, response.text);
    assert.deepEqual(response.body.data.payslips, []);
  });

  it('lets an employee read their own payslip', async () => {
    const mine = await request('GET', '/api/payslips/me', {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    const id = mine.body.data.payslips[0].id;

    const response = await request('GET', `/api/payslips/${id}`, {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    assert.equal(response.status, 200, response.text);
    assert.equal(response.body.data.payslip.id, id);
  });

  it("hides a colleague's payslip from an employee", async () => {
    const run = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const colleague = run.body.data.run.payslips.find(
      (payslip: any) => payslip.employeeId === empFull
    );

    const response = await request('GET', `/api/payslips/${colleague.id}`, {
      role: UserRole.EMPLOYEE,
      user: userEmpA,
    });
    assert.equal(response.status, 404, response.text);
  });

  it('lets a manager read any payslip in the tenant', async () => {
    const run = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const anyPayslip = run.body.data.run.payslips[0];

    const response = await request('GET', `/api/payslips/${anyPayslip.id}`, {
      role: UserRole.MANAGER,
    });
    assert.equal(response.status, 200, response.text);
  });

  it('exports the run as CSV', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}/export`);
    assert.equal(response.status, 200, response.text);
    assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /payroll-2026-10-01-2026-10-31\.csv/
    );

    const lines = response.text.trim().split('\r\n');
    assert.equal(lines.length, 5);
    assert.ok(lines[0].startsWith('"employee_number","employee_name"'));
    assert.ok(response.text.includes('"PC-1001"'));
  });

  it('forbids employees from exporting a run', async () => {
    const response = await request('GET', `/api/payroll-runs/${octoberRunId}/export`, {
      role: UserRole.EMPLOYEE,
    });
    assert.equal(response.status, 403, response.text);
  });

  it('returns 404 for a payslip in another tenant', async () => {
    const run = await request('GET', `/api/payroll-runs/${octoberRunId}`);
    const anyPayslip = run.body.data.run.payslips[0];

    const response = await request('GET', `/api/payslips/${anyPayslip.id}`, { org: orgB });
    assert.equal(response.status, 404, response.text);
  });

  it('denies direct runtime access to deduction rules without tenant context', async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM payroll_deduction_rules
    `;
    assert.equal(rows[0].count, 0n);
  });
});
