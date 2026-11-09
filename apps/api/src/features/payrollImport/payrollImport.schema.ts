import { z } from 'zod';
import { PayrollImportStatus, ValidationSeverity } from '@prisma/client';

const pageSchema = z.coerce
  .number()
  .int()
  .catch(1)
  .transform((value) => Math.min(10_000, Math.max(1, value)));

const pageSizeSchema = z.coerce
  .number()
  .int()
  .catch(25)
  .transform((value) => Math.min(100, Math.max(1, value)));

export const payrollImportListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  status: z.nativeEnum(PayrollImportStatus).optional(),
});

export const importedRecordListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  valid: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const findingListQuerySchema = z.object({
  page: pageSchema,
  pageSize: pageSizeSchema,
  severity: z.nativeEnum(ValidationSeverity).optional(),
  ruleCode: z.string().trim().max(64).optional(),
});

export const payrollImportIdSchema = z.string().uuid();

export type PayrollImportListQuery = z.infer<typeof payrollImportListQuerySchema>;
export type ImportedRecordListQuery = z.infer<typeof importedRecordListQuerySchema>;
export type FindingListQuery = z.infer<typeof findingListQuerySchema>;
