import { AttendanceStatus } from '@prisma/client';
import { z } from 'zod';
import { isDateOnly } from '../../lib/dateOnly';

const dateString = z.string().refine(isDateOnly, 'Expected a real YYYY-MM-DD date');
const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const attendanceListQuerySchema = paginationSchema.extend({
  workDate: dateString.optional(),
  from: dateString.optional(),
  to: dateString.optional(),
  employeeId: z.string().uuid().optional(),
  status: z.nativeEnum(AttendanceStatus).optional(),
});

export const attendancePunchSchema = z.object({
  action: z.enum(['in', 'out']),
  workDate: dateString.optional(),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const attendanceUpsertSchema = z
  .object({
    employeeId: z.string().uuid(),
    workDate: dateString,
    status: z.nativeEnum(AttendanceStatus),
    checkInTime: z.string().datetime().optional().nullable(),
    checkOutTime: z.string().datetime().optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.checkInTime && value.checkOutTime && new Date(value.checkOutTime) <= new Date(value.checkInTime)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['checkOutTime'], message: 'Check-out time must be after check-in time' });
    }
  });

export type AttendanceListQuery = z.infer<typeof attendanceListQuerySchema>;
export type AttendancePunchInput = z.infer<typeof attendancePunchSchema>;
export type AttendanceUpsertInput = z.infer<typeof attendanceUpsertSchema>;
