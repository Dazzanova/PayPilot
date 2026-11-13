import { DeductionRuleType, PayrollStatus, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import {
  RUN_INCLUDE,
  toDeductionRuleDto,
  toRunDto,
  toRunSummaryDto,
  type DeductionRuleDto,
  type PayrollRunDto,
  type PayrollRunSummaryDto,
} from './payroll.dto';
import type {
  DeductionRuleCreateInput,
  DeductionRuleUpdateInput,
  PayrollRunCreateInput,
  PayrollRunListQuery,
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

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function pageResult(page: number, pageSize: number, total: number) {
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function listPayrollRuns(
  tx: Tx,
  organizationId: string,
  query: PayrollRunListQuery
): Promise<{ runs: PayrollRunSummaryDto[]; pagination: ReturnType<typeof pageResult> }> {
  const where: Prisma.PayrollRunWhereInput = { organizationId };
  if (query.status) where.status = query.status;
  if (query.from) where.periodEnd = { gte: dateValue(query.from) };
  if (query.to) where.periodStart = { lte: dateValue(query.to) };

  const [total, runs] = await Promise.all([
    tx.payrollRun.count({ where }),
    tx.payrollRun.findMany({
      where,
      include: { _count: { select: { payslips: true } } },
      orderBy: [{ periodStart: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    runs: runs.map(toRunSummaryDto),
    pagination: pageResult(query.page, query.pageSize, total),
  };
}

export async function createPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: PayrollRunCreateInput
): Promise<PayrollRunDto> {
  try {
    const created = await tx.payrollRun.create({
      data: {
        organizationId,
        periodStart: dateValue(input.periodStart),
        periodEnd: dateValue(input.periodEnd),
        payDate: dateValue(input.payDate),
        status: PayrollStatus.DRAFT,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorId: userId,
        action: 'payroll.run_created',
        entityType: 'PayrollRun',
        entityId: created.id,
        metadata: {
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          payDate: input.payDate,
        },
      },
    });

    const run = await tx.payrollRun.findFirstOrThrow({
      where: { id: created.id, organizationId },
      include: RUN_INCLUDE,
    });
    return toRunDto(run);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new HttpError(
        409,
        'PAYROLL_RUN_EXISTS',
        'A payroll run already exists for this period'
      );
    }
    throw error;
  }
}

export async function getPayrollRun(
  tx: Tx,
  organizationId: string,
  runId: string
): Promise<PayrollRunDto> {
  const run = await tx.payrollRun.findFirst({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });
  if (!run) throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
  return toRunDto(run);
}
