import { Prisma } from '@prisma/client';

export type AttendanceWithEmployee = Prisma.AttendanceRecordGetPayload<{
  include: {
    employee: {
      select: {
        firstName: true;
        lastName: true;
        employeeNumber: true;
        department: { select: { name: true } };
      };
    };
  };
}>;

export interface AttendanceRecordDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string | null;
  workDate: string;
  status: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toAttendanceDto(record: AttendanceWithEmployee): AttendanceRecordDto {
  return {
    id: record.id,
    employeeId: record.employeeId,
    employeeName: `${record.employee.firstName} ${record.employee.lastName}`,
    employeeNumber: record.employee.employeeNumber,
    departmentName: record.employee.department?.name ?? null,
    workDate: record.workDate.toISOString().slice(0, 10),
    status: record.status,
    checkInTime: record.checkInTime?.toISOString() ?? null,
    checkOutTime: record.checkOutTime?.toISOString() ?? null,
    notes: record.notes,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}
