import { z } from 'zod';
import { isDateOnly } from '../../lib/dateOnly';

/** Integer cents must stay inside a PostgreSQL `integer` column. */
const MAX_CENTS = 2_000_000_000;

const dateString = z.string().refine(isDateOnly, 'Expected a real YYYY-MM-DD date');

/**
 * Accepts a decimal string or number and returns integer cents without going
 * through binary floating point.
 */
const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === 'number' ? String(value) : value.trim()))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Enter a valid amount')
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  })
  .refine((cents) => cents <= MAX_CENTS, 'Amount is too large');

const rateSchema = z
  .number()
  .min(0, 'Rate must be between 0 and 100')
  .max(100, 'Rate must be between 0 and 100')
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6,
    'Rate can have at most two decimals'
  )
  .transform((value) => Math.round(value * 100));

const stateSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, 'State must be a two-letter uppercase code');

interface SlabBounds {
  lowerCents: number;
  upperCents: number | null;
}

function validateContiguousSlabs(
  slabs: SlabBounds[],
  ctx: z.RefinementCtx,
  pathPrefix: string[]
): void {
  if (slabs.length === 0) return;

  if (slabs[0].lowerCents !== 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [...pathPrefix, 0, 'lower'],
      message: 'The first slab must start at zero',
    });
  }

  slabs.forEach((slab, index) => {
    if (slab.upperCents !== null && slab.upperCents <= slab.lowerCents) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, index, 'upper'],
        message: 'Upper bound must be greater than the lower bound',
      });
    }
    if (slab.upperCents === null && index !== slabs.length - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...pathPrefix, index, 'upper'],
        message: 'Only the last slab may be unbounded',
      });
    }
    if (index > 0) {
      const previous = slabs[index - 1];
      if (
        previous.upperCents === null ||
        previous.upperCents !== slab.lowerCents
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [...pathPrefix, index, 'lower'],
          message: 'Slabs must be contiguous with no gaps or overlaps',
        });
      }
    }
  });
}

const taxSlabSchema = z
  .object({
    lower: moneySchema,
    upper: moneySchema.nullable(),
    rate: rateSchema,
  })
  .transform((value) => ({
    lowerCents: value.lower,
    upperCents: value.upper,
    rateBps: value.rate,
  }));

export const taxSlabSetSchema = z
  .object({
    effectiveFrom: dateString,
    slabs: z.array(taxSlabSchema).min(1, 'At least one slab is required'),
  })
  .superRefine((value, ctx) => {
    validateContiguousSlabs(value.slabs, ctx, ['slabs']);
  });

export const statutorySettingsSchema = z
  .object({
    effectiveFrom: dateString,
    standardDeduction: moneySchema,
    rebateThreshold: moneySchema,
    rebateMax: moneySchema,
    cessRate: rateSchema,
    pfEmployeeRate: rateSchema,
    pfWageCeiling: moneySchema,
    esiEmployeeRate: rateSchema,
    esiGrossCeiling: moneySchema,
  })
  .transform((value) => ({
    effectiveFrom: value.effectiveFrom,
    standardDeductionCents: value.standardDeduction,
    rebateThresholdCents: value.rebateThreshold,
    rebateMaxCents: value.rebateMax,
    cessRateBps: value.cessRate,
    pfEmployeeRateBps: value.pfEmployeeRate,
    pfWageCeilingCents: value.pfWageCeiling,
    esiEmployeeRateBps: value.esiEmployeeRate,
    esiGrossCeilingCents: value.esiGrossCeiling,
  }));

const professionalTaxSlabSchema = z
  .object({
    lower: moneySchema,
    upper: moneySchema.nullable(),
    amount: moneySchema,
    februaryAmount: moneySchema.nullable(),
  })
  .transform((value) => ({
    lowerCents: value.lower,
    upperCents: value.upper,
    amountCents: value.amount,
    februaryAmountCents: value.februaryAmount,
  }));

export const professionalTaxSchema = z
  .object({
    state: stateSchema,
    effectiveFrom: dateString,
    slabs: z.array(professionalTaxSlabSchema).min(1, 'At least one slab is required'),
  })
  .superRefine((value, ctx) => {
    validateContiguousSlabs(value.slabs, ctx, ['slabs']);
  });

export const effectiveFromQuerySchema = z.object({
  effectiveFrom: dateString.optional(),
});

export const payrollProfessionalTaxQuerySchema = effectiveFromQuerySchema.extend({
  state: stateSchema,
});

export type TaxSlabSetInput = z.infer<typeof taxSlabSetSchema>;
export type StatutorySettingsInput = z.infer<typeof statutorySettingsSchema>;
export type ProfessionalTaxInput = z.infer<typeof professionalTaxSchema>;
export type EffectiveFromQuery = z.infer<typeof effectiveFromQuerySchema>;
export type PayrollProfessionalTaxQuery = z.infer<
  typeof payrollProfessionalTaxQuerySchema
>;
