import { AttendanceStatus, Prisma } from '@prisma/client';
import { HttpError } from '../../lib/httpError';
import { toAttendanceDto } from './attendance.dto';
import type { AttendanceListQuery, AttendancePunchInput, AttendanceUpsertInput } from './attendance.schema';

type Tx = Prisma.TransactionClient;
const INCLUDE = {
  employee: {
    select: {
      firstName: true,
      lastName: true,
      employeeNumber: true,
      department: { select: { name: true } },
    },
  },
} as const;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateValue(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

async function requireOwnEmployee(tx: Tx, organizationId: string, userId: string) {
  const employee = await tx.employee.findFirst({
    where: { organizationId, userId },
    select: { id: true, status: true },
  });
  if (!employee) throw new HttpError(404, 'EMPLOYEE_PROFILE_NOT_FOUND', 'No employee profile is linked to this account');
  return employee;
}

async function requireEmployeeInOrg(tx: Tx, organizationId: string, employeeId: string) {
  const employee = await tx.employee.findFirst({
    where: { organizationId, id: employeeId },
    select: { id: true },
  });
  if (!employee) throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
}

export async function listAttendance(tx: Tx, organizationId: string, query: AttendanceListQuery) {
  // Summary counts must respect the same tenant/employee/date scope as the list.
  // The status filter is deliberately excluded so the status breakdown stays
  // meaningful while a single status is selected.
  const baseWhere: Prisma.AttendanceRecordWhereInput = { organizationId };
  if (query.workDate) baseWhere.workDate = dateValue(query.workDate);
  if (query.from || query.to) {
    baseWhere.workDate = {
      ...(query.from ? { gte: dateValue(query.from) } : {}),
      ...(query.to ? { lte: dateValue(query.to) } : {}),
    };
  }
  if (query.employeeId) baseWhere.employeeId = query.employeeId;

  const where: Prisma.AttendanceRecordWhereInput = { ...baseWhere };
  if (query.status) where.status = query.status;

  const [total, records, grouped] = await Promise.all([
    tx.attendanceRecord.count({ where }),
    tx.attendanceRecord.findMany({
      where,
      include: INCLUDE,
      orderBy: [{ workDate: 'desc' }, { checkInTime: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    tx.attendanceRecord.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  return {
    records: records.map(toAttendanceDto),
    pagination: pagination(query.page, query.pageSize, total),
    summary: {
      present: counts.get(AttendanceStatus.PRESENT) ?? 0,
      remote: counts.get(AttendanceStatus.REMOTE) ?? 0,
      halfDay: counts.get(AttendanceStatus.HALF_DAY) ?? 0,
      onLeave: counts.get(AttendanceStatus.ON_LEAVE) ?? 0,
      absent: counts.get(AttendanceStatus.ABSENT) ?? 0,
    },
  };
}

export async function punchAttendance(
  tx: Tx,
  organizationId: string,
  userId: string,
  input: AttendancePunchInput
) {
  const employee = await requireOwnEmployee(tx, organizationId, userId);
  const workDate = input.workDate ?? todayUtc();
  const now = new Date();
  const existing = await tx.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId: employee.id, workDate: dateValue(workDate) } },
    include: INCLUDE,
  });

  if (input.action === 'in') {
    if (existing?.checkInTime) {
      throw new HttpError(409, 'ALREADY_CLOCKED_IN', 'You have already clocked in for this date');
    }
    const record = existing
      ? await tx.attendanceRecord.update({
          where: { id: existing.id },
          data: { checkInTime: now, notes: input.notes ?? existing.notes, status: AttendanceStatus.PRESENT },
          include: INCLUDE,
        })
      : await tx.attendanceRecord.create({
          data: {
            organizationId,
            employeeId: employee.id,
            workDate: dateValue(workDate),
            status: AttendanceStatus.PRESENT,
            checkInTime: now,
            notes: input.notes ?? null,
          },
          include: INCLUDE,
        });
    await tx.auditLog.create({ data: { organizationId, actorId: userId, action: 'attendance.clock_in', entityType: 'AttendanceRecord', entityId: record.id, metadata: { workDate } } });
    return toAttendanceDto(record);
  }

  if (!existing?.checkInTime) {
    throw new HttpError(409, 'NOT_CLOCKED_IN', 'Clock in before clocking out');
  }
  if (existing.checkOutTime) {
    throw new HttpError(409, 'ALREADY_CLOCKED_OUT', 'You have already clocked out for this date');
  }
  const record = await tx.attendanceRecord.update({
    where: { id: existing.id },
    data: { checkOutTime: now, notes: input.notes ?? existing.notes },
    include: INCLUDE,
  });
  await tx.auditLog.create({ data: { organizationId, actorId: userId, action: 'attendance.clock_out', entityType: 'AttendanceRecord', entityId: record.id, metadata: { workDate } } });
  return toAttendanceDto(record);
}

export async function upsertAttendance(
  tx: Tx,
  organizationId: string,
  actorId: string,
  input: AttendanceUpsertInput
) {
  await requireEmployeeInOrg(tx, organizationId, input.employeeId);
  const workDate = dateValue(input.workDate);
  const existing = await tx.attendanceRecord.findUnique({
    where: { employeeId_workDate: { employeeId: input.employeeId, workDate } },
    select: { id: true },
  });
  const data = {
    organizationId,
    employeeId: input.employeeId,
    workDate,
    status: input.status,
    checkInTime: input.checkInTime ? new Date(input.checkInTime) : null,
    checkOutTime: input.checkOutTime ? new Date(input.checkOutTime) : null,
    notes: input.notes ?? null,
  };
  const record = existing
    ? await tx.attendanceRecord.update({ where: { id: existing.id }, data, include: INCLUDE })
    : await tx.attendanceRecord.create({ data, include: INCLUDE });
  await tx.auditLog.create({ data: { organizationId, actorId, action: existing ? 'attendance.updated' : 'attendance.created', entityType: 'AttendanceRecord', entityId: record.id, metadata: { employeeId: input.employeeId, workDate: input.workDate, status: input.status } } });
  return toAttendanceDto(record);
}
