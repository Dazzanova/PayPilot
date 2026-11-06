import { RequestHandler, Router } from 'express';
import { ZodTypeAny } from 'zod';
import { UserRole } from '@prisma/client';
import { requireAuth, requireRole, tenantRouteHandler } from '../middleware/auth';
import { AuthenticatedRequest } from '../types/auth';
import { HttpError } from '../lib/httpError';
import {
  employeeCreateSchema,
  employeeIdSchema,
  employeeListQuerySchema,
  employeeStatusSchema,
  employeeUpdateSchema,
} from './employees.schema';
import {
  changeEmployeeStatus,
  createEmployee,
  getEmployee,
  listEmployees,
  updateEmployee,
} from './employees.service';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

function parse<T extends ZodTypeAny>(schema: T, value: unknown): ReturnType<T['parse']> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
    );
  }
  return result.data;
}

function actor(req: AuthenticatedRequest): { organizationId: string; userId: string } {
  if (!req.auth) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Authentication required');
  }
  return { organizationId: req.auth.organization.id, userId: req.auth.user.id };
}

/**
 * The authentication middleware is injectable so route behavior can be tested
 * over real HTTP without a Keycloak round trip. Production uses `requireAuth`.
 */
export function createEmployeesRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();

  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(employeeListQuerySchema, req.query);
      const result = await listEmployees(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

  router.get(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(employeeIdSchema, req.params.id);
      const employee = await getEmployee(tx, organizationId, id);
      return { body: { success: true, data: { employee } } };
    })
  );

  router.post(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(employeeCreateSchema, req.body);
      const employee = await createEmployee(tx, organizationId, userId, input);
      return {
        status: 201,
        location: `/api/employees/${employee.id}`,
        body: { success: true, data: { employee } },
      };
    })
  );

  router.patch(
    '/:id/status',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(employeeIdSchema, req.params.id);
      const { status } = parse(employeeStatusSchema, req.body);
      const employee = await changeEmployeeStatus(
        tx,
        organizationId,
        userId,
        id,
        status
      );
      return { body: { success: true, data: { employee } } };
    })
  );

  router.patch(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(employeeIdSchema, req.params.id);
      const input = parse(employeeUpdateSchema, req.body);
      const employee = await updateEmployee(tx, organizationId, userId, id, input);
      return { body: { success: true, data: { employee } } };
    })
  );

  return router;
}

export const employeesRouter = createEmployeesRouter();
