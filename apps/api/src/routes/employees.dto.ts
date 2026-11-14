import { EmployeeStatus, EmploymentType, Prisma } from '@prisma/client';

export type EmployeeWithDepartment = Prisma.EmployeeGetPayload<{
  include: { department: true };
}>;

export interface EmployeeDto {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  jobTitle: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinedAt: string;
  baseSalary: string;
  state: string | null;
  pfApplicable: boolean;
  esiApplicable: boolean;
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toEmployeeDto(employee: EmployeeWithDepartment): EmployeeDto {
  return {
    id: employee.id,
    employeeNumber: employee.employeeNumber,
    firstName: employee.firstName,
    lastName: employee.lastName,
    email: employee.email,
    phone: employee.phone,
    jobTitle: employee.jobTitle,
    employmentType: employee.employmentType,
    status: employee.status,
    joinedAt: employee.joinedAt.toISOString().slice(0, 10),
    baseSalary: employee.baseSalary.toFixed(2),
    state: employee.state,
    pfApplicable: employee.pfApplicable,
    esiApplicable: employee.esiApplicable,
    departmentId: employee.departmentId,
    departmentName: employee.department?.name ?? null,
    userId: employee.userId,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}
