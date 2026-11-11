import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { attendancePunchesTotal, onRequestSuccess } from '../../lib/metrics';
import { AuthenticatedRequest } from '../../types/auth';
import { attendanceListQuerySchema, attendancePunchSchema, attendanceUpsertSchema } from './attendance.schema';
import { listAttendance, punchAttendance, upsertAttendance } from './attendance.service';

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

export function createAttendanceRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get(
    '/',
    requireRole(...ALL_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId, role } = actor(req);
      const query = parse(attendanceListQuerySchema, req.query);
      // Employees/managers see only their own linked employee records unless they are HR+.
      if (!HR_ROLES.includes(role as (typeof HR_ROLES)[number])) {
        const employee = await tx.employee.findFirst({ where: { organizationId, userId }, select: { id: true } });
        if (!employee) return { body: { success: true, data: { records: [], pagination: { page: 1, pageSize: query.pageSize, total: 0, totalPages: 1 }, summary: { present: 0, remote: 0, halfDay: 0, onLeave: 0, absent: 0 } } } };
        query.employeeId = employee.id;
      }
      const result = await listAttendance(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

  router.post(
    '/punch',
    requireRole(...ALL_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(attendancePunchSchema, req.body);
      const record = await punchAttendance(tx, organizationId, userId, input);
      onRequestSuccess(req, () =>
        attendancePunchesTotal.inc({ action: input.action })
      );
      return { body: { success: true, data: { record } } };
    })
  );

  router.post(
    '/records',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(attendanceUpsertSchema, req.body);
      const record = await upsertAttendance(tx, organizationId, userId, input);
      return { status: 201, body: { success: true, data: { record } } };
    })
  );

  return router;
}

export const attendanceRouter = createAttendanceRouter();
