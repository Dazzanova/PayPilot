import { LeaveStatus, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import { toLeaveDto, totalDays } from './leave.dto';
import type { LeaveCreateInput, LeaveListQuery, LeaveReviewInput } from './leave.schema';

type Tx = Prisma.TransactionClient;
const INCLUDE = {
  employee: {
    select: { firstName: true, lastName: true, employeeNumber: true, department: { select: { name: true } } },
  },
  reviewedBy: { select: { email: true } },
} as const;

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function requireOwnEmployee(tx: Tx, organizationId: string, userId: string) {
  const employee = await tx.employee.findFirst({ where: { organizationId, userId }, select: { id: true } });
  if (!employee) throw new HttpError(404, 'EMPLOYEE_PROFILE_NOT_FOUND', 'No employee profile is linked to this account');
  return employee;
}

export async function listLeaveRequests(tx: Tx, organizationId: string, query: LeaveListQuery) {
  // Summary counts must respect the same tenant/employee scope as the list.
  // The status filter is deliberately excluded so the status breakdown stays
  // meaningful while a single status is selected.
  const baseWhere: Prisma.LeaveRequestWhereInput = { organizationId };
  if (query.employeeId) baseWhere.employeeId = query.employeeId;

  const where: Prisma.LeaveRequestWhereInput = { ...baseWhere };
  if (query.status) where.status = query.status;

  const [total, requests, grouped] = await Promise.all([
    tx.leaveRequest.count({ where }),
    tx.leaveRequest.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    tx.leaveRequest.groupBy({ by: ['status'], where: baseWhere, _count: { _all: true } }),
  ]);

  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  return {
    requests: requests.map(toLeaveDto),
    pagination: pagination(query.page, query.pageSize, total),
    summary: {
      pending: counts.get(LeaveStatus.PENDING) ?? 0,
      approved: counts.get(LeaveStatus.APPROVED) ?? 0,
      rejected: counts.get(LeaveStatus.REJECTED) ?? 0,
      cancelled: counts.get(LeaveStatus.CANCELLED) ?? 0,
    },
  };
}

export async function createLeaveRequest(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: LeaveCreateInput
) {
  const employee = await requireOwnEmployee(tx, organizationId, userId);

  // Serialize overlap checks per organization+employee so two concurrent
  // requests cannot both pass the check and create overlapping leave.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`leave-overlap:${organizationId}:${employee.id}`}))`;

  const overlap = await tx.leaveRequest.findFirst({
    where: {
      organizationId,
      employeeId: employee.id,
      status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
      startDate: { lte: dateValue(input.endDate) },
      endDate: { gte: dateValue(input.startDate) },
    },
    select: { id: true },
  });
  if (overlap) {
    throw new HttpError(409, 'LEAVE_OVERLAP', 'You already have a pending or approved leave request overlapping these dates');
  }

  const request = await tx.leaveRequest.create({
    data: {
      organizationId,
      employeeId: employee.id,
      leaveType: input.leaveType,
      startDate: dateValue(input.startDate),
      endDate: dateValue(input.endDate),
      totalDays: totalDays(input.startDate, input.endDate),
      reason: input.reason,
      status: LeaveStatus.PENDING,
    },
    include: INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: userId,
      action: 'leave.created',
      entityType: 'LeaveRequest',
      entityId: request.id,
      metadata: { employeeId: employee.id, startDate: input.startDate, endDate: input.endDate, leaveType: input.leaveType },
    },
  });

  return toLeaveDto(request);
}

export async function reviewLeaveRequest(
  tx: Tx,
  organizationId: string,
  reviewerUserId: string,
  requestId: string,
  input: LeaveReviewInput
) {
  const existing = await tx.leaveRequest.findFirst({
    where: { id: requestId, organizationId },
    select: { id: true, employeeId: true, status: true },
  });
  if (!existing) throw new HttpError(404, 'LEAVE_NOT_FOUND', 'Leave request not found');
  if (existing.status !== LeaveStatus.PENDING) {
    throw new HttpError(409, 'LEAVE_NOT_PENDING', 'Only pending leave requests can be reviewed');
  }

  const status = input.action === 'approve' ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;
  // Conditional update guards against a concurrent review: only the first
  // request that still sees PENDING can transition the row.
  const updated = await tx.leaveRequest.updateMany({
    where: { id: requestId, organizationId, status: LeaveStatus.PENDING },
    data: { status, reviewedById: reviewerUserId, reviewedAt: new Date() },
  });
  if (updated.count === 0) {
    throw new HttpError(409, 'LEAVE_NOT_PENDING', 'This leave request has already been reviewed');
  }

  const request = await tx.leaveRequest.findFirstOrThrow({
    where: { id: requestId, organizationId },
    include: INCLUDE,
  });

  await tx.auditLog.create({
    data: {
      organizationId,
      actorId: reviewerUserId,
      action: input.action === 'approve' ? 'leave.approved' : 'leave.rejected',
      entityType: 'LeaveRequest',
      entityId: request.id,
      metadata: { employeeId: existing.employeeId, previousStatus: existing.status, status },
    },
  });

  return toLeaveDto(request);
}
