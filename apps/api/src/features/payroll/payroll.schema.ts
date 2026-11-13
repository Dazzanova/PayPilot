import { DeductionRuleType, PayrollStatus } from '@prisma/client';
import { z } from 'zod';
import { isDateOnly } from '../../lib/dateOnly';

const dateString = z.string().refine(isDateOnly, 'Expected a real YYYY-MM-DD date');

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const payrollRunIdSchema = z.string().uuid();

export const payrollRunListQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(PayrollStatus).optional(),
  from: dateString.optional(),
  to: dateString.optional(),
});

export const payrollRunCreateSchema = z
  .object({
    periodStart: dateString,
    periodEnd: dateString,
    payDate: dateString,
  })
  .superRefine((value, ctx) => {
    if (value.periodEnd < value.periodStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodEnd'],
        message: 'Period end must be on or after period start',
      });
    }
    if (value.payDate < value.periodEnd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payDate'],
        message: 'Pay date must be on or after period end',
      });
    }
  });

export const payrollRunVoidSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

const deductionRuleFields = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.nativeEnum(DeductionRuleType),
  value: z.coerce.number().positive(),
  taxable: z.boolean(),
  active: z.boolean(),
});

export const deductionRuleCreateSchema = deductionRuleFields
  .extend({
    taxable: z.boolean().default(true),
    active: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === DeductionRuleType.RATE && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Rate must be between 0 and 100',
      });
    }
  });

export const deductionRuleUpdateSchema = deductionRuleFields
  .partial()
  .superRefine((value, ctx) => {
    if (value.type === DeductionRuleType.RATE && value.value !== undefined && value.value > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['value'],
        message: 'Rate must be between 0 and 100',
      });
    }
  });

export type PayrollRunListQuery = z.infer<typeof payrollRunListQuerySchema>;
export type PayrollRunCreateInput = z.infer<typeof payrollRunCreateSchema>;
export type PayrollRunVoidInput = z.infer<typeof payrollRunVoidSchema>;
export type DeductionRuleCreateInput = z.infer<typeof deductionRuleCreateSchema>;
export type DeductionRuleUpdateInput = z.infer<typeof deductionRuleUpdateSchema>;
