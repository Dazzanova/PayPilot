import { roundHalfUp } from './payroll.money';

export const STATUTORY_LINE_LABELS = {
  pf: 'Provident Fund (employee)',
  esi: 'ESI (employee)',
  pt: 'Professional tax',
  tds: 'Income tax (TDS)',
} as const;

export class StatutoryConfigMissingError extends Error {
  readonly code = 'STATUTORY_CONFIG_MISSING';

  constructor(message = 'No effective statutory configuration exists for the pay date') {
    super(message);
    this.name = 'StatutoryConfigMissingError';
  }
}

export interface StatutoryTaxSlab {
  lowerCents: number;
  upperCents: number | null;
  rateBps: number;
}

export interface StatutoryPtSlab {
  lowerCents: number;
  upperCents: number | null;
  amountCents: number;
  februaryAmountCents: number | null;
}

export interface StatutoryConfig {
  standardDeductionCents: number;
  rebateThresholdCents: number;
  rebateMaxCents: number;
  cessRateBps: number;
  pfEmployeeRateBps: number;
  pfWageCeilingCents: number;
  esiEmployeeRateBps: number;
  esiGrossCeilingCents: number;
  taxSlabs: StatutoryTaxSlab[];
  /** Slabs for the employee's state, or null when no state config applies. */
  ptSlabs: StatutoryPtSlab[] | null;
}

export interface StatutoryEmployee {
  baseSalaryCents: number;
  grossCents: number;
  state: string | null;
  pfApplicable: boolean;
  esiApplicable: boolean;
}

export interface StatutoryLine {
  label: string;
  amountCents: number;
  sortOrder: number;
}

export interface StatutoryResult {
  pfCents: number;
  esiCents: number;
  ptCents: number;
  tdsCents: number;
  totalCents: number;
  lines: StatutoryLine[];
}

function calculatePf(employee: StatutoryEmployee, config: StatutoryConfig): number {
  if (!employee.pfApplicable || employee.grossCents <= 0) return 0;
  const wageCents = Math.min(employee.baseSalaryCents, config.pfWageCeilingCents);
  return roundHalfUp((wageCents * config.pfEmployeeRateBps) / 10_000);
}

function calculateEsi(employee: StatutoryEmployee, config: StatutoryConfig): number {
  if (!employee.esiApplicable || employee.grossCents <= 0) return 0;
  if (employee.grossCents > config.esiGrossCeilingCents) return 0;
  return roundHalfUp((employee.grossCents * config.esiEmployeeRateBps) / 10_000);
}

function isFebruary(payDate: string): boolean {
  return payDate.slice(5, 7) === '02';
}

function calculatePt(
  employee: StatutoryEmployee,
  config: StatutoryConfig,
  payDate: string
): { monthlyCents: number; chargedCents: number } {
  if (!employee.state || !config.ptSlabs || employee.grossCents <= 0) {
    return { monthlyCents: 0, chargedCents: 0 };
  }

  const slab = config.ptSlabs.find(
    (candidate) =>
      employee.grossCents >= candidate.lowerCents &&
      (candidate.upperCents === null || employee.grossCents < candidate.upperCents)
  );
  if (!slab) return { monthlyCents: 0, chargedCents: 0 };

  const chargedCents =
    isFebruary(payDate) && slab.februaryAmountCents !== null
      ? slab.februaryAmountCents
      : slab.amountCents;

  return { monthlyCents: slab.amountCents, chargedCents };
}

function calculateTds(
  employee: StatutoryEmployee,
  config: StatutoryConfig,
  monthlyPtCents: number
): number {
  if (employee.grossCents <= 0) return 0;

  const annualGrossCents = employee.baseSalaryCents * 12;
  const annualPtCents = monthlyPtCents * 12;
  const taxableCents = Math.max(
    0,
    annualGrossCents - config.standardDeductionCents - annualPtCents
  );

  let taxCents = 0;
  for (const slab of [...config.taxSlabs].sort((a, b) => a.lowerCents - b.lowerCents)) {
    const upperCents = slab.upperCents ?? taxableCents;
    const portionCents = Math.max(
      0,
      Math.min(taxableCents, upperCents) - slab.lowerCents
    );
    if (portionCents > 0) {
      taxCents += roundHalfUp((portionCents * slab.rateBps) / 10_000);
    }
  }

  if (taxableCents <= config.rebateThresholdCents) {
    taxCents = Math.max(0, taxCents - Math.min(taxCents, config.rebateMaxCents));
  }

  const cessCents = roundHalfUp((taxCents * config.cessRateBps) / 10_000);
  const annualTaxCents = taxCents + cessCents;
  return roundHalfUp(annualTaxCents / 12);
}

export function calculateStatutoryDeductions(input: {
  employee: StatutoryEmployee;
  config: StatutoryConfig | null;
  payDate: string;
}): StatutoryResult {
  const { employee, config, payDate } = input;
  if (!config || config.taxSlabs.length === 0) {
    throw new StatutoryConfigMissingError();
  }

  if (employee.grossCents <= 0) {
    return {
      pfCents: 0,
      esiCents: 0,
      ptCents: 0,
      tdsCents: 0,
      totalCents: 0,
      lines: [],
    };
  }

  const pfCents = calculatePf(employee, config);
  const esiCents = calculateEsi(employee, config);
  const pt = calculatePt(employee, config, payDate);
  const ptCents = pt.chargedCents;
  const tdsCents = calculateTds(employee, config, pt.monthlyCents);

  const lines: StatutoryLine[] = [];
  if (pfCents > 0) {
    lines.push({ label: STATUTORY_LINE_LABELS.pf, amountCents: pfCents, sortOrder: 1 });
  }
  if (esiCents > 0) {
    lines.push({ label: STATUTORY_LINE_LABELS.esi, amountCents: esiCents, sortOrder: 2 });
  }
  if (ptCents > 0) {
    lines.push({ label: STATUTORY_LINE_LABELS.pt, amountCents: ptCents, sortOrder: 3 });
  }
  if (tdsCents > 0) {
    lines.push({ label: STATUTORY_LINE_LABELS.tds, amountCents: tdsCents, sortOrder: 4 });
  }

  return {
    pfCents,
    esiCents,
    ptCents,
    tdsCents,
    totalCents: pfCents + esiCents + ptCents + tdsCents,
    lines,
  };
}
