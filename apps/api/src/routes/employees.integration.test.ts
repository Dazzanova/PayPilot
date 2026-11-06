import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express, { RequestHandler } from 'express';
import { EmployeeStatus, EmploymentType, PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withOrganizationContext } from '../lib/tenant';
import { HttpError } from '../lib/httpError';
import { errorHandler } from '../middleware/errorHandler';
import { AuthenticatedRequest } from '../types/auth';
import { createEmployeesRouter } from './employees.routes';
import { createDepartmentsRouter } from './departments.routes';
import {
  changeEmployeeStatus,
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from './employees.service';
import { EmployeeListQuery } from './employees.schema';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

// Dedicated fixtures: auth.integration.test.ts runs concurrently and owns the
// 3333 organization, so sharing it would race across test processes.
const orgA = '55555555-5555-4555-8555-555555555555';
const orgB = '66666666-6666-4666-8666-666666666666';
const orgC = '77777777-7777-4777-8777-777777777777';
const userA = '55555555-5555-4555-8555-555555555501';
const userB = '66666666-6666-4666-8666-666666666601';
const userC = '77777777-7777-4777-8777-777777777701';

// Tenant C owns a fully controlled fixture set so list, summary, search, and
// sort assertions never depend on rows created by other tests.
const cFixtures = [
  {
    employeeNumber: 'PP-2001',
    firstName: 'Quinn',
    lastName: 'Bennett',
    email: 'quinn.bennett@example.com',
    jobTitle: 'Quality Engineer',
    joinedAt: '2021-01-10',
    baseSalary: '91000.00',
    status: EmployeeStatus.ACTIVE,
    inDepartment: true,
  },
  {
    employeeNumber: 'PP-2002',
    firstName: 'Riley',
    lastName: 'Chen',
    email: 'riley.chen@example.com',
    jobTitle: 'Data Analyst',
    joinedAt: '2022-02-20',
    baseSalary: '92000.00',
    status: EmployeeStatus.ACTIVE,
    inDepartment: true,
  },
  {
    employeeNumber: 'PP-2003',
    firstName: 'Sage',
    lastName: 'Dawson',
    email: 'sage.dawson@example.com',
    jobTitle: 'Payroll Specialist',
    joinedAt: '2023-03-30',
    baseSalary: '93000.00',
    status: EmployeeStatus.ON_LEAVE,
    inDepartment: false,
  },
  {
    employeeNumber: 'PP-2004',
    firstName: 'Tatum',
    lastName: 'Ellis',
    email: 'tatum.ellis@example.com',
    jobTitle: 'HR Coordinator',
    joinedAt: '2024-04-15',
    baseSalary: '94000.00',
    status: EmployeeStatus.TERMINATED,
    inDepartment: false,
  },
  {
    employeeNumber: 'PP-2005',
    firstName: 'Umber',
    lastName: 'Frost',
    email: 'umber.frost@example.com',
    jobTitle: 'Office Manager',
    joinedAt: '2025-05-25',
    baseSalary: '95000.00',
    status: EmployeeStatus.ACTIVE,
    inDepartment: false,
  },
] as const;

type CFixture = (typeof cFixtures)[number];

let adminPrisma: PrismaClient;
let deptA: string;
let deptB: string;
let deptC: string;
let cEmployees: Array<CFixture & { id: string }>;
let httpServer: http.Server;
let baseUrl: string;

const testUserByOrg: Record<string, string> = {
  [orgA]: userA,
  [orgB]: userB,
  [orgC]: userC,
};

/**
 * Replaces Keycloak authentication for the route-level tests by populating the
 * same `req.auth` shape that `requireAuth` produces.
 */
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

const baseQuery: EmployeeListQuery = {
  page: 1,
  pageSize: 25,
  sort: 'lastName',
  order: 'asc',
};

const input = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Alex',
  lastName: 'Mercer',
  email: 'alex.mercer@example.com',
  phone: '+1 (555) 234-5678',
  jobTitle: 'VP of Engineering',
  employmentType: 'FULL_TIME' as const,
  joinedAt: '2026-01-15',
  baseSalary: '145000.00',
  departmentId: null,
  ...overrides,
});

