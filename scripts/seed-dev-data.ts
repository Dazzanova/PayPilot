#!/usr/bin/env tsx

import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', description: 'Software development, cloud infrastructure, and QA' },
  { name: 'Product & Design', code: 'PROD', description: 'Product strategy, UX/UI design, and user research' },
  { name: 'Sales & Marketing', code: 'S&M', description: 'Enterprise sales, demand generation, and marketing' },
  { name: 'Human Resources', code: 'HR', description: 'Talent acquisition, employee relations, and compliance' },
  { name: 'Operations & Finance', code: 'OPS', description: 'Financial management, payroll, accounting, and legal' },
  { name: 'Customer Success', code: 'CS', description: 'Client onboarding, technical support, and retention' },
];

async function main() {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL is required to seed development data');
  }

  const slug = process.env.SEED_ORGANIZATION_SLUG ?? 'paypilot-demo';
  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

  try {
    const organization = await prisma.organization.findUnique({ where: { slug } });
    if (!organization) {
      throw new Error(
        `Organization "${slug}" not found. Run "npm run provision:user" first or set SEED_ORGANIZATION_SLUG.`
      );
    }

    for (const department of DEPARTMENTS) {
      await prisma.department.upsert({
        where: {
          organizationId_code: {
            organizationId: organization.id,
            code: department.code,
          },
        },
        update: { name: department.name, description: department.description },
        create: { organizationId: organization.id, ...department },
      });
    }

    console.log(
      `Seeded ${DEPARTMENTS.length} departments for ${organization.name} (${organization.id}).`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
