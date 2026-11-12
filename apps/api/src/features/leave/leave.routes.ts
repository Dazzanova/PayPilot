import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny, z } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import {
  leaveRequestsCreatedTotal,
  leaveReviewsTotal,
  onRequestSuccess,
} from '../../lib/metrics';
import { AuthenticatedRequest } from '../../types/auth';
import { leaveCreateSchema, leaveListQuerySchema, leaveReviewSchema } from './leave.schema';
import { createLeaveRequest, listLeaveRequests, reviewLeaveRequest } from './leave.service';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;
const ALL_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER, UserRole.MANAGER, UserRole.EMPLOYEE] as const;

function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T['parse']> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  return result.data;
}

function actor(req: AuthenticatedRequest) {
  if (!req.auth) throw new HttpError(401, 'NOT_AUTHENTICATED', 'Authentication required');
  return { organizationId: req.auth.organization.id, userId: req.auth.user.id, role: req.auth.user.role };
}

export function createLeaveRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get(
    '/',
    requireRole(...ALL_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId, role } = actor(req);
      const query = parse(leaveListQuerySchema, req.query);
      if (!HR_ROLES.includes(role as (typeof HR_ROLES)[number])) {
        const employee = await tx.employee.findFirst({ where: { organizationId, userId }, select: { id: true } });
        if (!employee) return { body: { success: true, data: { requests: [], pagination: { page: 1, pageSize: query.pageSize, total: 0, totalPages: 1 }, summary: { pending: 0, approved: 0, rejected: 0, cancelled: 0 } } } };
        query.employeeId = employee.id;
      }
      const result = await listLeaveRequests(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

  router.post(
    '/',
    requireRole(...ALL_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(leaveCreateSchema, req.body);
      const request = await createLeaveRequest(tx, organizationId, userId, input);
      onRequestSuccess(req, () =>
        leaveRequestsCreatedTotal.inc({ leave_type: input.leaveType })
      );
      return { status: 201, body: { success: true, data: { request } } };
    })
  );

  router.patch(
    '/:id/review',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const idResult = z.string().uuid().safeParse(req.params.id);
      if (!idResult.success) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid leave request id');
      }
      const input = parse(leaveReviewSchema, req.body);
      const request = await reviewLeaveRequest(tx, organizationId, userId, idResult.data, input);
      onRequestSuccess(req, () =>
        leaveReviewsTotal.inc({ decision: input.action })
      );
      return { body: { success: true, data: { request } } };
    })
  );

  return router;
}

export const leaveRouter = createLeaveRouter();
