import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { RequestHandler } from 'express';
import {
  AttendanceStatus,
  EmployeeStatus,
  EmploymentType,
  LeaveStatus,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { errorHandler } from '../../middleware/errorHandler';
import { AuthenticatedRequest } from '../../types/auth';
import { createAttendanceRouter } from './attendance.routes';
import { createLeaveRouter } from '../leave/leave.routes';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

// Dedicated fixtures. Other suites own 1111/2222, 3333, 5555/6666/7777 and
// 8888/9999, so this suite owns aaaa/bbbb and never shares mutable rows.
const orgA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const orgB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const userHrA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01';
const userManagerA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02';
const userEmployeeA1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03';
const userEmployeeA2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa04';
const userHrB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01';
const userEmployeeB1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb02';

type JsonResponse = {
  status: number;
  body: any;
  text: string;
};

let adminPrisma: PrismaClient;
let httpServer: http.Server;
let baseUrl: string;

let employeeA1: string;
let employeeA2: string;
let employeeB1: string;

const users = new Map<
  string,
  { id: string; organizationId: string; role: UserRole; email: string }
>();

const fakeAuth: RequestHandler = (req, res, next) => {
  const userId = req.header('x-test-user') ?? '';
  const user = users.get(userId);

  if (!user) {
    res.status(401).json({
      success: false,
      error: { code: 'NO_TOKEN', message: 'Test auth requires a known x-test-user' },
    });
    return;
  }

  (req as AuthenticatedRequest).auth = {
    user: {
      id: user.id,
      identityIssuer: 'test',
      identitySubject: `subject-${user.id}`,
      email: user.email,
      role: user.role,
      isActive: true,
      organizationId: user.organizationId,
    },
    organization: {
      id: user.organizationId,
      name: `Test Org ${user.organizationId.slice(0, 4)}`,
      slug: `test-org-${user.organizationId.slice(0, 4)}`,
      currency: 'USD',
      timezone: 'UTC',
    },
  };

  next();
};

async function api(
  pathName: string,
  options: { method?: string; user?: string; body?: unknown } = {}
): Promise<JsonResponse> {
  const { method = 'GET', user = userHrA, body } = options;
  const response = await fetch(`${baseUrl}${pathName}`, {
    method,
    headers: {
      ...(user ? { 'x-test-user': user } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

async function createEmployee(
  organizationId: string,
  employeeNumber: string,
  firstName: string,
  userId?: string
) {
  return adminPrisma.employee.create({
    data: {
      organizationId,
      userId,
      employeeNumber,
      firstName,
      lastName: 'Test',
      email: `${employeeNumber.toLowerCase()}@example.com`,
      jobTitle: 'Integration Test',
      employmentType: EmploymentType.FULL_TIME,
      status: EmployeeStatus.ACTIVE,
      joinedAt: new Date('2020-01-01T00:00:00.000Z'),
      baseSalary: '50000.00',
    },
  });
}

before(async () => {
  if (!dbIntegration) return;
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  for (const org of [
    { id: orgA, name: 'Attendance Leave Org A', slug: 'attendance-leave-org-a' },
    { id: orgB, name: 'Attendance Leave Org B', slug: 'attendance-leave-org-b' },
  ]) {
    await adminPrisma.organization.upsert({
      where: { id: org.id },
      update: {},
      create: { ...org, currency: 'USD', timezone: 'UTC' },
    });
  }

  const tenantIds = [orgA, orgB];
  await adminPrisma.leaveRequest.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.attendanceRecord.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: tenantIds } } });

  const userFixtures = [
    { id: userHrA, organizationId: orgA, role: UserRole.HR_MANAGER, email: 'al-hr-a@example.com' },
    { id: userManagerA, organizationId: orgA, role: UserRole.MANAGER, email: 'al-manager-a@example.com' },
    { id: userEmployeeA1, organizationId: orgA, role: UserRole.EMPLOYEE, email: 'al-employee-a1@example.com' },
    { id: userEmployeeA2, organizationId: orgA, role: UserRole.EMPLOYEE, email: 'al-employee-a2@example.com' },
    { id: userHrB, organizationId: orgB, role: UserRole.HR_MANAGER, email: 'al-hr-b@example.com' },
    { id: userEmployeeB1, organizationId: orgB, role: UserRole.EMPLOYEE, email: 'al-employee-b1@example.com' },
  ];

  for (const fixture of userFixtures) {
    await adminPrisma.user.create({
      data: {
        id: fixture.id,
        organizationId: fixture.organizationId,
        email: fixture.email,
        role: fixture.role,
        identityIssuer: 'test',
        identitySubject: `subject-${fixture.id}`,
      },
    });
    users.set(fixture.id, fixture);
  }

  employeeA1 = (
    await createEmployee(orgA, 'AL-1001', 'Alice', userEmployeeA1)
  ).id;
  employeeA2 = (
    await createEmployee(orgA, 'AL-1002', 'Bob', userEmployeeA2)
  ).id;
  employeeB1 = (
    await createEmployee(orgB, 'AL-2001', 'Cara', userEmployeeB1)
  ).id;

  const app = express();
  app.use(express.json());
  app.use('/api/attendance', createAttendanceRouter(fakeAuth));
  app.use('/api/leave-requests', createLeaveRouter(fakeAuth));
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
  await adminPrisma.leaveRequest.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.attendanceRecord.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: tenantIds } } });

  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

