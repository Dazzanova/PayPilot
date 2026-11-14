import { Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import type {
  StatutoryConfig,
  StatutoryPtSlab,
  StatutoryTaxSlab,
} from './payroll.statutory';
import {
  toProfessionalTaxDto,
  toStatutorySettingsDto,
  toTaxSlabsDto,
  type ProfessionalTaxDto,
  type StatutorySettingsDto,
  type TaxSlabsDto,
} from './payrollTax.dto';
import type {
  ProfessionalTaxInput,
  StatutorySettingsInput,
  TaxSlabSetInput,
} from './payrollTax.schema';

type Tx = Prisma.TransactionClient;

const DEFAULT_EFFECTIVE_FROM = new Date('2025-04-01T00:00:00.000Z');

const DEFAULT_STATUTORY = {
  standardDeductionCents: 7_500_000,
  rebateThresholdCents: 120_000_000,
  rebateMaxCents: 6_000_000,
  cessRateBps: 400,
  pfEmployeeRateBps: 1200,
  pfWageCeilingCents: 1_500_000,
  esiEmployeeRateBps: 75,
  esiGrossCeilingCents: 2_100_000,
} as const;

const DEFAULT_TAX_SLABS = [
  { lowerCents: 0, upperCents: 40_000_000, rateBps: 0 },
  { lowerCents: 40_000_000, upperCents: 80_000_000, rateBps: 500 },
  { lowerCents: 80_000_000, upperCents: 120_000_000, rateBps: 1000 },
  { lowerCents: 120_000_000, upperCents: 160_000_000, rateBps: 1500 },
  { lowerCents: 160_000_000, upperCents: 200_000_000, rateBps: 2000 },
  { lowerCents: 200_000_000, upperCents: 240_000_000, rateBps: 2500 },
  { lowerCents: 240_000_000, upperCents: null, rateBps: 3000 },
] as const;

const DEFAULT_PT_SLABS: Record<
  string,
  Array<{
    lowerCents: number;
    upperCents: number | null;
    amountCents: number;
    februaryAmountCents: number | null;
  }>
> = {
  MH: [
    { lowerCents: 0, upperCents: 750_000, amountCents: 0, februaryAmountCents: 0 },
    {
      lowerCents: 750_000,
      upperCents: 1_000_000,
      amountCents: 17_500,
      februaryAmountCents: 17_500,
    },
    {
      lowerCents: 1_000_000,
      upperCents: null,
      amountCents: 20_000,
      februaryAmountCents: 30_000,
    },
  ],
  KA: [
    { lowerCents: 0, upperCents: 1_500_000, amountCents: 0, februaryAmountCents: 0 },
    {
      lowerCents: 1_500_000,
      upperCents: null,
      amountCents: 20_000,
      februaryAmountCents: 20_000,
    },
  ],
};

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/**
 * Seeds the India new-regime defaults once per organization. The migration
 * seeds existing tenants; this covers organizations created after it ran.
 */
export async function ensurePayrollTaxConfig(
  tx: Tx,
  organizationId: string
): Promise<void> {
  const settingCount = await tx.payrollStatutorySetting.count({
    where: { organizationId },
  });
  if (settingCount === 0) {
    await tx.payrollStatutorySetting.createMany({
      data: [
        {
          organizationId,
          effectiveFrom: DEFAULT_EFFECTIVE_FROM,
          ...DEFAULT_STATUTORY,
        },
      ],
      skipDuplicates: true,
    });
  }

  const setCount = await tx.payrollTaxSlabSet.count({ where: { organizationId } });
  if (setCount === 0) {
    const set = await tx.payrollTaxSlabSet.create({
      data: { organizationId, effectiveFrom: DEFAULT_EFFECTIVE_FROM },
    });
    await tx.payrollTaxSlab.createMany({
      data: DEFAULT_TAX_SLABS.map((slab) => ({
        organizationId,
        setId: set.id,
        ...slab,
      })),
      skipDuplicates: true,
    });
  }

  for (const [state, slabs] of Object.entries(DEFAULT_PT_SLABS)) {
    const count = await tx.payrollProfessionalTaxSlabSet.count({
      where: { organizationId, state },
    });
    if (count > 0) continue;

    const set = await tx.payrollProfessionalTaxSlabSet.create({
      data: { organizationId, state, effectiveFrom: DEFAULT_EFFECTIVE_FROM },
    });
    await tx.payrollProfessionalTaxSlab.createMany({
      data: slabs.map((slab) => ({
        organizationId,
        setId: set.id,
        ...slab,
      })),
      skipDuplicates: true,
    });
  }
}

export interface EffectiveTaxConfig {
  setting: Prisma.PayrollStatutorySettingGetPayload<object>;
  taxSlabs: Prisma.PayrollTaxSlabGetPayload<object>[];
  ptByState: Map<string, StatutoryPtSlab[]>;
}

function toStatutoryTaxSlab(
  slab: Prisma.PayrollTaxSlabGetPayload<object>
): StatutoryTaxSlab {
  return {
    lowerCents: slab.lowerCents,
    upperCents: slab.upperCents,
    rateBps: slab.rateBps,
  };
}

/**
 * Resolves the configuration in force on a pay date. Returns null when the
 * organization has no statutory setting or income-tax slab set yet.
 */
export async function getEffectiveTaxConfig(
  tx: Tx,
  organizationId: string,
  payDate: string
): Promise<EffectiveTaxConfig | null> {
  const date = toUtcDate(payDate);

  const [setting, taxSlabSet] = await Promise.all([
    tx.payrollStatutorySetting.findFirst({
      where: { organizationId, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: 'desc' },
    }),
    tx.payrollTaxSlabSet.findFirst({
      where: { organizationId, effectiveFrom: { lte: date } },
      orderBy: { effectiveFrom: 'desc' },
      include: { slabs: { orderBy: { lowerCents: 'asc' } } },
    }),
  ]);

  if (!setting || !taxSlabSet) return null;

  const ptSets = await tx.payrollProfessionalTaxSlabSet.findMany({
    where: { organizationId, effectiveFrom: { lte: date } },
    orderBy: [{ state: 'asc' }, { effectiveFrom: 'desc' }],
  });

  const latestSetByState = new Map<string, string>();
  for (const set of ptSets) {
    if (!latestSetByState.has(set.state)) latestSetByState.set(set.state, set.id);
  }

  const ptSlabs = latestSetByState.size
    ? await tx.payrollProfessionalTaxSlab.findMany({
        where: { organizationId, setId: { in: [...latestSetByState.values()] } },
        orderBy: { lowerCents: 'asc' },
      })
    : [];

  const ptByState = new Map<string, StatutoryPtSlab[]>();
  for (const [state, setId] of latestSetByState) {
    ptByState.set(
      state,
      ptSlabs
        .filter((slab) => slab.setId === setId)
        .map((slab) => ({
          lowerCents: slab.lowerCents,
          upperCents: slab.upperCents,
          amountCents: slab.amountCents,
          februaryAmountCents: slab.februaryAmountCents,
        }))
    );
  }

  return {
    setting,
    taxSlabs: taxSlabSet.slabs,
    ptByState,
  };
}

export function resolveStatutoryConfig(
  effective: EffectiveTaxConfig,
  state: string | null
): StatutoryConfig {
  const { setting } = effective;
  return {
    standardDeductionCents: setting.standardDeductionCents,
    rebateThresholdCents: setting.rebateThresholdCents,
    rebateMaxCents: setting.rebateMaxCents,
    cessRateBps: setting.cessRateBps,
    pfEmployeeRateBps: setting.pfEmployeeRateBps,
    pfWageCeilingCents: setting.pfWageCeilingCents,
    esiEmployeeRateBps: setting.esiEmployeeRateBps,
    esiGrossCeilingCents: setting.esiGrossCeilingCents,
    taxSlabs: effective.taxSlabs.map(toStatutoryTaxSlab),
    ptSlabs: state ? effective.ptByState.get(state) ?? null : null,
  };
}

async function findTaxSlabSet(
  tx: Tx,
  organizationId: string,
  effectiveFrom?: string
) {
  return tx.payrollTaxSlabSet.findFirst({
    where: {
      organizationId,
      ...(effectiveFrom ? { effectiveFrom: { lte: toUtcDate(effectiveFrom) } } : {}),
    },
    orderBy: { effectiveFrom: 'desc' },
    include: { slabs: { orderBy: { lowerCents: 'asc' } } },
  });
}

export async function listTaxSlabs(
  tx: Tx,
  organizationId: string,
  effectiveFrom?: string
): Promise<TaxSlabsDto> {
  await ensurePayrollTaxConfig(tx, organizationId);
  const set = await findTaxSlabSet(tx, organizationId, effectiveFrom);
  if (!set) {
    throw new HttpError(
      404,
      'PAYROLL_TAX_CONFIG_NOT_FOUND',
      'No income-tax slab set is effective for that date'
    );
  }
  return toTaxSlabsDto(set);
}

export async function listStatutorySettings(
  tx: Tx,
  organizationId: string,
  effectiveFrom?: string
): Promise<StatutorySettingsDto> {
  await ensurePayrollTaxConfig(tx, organizationId);
  const row = await tx.payrollStatutorySetting.findFirst({
    where: {
      organizationId,
      ...(effectiveFrom ? { effectiveFrom: { lte: toUtcDate(effectiveFrom) } } : {}),
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (!row) {
    throw new HttpError(
      404,
      'PAYROLL_STATUTORY_CONFIG_NOT_FOUND',
      'No statutory setting is effective for that date'
    );
  }
  return toStatutorySettingsDto(row);
}

async function findProfessionalTaxSet(
  tx: Tx,
  organizationId: string,
  state: string,
  effectiveFrom?: string
) {
  return tx.payrollProfessionalTaxSlabSet.findFirst({
    where: {
      organizationId,
      state,
      ...(effectiveFrom ? { effectiveFrom: { lte: toUtcDate(effectiveFrom) } } : {}),
    },
    orderBy: { effectiveFrom: 'desc' },
    include: { slabs: { orderBy: { lowerCents: 'asc' } } },
  });
}

export async function listProfessionalTax(
  tx: Tx,
  organizationId: string,
  state: string,
  effectiveFrom?: string
): Promise<ProfessionalTaxDto> {
  await ensurePayrollTaxConfig(tx, organizationId);
  const set = await findProfessionalTaxSet(tx, organizationId, state, effectiveFrom);
  if (!set) {
    throw new HttpError(
      404,
      'PAYROLL_PT_CONFIG_NOT_FOUND',
      'No professional-tax configuration is effective for that state and date'
    );
  }
  return toProfessionalTaxDto(set);
}

export async function saveTaxSlabs(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: TaxSlabSetInput
): Promise<TaxSlabsDto> {
  const effectiveFrom = toUtcDate(input.effectiveFrom);

  const set = await tx.payrollTaxSlabSet.upsert({
    where: { organizationId_effectiveFrom: { organizationId, effectiveFrom } },
    update: {},
    create: { organizationId, effectiveFrom },
  });

  await tx.payrollTaxSlab.deleteMany({ where: { organizationId, setId: set.id } });
  await tx.payrollTaxSlab.createMany({
    data: input.slabs.map((slab) => ({
      organizationId,
      setId: set.id,
      lowerCents: slab.lowerCents,
      upperCents: slab.upperCents,
      rateBps: slab.rateBps,
    })),
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.tax_slabs_updated',
      entityType: 'PayrollTaxSlabSet',
      entityId: set.id,
      metadata: {
        effectiveFrom: input.effectiveFrom,
        slabCount: input.slabs.length,
      },
    },
  });

  const saved = await findTaxSlabSet(tx, organizationId, input.effectiveFrom);
  if (!saved) {
    throw new HttpError(
      500,
      'PAYROLL_TAX_CONFIG_SAVE_FAILED',
      'The income-tax slab set could not be reloaded after saving'
    );
  }
  return toTaxSlabsDto(saved);
}

export async function saveStatutorySettings(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: StatutorySettingsInput
): Promise<StatutorySettingsDto> {
  const effectiveFrom = toUtcDate(input.effectiveFrom);
  const data = {
    standardDeductionCents: input.standardDeductionCents,
    rebateThresholdCents: input.rebateThresholdCents,
    rebateMaxCents: input.rebateMaxCents,
    cessRateBps: input.cessRateBps,
    pfEmployeeRateBps: input.pfEmployeeRateBps,
    pfWageCeilingCents: input.pfWageCeilingCents,
    esiEmployeeRateBps: input.esiEmployeeRateBps,
    esiGrossCeilingCents: input.esiGrossCeilingCents,
  };

  const row = await tx.payrollStatutorySetting.upsert({
    where: { organizationId_effectiveFrom: { organizationId, effectiveFrom } },
    update: data,
    create: { organizationId, effectiveFrom, ...data },
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.statutory_settings_updated',
      entityType: 'PayrollStatutorySetting',
      entityId: row.id,
      metadata: { effectiveFrom: input.effectiveFrom },
    },
  });

  return toStatutorySettingsDto(row);
}

export async function saveProfessionalTax(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: ProfessionalTaxInput
): Promise<ProfessionalTaxDto> {
  const effectiveFrom = toUtcDate(input.effectiveFrom);

  const set = await tx.payrollProfessionalTaxSlabSet.upsert({
    where: {
      organizationId_state_effectiveFrom: {
        organizationId,
        state: input.state,
        effectiveFrom,
      },
    },
    update: {},
    create: { organizationId, state: input.state, effectiveFrom },
  });

  await tx.payrollProfessionalTaxSlab.deleteMany({
    where: { organizationId, setId: set.id },
  });
  await tx.payrollProfessionalTaxSlab.createMany({
    data: input.slabs.map((slab) => ({
      organizationId,
      setId: set.id,
      lowerCents: slab.lowerCents,
      upperCents: slab.upperCents,
      amountCents: slab.amountCents,
      februaryAmountCents: slab.februaryAmountCents,
    })),
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.professional_tax_updated',
      entityType: 'PayrollProfessionalTaxSlabSet',
      entityId: set.id,
      metadata: {
        state: input.state,
        effectiveFrom: input.effectiveFrom,
        slabCount: input.slabs.length,
      },
    },
  });

  const saved = await findProfessionalTaxSet(
    tx,
    organizationId,
    input.state,
    input.effectiveFrom
  );
  if (!saved) {
    throw new HttpError(
      500,
      'PAYROLL_PT_CONFIG_SAVE_FAILED',
      'The professional-tax set could not be reloaded after saving'
    );
  }
  return toProfessionalTaxDto(saved);
}
