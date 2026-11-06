#!/usr/bin/env tsx

import path from 'path';
import dotenv from 'dotenv';
import { PrismaClient, UserRole } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Controlled development provisioning.
 *
 * Creates or finds a Keycloak user, then links that exact Keycloak subject to
 * an existing PayPilot user (or creates a new PayPilot user and organization).
 * It never links accounts by matching email at authentication time.
 *
 * Usage:
 *   npm run provision:user -- --email admin@company.com --org-name "Acme" --role ADMIN
 *   npm run provision:user -- --email admin@company.com --identity-subject <keycloak-sub>
 */

interface ProvisionOptions {
  email: string;
  organizationName?: string;
  role: UserRole;
  identitySubject?: string;
  keycloakUsername: string;
  issuer: string;
}

interface KeycloakUser {
  id: string;
  username: string;
  email?: string;
}

function parseArgs(): ProvisionOptions {
  const args = process.argv.slice(2);
  const values: Record<string, string> = {};
  const flags = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--reset-password') {
      flags.add(arg);
      continue;
    }

    if (!arg.startsWith('--')) {
      continue;
    }

    const value = args[i + 1];
    if (!value || value.startsWith('--')) {
      console.error(`Missing value for ${arg}`);
      process.exit(1);
    }

    values[arg.slice(2)] = value;
    i++;
  }

  const email = values.email;
  if (!email) {
    console.error(
      'Usage: npm run provision:user -- --email <email> [--org-name <name>] [--role <role>] [--identity-subject <subject>] [--keycloak-username <username>]\n'
    );
    process.exit(1);
  }

  const roleArg = values.role ?? UserRole.EMPLOYEE;
  if (!Object.values(UserRole).includes(roleArg as UserRole)) {
    console.error(`Invalid role: ${roleArg}`);
    console.error(`Valid roles: ${Object.values(UserRole).join(', ')}`);
    process.exit(1);
  }

  const keycloakUrl =
    process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  const realm = process.env.KEYCLOAK_REALM ?? 'paypilot';
  const issuer =
    values.issuer ??
    process.env.KEYCLOAK_ISSUER ??
    `${keycloakUrl.replace(/\/$/, '')}/realms/${realm}`;

  return {
    email,
    organizationName: values['org-name'],
    role: roleArg as UserRole,
    identitySubject: values['identity-subject'],
    keycloakUsername: values['keycloak-username'] ?? email,
    issuer,
  };
}

async function getKeycloakAdminToken(): Promise<string> {
  const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  const username = process.env.KEYCLOAK_ADMIN_USER;
  const password = process.env.KEYCLOAK_ADMIN_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'KEYCLOAK_ADMIN_USER and KEYCLOAK_ADMIN_PASSWORD are required to create a Keycloak user'
    );
  }

  const response = await fetch(
    `${keycloakUrl.replace(/\/$/, '')}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username,
        password,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Keycloak admin authentication failed with HTTP ${response.status}`
    );
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Keycloak admin authentication returned no access token');
  }

  return data.access_token;
}

