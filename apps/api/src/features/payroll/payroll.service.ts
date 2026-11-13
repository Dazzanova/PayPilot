import { DeductionRuleType, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import { toDeductionRuleDto, type DeductionRuleDto } from './payroll.dto';
import type {
  DeductionRuleCreateInput,
  DeductionRuleUpdateInput,
} from './payroll.schema';

type Tx = Prisma.TransactionClient;

const DEFAULT_RULES: Array<{
  name: string;
  type: DeductionRuleType;
  value: string;
}> = [
  { name: 'Income tax', type: DeductionRuleType.RATE, value: '10.00' },
  { name: 'Pension', type: DeductionRuleType.RATE, value: '5.00' },
  { name: 'Health insurance', type: DeductionRuleType.FIXED, value: '50.00' },
];

export async function ensureDeductionRules(tx: Tx, organizationId: string): Promise<void> {
  const count = await tx.payrollDeductionRule.count({ where: { organizationId } });
  if (count > 0) return;

  await tx.payrollDeductionRule.createMany({
    data: DEFAULT_RULES.map((rule) => ({
      organizationId,
      name: rule.name,
      type: rule.type,
      value: new Prisma.Decimal(rule.value),
    })),
    skipDuplicates: true,
  });
}

export async function listDeductionRules(
  tx: Tx,
  organizationId: string
): Promise<DeductionRuleDto[]> {
  await ensureDeductionRules(tx, organizationId);
  const rules = await tx.payrollDeductionRule.findMany({
    where: { organizationId },
    orderBy: { name: 'asc' },
  });
  return rules.map(toDeductionRuleDto);
}

function ruleData(input: DeductionRuleCreateInput) {
  return {
    name: input.name,
    type: input.type,
    value: new Prisma.Decimal(input.value),
    taxable: input.taxable,
    active: input.active,
  };
}

export async function createDeductionRule(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: DeductionRuleCreateInput
): Promise<DeductionRuleDto> {
  try {
    const rule = await tx.payrollDeductionRule.create({
      data: { organizationId, ...ruleData(input) },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: userId,
        action: 'payroll.deduction_rule_created',
        entityType: 'PayrollDeductionRule',
        entityId: rule.id,
        metadata: { name: rule.name, type: rule.type, value: rule.value.toFixed(2) },
      },
    });

    return toDeductionRuleDto(rule);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'DEDUCTION_RULE_EXISTS', 'A deduction rule with that name already exists');
    }
    throw error;
  }
}

export async function updateDeductionRule(
  tx: Tx,
  organizationId: string,
  userId: string,
  ruleId: string,
  input: DeductionRuleUpdateInput
): Promise<DeductionRuleDto> {
  const existing = await tx.payrollDeductionRule.findFirst({
    where: { id: ruleId, organizationId },
    select: { id: true, type: true, value: true },
  });
  if (!existing) throw new HttpError(404, 'DEDUCTION_RULE_NOT_FOUND', 'Deduction rule not found');

  // A partial PATCH can change only the value. Validate the merged state so a
  // RATE rule can never be raised above 100% by omitting `type`.
  const effectiveType = input.type ?? existing.type;
  const effectiveValue =
    input.value !== undefined ? input.value : Number(existing.value);
  if (effectiveType === DeductionRuleType.RATE && effectiveValue > 100) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Rate must be between 0 and 100');
  }

  try {
    const rule = await tx.payrollDeductionRule.update({
      where: { id: ruleId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.value !== undefined ? { value: new Prisma.Decimal(input.value) } : {}),
        ...(input.taxable !== undefined ? { taxable: input.taxable } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: userId,
        action: 'payroll.deduction_rule_updated',
        entityType: 'PayrollDeductionRule',
        entityId: rule.id,
        metadata: { name: rule.name, active: rule.active, value: rule.value.toFixed(2) },
      },
    });

    return toDeductionRuleDto(rule);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(409, 'DEDUCTION_RULE_EXISTS', 'A deduction rule with that name already exists');
    }
    throw error;
  }
}

export async function deleteDeductionRule(
  tx: Tx,
  organizationId: string,
  userId: string,
  ruleId: string
): Promise<void> {
  const existing = await tx.payrollDeductionRule.findFirst({
    where: { id: ruleId, organizationId },
    select: { id: true, name: true },
  });
  if (!existing) throw new HttpError(404, 'DEDUCTION_RULE_NOT_FOUND', 'Deduction rule not found');

  await tx.payrollDeductionRule.delete({ where: { id: ruleId } });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.deduction_rule_deleted',
      entityType: 'PayrollDeductionRule',
      entityId: ruleId,
      metadata: { name: existing.name },
    },
  });
}
