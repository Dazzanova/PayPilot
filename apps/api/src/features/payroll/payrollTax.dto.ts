import type {
  PayrollProfessionalTaxSlab,
  PayrollProfessionalTaxSlabSet,
  PayrollStatutorySetting,
  PayrollTaxSlab,
  PayrollTaxSlabSet,
} from '@prisma/client';

export interface TaxSlabDto {
  lower: string;
  upper: string | null;
  rate: number;
}

export interface TaxSlabsDto {
  effectiveFrom: string;
  slabs: TaxSlabDto[];
}

export interface StatutorySettingsDto {
  effectiveFrom: string;
  standardDeduction: string;
  rebateThreshold: string;
  rebateMax: string;
  cessRate: number;
  pfEmployeeRate: number;
  pfWageCeiling: string;
  esiEmployeeRate: number;
  esiGrossCeiling: string;
}

export interface ProfessionalTaxSlabDto {
  lower: string;
  upper: string | null;
  amount: string;
  februaryAmount: string | null;
}

export interface ProfessionalTaxDto {
  state: string;
  effectiveFrom: string;
  slabs: ProfessionalTaxSlabDto[];
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function centsToMoney(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function bpsToPercent(bps: number): number {
  return bps / 100;
}

export function toTaxSlabsDto(
  set: PayrollTaxSlabSet & { slabs: PayrollTaxSlab[] }
): TaxSlabsDto {
  return {
    effectiveFrom: dateOnly(set.effectiveFrom),
    slabs: set.slabs.map((slab) => ({
      lower: centsToMoney(slab.lowerCents),
      upper: slab.upperCents === null ? null : centsToMoney(slab.upperCents),
      rate: bpsToPercent(slab.rateBps),
    })),
  };
}

export function toStatutorySettingsDto(row: PayrollStatutorySetting): StatutorySettingsDto {
  return {
    effectiveFrom: dateOnly(row.effectiveFrom),
    standardDeduction: centsToMoney(row.standardDeductionCents),
    rebateThreshold: centsToMoney(row.rebateThresholdCents),
    rebateMax: centsToMoney(row.rebateMaxCents),
    cessRate: bpsToPercent(row.cessRateBps),
    pfEmployeeRate: bpsToPercent(row.pfEmployeeRateBps),
    pfWageCeiling: centsToMoney(row.pfWageCeilingCents),
    esiEmployeeRate: bpsToPercent(row.esiEmployeeRateBps),
    esiGrossCeiling: centsToMoney(row.esiGrossCeilingCents),
  };
}

export function toProfessionalTaxDto(
  set: PayrollProfessionalTaxSlabSet & { slabs: PayrollProfessionalTaxSlab[] }
): ProfessionalTaxDto {
  return {
    state: set.state,
    effectiveFrom: dateOnly(set.effectiveFrom),
    slabs: set.slabs.map((slab) => ({
      lower: centsToMoney(slab.lowerCents),
      upper: slab.upperCents === null ? null : centsToMoney(slab.upperCents),
      amount: centsToMoney(slab.amountCents),
      februaryAmount:
        slab.februaryAmountCents === null
          ? null
          : centsToMoney(slab.februaryAmountCents),
    })),
  };
}
