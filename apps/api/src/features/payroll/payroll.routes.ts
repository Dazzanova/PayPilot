import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny, z } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { AuthenticatedRequest } from '../../types/auth';
import {
  deductionRuleCreateSchema,
  deductionRuleUpdateSchema,
  payrollRunCreateSchema,
  payrollRunIdSchema,
  payrollRunListQuerySchema,
  payrollRunVoidSchema,
} from './payroll.schema';
import {
  approvePayrollRun,
  calculatePayrollRun,
  createDeductionRule,
  createPayrollRun,
  deleteDeductionRule,
  getPayrollRun,
  listDeductionRules,
  listPayrollRuns,
  payPayrollRun,
  updateDeductionRule,
  voidPayrollRun,
} from './payroll.service';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;
const READ_ROLES = [UserRole.MANAGER, ...HR_ROLES] as const;

function parse<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
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

function actor(req: AuthenticatedRequest) {
  if (!req.auth) {
    throw new HttpError(401, 'NOT_AUTHENTICATED', 'Authentication required');
  }
  return {
    organizationId: req.auth.organization.id,
    userId: req.auth.user.id,
    role: req.auth.user.role,
  };
}

export function createDeductionRulesRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const rules = await listDeductionRules(tx, organizationId);
      return { body: { success: true, data: { rules } } };
    })
  );

  router.post(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(deductionRuleCreateSchema, req.body);
      const rule = await createDeductionRule(tx, organizationId, userId, input);
      return { status: 201, body: { success: true, data: { rule } } };
    })
  );

  router.patch(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const input = parse(deductionRuleUpdateSchema, req.body);
      const rule = await updateDeductionRule(tx, organizationId, userId, id, input);
      return { body: { success: true, data: { rule } } };
    })
  );

  router.delete(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      await deleteDeductionRule(tx, organizationId, userId, id);
      return { body: { success: true, data: { deleted: true } } };
    })
  );

  return router;
}

export const payrollDeductionRulesRouter = createDeductionRulesRouter();

// Placeholder factories are replaced in later tasks.
export function createPayrollRunsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware);

  router.get(
    '/',
    requireRole(...READ_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(payrollRunListQuerySchema, req.query);
      const result = await listPayrollRuns(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

  router.post(
    '/',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(payrollRunCreateSchema, req.body);
      const run = await createPayrollRun(tx, organizationId, userId, input);
      return { status: 201, body: { success: true, data: { run } } };
    })
  );

  router.post(
    '/:id/calculate',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await calculatePayrollRun(tx, organizationId, userId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  router.post(
    '/:id/approve',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await approvePayrollRun(tx, organizationId, userId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  router.post(
    '/:id/pay',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await payPayrollRun(tx, organizationId, userId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  router.post(
    '/:id/void',
    requireRole(...HR_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const input = parse(payrollRunVoidSchema, req.body);
      const run = await voidPayrollRun(tx, organizationId, userId, id, input.reason);
      return { body: { success: true, data: { run } } };
    })
  );

  router.get(
    '/:id',
    requireRole(...READ_ROLES),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollRunIdSchema, req.params.id);
      const run = await getPayrollRun(tx, organizationId, id);
      return { body: { success: true, data: { run } } };
    })
  );

  return router;
}

export function createPayslipsRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware);
  return router;
}
