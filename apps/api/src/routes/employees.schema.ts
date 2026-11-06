import { z } from 'zod';
import { EmployeeStatus, EmploymentType } from '@prisma/client';

const MIN_JOIN_DATE = '1900-01-01';

const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Invalid calendar date')
  .refine((value) => value >= MIN_JOIN_DATE, 'Date is too far in the past')
  .refine((value) => {
    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    )
      .toISOString()
      .slice(0, 10);
    return value <= today;
  }, 'Joined date cannot be in the future');

const baseSalarySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Enter a valid salary')
  .refine(
    (value) => Number(value) > 0 && Number(value) <= 9_999_999_999.99,
    'Salary must be greater than zero and fit 12 digits with 2 decimals'
  );

const employeeFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z
    .union([z.string(), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) {
        return undefined;
      }
      if (value === null) {
        return null;
      }
      const trimmed = value.trim();
      return trimmed === '' ? null : trimmed;
    })
    .refine(
      (value) => value === undefined || value === null || value.length <= 30,
      'Phone must be 30 characters or fewer'
    )
    .refine(
      (value) =>
        value === undefined || value === null || /^[+0-9 ().-]+$/.test(value),
      'Phone contains unsupported characters'
    ),
  jobTitle: z.string().trim().min(1).max(120),
  departmentId: z.string().uuid().nullable().optional(),
  employmentType: z.nativeEnum(EmploymentType),
  joinedAt: dateOnlySchema,
  baseSalary: baseSalarySchema,
};

export const employeeCreateSchema = z.object(employeeFields).strict();

export const employeeUpdateSchema = z
  .object(employeeFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const employeeStatusSchema = z
  .object({ status: z.nativeEnum(EmployeeStatus) })
  .strict();

export const employeeListQuerySchema = z
  .object({
    page: z.coerce.number().int().catch(1).transform((value) => Math.max(1, value)),
    pageSize: z.coerce
      .number()
      .int()
      .catch(25)
      .transform((value) => Math.min(100, Math.max(1, value))),
    search: z.string().trim().max(100).optional(),
    departmentId: z.string().uuid().optional(),
    status: z.nativeEnum(EmployeeStatus).optional(),
    sort: z.enum(['lastName', 'joinedAt', 'employeeNumber', 'createdAt']).catch('lastName'),
    order: z.enum(['asc', 'desc']).catch('asc'),
  });

export const employeeIdSchema = z.string().uuid();

export type EmployeeCreateInput = z.infer<typeof employeeCreateSchema>;
export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;
export type EmployeeListQuery = z.infer<typeof employeeListQuerySchema>;
