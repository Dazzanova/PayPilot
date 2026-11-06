import { Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { logger } from './logger';

const ORGANIZATION_CONTEXT_KEY = 'app.current_organization_id';

/**
 * Runs all protected database work inside one interactive transaction.
 *
 * The tenant setting is transaction-local and is set on the same connection
 * that executes the callback, so pooled connections cannot leak context.
 * Missing or invalid context causes the RLS policies to deny access.
 */
export async function withOrganizationContext<T>(
  organizationId: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  if (!organizationId) {
    throw new Error('Organization ID is required for tenant context');
  }

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        SELECT set_config(${ORGANIZATION_CONTEXT_KEY}, ${organizationId}, true)
      `;

      return callback(tx);
    },
    {
      maxWait: 5000,
      timeout: 30000,
    }
  );
}

export { ORGANIZATION_CONTEXT_KEY };
