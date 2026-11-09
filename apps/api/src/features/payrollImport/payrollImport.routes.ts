import express, { RequestHandler, Router } from 'express';
import { UserRole } from '@prisma/client';
import { ZodTypeAny, z } from 'zod';
import { requireAuth, requireRole, tenantRouteHandler } from '../../middleware/auth';
import { HttpError } from '../../lib/httpError';
import { AuthenticatedRequest } from '../../types/auth';
import { MAX_FILE_BYTES } from './payrollImport.types';
import {
  findingListQuerySchema,
  importedRecordListQuerySchema,
  payrollImportIdSchema,
  payrollImportListQuerySchema,
} from './payrollImport.schema';
import {
  buildExceptionReportRows,
  getPayrollImport,
  importPayrollCsv,
  listFindings,
  listImportedRecords,
  listPayrollImports,
} from './payrollImport.service';
import { buildExceptionReportCsv } from './export';

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
  return { organizationId: req.auth.organization.id, userId: req.auth.user.id };
}

function decodeFilename(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function createPayrollImportsRouter(
  authMiddleware: RequestHandler = requireAuth
): Router {
  const router = Router();
  router.use(authMiddleware, requireRole(...HR_ROLES));

  router.get(
    '/',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const query = parse(payrollImportListQuerySchema, req.query);
      const result = await listPayrollImports(tx, organizationId, query);
      return { body: { success: true, data: result } };
    })
  );

  router.post(
    '/',
    express.raw({ type: ['text/csv', 'application/csv'], limit: MAX_FILE_BYTES }),
    tenantRouteHandler(async (req, tx) => {
      const { organizationId, userId } = actor(req);
      if (!Buffer.isBuffer(req.body)) {
        throw new HttpError(
          400,
          'CSV_BODY_REQUIRED',
          'Send the payroll register as a text/csv request body'
        );
      }

      const batch = await importPayrollCsv(tx, {
        organizationId,
        userId,
        filename: decodeFilename(req.header('x-file-name')),
        buffer: req.body,
      });

      return {
        status: 201,
        location: `/api/payroll-imports/${batch.id}`,
        body: { success: true, data: { batch } },
      };
    })
  );

  router.get(
    '/:id/records',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const query = parse(importedRecordListQuerySchema, req.query);
      const result = await listImportedRecords(tx, organizationId, id, query);
      return { body: { success: true, data: result } };
    })
  );

  router.get(
    '/:id/findings',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const query = parse(findingListQuerySchema, req.query);
      const result = await listFindings(tx, organizationId, id, query);
      return { body: { success: true, data: result } };
    })
  );

  router.get(
    '/:id/exception-report',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const rows = await buildExceptionReportRows(tx, organizationId, id);
      return {
        file: {
          content: buildExceptionReportCsv(rows),
          contentType: 'text/csv; charset=utf-8',
          filename: `payroll-exceptions-${id}.csv`,
        },
      };
    })
  );

  router.get(
    '/:id',
    tenantRouteHandler(async (req, tx) => {
      const { organizationId } = actor(req);
      const id = parse(payrollImportIdSchema, req.params.id);
      const batch = await getPayrollImport(tx, organizationId, id);
      return { body: { success: true, data: { batch } } };
    })
  );

  return router;
}

export const payrollImportsRouter = createPayrollImportsRouter();
