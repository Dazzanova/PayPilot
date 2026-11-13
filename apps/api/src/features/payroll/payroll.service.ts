import {
  DeductionRuleType,
  EmployeeStatus,
  LeaveStatus,
  PayrollStatus,
  PayslipStatus,
  Prisma,
} from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import { PayrollCalculationError, calculatePayroll, type CalcEmployee } from './payroll.calc';
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

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).div(100);
}

export async function calculatePayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string
): Promise<PayrollRunDto> {
  const guard = await tx.payrollRun.updateMany({
    where: {
      id: runId,
      organizationId,
      status: { in: [PayrollStatus.DRAFT, PayrollStatus.CALCULATED] },
    },
    data: { status: PayrollStatus.CALCULATING, processedById: userId },
  });

  if (guard.count === 0) {
    const existing = await tx.payrollRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (!existing) {
      throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    }
    throw new HttpError(
      409,
      'INVALID_PAYROLL_TRANSITION',
      `Cannot calculate a payroll run in ${existing.status} status`,
      { from: existing.status, action: 'calculate' }
    );
  }

  const run = await tx.payrollRun.findFirstOrThrow({
    where: { id: runId, organizationId },
  });
  const organization = await tx.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { currency: true },
  });

  await ensureDeductionRules(tx, organizationId);
  const rules = await tx.payrollDeductionRule.findMany({
    where: { organizationId, active: true },
    orderBy: { name: 'asc' },
  });

  const employees = await tx.employee.findMany({
    where: {
      organizationId,
      status: { in: [EmployeeStatus.ACTIVE, EmployeeStatus.ON_LEAVE] },
    },
    select: { id: true, baseSalary: true, joinedAt: true },
  });
  const employeeIds = employees.map((employee) => employee.id);

  const [attendance, leave] = await Promise.all([
    tx.attendanceRecord.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        workDate: { gte: run.periodStart, lte: run.periodEnd },
      },
      select: { employeeId: true, workDate: true, status: true },
    }),
    tx.leaveRequest.findMany({
      where: {
        organizationId,
        employeeId: { in: employeeIds },
        status: LeaveStatus.APPROVED,
        startDate: { lte: run.periodEnd },
        endDate: { gte: run.periodStart },
      },
      select: { employeeId: true, leaveType: true, startDate: true, endDate: true },
    }),
  ]);

  const attendanceByEmployee = new Map<string, CalcEmployee['attendance']>();
  for (const record of attendance) {
    const list = attendanceByEmployee.get(record.employeeId) ?? [];
    list.push({ workDate: dateOnly(record.workDate), status: record.status });
    attendanceByEmployee.set(record.employeeId, list);
  }

  const leaveByEmployee = new Map<string, CalcEmployee['approvedLeave']>();
  for (const request of leave) {
    const list = leaveByEmployee.get(request.employeeId) ?? [];
    list.push({
      leaveType: request.leaveType,
      startDate: dateOnly(request.startDate),
      endDate: dateOnly(request.endDate),
    });
    leaveByEmployee.set(request.employeeId, list);
  }

  let result;
  try {
    result = calculatePayroll({
      periodStart: dateOnly(run.periodStart),
      periodEnd: dateOnly(run.periodEnd),
      currency: organization.currency,
      rules: rules.map((rule) => ({
        id: rule.id,
        name: rule.name,
        type: rule.type,
        valueCents: rule.value.mul(100).toDecimalPlaces(0).toNumber(),
      })),
      employees: employees.map((employee) => ({
        id: employee.id,
        baseSalaryCents: employee.baseSalary.mul(100).toDecimalPlaces(0).toNumber(),
        joinedAt: dateOnly(employee.joinedAt),
        attendance: attendanceByEmployee.get(employee.id) ?? [],
        approvedLeave: leaveByEmployee.get(employee.id) ?? [],
      })),
    });
  } catch (error) {
    if (error instanceof PayrollCalculationError) {
      throw new HttpError(422, error.code, error.message, error.details);
    }
    throw error;
  }

  await tx.payslip.deleteMany({ where: { organizationId, payrollRunId: runId } });

  for (const payslip of result.payslips) {
    await tx.payslip.create({
      data: {
        organizationId,
        payrollRunId: runId,
        employeeId: payslip.employeeId,
        baseSalary: centsToDecimal(payslip.baseSalaryCents),
        workingDays: new Prisma.Decimal(payslip.workingDays),
        paidDays: new Prisma.Decimal(payslip.paidDays),
        unpaidDays: new Prisma.Decimal(payslip.unpaidDays),
        absentDays: new Prisma.Decimal(payslip.absentDays),
        grossPay: centsToDecimal(payslip.grossCents),
        totalDeductions: centsToDecimal(payslip.totalDeductionsCents),
        netPay: centsToDecimal(payslip.netCents),
        currency: organization.currency,
        status: PayslipStatus.DRAFT,
        lineItems: {
          create: payslip.lines.map((line) => ({
            organizationId,
            kind: line.kind,
            label: line.label,
            amount: centsToDecimal(line.amountCents),
            ruleId: line.ruleId,
            sortOrder: line.sortOrder,
          })),
        },
      },
    });
  }

  const updated = await tx.payrollRun.update({
    where: { id: runId },
    data: {
      status: PayrollStatus.CALCULATED,
      totalGross: centsToDecimal(result.totalGrossCents),
      totalDeductions: centsToDecimal(result.totalDeductionsCents),
      totalNet: centsToDecimal(result.totalNetCents),
      calculatedAt: new Date(),
      processedById: userId,
    },
    include: RUN_INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.run_calculated',
      entityType: 'PayrollRun',
      entityId: runId,
      metadata: {
        payslipCount: result.payslips.length,
        totalGross: updated.totalGross.toFixed(2),
        totalDeductions: updated.totalDeductions.toFixed(2),
        totalNet: updated.totalNet.toFixed(2),
      },
    },
  });

  return toRunDto(updated);
}

