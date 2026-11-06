import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withOrganizationContext } from '../lib/tenant';
import { HttpError } from '../lib/httpError';
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
// 3333/4444 organizations, so sharing them would race across test processes.
const orgA = '55555555-5555-4555-8555-555555555555';
const orgB = '66666666-6666-4666-8666-666666666666';
const userA = '55555555-5555-4555-8555-555555555501';
const userB = '66666666-6666-4666-8666-666666666601';

let adminPrisma: PrismaClient;
let deptA: string;
let deptB: string;

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

  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.department.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });

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
});

after(async () => {
  if (!dbIntegration) {
    return;
  }
  await adminPrisma.employee.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.auditLog.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.department.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.user.deleteMany({ where: { organizationId: { in: [orgA, orgB] } } });
  await adminPrisma.organization.deleteMany({ where: { id: { in: [orgA, orgB] } } });
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

  it('lists, searches, filters, paginates, and summarizes', async () => {
    const result = await withOrganizationContext(orgA, (tx) =>
      listEmployees(tx, orgA, { ...baseQuery, search: 'second' })
    );
    assert.equal(result.employees.length, 1);
    assert.equal(result.employees[0].email, 'second@example.com');
    assert.equal(result.pagination.total, 1);
    assert.ok(result.summary.total >= 6);

    const byDepartment = await withOrganizationContext(orgA, (tx) =>
      listEmployees(tx, orgA, { ...baseQuery, departmentId: deptA })
    );
    assert.equal(byDepartment.pagination.total, 0);

    const paged = await withOrganizationContext(orgA, (tx) =>
      listEmployees(tx, orgA, { ...baseQuery, pageSize: 2, page: 2 })
    );
    assert.equal(paged.employees.length, 2);
    assert.equal(paged.pagination.page, 2);
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

  it('returns nothing without tenant context', async () => {
    const rows = await prisma.employee.findMany({ where: { organizationId: orgA } });
    assert.equal(rows.length, 0);
  });
});
