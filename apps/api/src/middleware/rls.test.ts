import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, UserRole } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { withOrganizationContext } from '../lib/tenant';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

const orgA = '11111111-1111-4111-8111-111111111111';
const orgB = '22222222-2222-4222-8222-222222222222';
const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/paypilot';

let adminPrisma: PrismaClient;

async function createDepartment(organizationId: string, code: string) {
  return adminPrisma.department.create({
    data: {
      organizationId,
      name: `Department ${code}`,
      code,
    },
  });
}

async function departmentExists(id: string) {
  return adminPrisma.department.findUnique({ where: { id } });
}

before(async () => {
  if (!dbIntegration) {
    return;
  }

  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required for database integration tests');
  }

  adminPrisma = new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
  });

  await adminPrisma.department.deleteMany({
    where: { organizationId: { in: [orgA, orgB] } },
  });
  await adminPrisma.user.deleteMany({
    where: { organizationId: { in: [orgA, orgB] } },
  });

  await adminPrisma.organization.upsert({
    where: { id: orgA },
    update: {},
    create: {
      id: orgA,
      name: 'RLS Organization A',
      slug: 'rls-organization-a',
      currency: 'USD',
      timezone: 'UTC',
    },
  });

  await adminPrisma.organization.upsert({
    where: { id: orgB },
    update: {},
    create: {
      id: orgB,
      name: 'RLS Organization B',
      slug: 'rls-organization-b',
      currency: 'USD',
      timezone: 'UTC',
    },
  });
});

after(async () => {
  if (!dbIntegration) {
    return;
  }

  await adminPrisma.department.deleteMany({
    where: { organizationId: { in: [orgA, orgB] } },
  });
  await adminPrisma.user.deleteMany({
    where: { organizationId: { in: [orgA, orgB] } },
  });
  await adminPrisma.organization.deleteMany({
    where: { id: { in: [orgA, orgB] } },
  });

  await adminPrisma.$disconnect();
  await prisma.$disconnect();
});

describeDb('PostgreSQL RLS runtime role and policies', () => {
  it('uses a non-superuser runtime role without BYPASSRLS that does not own tables', async () => {
    const [role] = await prisma.$queryRaw<
      Array<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>
    >`SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;

    assert.equal(role.rolsuper, false);
    assert.equal(role.rolbypassrls, false);

    const [table] = await prisma.$queryRaw<
      Array<{ tableowner: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT pg_get_userbyid(c.relowner) AS tableowner,
             c.relrowsecurity,
             c.relforcerowsecurity
      FROM pg_class c
      WHERE c.oid = 'public.departments'::regclass`;

    assert.notEqual(table.tableowner, role.rolname);
    assert.equal(table.relrowsecurity, true);
    assert.equal(table.relforcerowsecurity, true);
  });

  it('cannot assume the migration role', async () => {
    await assert.rejects(() =>
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET ROLE paypilot_migrator');
      })
    );
  });

  it('denies protected reads and writes when tenant context is missing', async () => {
    const rows = await prisma.department.findMany({
      where: { organizationId: { in: [orgA, orgB] } },
    });
    assert.equal(rows.length, 0);

    await assert.rejects(() =>
      prisma.department.create({
        data: {
          organizationId: orgA,
          name: 'No Context',
          code: 'NOCTX',
        },
      })
    );
  });
});