describeDb('Attendance and leave integration', () => {
  it('requires authentication', async () => {
    const response = await api('/api/attendance', { user: '' });
    assert.equal(response.status, 401);
    assert.equal(response.body.error.code, 'NO_TOKEN');
  });

  it('records clock-in and clock-out and rejects duplicate punches', async () => {
    const clockIn = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA1,
      body: { action: 'in', workDate: '2026-10-05' },
    });
    assert.equal(clockIn.status, 200, clockIn.text);
    assert.equal(clockIn.body.data.record.employeeId, employeeA1);
    assert.equal(clockIn.body.data.record.status, 'PRESENT');
    assert.ok(clockIn.body.data.record.checkInTime);

    const duplicateIn = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA1,
      body: { action: 'in', workDate: '2026-10-05' },
    });
    assert.equal(duplicateIn.status, 409);
    assert.equal(duplicateIn.body.error.code, 'ALREADY_CLOCKED_IN');

    const clockOut = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA1,
      body: { action: 'out', workDate: '2026-10-05' },
    });
    assert.equal(clockOut.status, 200, clockOut.text);
    assert.ok(clockOut.body.data.record.checkOutTime);

    const duplicateOut = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA1,
      body: { action: 'out', workDate: '2026-10-05' },
    });
    assert.equal(duplicateOut.status, 409);
    assert.equal(duplicateOut.body.error.code, 'ALREADY_CLOCKED_OUT');

    const outBeforeIn = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA1,
      body: { action: 'out', workDate: '2026-10-06' },
    });
    assert.equal(outBeforeIn.status, 409);
    assert.equal(outBeforeIn.body.error.code, 'NOT_CLOCKED_IN');
  });

  it('rejects impossible attendance dates', async () => {
    const response = await api('/api/attendance/punch', {
      method: 'POST',
      user: userEmployeeA1,
      body: { action: 'in', workDate: '2026-02-30' },
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  });

  it('scopes attendance lists and summaries to the employee for non-HR users', async () => {
    for (const [workDate, status] of [
      ['2026-10-05', AttendanceStatus.ABSENT],
      ['2026-10-06', AttendanceStatus.REMOTE],
    ] as const) {
      const upsert = await api('/api/attendance/records', {
        method: 'POST',
        user: userHrA,
        body: { employeeId: employeeA2, workDate, status },
      });
      assert.equal(upsert.status, 201, upsert.text);
    }

    const employeeList = await api('/api/attendance', { user: userEmployeeA1 });
    assert.equal(employeeList.status, 200, employeeList.text);
    assert.equal(employeeList.body.data.pagination.total, 1);
    assert.equal(employeeList.body.data.summary.present, 1);
    assert.equal(employeeList.body.data.summary.absent, 0);
    assert.equal(employeeList.body.data.summary.remote, 0);
    assert.ok(employeeList.body.data.records.every((r: any) => r.employeeId === employeeA1));

    // A non-HR caller cannot widen the scope by supplying another employee id.
    const spoofed = await api(`/api/attendance?employeeId=${employeeA2}`, {
      user: userEmployeeA1,
    });
    assert.equal(spoofed.status, 200);
    assert.equal(spoofed.body.data.pagination.total, 1);
    assert.ok(spoofed.body.data.records.every((r: any) => r.employeeId === employeeA1));

    const hrList = await api('/api/attendance', { user: userHrA });
    assert.equal(hrList.status, 200, hrList.text);
    assert.equal(hrList.body.data.pagination.total, 3);
    assert.equal(hrList.body.data.summary.present, 1);
    assert.equal(hrList.body.data.summary.absent, 1);
    assert.equal(hrList.body.data.summary.remote, 1);

    const managerList = await api('/api/attendance', { user: userManagerA });
    assert.equal(managerList.status, 200);
    assert.equal(managerList.body.data.pagination.total, 0);
    assert.equal(managerList.body.data.summary.present, 0);
  });

  it('enforces HR-only attendance upserts', async () => {
    const employeeAttempt = await api('/api/attendance/records', {
      method: 'POST',
      user: userEmployeeA1,
      body: { employeeId: employeeA1, workDate: '2026-10-07', status: 'PRESENT' },
    });
    assert.equal(employeeAttempt.status, 403);

    const managerAttempt = await api('/api/attendance/records', {
      method: 'POST',
      user: userManagerA,
      body: { employeeId: employeeA1, workDate: '2026-10-07', status: 'PRESENT' },
    });
    assert.equal(managerAttempt.status, 403);
  });

  it('isolates attendance between tenants', async () => {
    const crossTenantUpsert = await api('/api/attendance/records', {
      method: 'POST',
      user: userHrA,
      body: { employeeId: employeeB1, workDate: '2026-10-05', status: 'PRESENT' },
    });
    assert.equal(crossTenantUpsert.status, 404);
    assert.equal(crossTenantUpsert.body.error.code, 'EMPLOYEE_NOT_FOUND');

    const orgBRecord = await api('/api/attendance/records', {
      method: 'POST',
      user: userHrB,
      body: { employeeId: employeeB1, workDate: '2026-10-05', status: 'PRESENT' },
    });
    assert.equal(orgBRecord.status, 201, orgBRecord.text);

    const orgAList = await api('/api/attendance', { user: userHrA });
    assert.equal(orgAList.body.data.pagination.total, 3);
    assert.ok(orgAList.body.data.records.every((r: any) => r.employeeId !== employeeB1));
  });

  it('creates leave, computes days, and rejects overlaps and bad dates', async () => {
    const created = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeA1,
      body: {
        leaveType: 'ANNUAL',
        startDate: '2026-11-10',
        endDate: '2026-11-12',
        reason: 'Family trip',
      },
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.body.data.request.employeeId, employeeA1);
    assert.equal(created.body.data.request.totalDays, '3.0');
    assert.equal(created.body.data.request.status, 'PENDING');

    const overlap = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeA1,
      body: {
        leaveType: 'SICK',
        startDate: '2026-11-11',
        endDate: '2026-11-13',
        reason: 'Overlapping request',
      },
    });
    assert.equal(overlap.status, 409);
    assert.equal(overlap.body.error.code, 'LEAVE_OVERLAP');

    const adjacent = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeA1,
      body: {
        leaveType: 'CASUAL',
        startDate: '2026-11-13',
        endDate: '2026-11-14',
        reason: 'Adjacent request',
      },
    });
    assert.equal(adjacent.status, 201, adjacent.text);
    assert.equal(adjacent.body.data.request.totalDays, '2.0');

    const reversed = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeA1,
      body: {
        leaveType: 'SICK',
        startDate: '2026-11-20',
        endDate: '2026-11-18',
        reason: 'Reversed dates',
      },
    });
    assert.equal(reversed.status, 400);
    assert.equal(reversed.body.error.code, 'VALIDATION_ERROR');

    const impossible = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeA1,
      body: {
        leaveType: 'SICK',
        startDate: '2026-02-30',
        endDate: '2026-03-02',
        reason: 'Impossible date',
      },
    });
    assert.equal(impossible.status, 400);
    assert.equal(impossible.body.error.code, 'VALIDATION_ERROR');
  });

  it('serializes concurrent overlapping leave requests with an advisory lock', async () => {
    const [first, second] = await Promise.all([
      api('/api/leave-requests', {
        method: 'POST',
        user: userEmployeeA2,
        body: {
          leaveType: 'ANNUAL',
          startDate: '2027-01-10',
          endDate: '2027-01-12',
          reason: 'Concurrent request one',
        },
      }),
      api('/api/leave-requests', {
        method: 'POST',
        user: userEmployeeA2,
        body: {
          leaveType: 'ANNUAL',
          startDate: '2027-01-11',
          endDate: '2027-01-13',
          reason: 'Concurrent request two',
        },
      }),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409], `${first.text} / ${second.text}`);
    const rejected = first.status === 409 ? first : second;
    assert.equal(rejected.body.error.code, 'LEAVE_OVERLAP');
  });

  it('restricts leave review to HR and guards double review', async () => {
    const employeeReview = await api('/api/leave-requests/00000000-0000-4000-8000-000000000000/review', {
      method: 'PATCH',
      user: userEmployeeA1,
      body: { action: 'approve' },
    });
    assert.equal(employeeReview.status, 403);

    const managerReview = await api('/api/leave-requests/00000000-0000-4000-8000-000000000000/review', {
      method: 'PATCH',
      user: userManagerA,
      body: { action: 'approve' },
    });
    assert.equal(managerReview.status, 403);

    const pending = await api('/api/leave-requests?status=PENDING', { user: userHrA });
    assert.equal(pending.status, 200, pending.text);
    const ownPending = pending.body.data.requests.filter(
      (request: any) => request.employeeId === employeeA1
    );
    assert.equal(ownPending.length, 2);

    const approve = await api(`/api/leave-requests/${ownPending[0].id}/review`, {
      method: 'PATCH',
      user: userHrA,
      body: { action: 'approve' },
    });
    assert.equal(approve.status, 200, approve.text);
    assert.equal(approve.body.data.request.status, 'APPROVED');
    assert.equal(approve.body.data.request.reviewedByEmail, 'al-hr-a@example.com');

    const doubleReview = await api(`/api/leave-requests/${ownPending[0].id}/review`, {
      method: 'PATCH',
      user: userHrA,
      body: { action: 'reject' },
    });
    assert.equal(doubleReview.status, 409);
    assert.equal(doubleReview.body.error.code, 'LEAVE_NOT_PENDING');

    const reject = await api(`/api/leave-requests/${ownPending[1].id}/review`, {
      method: 'PATCH',
      user: userHrA,
      body: { action: 'reject' },
    });
    assert.equal(reject.status, 200, reject.text);
    assert.equal(reject.body.data.request.status, 'REJECTED');
  });

  it('isolates leave requests between tenants', async () => {
    const orgBLeave = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeB1,
      body: {
        leaveType: 'SICK',
        startDate: '2026-12-01',
        endDate: '2026-12-02',
        reason: 'Cross-tenant request',
      },
    });
    assert.equal(orgBLeave.status, 201, orgBLeave.text);

    const crossTenantReview = await api(
      `/api/leave-requests/${orgBLeave.body.data.request.id}/review`,
      { method: 'PATCH', user: userHrA, body: { action: 'approve' } }
    );
    assert.equal(crossTenantReview.status, 404);
    assert.equal(crossTenantReview.body.error.code, 'LEAVE_NOT_FOUND');

    const orgAList = await api('/api/leave-requests', { user: userHrA });
    assert.equal(orgAList.status, 200, orgAList.text);
    assert.ok(
      orgAList.body.data.requests.every(
        (request: any) => request.employeeId !== employeeB1
      )
    );
  });

  it('scopes leave lists and summaries to the employee for non-HR users', async () => {
    const employeeOne = await api('/api/leave-requests', { user: userEmployeeA1 });
    assert.equal(employeeOne.status, 200, employeeOne.text);
    assert.equal(employeeOne.body.data.pagination.total, 2);
    assert.equal(employeeOne.body.data.summary.pending, 0);
    assert.equal(employeeOne.body.data.summary.approved, 1);
    assert.equal(employeeOne.body.data.summary.rejected, 1);
    assert.ok(
      employeeOne.body.data.requests.every(
        (request: any) => request.employeeId === employeeA1
      )
    );

    const employeeTwo = await api('/api/leave-requests', { user: userEmployeeA2 });
    assert.equal(employeeTwo.status, 200, employeeTwo.text);
    assert.equal(employeeTwo.body.data.pagination.total, 1);
    assert.equal(employeeTwo.body.data.summary.pending, 1);
    assert.equal(employeeTwo.body.data.summary.approved, 0);
    assert.ok(
      employeeTwo.body.data.requests.every(
        (request: any) => request.employeeId === employeeA2
      )
    );

    // A non-HR caller cannot widen the scope by supplying another employee id.
    const spoofed = await api(`/api/leave-requests?employeeId=${employeeA1}`, {
      user: userEmployeeA2,
    });
    assert.equal(spoofed.status, 200);
    assert.equal(spoofed.body.data.pagination.total, 1);
    assert.ok(
      spoofed.body.data.requests.every(
        (request: any) => request.employeeId === employeeA2
      )
    );

    const hrList = await api('/api/leave-requests', { user: userHrA });
    assert.equal(hrList.status, 200, hrList.text);
    assert.equal(hrList.body.data.pagination.total, 3);
    assert.equal(hrList.body.data.summary.pending, 1);
    assert.equal(hrList.body.data.summary.approved, 1);
    assert.equal(hrList.body.data.summary.rejected, 1);
    assert.equal(hrList.body.data.summary.cancelled, 0);
  });

  it('does not persist overlapping leave when the same request is replayed', async () => {
    const approved = await api('/api/leave-requests?status=APPROVED', { user: userHrA });
    const approvedRequest = approved.body.data.requests.find(
      (request: any) => request.employeeId === employeeA1
    );
    assert.ok(approvedRequest, 'expected an approved leave request for employee A1');

    const countBefore = await adminPrisma.leaveRequest.count({
      where: { organizationId: orgA },
    });

    const replay = await api('/api/leave-requests', {
      method: 'POST',
      user: userEmployeeA1,
      body: {
        leaveType: 'ANNUAL',
        startDate: approvedRequest.startDate,
        endDate: approvedRequest.endDate,
        reason: 'Replay of approved dates',
      },
    });
    assert.equal(replay.status, 409);
    assert.equal(replay.body.error.code, 'LEAVE_OVERLAP');

    const countAfter = await adminPrisma.leaveRequest.count({
      where: { organizationId: orgA },
    });
    assert.equal(countAfter, countBefore);
    assert.equal(
      (await adminPrisma.leaveRequest.count({
        where: { organizationId: orgA, employeeId: employeeA1 },
      })),
      2
    );
  });
});