const listC = (overrides: Partial<EmployeeListQuery> = {}) =>
  withOrganizationContext(orgC, (tx) =>
    listEmployees(tx, orgC, { ...baseQuery, ...overrides })
  );

const testHeaders = (
  organizationId: string,
  role: UserRole = UserRole.HR_MANAGER
) => ({
  'content-type': 'application/json',
  'x-test-org': organizationId,
  'x-test-role': role,
});

async function expectHttpError(promise: Promise<unknown>, status: number, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, status);
    assert.equal(error.code, code);
    return true;
  });
}

before(async () => {
  if (!dbIntegration) {
    return;
  }
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  adminPrisma = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });

  for (const org of [
    { id: orgA, name: 'Employee Org A', slug: 'employee-org-a' },
    { id: orgB, name: 'Employee Org B', slug: 'employee-org-b' },
    { id: orgC, name: 'Employee Org C', slug: 'employee-org-c' },
  ]) {
    await adminPrisma.organization.upsert({
      where: { id: org.id },
      update: {},
      create: { ...org, currency: 'USD', timezone: 'UTC' },
    });
  }

  for (const [id, organizationId, email] of [
    [userA, orgA, 'hr-a@example.com'],
    [userB, orgB, 'hr-b@example.com'],
    [userC, orgC, 'hr-c@example.com'],
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

  const tenantIds = [orgA, orgB, orgC];
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.department.deleteMany({ where: { organizationId: { in: tenantIds } } });

  deptA = (
    await adminPrisma.department.create({
      data: { organizationId: orgA, name: 'Engineering', code: 'ENG' },
    })
  ).id;
  deptB = (
    await adminPrisma.department.create({
      data: { organizationId: orgB, name: 'Finance', code: 'FIN' },
    })
  ).id;
  deptC = (
    await adminPrisma.department.create({
      data: { organizationId: orgC, name: 'Operations', code: 'OPS' },
    })
  ).id;

  cEmployees = [];
  for (const [index, fixture] of cFixtures.entries()) {
    const created = await adminPrisma.employee.create({
      data: {
        organizationId: orgC,
        employeeNumber: fixture.employeeNumber,
        firstName: fixture.firstName,
        lastName: fixture.lastName,
        email: fixture.email,
        jobTitle: fixture.jobTitle,
        employmentType: EmploymentType.FULL_TIME,
        status: fixture.status,
        joinedAt: new Date(`${fixture.joinedAt}T00:00:00.000Z`),
        baseSalary: fixture.baseSalary,
        departmentId: fixture.inDepartment ? deptC : null,
        // Explicit timestamps keep the createdAt sort assertion deterministic.
        createdAt: new Date(Date.UTC(2020, 0, index + 1)),
      },
    });
    cEmployees.push({ ...fixture, id: created.id });
  }

  const app = express();
  app.use(express.json());
  app.use('/api/employees', createEmployeesRouter(fakeAuth));
  app.use('/api/departments', createDepartmentsRouter(fakeAuth));
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
  if (!dbIntegration) {
    return;
  }

  if (httpServer) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }

  const tenantIds = [orgA, orgB, orgC];
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.department.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: tenantIds } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: tenantIds } } });
  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

