import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient, UserRole } from '@prisma/client';
import {
  AuthenticationError,
  loadAuthContext,
  resolveIdentity,
} from './auth';

const dbIntegration = process.env.RUN_DB_INTEGRATION === '1';
const describeDb = dbIntegration ? describe : describe.skip;

const orgId = '33333333-3333-4333-8333-333333333333';
const issuer = process.env.KEYCLOAK_ISSUER || 'http://localhost:8080/realms/paypilot';
const activeSubject = 'auth-integration-active';
const inactiveSubject = 'auth-integration-inactive';

let adminPrisma: PrismaClient;

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

  await adminPrisma.user.deleteMany({ where: { organizationId: orgId } });
  await adminPrisma.organization.upsert({
    where: { id: orgId },
    update: {},
    create: {
      id: orgId,
      name: 'Auth Integration Organization',
      slug: 'auth-integration-organization',
      currency: 'USD',
      timezone: 'UTC',
    },
  });

  await adminPrisma.user.create({
    data: {
      organizationId: orgId,
      identityIssuer: issuer,
      identitySubject: activeSubject,
      email: 'auth-integration-active@example.com',
      role: UserRole.ADMIN,
      isActive: true,
    },
  });

  await adminPrisma.user.create({
    data: {
      organizationId: orgId,
      identityIssuer: issuer,
      identitySubject: inactiveSubject,
      email: 'auth-integration-inactive@example.com',
      role: UserRole.EMPLOYEE,
      isActive: false,
    },
  });

  await adminPrisma.user.create({
    data: {
      organizationId: orgId,
      email: 'auth-integration-unlinked@example.com',
      role: UserRole.EMPLOYEE,
      isActive: true,
    },
  });
});

after(async () => {
  if (!dbIntegration) {
    return;
  }

  await adminPrisma.user.deleteMany({ where: { organizationId: orgId } });
  await adminPrisma.organization.delete({ where: { id: orgId } });
  await adminPrisma.$disconnect();
});

describeDb('Verified identity to PayPilot context resolution', () => {
  it('resolves issuer and subject to the trusted organization and role', async () => {
    const context = await loadAuthContext(issuer, activeSubject);

    assert.equal(context.organization.id, orgId);
    assert.equal(context.organization.name, 'Auth Integration Organization');
    assert.equal(context.user.email, 'auth-integration-active@example.com');
    assert.equal(context.user.role, UserRole.ADMIN);
    assert.equal(context.user.identityIssuer, issuer);
    assert.equal(context.user.identitySubject, activeSubject);
  });

  it('updates lastLoginAt inside the tenant transaction', async () => {
    await loadAuthContext(issuer, activeSubject);

    const user = await adminPrisma.user.findFirst({
      where: { organizationId: orgId, identitySubject: activeSubject },
    });
    assert.ok(user?.lastLoginAt);
  });

  it('rejects an unlinked subject even when the email matches a user', async () => {
    await assert.rejects(
      () => loadAuthContext(issuer, 'auth-integration-unlinked@example.com'),
      (error: unknown) =>
        error instanceof AuthenticationError &&
        error.code === 'IDENTITY_NOT_PROVISIONED' &&
        error.statusCode === 401
    );

    const mapping = await resolveIdentity(
      issuer,
      'auth-integration-unlinked@example.com'
    );
    assert.equal(mapping, null);
  });

  it('rejects an inactive user with HTTP 403', async () => {
    await assert.rejects(
      () => loadAuthContext(issuer, inactiveSubject),
      (error: unknown) =>
        error instanceof AuthenticationError &&
        error.code === 'USER_INACTIVE' &&
        error.statusCode === 403
    );
  });

  it('does not resolve an unknown issuer', async () => {
    await assert.rejects(
      () => loadAuthContext('http://localhost:8080/realms/other', activeSubject),
      (error: unknown) =>
        error instanceof AuthenticationError &&
        error.code === 'IDENTITY_NOT_PROVISIONED'
    );
  });
});
