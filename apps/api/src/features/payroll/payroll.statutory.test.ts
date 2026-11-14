import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  StatutoryConfigMissingError,
  calculateStatutoryDeductions,
  type StatutoryConfig,
  type StatutoryEmployee,
  type StatutoryPtSlab,
  type StatutoryTaxSlab,
} from './payroll.statutory';

const TAX_SLABS: StatutoryTaxSlab[] = [
  { lowerCents: 0, upperCents: 40_000_000, rateBps: 0 },
  { lowerCents: 40_000_000, upperCents: 80_000_000, rateBps: 500 },
  { lowerCents: 80_000_000, upperCents: 120_000_000, rateBps: 1000 },
  { lowerCents: 120_000_000, upperCents: 160_000_000, rateBps: 1500 },
  { lowerCents: 160_000_000, upperCents: 200_000_000, rateBps: 2000 },
  { lowerCents: 200_000_000, upperCents: 240_000_000, rateBps: 2500 },
  { lowerCents: 240_000_000, upperCents: null, rateBps: 3000 },
];

const MH_SLABS: StatutoryPtSlab[] = [
  { lowerCents: 0, upperCents: 750_000, amountCents: 0, februaryAmountCents: 0 },
  { lowerCents: 750_000, upperCents: 1_000_000, amountCents: 17_500, februaryAmountCents: 17_500 },
  { lowerCents: 1_000_000, upperCents: null, amountCents: 20_000, februaryAmountCents: 30_000 },
];

const KA_SLABS: StatutoryPtSlab[] = [
  { lowerCents: 0, upperCents: 1_500_000, amountCents: 0, februaryAmountCents: 0 },
  { lowerCents: 1_500_000, upperCents: null, amountCents: 20_000, februaryAmountCents: 20_000 },
];

function config(overrides: Partial<StatutoryConfig> = {}): StatutoryConfig {
  return {
    standardDeductionCents: 7_500_000,
    rebateThresholdCents: 120_000_000,
    rebateMaxCents: 6_000_000,
    cessRateBps: 400,
    pfEmployeeRateBps: 1200,
    pfWageCeilingCents: 1_500_000,
    esiEmployeeRateBps: 75,
    esiGrossCeilingCents: 2_100_000,
    taxSlabs: TAX_SLABS,
    ptSlabsByState: {},
    ...overrides,
  };
}

function employee(overrides: Partial<StatutoryEmployee> = {}): StatutoryEmployee {
  return {
    baseSalaryCents: 5_000_000,
    grossCents: 5_000_000,
    state: null,
    pfApplicable: true,
    esiApplicable: true,
    ...overrides,
  };
}

function calculate(
  employeeOverrides: Partial<StatutoryEmployee> = {},
  configOverrides: Partial<StatutoryConfig> = {},
  payDate = '2026-10-31'
) {
  return calculateStatutoryDeductions({
    employee: employee(employeeOverrides),
    config: config(configOverrides),
    payDate,
  });
}

describe('calculateStatutoryDeductions — PF', () => {
  it('deducts 12% of base salary below the wage ceiling', () => {
    const result = calculate({ baseSalaryCents: 1_000_000, grossCents: 1_000_000 });
    assert.equal(result.pfCents, 120_000);
  });

  it('caps the PF wage at the configured ceiling', () => {
    const result = calculate({ baseSalaryCents: 2_000_000, grossCents: 2_000_000 });
    assert.equal(result.pfCents, 180_000);
  });

  it('skips PF when the employee is not PF applicable', () => {
    const result = calculate({
      baseSalaryCents: 2_000_000,
      grossCents: 2_000_000,
      pfApplicable: false,
    });
    assert.equal(result.pfCents, 0);
    assert.equal(
      result.lines.some((line) => line.label === 'Provident Fund (employee)'),
      false
    );
  });
});

describe('calculateStatutoryDeductions — ESI', () => {
  it('deducts 0.75% of gross below the ceiling', () => {
    const result = calculate({ baseSalaryCents: 2_000_000, grossCents: 2_000_000 });
    assert.equal(result.esiCents, 15_000);
  });

  it('applies at the exact gross ceiling', () => {
    const result = calculate({ baseSalaryCents: 2_100_000, grossCents: 2_100_000 });
    assert.equal(result.esiCents, 15_750);
  });

  it('is zero above the gross ceiling', () => {
    const result = calculate({ baseSalaryCents: 2_100_001, grossCents: 2_100_001 });
    assert.equal(result.esiCents, 0);
  });

  it('skips ESI when the employee is not ESI applicable', () => {
    const result = calculate({
      baseSalaryCents: 2_000_000,
      grossCents: 2_000_000,
      esiApplicable: false,
    });
    assert.equal(result.esiCents, 0);
  });

  it('rounds half a cent upward', () => {
    const result = calculate({ baseSalaryCents: 100_067, grossCents: 100_067 });
    assert.equal(result.esiCents, 751);
  });
});