async function transitionPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string,
  action: 'approve' | 'pay',
  from: PayrollStatus[],
  to: PayrollStatus,
  payslipStatus: PayslipStatus,
  auditAction: string
): Promise<PayrollRunDto> {
  const data: Prisma.PayrollRunUpdateManyMutationInput = {
    status: to,
    processedById: userId,
  };
  if (action === 'approve') data.approvedAt = new Date();
  if (action === 'pay') data.paidAt = new Date();

  const guard = await tx.payrollRun.updateMany({
    where: { id: runId, organizationId, status: { in: from } },
    data,
  });

  if (guard.count === 0) {
    const existing = await tx.payrollRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (!existing) {
      throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    }
    throw new HttpError(
      409,
      'INVALID_PAYROLL_TRANSITION',
      `Cannot ${action} a payroll run in ${existing.status} status`,
      { from: existing.status, action }
    );
  }

  await tx.payslip.updateMany({
    where: { organizationId, payrollRunId: runId },
    data: { status: payslipStatus },
  });

  const run = await tx.payrollRun.findFirstOrThrow({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: auditAction,
      entityType: 'PayrollRun',
      entityId: runId,
      metadata: { status: to },
    },
  });

  return toRunDto(run);
}

export function approvePayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string
): Promise<PayrollRunDto> {
  return transitionPayrollRun(
    tx,
    organizationId,
    userId,
    runId,
    'approve',
    [PayrollStatus.CALCULATED],
    PayrollStatus.APPROVED,
    PayslipStatus.ISSUED,
    'payroll.run_approved'
  );
}

export function payPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string
): Promise<PayrollRunDto> {
  return transitionPayrollRun(
    tx,
    organizationId,
    userId,
    runId,
    'pay',
    [PayrollStatus.APPROVED],
    PayrollStatus.PAID,
    PayslipStatus.PAID,
    'payroll.run_paid'
  );
}

export async function voidPayrollRun(
  tx: Tx,
  organizationId: string,
  userId: string,
  runId: string,
  reason: string
): Promise<PayrollRunDto> {
  const guard = await tx.payrollRun.updateMany({
    where: {
      id: runId,
      organizationId,
      status: { in: [PayrollStatus.APPROVED, PayrollStatus.PAID] },
    },
    data: {
      status: PayrollStatus.VOID,
      voidedAt: new Date(),
      voidReason: reason,
      processedById: userId,
    },
  });

  if (guard.count === 0) {
    const existing = await tx.payrollRun.findFirst({
      where: { id: runId, organizationId },
      select: { status: true },
    });
    if (!existing) {
      throw new HttpError(404, 'PAYROLL_RUN_NOT_FOUND', 'Payroll run not found');
    }
    throw new HttpError(
      409,
      'INVALID_PAYROLL_TRANSITION',
      `Cannot void a payroll run in ${existing.status} status`,
      { from: existing.status, action: 'void' }
    );
  }

  const run = await tx.payrollRun.findFirstOrThrow({
    where: { id: runId, organizationId },
    include: RUN_INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'payroll.run_voided',
      entityType: 'PayrollRun',
      entityId: runId,
      metadata: { status: PayrollStatus.VOID, reason },
    },
  });

  return toRunDto(run);
}
