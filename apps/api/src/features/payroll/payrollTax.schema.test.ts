import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  payrollProfessionalTaxQuerySchema,
  professionalTaxSchema,
  statutorySettingsSchema,
  taxSlabSetSchema,
} from './payrollTax.schema';

const TAX_SLABS = [
  { lower: '0.00', upper: '400000.00', rate: 0 },
  { lower: '400000.00', upper: '800000.00', rate: 5 },
  { lower: '800000.00', upper: null, rate: 10 },
];

describe('taxSlabSetSchema', () => {
  it('transforms money to cents and rates to basis points', () => {
    const parsed = taxSlabSetSchema.parse({
      effectiveFrom: '2025-04-01',
      slabs: TAX_SLABS,
    });

    assert.equal(parsed.effectiveFrom, '2025-04-01');
    assert.deepEqual(parsed.slabs, [
      { lowerCents: 0, upperCents: 40_000_000, rateBps: 0 },
      { lowerCents: 40_000_000, upperCents: 80_000_000, rateBps: 500 },
      { lowerCents: 80_000_000, upperCents: null, rateBps: 1000 },
    ]);
  });

  it('rejects a set that does not start at zero', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [
        { lower: '1.00', upper: null, rate: 0 },
      ],
    });
    assert.equal(result.success, false);
  });

  it('rejects a gap between slabs', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [
        { lower: '0.00', upper: '400000.00', rate: 0 },
        { lower: '500000.00', upper: null, rate: 5 },
      ],
    });
    assert.equal(result.success, false);
  });

  it('rejects an overlap between slabs', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [
        { lower: '0.00', upper: '400000.00', rate: 0 },
        { lower: '300000.00', upper: null, rate: 5 },
      ],
    });
    assert.equal(result.success, false);
  });

  it('rejects a null upper bound before the last slab', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [
        { lower: '0.00', upper: null, rate: 0 },
        { lower: '400000.00', upper: null, rate: 5 },
      ],
    });
    assert.equal(result.success, false);
  });

  it('rejects an upper bound at or below the lower bound', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [{ lower: '0.00', upper: '0.00', rate: 0 }],
    });
    assert.equal(result.success, false);
  });

  it('rejects an empty slab list', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [],
    });
    assert.equal(result.success, false);
  });

  it('rejects a rate above 100', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-04-01',
      slabs: [{ lower: '0.00', upper: null, rate: 101 }],
    });
    assert.equal(result.success, false);
  });

  it('rejects an invalid effective date', () => {
    const result = taxSlabSetSchema.safeParse({
      effectiveFrom: '2025-02-30',
      slabs: TAX_SLABS,
    });
    assert.equal(result.success, false);
  });
});

describe('statutorySettingsSchema', () => {
  const VALID = {
    effectiveFrom: '2025-04-01',
    standardDeduction: '75000.00',
    rebateThreshold: '1200000.00',
    rebateMax: '60000.00',
    cessRate: 4,
    pfEmployeeRate: 12,
    pfWageCeiling: '15000.00',
    esiEmployeeRate: 0.75,
    esiGrossCeiling: '21000.00',
  };

  it('transforms money and rates', () => {
    const parsed = statutorySettingsSchema.parse(VALID);
    assert.equal(parsed.standardDeductionCents, 7_500_000);
    assert.equal(parsed.rebateThresholdCents, 120_000_000);
    assert.equal(parsed.rebateMaxCents, 6_000_000);
    assert.equal(parsed.cessRateBps, 400);
    assert.equal(parsed.pfEmployeeRateBps, 1200);
    assert.equal(parsed.pfWageCeilingCents, 1_500_000);
    assert.equal(parsed.esiEmployeeRateBps, 75);
    assert.equal(parsed.esiGrossCeilingCents, 2_100_000);
  });

  it('rejects a negative amount', () => {
    const result = statutorySettingsSchema.safeParse({
      ...VALID,
      standardDeduction: '-1.00',
    });
    assert.equal(result.success, false);
  });

  it('rejects a rate above 100', () => {
    const result = statutorySettingsSchema.safeParse({ ...VALID, cessRate: 101 });
    assert.equal(result.success, false);
  });

  it('rejects a rate with more than two decimals', () => {
    const result = statutorySettingsSchema.safeParse({ ...VALID, pfEmployeeRate: 12.345 });
    assert.equal(result.success, false);
  });
});

describe('professionalTaxSchema', () => {
  const VALID = {
    state: 'MH',
    effectiveFrom: '2025-04-01',
    slabs: [
      { lower: '0.00', upper: '7500.00', amount: '0.00', februaryAmount: null },
      { lower: '7500.00', upper: null, amount: '200.00', februaryAmount: '300.00' },
    ],
  };

  it('transforms amounts and keeps nullable fields', () => {
    const parsed = professionalTaxSchema.parse(VALID);
    assert.equal(parsed.state, 'MH');
    assert.deepEqual(parsed.slabs, [
      {
        lowerCents: 0,
        upperCents: 750_000,
        amountCents: 0,
        februaryAmountCents: null,
      },
      {
        lowerCents: 750_000,
        upperCents: null,
        amountCents: 20_000,
        februaryAmountCents: 30_000,
      },
    ]);
  });

  it('rejects a lowercase or non-two-letter state', () => {
    assert.equal(professionalTaxSchema.safeParse({ ...VALID, state: 'mh' }).success, false);
    assert.equal(professionalTaxSchema.safeParse({ ...VALID, state: 'MHR' }).success, false);
  });

  it('rejects a negative amount', () => {
    const result = professionalTaxSchema.safeParse({
      ...VALID,
      slabs: [{ lower: '0.00', upper: null, amount: '-1.00', februaryAmount: null }],
    });
    assert.equal(result.success, false);
  });

  it('validates the query state format', () => {
    assert.equal(payrollProfessionalTaxQuerySchema.safeParse({ state: 'KA' }).success, true);
    assert.equal(payrollProfessionalTaxQuerySchema.safeParse({ state: 'ka' }).success, false);
    assert.equal(payrollProfessionalTaxQuerySchema.safeParse({}).success, false);
  });
});
