import { LeaveStatus, LeaveType } from '@prisma/client';
import { z } from 'zod';
import { isDateOnly } from '../../lib/dateOnly';

const dateString = z.string().refine(isDateOnly, 'Expected a real YYYY-MM-DD date');
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const leaveListQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(LeaveStatus).optional(),
  employeeId: z.string().uuid().optional(),
});

export const leaveCreateSchema = z
  .object({
    leaveType: z.nativeEnum(LeaveType),
    startDate: dateString,
    endDate: dateString,
    reason: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be on or after start date' });
    }
  });

export const leaveReviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
});

export type LeaveListQuery = z.infer<typeof leaveListQuerySchema>;
export type LeaveCreateInput = z.infer<typeof leaveCreateSchema>;
export type LeaveReviewInput = z.infer<typeof leaveReviewSchema>;