async function findKeycloakUser(
  token: string,
  username: string
): Promise<KeycloakUser | null> {
  const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  const realm = process.env.KEYCLOAK_REALM ?? 'paypilot';
  const response = await fetch(
    `${keycloakUrl.replace(/\/$/, '')}/admin/realms/${realm}/users?username=${encodeURIComponent(
      username
    )}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!response.ok) {
    throw new Error(`Keycloak user lookup failed with HTTP ${response.status}`);
  }

  const users = (await response.json()) as KeycloakUser[];
  return users.find((user) => user.username === username) ?? null;
}

async function createKeycloakUser(
  token: string,
  options: ProvisionOptions
): Promise<KeycloakUser> {
  const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
  const realm = process.env.KEYCLOAK_REALM ?? 'paypilot';
  const password = process.env.KEYCLOAK_DEV_USER_PASSWORD;

  if (!password) {
    throw new Error(
      'KEYCLOAK_DEV_USER_PASSWORD is required to create a development Keycloak user'
    );
  }

  const response = await fetch(
    `${keycloakUrl.replace(/\/$/, '')}/admin/realms/${realm}/users`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: options.keycloakUsername,
        email: options.email,
        firstName: 'PayPilot',
        lastName: 'User',
        enabled: true,
        emailVerified: true,
      }),
    }
  );

  if (!response.ok) {
    throw new Error(
      `Keycloak user creation failed with HTTP ${response.status}: ${await response.text()}`
    );
  }

  const created = await findKeycloakUser(token, options.keycloakUsername);
  if (!created) {
    throw new Error('Created Keycloak user could not be read back');
  }

  const passwordResponse = await fetch(
    `${keycloakUrl.replace(/\/$/, '')}/admin/realms/${realm}/users/${created.id}/reset-password`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'password',
        value: password,
        temporary: false,
      }),
    }
  );

  if (!passwordResponse.ok) {
    throw new Error(
      `Keycloak password setup failed with HTTP ${passwordResponse.status}`
    );
  }

  return created;
}

async function resolveKeycloakSubject(options: ProvisionOptions): Promise<string> {
  if (options.identitySubject) {
    return options.identitySubject;
  }

  const token = await getKeycloakAdminToken();
  const existing = await findKeycloakUser(token, options.keycloakUsername);

  if (existing) {
    console.log(`Keycloak user already exists: ${existing.username}`);
    return existing.id;
  }

  const created = await createKeycloakUser(token, options);
  console.log(`Created Keycloak user: ${created.username}`);
  return created.id;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function provision() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'This development provisioning script refuses to run in production'
    );
  }

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL is required for controlled provisioning');
  }

  const options = parseArgs();
  const subject = await resolveKeycloakSubject(options);

  const prisma = new PrismaClient({
    datasources: { db: { url: directUrl } },
  });

  try {
    const identityOwner = await prisma.user.findUnique({
      where: {
        identityIssuer_identitySubject: {
          identityIssuer: options.issuer,
          identitySubject: subject,
        },
      },
    });

    if (identityOwner && identityOwner.email !== options.email) {
      throw new Error(
        `This Keycloak identity is already linked to ${identityOwner.email}`
      );
    }

    let user = await prisma.user.findUnique({
      where: { email: options.email },
      include: { organization: true },
    });

    if (user) {
      if (
        user.identitySubject &&
        (user.identityIssuer !== options.issuer ||
          user.identitySubject !== subject)
      ) {
        throw new Error(
          `User ${user.email} is already linked to a different identity. Refusing to overwrite.`
        );
      }

      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          identityIssuer: options.issuer,
          identitySubject: subject,
          role: options.role,
        },
        include: { organization: true },
      });

      console.log(`Linked existing PayPilot user: ${user.email}`);
    } else {
      if (!options.organizationName) {
        throw new Error(
          '--org-name is required when creating a new PayPilot user'
        );
      }

      const slug = slugify(options.organizationName);
      let organization = await prisma.organization.findFirst({
        where: { slug },
      });

      if (!organization) {
        organization = await prisma.organization.create({
          data: {
            name: options.organizationName,
            slug,
            currency: 'USD',
            timezone: 'UTC',
          },
        });
        console.log(`Created organization: ${organization.name}`);
      }

      user = await prisma.user.create({
        data: {
          organizationId: organization.id,
          identityIssuer: options.issuer,
          identitySubject: subject,
          email: options.email,
          role: options.role,
          isActive: true,
        },
        include: { organization: true },
      });

      console.log(`Created PayPilot user: ${user.email}`);
    }

    console.log('\nProvisioning complete');
    console.log(`  PayPilot user: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Organization: ${user.organization.name}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Identity issuer: ${options.issuer}`);
    console.log(`  Identity subject: ${subject}`);
  } finally {
    await prisma.$disconnect();
  }
}

provision().catch((error) => {
  console.error('Provisioning failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