describe('calculateStatutoryDeductions — professional tax', () => {
  it('uses the Maharashtra slab for the prorated gross', () => {
    const result = calculate(
      { grossCents: 800_000, state: 'MH' },
      { ptSlabsByState: { MH: MH_SLABS } }
    );
    assert.equal(result.ptCents, 17_500);
  });

  it('uses the higher Maharashtra slab above 10,000', () => {
    const result = calculate(
      { grossCents: 1_200_000, state: 'MH' },
      { ptSlabsByState: { MH: MH_SLABS } }
    );
    assert.equal(result.ptCents, 20_000);
  });

  it('uses the Maharashtra February amount in February', () => {
    const result = calculate(
      { grossCents: 1_200_000, state: 'MH' },
      { ptSlabsByState: { MH: MH_SLABS } },
      '2026-02-28'
    );
    assert.equal(result.ptCents, 30_000);
  });

  it('uses the Karnataka slab', () => {
    const result = calculate(
      { grossCents: 1_600_000, state: 'KA' },
      { ptSlabsByState: { KA: KA_SLABS } }
    );
    assert.equal(result.ptCents, 20_000);
  });

  it('is zero below the Karnataka threshold', () => {
    const result = calculate(
      { grossCents: 1_000_000, state: 'KA' },
      { ptSlabsByState: { KA: KA_SLABS } }
    );
    assert.equal(result.ptCents, 0);
  });

  it('is zero when the employee has no state or no configured slabs', () => {
    assert.equal(calculate({ grossCents: 1_600_000, state: null }).ptCents, 0);
    assert.equal(calculate({ grossCents: 1_600_000, state: 'MH' }).ptCents, 0);
  });
});

describe('calculateStatutoryDeductions — TDS', () => {
  it('is zero when taxable income is under the rebate threshold', () => {
    const result = calculate({ baseSalaryCents: 10_000_000, grossCents: 10_000_000 });
    assert.equal(result.tdsCents, 0);
  });

  it('is zero exactly at the rebate threshold', () => {
    const result = calculate({ baseSalaryCents: 10_625_000, grossCents: 10_625_000 });
    assert.equal(result.tdsCents, 0);
  });

  it('charges tax just above the rebate threshold with cess', () => {
    const result = calculate({ baseSalaryCents: 10_625_100, grossCents: 10_625_100 });
    assert.equal(result.tdsCents, 520_016);
  });

  it('projects across several slabs and adds 4% cess', () => {
    const result = calculate({ baseSalaryCents: 15_000_000, grossCents: 15_000_000 });
    assert.equal(result.tdsCents, 1_256_667);
  });

  it('projects annual PT from the regular monthly amount, not February', () => {
    const regular = calculate(
      { baseSalaryCents: 15_000_000, grossCents: 1_200_000, state: 'MH' },
      { ptSlabsByState: { MH: MH_SLABS } },
      '2026-01-31'
    );
    const february = calculate(
      { baseSalaryCents: 15_000_000, grossCents: 1_200_000, state: 'MH' },
      { ptSlabsByState: { MH: MH_SLABS } },
      '2026-02-28'
    );
    assert.equal(regular.tdsCents, february.tdsCents);
  });

  it('annualizes base salary rather than prorated gross', () => {
    const full = calculate({ baseSalaryCents: 15_000_000, grossCents: 15_000_000 });
    const partial = calculate({ baseSalaryCents: 15_000_000, grossCents: 2_000_000 });
    assert.equal(full.tdsCents, partial.tdsCents);
  });
});

describe('calculateStatutoryDeductions — totals and lines', () => {
  it('returns no lines and zero totals for zero gross', () => {
    const result = calculate({ baseSalaryCents: 15_000_000, grossCents: 0 });
    assert.equal(result.totalCents, 0);
    assert.deepEqual(result.lines, []);
  });

  it('orders lines PF, ESI, PT, TDS with sort orders 1-4', () => {
    const result = calculate(
      { baseSalaryCents: 15_000_000, grossCents: 1_200_000, state: 'MH' },
      { ptSlabsByState: { MH: MH_SLABS } }
    );
    assert.deepEqual(
      result.lines.map((line) => [line.sortOrder, line.label]),
      [
        [1, 'Provident Fund (employee)'],
        [2, 'ESI (employee)'],
        [3, 'Professional tax'],
        [4, 'Income tax (TDS)'],
      ]
    );
    assert.equal(
      result.totalCents,
      result.pfCents + result.esiCents + result.ptCents + result.tdsCents
    );
  });

  it('omits zero-value statutory lines', () => {
    const result = calculate({ baseSalaryCents: 1_000_000, grossCents: 1_000_000 });
    assert.deepEqual(
      result.lines.map((line) => line.label),
      ['Provident Fund (employee)', 'ESI (employee)']
    );
  });

  it('throws when configuration is missing', () => {
    assert.throws(
      () =>
        calculateStatutoryDeductions({
          employee: employee(),
          config: null,
          payDate: '2026-10-31',
        }),
      (error: unknown) =>
        error instanceof StatutoryConfigMissingError &&
        error.code === 'STATUTORY_CONFIG_MISSING'
    );
  });

  it('throws when no income-tax slabs are configured', () => {
    assert.throws(
      () => calculate({}, { taxSlabs: [] }),
      (error: unknown) =>
        error instanceof StatutoryConfigMissingError &&
        error.code === 'STATUTORY_CONFIG_MISSING'
    );
  });
});
