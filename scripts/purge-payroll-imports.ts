#!/usr/bin/env tsx

import path from 'node:path';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { deleteImportFileQuietly } from '../apps/api/src/features/payrollImport/storage';

// Resolve relative to the repository root, not the caller's working directory.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

/**
 * Idempotently remove raw payroll-register files whose retention window has
 * elapsed. Batch metadata, imported records, and findings are kept; only the
 * private raw file is deleted and its storage key cleared.
 *
 * Uses the migrator connection because it scans across every tenant and the
 * runtime role has no delete policy on payroll imports.
 */
async function main() {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error('DIRECT_URL is required to purge expired payroll imports');
  }

  const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });
  const now = new Date();

  try {
    const expired = await prisma.payrollImportBatch.findMany({
      where: { retentionUntil: { lt: now }, storageKey: { not: null } },
      select: { id: true, storageKey: true },
    });

    let removed = 0;
    for (const batch of expired) {
      if (!batch.storageKey) continue;

      await deleteImportFileQuietly(batch.storageKey);
      await prisma.payrollImportBatch.update({
        where: { id: batch.id },
        data: { storageKey: null, filePurgedAt: now },
      });
      removed += 1;
    }

    console.log(`Purged ${removed} expired payroll import file(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
