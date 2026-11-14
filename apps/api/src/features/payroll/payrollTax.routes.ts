import { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny, z } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { AuthenticatedRequest } from '../../types/auth';
import {
  effectiveFromQuerySchema,
  payrollProfessionalTaxQuerySchema,
  professionalTaxSchema,
  statutorySettingsSchema,
  taxSlabSetSchema,
} from './payrollTax.schema';
import {
  listProfessionalTax,
  listStatutorySettings,
  listTaxSlabs,
  saveProfessionalTax,
  saveStatutorySettings,
  saveTaxSlabs,
} from './payrollTax.service';

const HR_ROLES = [UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.HR_MANAGER] as const;

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
  };
}

export function createPayrollTaxSlabsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(effectiveFromQuerySchema, req.query);
      const taxSlabs = await listTaxSlabs(tx, organizationId, query.effectiveFrom);
      return { body: { success: true, data: { taxSlabs } } };
    })
  );

  router.put(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(taxSlabSetSchema, req.body);
      const taxSlabs = await saveTaxSlabs(tx, organizationId, userId, input);
      return { body: { success: true, data: { taxSlabs } } };
    })
  );

  return router;
}

export function createPayrollStatutorySettingsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(effectiveFromQuerySchema, req.query);
      const statutorySettings = await listStatutorySettings(
        tx,
        organizationId,
        query.effectiveFrom
      );
      return { body: { success: true, data: { statutorySettings } } };
    })
  );

  router.put(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(statutorySettingsSchema, req.body);
      const statutorySettings = await saveStatutorySettings(
        tx,
        organizationId,
        userId,
        input
      );
      return { body: { success: true, data: { statutorySettings } } };
    })
  );

  return router;
}

export function createPayrollProfessionalTaxRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(payrollProfessionalTaxQuerySchema, req.query);
      const professionalTax = await listProfessionalTax(
        tx,
        organizationId,
        query.state,
        query.effectiveFrom
      );
      return { body: { success: true, data: { professionalTax } } };
    })
  );

  router.put(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      const input = parse(professionalTaxSchema, req.body);
      const professionalTax = await saveProfessionalTax(
        tx,
        organizationId,
        userId,
        input
      );
      return { body: { success: true, data: { professionalTax } } };
    })
  );

  return router;
}

export const payrollTaxSlabsRouter = createPayrollTaxSlabsRouter();
export const payrollStatutorySettingsRouter = createPayrollStatutorySettingsRouter();
export const payrollProfessionalTaxRouter = createPayrollProfessionalTaxRouter();