describeDb('Cross-tenant isolation', () => {
  it('returns no rows for another tenant on SELECT', async () => {
    const deptB = await createDepartment(orgB, 'CROSS-SEL');

    const rows = await withOrganizationContext(orgA, (tx) =>
      tx.department.findMany({ where: { organizationId: orgB } })
    );
    assert.equal(rows.length, 0);

    const byId = await withOrganizationContext(orgA, (tx) =>
      tx.department.findUnique({ where: { id: deptB.id } })
    );
    assert.equal(byId, null);
  });

  it('rejects an INSERT into another tenant', async () => {
    await assert.rejects(() =>
      withOrganizationContext(orgA, (tx) =>
        tx.department.create({
          data: {
            organizationId: orgB,
            name: 'Cross Tenant Insert',
            code: 'CROSS-INS',
          },
        })
      )
    );
  });

  it('rejects UPDATE and DELETE against another tenant', async () => {
    const deptB = await createDepartment(orgB, 'CROSS-UPD');

    await assert.rejects(() =>
      withOrganizationContext(orgA, (tx) =>
        tx.department.update({
          where: { id: deptB.id },
          data: { name: 'Hijacked' },
        })
      )
    );
    await assert.rejects(() =>
      withOrganizationContext(orgA, (tx) =>
        tx.department.delete({ where: { id: deptB.id } })
      )
    );

    const stillExists = await departmentExists(deptB.id);
    assert.ok(stillExists);
    assert.equal(stillExists?.name, 'Department CROSS-UPD');
  });

  it('allows a tenant to create, read, update, and delete its own records', async () => {
    const created = await withOrganizationContext(orgA, (tx) =>
      tx.department.create({
        data: {
          organizationId: orgA,
          name: 'Owned Department',
          code: 'OWNED',
        },
      })
    );

    const read = await withOrganizationContext(orgA, (tx) =>
      tx.department.findUnique({ where: { id: created.id } })
    );
    assert.equal(read?.id, created.id);

    const updated = await withOrganizationContext(orgA, (tx) =>
      tx.department.update({
        where: { id: created.id },
        data: { name: 'Owned Department Updated' },
      })
    );
    assert.equal(updated.name, 'Owned Department Updated');

    await withOrganizationContext(orgA, (tx) =>
      tx.department.delete({ where: { id: created.id } })
    );
    const deleted = await withOrganizationContext(orgA, (tx) =>
      tx.department.findUnique({ where: { id: created.id } })
    );
    assert.equal(deleted, null);
  });
});

describeDb('Transaction and connection isolation', () => {
  it('does not leak context between sequential requests', async () => {
    const deptA = await withOrganizationContext(orgA, (tx) =>
      tx.department.create({
        data: {
          organizationId: orgA,
          name: 'Sequential A',
          code: 'SEQ-A',
        },
      })
    );

    const orgBRows = await withOrganizationContext(orgB, (tx) =>
      tx.department.findMany()
    );
    assert.equal(orgBRows.some((row) => row.id === deptA.id), false);

    const deptB = await withOrganizationContext(orgB, (tx) =>
      tx.department.create({
        data: {
          organizationId: orgB,
          name: 'Sequential B',
          code: 'SEQ-B',
        },
      })
    );

    const orgARows = await withOrganizationContext(orgA, (tx) =>
      tx.department.findMany()
    );
    assert.equal(orgARows.some((row) => row.id === deptB.id), false);
  });

  it('keeps concurrent tenant contexts isolated', async () => {
    const deptA = await createDepartment(orgA, 'CONC-A');
    const deptB = await createDepartment(orgB, 'CONC-B');

    const [rowsA, rowsB] = await Promise.all([
      withOrganizationContext(orgA, async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return tx.department.findMany();
      }),
      withOrganizationContext(orgB, async (tx) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return tx.department.findMany();
      }),
    ]);

    assert.ok(rowsA.every((row) => row.organizationId === orgA));
    assert.ok(rowsB.every((row) => row.organizationId === orgB));
    assert.ok(rowsA.some((row) => row.id === deptA.id));
    assert.ok(rowsB.some((row) => row.id === deptB.id));
    assert.equal(rowsA.some((row) => row.id === deptB.id), false);
    assert.equal(rowsB.some((row) => row.id === deptA.id), false);
  });

  it('rolls back data and clears tenant context when a transaction fails', async () => {
    await assert.rejects(() =>
      withOrganizationContext(orgA, async (tx) => {
        await tx.department.create({
          data: {
            organizationId: orgA,
            name: 'Rolled Back',
            code: 'ROLLBACK',
          },
        });
        throw new Error('forced rollback');
      })
    );

    const persisted = await adminPrisma.department.findFirst({
      where: { organizationId: orgA, code: 'ROLLBACK' },
    });
    assert.equal(persisted, null);

    const withoutContext = await prisma.department.findMany();
    assert.equal(withoutContext.length, 0);
  });
});

