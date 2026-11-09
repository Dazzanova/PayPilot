import { Prisma } from '@prisma/client';

export type LeaveWithRelations = Prisma.LeaveRequestGetPayload<{
  include: {
    employee: {
      select: {
        firstName: true;
        lastName: true;
        employeeNumber: true;
        department: { select: { name: true } };
      };
    };
    reviewedBy: { select: { email: true } };
  };
}>;

export interface LeaveRequestDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string | null;
  leaveType: string;
  startDate: string;
  endDate: string;
  totalDays: string;
  reason: string;
  status: string;
  reviewedByEmail: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function daysBetween(start: string, end: string): string {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return (Math.floor(ms / 86400000) + 1).toFixed(1);
}

export function totalDays(start: string, end: string): string {
  return daysBetween(start, end);
}

export function toLeaveDto(row: LeaveWithRelations): LeaveRequestDto {
  return {
    id: row.id,
    employeeId: row.employeeId,
    employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
    employeeNumber: row.employee.employeeNumber,
    departmentName: row.employee.department?.name ?? null,
    leaveType: row.leaveType,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    totalDays: row.totalDays.toFixed(1),
    reason: row.reason,
    status: row.status,
    reviewedByEmail: row.reviewedBy?.email ?? null,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
