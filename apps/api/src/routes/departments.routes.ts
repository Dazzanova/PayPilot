import { Response, Router } from 'express';
import { UserRole } from '@prisma/client';
import { requireAuth, requireRole, tenantRouteHandler } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/auth';

export const departmentsRouter = Router();

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

departmentsRouter.use(requireAuth, requireRole(...HR_ROLES));

departmentsRouter.get(
  '/',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const organizationId = req.auth?.organization.id;
    if (!organizationId) {
      res.status(401).json({
        success: false,
        error: { code: 'NO_TENANT_CONTEXT', message: 'Tenant context is required' },
      });
      return;
    }

    const departments = await tx.department.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, code: true, description: true },
    });

    res.json({ success: true, data: { departments } });
  })
);