describeDb('Identity resolution before tenant context', () => {
  it('resolves only an exact issuer and subject mapping', async () => {
    const user = await adminPrisma.user.create({
      data: {
        organizationId: orgA,
        identityIssuer: issuer,
        identitySubject: 'rls-identity-subject',
        email: 'rls-user@example.com',
        role: UserRole.EMPLOYEE,
      },
    });

    const [mapping] = await prisma.$queryRaw<
      Array<{ user_id: string; organization_id: string }>
    >`SELECT user_id, organization_id
      FROM public.paypilot_resolve_identity(${issuer}, ${'rls-identity-subject'})`;

    assert.equal(mapping.user_id, user.id);
    assert.equal(mapping.organization_id, orgA);

    const wrongSubject = await prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id
      FROM public.paypilot_resolve_identity(${issuer}, ${'wrong-subject'})
    `;
    assert.equal(wrongSubject.length, 0);

    const emailOnlyLookup = await prisma.$queryRaw<Array<{ user_id: string }>>`
      SELECT user_id
      FROM public.paypilot_resolve_identity(${issuer}, ${'rls-user@example.com'})
    `;
    assert.equal(emailOnlyLookup.length, 0);
  });

  it('hides users without tenant context and scopes them to their tenant', async () => {
    const user = await adminPrisma.user.findFirst({
      where: { organizationId: orgA, email: 'rls-user@example.com' },
    });
    assert.ok(user);

    const withoutContext = await prisma.user.findMany();
    assert.equal(withoutContext.length, 0);

    const visibleToOwnTenant = await withOrganizationContext(orgA, (tx) =>
      tx.user.findUnique({ where: { id: user.id } })
    );
    assert.equal(visibleToOwnTenant?.id, user.id);

    const hiddenFromOtherTenant = await withOrganizationContext(orgB, (tx) =>
      tx.user.findUnique({ where: { id: user.id } })
    );
    assert.equal(hiddenFromOtherTenant, null);
  });

  it('enforces uniqueness for an identity mapping', async () => {
    await assert.rejects(() =>
      adminPrisma.user.create({
        data: {
          organizationId: orgB,
          identityIssuer: issuer,
          identitySubject: 'rls-identity-subject',
          email: 'rls-duplicate@example.com',
          role: UserRole.EMPLOYEE,
        },
      })
    );
  });
});

describeDb('Organization and audit-log policies', () => {
  it('allows reading only the current organization', async () => {
    const own = await withOrganizationContext(orgA, (tx) =>
      tx.organization.findUnique({ where: { id: orgA } })
    );
    assert.equal(own?.id, orgA);

    const other = await withOrganizationContext(orgA, (tx) =>
      tx.organization.findUnique({ where: { id: orgB } })
    );
    assert.equal(other, null);
  });

  it('prevents tenant updates to organization records', async () => {
    await assert.rejects(() =>
      withOrganizationContext(orgA, (tx) =>
        tx.organization.update({
          where: { id: orgA },
          data: { name: 'Changed by tenant' },
        })
      )
    );
  });

  it('treats audit logs as append-only', async () => {
    const log = await withOrganizationContext(orgA, (tx) =>
      tx.auditLog.create({
        data: {
          organizationId: orgA,
          action: 'TEST_ACTION',
          entityType: 'test',
        },
      })
    );

    await assert.rejects(() =>
      withOrganizationContext(orgA, (tx) =>
        tx.auditLog.update({
          where: { id: log.id },
          data: { action: 'CHANGED' },
        })
      )
    );
    await assert.rejects(() =>
      withOrganizationContext(orgA, (tx) =>
        tx.auditLog.delete({ where: { id: log.id } })
      )
    );

    await adminPrisma.auditLog.delete({ where: { id: log.id } });
  });
});
