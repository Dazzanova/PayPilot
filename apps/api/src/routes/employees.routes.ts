import { Response, Router } from 'express';
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

export const employeesRouter = Router();

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

employeesRouter.use(requireAuth, requireRole(...HR_ROLES));

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

employeesRouter.get(
  '/',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId } = actor(req);
    const query = parse(employeeListQuerySchema, req.query);
    const result = await listEmployees(tx, organizationId, query);
    res.json({ success: true, data: result });
  })
);

employeesRouter.get(
  '/:id',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId } = actor(req);
    const id = parse(employeeIdSchema, req.params.id);
    const employee = await getEmployee(tx, organizationId, id);
    res.json({ success: true, data: { employee } });
  })
);

employeesRouter.post(
  '/',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId, userId } = actor(req);
    const input = parse(employeeCreateSchema, req.body);
    const employee = await createEmployee(tx, organizationId, userId, input);
    res.status(201).location(`/api/employees/${employee.id}`).json({
      success: true,
      data: { employee },
    });
  })
);

employeesRouter.patch(
  '/:id/status',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId, userId } = actor(req);
    const id = parse(employeeIdSchema, req.params.id);
    const { status } = parse(employeeStatusSchema, req.body);
    const employee = await changeEmployeeStatus(tx, organizationId, userId, id, status);
    res.json({ success: true, data: { employee } });
  })
);

employeesRouter.patch(
  '/:id',
  tenantRouteHandler(async (req: AuthenticatedRequest, res: Response, tx) => {
    const { organizationId, userId } = actor(req);
    const id = parse(employeeIdSchema, req.params.id);
    const input = parse(employeeUpdateSchema, req.body);
    const employee = await updateEmployee(tx, organizationId, userId, id, input);
    res.json({ success: true, data: { employee } });
  })
);