describeDb('Employee directory service', () => {
  it('creates employees with sequential numbers and audits the create', async () => {
    const first = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'first@example.com' }))
    );
    const second = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'second@example.com' }))
    );

    assert.equal(first.employeeNumber, 'PP-1001');
    assert.equal(second.employeeNumber, 'PP-1002');

    const audits = await adminPrisma.auditLog.findMany({
      where: { organizationId: orgA, action: 'employee.created' },
    });
    assert.equal(audits.length, 2);
    assert.equal(audits[0].actorId, userA);
  });

  it('allocates distinct numbers for concurrent creates', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        withOrganizationContext(orgA, (tx) =>
          createEmployee(
            tx,
            orgA,
            userA,
            input({ email: `concurrent-${index}@example.com` })
          )
        )
      )
    );

    const numbers = results.map((row) => row.employeeNumber);
    assert.equal(new Set(numbers).size, numbers.length);
  });

  it('serializes a create and an update competing for the same email', async () => {
    const employeeB = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'race-b@example.com' }))
    );

    const target = 'race-target@example.com';
    const [updateResult, createResult] = await Promise.allSettled([
      withOrganizationContext(orgA, (tx) =>
        updateEmployee(tx, orgA, userA, employeeB.id, { email: target })
      ),
      withOrganizationContext(orgA, (tx) =>
        createEmployee(tx, orgA, userA, input({ email: target }))
      ),
    ]);

    const results = [updateResult, createResult];
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected'
    );

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);

    const error = rejected[0].reason;
    assert.ok(error instanceof HttpError);
    assert.equal(error.statusCode, 409);
    assert.equal(error.code, 'EMAIL_ALREADY_EXISTS');

    // Exactly one row owns the contended email.
    const stored = await adminPrisma.employee.findMany({
      where: { organizationId: orgA, email: target },
      select: { id: true },
    });
    assert.equal(stored.length, 1);

    if (updateResult.status === 'fulfilled') {
      assert.equal(stored[0].id, employeeB.id);
    } else {
      assert.equal(createResult.status, 'fulfilled');
      assert.equal(stored[0].id, createResult.value.id);
    }
  });

  it('gets a fixture employee by id within the tenant', async () => {
    const expected = cEmployees[0];
    const employee = await withOrganizationContext(orgC, (tx) =>
      getEmployee(tx, orgC, expected.id)
    );

    assert.equal(employee.id, expected.id);
    assert.equal(employee.email, expected.email);
    assert.equal(employee.employeeNumber, expected.employeeNumber);
  });

  it('searches by first name, last name, employee number, and job title', async () => {
    const cases = [
      { term: cEmployees[0].firstName, expected: cEmployees[0] },
      { term: cEmployees[1].lastName, expected: cEmployees[1] },
      { term: cEmployees[3].employeeNumber, expected: cEmployees[3] },
      { term: cEmployees[2].jobTitle, expected: cEmployees[2] },
    ];

    for (const { term, expected } of cases) {
      const result = await listC({ search: term });
      assert.equal(
        result.pagination.total,
        1,
        `search "${term}" should match exactly one employee`
      );
      assert.equal(result.employees[0].id, expected.id);
      assert.equal(result.employees[0].email, expected.email);
    }
  });

  it('filters the department fixture set exactly', async () => {
    const result = await listC({ departmentId: deptC });

    assert.equal(result.pagination.total, 2);
    assert.deepEqual(
      result.employees.map((employee) => employee.id).sort(),
      [cEmployees[0].id, cEmployees[1].id].sort()
    );
  });

  it('filters terminated employees in the fixture tenant', async () => {
    const result = await listC({ status: 'TERMINATED' });

    assert.equal(result.pagination.total, 1);
    assert.equal(result.employees[0].id, cEmployees[3].id);
    assert.deepEqual(result.summary, {
      total: 5,
      active: 3,
      onLeave: 1,
      suspended: 0,
      terminated: 1,
    });
  });

  it('paginates deterministically and sorts by joinedAt', async () => {
    const page = await listC({ sort: 'lastName', order: 'asc', pageSize: 2, page: 2 });

    assert.equal(page.pagination.total, 5);
    assert.equal(page.pagination.totalPages, 3);
    assert.deepEqual(
      page.employees.map((employee) => employee.id),
      [cEmployees[2].id, cEmployees[3].id]
    );

    const latest = await listC({ sort: 'joinedAt', order: 'desc', pageSize: 2, page: 1 });
    assert.equal(latest.employees[0].id, cEmployees[4].id);

    const byNumber = await listC({ sort: 'employeeNumber', order: 'asc', pageSize: 2, page: 1 });
    assert.equal(byNumber.employees[0].id, cEmployees[0].id);

    const byCreatedAt = await listC({ sort: 'createdAt', order: 'asc', pageSize: 2, page: 1 });
    assert.equal(byCreatedAt.employees[0].id, cEmployees[0].id);
  });

  it('summarizes the fixture tenant exactly', async () => {
    const result = await listC();

    assert.deepEqual(result.summary, {
      total: 5,
      active: 3,
      onLeave: 1,
      suspended: 0,
      terminated: 1,
    });
  });

  it('excludes other tenants from list results', async () => {
    const outsider = await withOrganizationContext(orgB, (tx) =>
      createEmployee(tx, orgB, userB, input({ email: 'org-b-outsider@example.com' }))
    );

    const result = await listC({ pageSize: 100 });

    assert.equal(result.pagination.total, 5);
    assert.equal(
      result.employees.some((employee) => employee.id === outsider.id),
      false
    );
    assert.equal(
      result.employees.some((employee) => employee.email === outsider.email),
      false
    );
  });

  it('rejects writes without tenant context and leaves no rows', async () => {
    await assert.rejects(
      prisma.$transaction((tx) =>
        createEmployee(tx, orgC, userC, input({ email: 'no-context@example.com' }))
      )
    );

    const leaked = await adminPrisma.employee.findFirst({
      where: { organizationId: orgC, email: 'no-context@example.com' },
    });
    assert.equal(leaked, null);
  });

  it('rejects an update that duplicates another employee email', async () => {
    await expectHttpError(
      withOrganizationContext(orgC, (tx) =>
        updateEmployee(tx, orgC, userC, cEmployees[1].id, {
          email: cEmployees[0].email,
        })
      ),
      409,
      'EMAIL_ALREADY_EXISTS'
    );

    const unchanged = await adminPrisma.employee.findUniqueOrThrow({
      where: { id: cEmployees[1].id },
    });
    assert.equal(unchanged.email, cEmployees[1].email);
  });

  it('does not leak salaries into create or status audit metadata', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(
        tx,
        orgA,
        userA,
        input({ email: 'audit-metadata@example.com', baseSalary: '166000.00' })
      )
    );

    const createAudit = await adminPrisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'employee.created' },
    });
    assert.deepEqual(createAudit?.metadata, {
      employeeNumber: created.employeeNumber,
    });

    await withOrganizationContext(orgA, (tx) =>
      changeEmployeeStatus(tx, orgA, userA, created.id, 'ON_LEAVE')
    );

    const statusAudit = await adminPrisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'employee.status_changed' },
    });
    assert.deepEqual(statusAudit?.metadata, { from: 'ACTIVE', to: 'ON_LEAVE' });
  });

  it('updates fields and records changed fields without salary values', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'update@example.com' }))
    );

    const updated = await withOrganizationContext(orgA, (tx) =>
      updateEmployee(tx, orgA, userA, created.id, {
        jobTitle: 'CTO',
        baseSalary: '155000.00',
        departmentId: deptA,
      })
    );

    assert.equal(updated.jobTitle, 'CTO');
    assert.equal(updated.baseSalary, '155000.00');
    assert.equal(updated.departmentName, 'Engineering');

    const audit = await adminPrisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'employee.updated' },
      orderBy: { createdAt: 'desc' },
    });
    assert.deepEqual(audit?.metadata, {
      changedFields: ['jobTitle', 'baseSalary', 'departmentId'],
    });
    assert.equal(JSON.stringify(audit?.metadata).includes('155000'), false);
  });

  it('changes status and audits the transition', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'status@example.com' }))
    );

    const updated = await withOrganizationContext(orgA, (tx) =>
      changeEmployeeStatus(tx, orgA, userA, created.id, 'ON_LEAVE')
    );
    assert.equal(updated.status, 'ON_LEAVE');

    const audit = await adminPrisma.auditLog.findFirst({
      where: { entityId: created.id, action: 'employee.status_changed' },
    });
    assert.deepEqual(audit?.metadata, { from: 'ACTIVE', to: 'ON_LEAVE' });
  });

  it('rejects duplicate email in the same organization but allows it in another', async () => {
    await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'shared@example.com' }))
    );

    await expectHttpError(
      withOrganizationContext(orgA, (tx) =>
        createEmployee(tx, orgA, userA, input({ email: 'shared@example.com' }))
      ),
      409,
      'EMAIL_ALREADY_EXISTS'
    );

    const other = await withOrganizationContext(orgB, (tx) =>
      createEmployee(tx, orgB, userB, input({ email: 'shared@example.com' }))
    );
    assert.equal(other.email, 'shared@example.com');
  });

  it('rejects a department from another organization', async () => {
    await expectHttpError(
      withOrganizationContext(orgA, (tx) =>
        createEmployee(tx, orgA, userA, input({ email: 'foreign@example.com', departmentId: deptB }))
      ),
      400,
      'INVALID_DEPARTMENT'
    );
  });

  it('hides employees from other tenants', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'hidden@example.com' }))
    );

    await expectHttpError(
      withOrganizationContext(orgB, (tx) => getEmployee(tx, orgB, created.id)),
      404,
      'EMPLOYEE_NOT_FOUND'
    );

    await expectHttpError(
      withOrganizationContext(orgB, (tx) =>
        updateEmployee(tx, orgB, userB, created.id, { jobTitle: 'Hijacked' })
      ),
      404,
      'EMPLOYEE_NOT_FOUND'
    );

    await expectHttpError(
      withOrganizationContext(orgB, (tx) =>
        changeEmployeeStatus(tx, orgB, userB, created.id, 'TERMINATED')
      ),
      404,
      'EMPLOYEE_NOT_FOUND'
    );
  });

  it('returns nothing without tenant context even when rows exist', async () => {
    const stored = await adminPrisma.employee.count({ where: { organizationId: orgC } });
    assert.ok(stored >= 5, 'tenant C fixtures must exist for this check');

    const rows = await prisma.employee.findMany({ where: { organizationId: orgC } });
    assert.equal(rows.length, 0);
  });

  it('creates an employee over HTTP with 201 and a Location header', async () => {
    const response = await fetch(`${baseUrl}/api/employees`, {
      method: 'POST',
      headers: testHeaders(orgA),
      body: JSON.stringify(input({ email: 'http-create@example.com' })),
    });

    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.data.employee.email, 'http-create@example.com');
    assert.match(body.data.employee.employeeNumber, /^PP-\d+$/);
    assert.equal(
      response.headers.get('location'),
      `/api/employees/${body.data.employee.id}`
    );
  });

  it('returns validation details over HTTP for an invalid payload', async () => {
    const response = await fetch(`${baseUrl}/api/employees`, {
      method: 'POST',
      headers: testHeaders(orgA),
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(body.error.details));
    assert.ok(body.error.details.length > 0);
    assert.ok(
      body.error.details.every(
        (detail: { path?: unknown; message?: unknown }) =>
          typeof detail.path === 'string' && typeof detail.message === 'string'
      )
    );
  });

  it('forbids roles outside the HR roles over HTTP', async () => {
    const response = await fetch(`${baseUrl}/api/employees`, {
      headers: testHeaders(orgA, UserRole.MANAGER),
    });

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'INSUFFICIENT_PERMISSIONS');
  });

  it('hides another tenant employee over HTTP', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      createEmployee(tx, orgA, userA, input({ email: 'http-cross-tenant@example.com' }))
    );

    const response = await fetch(`${baseUrl}/api/employees/${created.id}`, {
      headers: testHeaders(orgB),
    });

    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'EMPLOYEE_NOT_FOUND');
  });

  it('lists employees and departments over HTTP with the expected envelopes', async () => {
    const listResponse = await fetch(`${baseUrl}/api/employees?pageSize=2`, {
      headers: testHeaders(orgC),
    });
    assert.equal(listResponse.status, 200);
    const listBody = await listResponse.json();
    assert.equal(listBody.success, true);
    assert.equal(listBody.data.pagination.total, 5);
    assert.equal(listBody.data.employees.length, 2);
    assert.deepEqual(listBody.data.summary, {
      total: 5,
      active: 3,
      onLeave: 1,
      suspended: 0,
      terminated: 1,
    });

    const departmentsResponse = await fetch(`${baseUrl}/api/departments`, {
      headers: testHeaders(orgC),
    });
    assert.equal(departmentsResponse.status, 200);
    const departmentsBody = await departmentsResponse.json();
    assert.equal(departmentsBody.success, true);
    assert.ok(Array.isArray(departmentsBody.data.departments));
    assert.ok(
      departmentsBody.data.departments.some(
        (department: { id: string; code: string }) =>
          department.id === deptC && department.code === 'OPS'
      )
    );
  });
});
