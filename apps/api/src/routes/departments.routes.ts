import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { requireAuth, requireRole, tenantRouteHandler } from '../middleware/auth';
import { HttpError } from '../lib/httpError';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

/**
 * The authentication middleware is injectable so route behavior can be tested
 * over real HTTP without a Keycloak round trip. Production uses `requireAuth`.
 */
export function createDepartmentsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();

  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const organizationId = req.auth?.organization.id;

      if (!organizationId) {
        throw new HttpError(401, 'NO_TENANT_CONTEXT', 'Tenant context is required');
      }

      const departments = await tx.department.findMany({
        where: { organizationId },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, code: true, description: true },
      });

      return { body: { success: true, data: { departments } } };
    })
  );

  return router;
}

export const departmentsRouter = createDepartmentsRouter();
