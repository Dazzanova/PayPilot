import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny, z } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { AuthenticatedRequest } from '../../types/auth';
import {
  deductionRuleCreateSchema,
  deductionRuleUpdateSchema,
  payrollRunIdSchema,
} from './payroll.schema';
import {
  createDeductionRule,
  deleteDeductionRule,
  listDeductionRules,
  updateDeductionRule,
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
export function createPayrollRunsRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...READ_ROLES));
  return router;
}

export function createPayslipsRouter(authMiddleware: RequestHandler = requireAuth): Router {
  const router = Router();
  router.use(authMiddleware);
  return router;
}
