import { Prisma } from '@prisma/client';
import { HttpError } from '../lib/httpError';
import { nextEmployeeNumber } from '../lib/employeeNumber';
import {
  EmployeeCreateInput,
  EmployeeListQuery,
  EmployeeUpdateInput,
} from './employees.schema';
import { EmployeeWithDepartment, toEmployeeDto } from './employees.dto';

const DEPARTMENT_INCLUDE = { department: true } as const;

type Tx = Prisma.TransactionClient;

async function allocateEmployeeNumber(tx: Tx, organizationId: string): Promise<string> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(
      hashtext(${organizationId}::text),
      hashtext('employee_number')
    )
  `;

  const existing = await tx.employee.findMany({
    where: { organizationId },
    select: { employeeNumber: true },
  });

  return nextEmployeeNumber(existing.map((row) => row.employeeNumber));
}

async function requireEmployee(
  tx: Tx,
  organizationId: string,
  employeeId: string
): Promise<EmployeeWithDepartment> {
  const employee = await tx.employee.findFirst({
    where: { id: employeeId, organizationId },
    include: DEPARTMENT_INCLUDE,
  });

  if (!employee) {
    throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
  }

  return employee;
}

async function assertDepartment(
  tx: Tx,
  organizationId: string,
  departmentId: string | null | undefined
): Promise<void> {
  if (!departmentId) {
    return;
  }

  const department = await tx.department.findFirst({
    where: { id: departmentId, organizationId },
    select: { id: true },
  });

  if (!department) {
    throw new HttpError(400, 'INVALID_DEPARTMENT', 'Department does not exist in this organization');
  }
}

function isRecordNotFound(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2025'
  );
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2003'
  );
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function isUniqueViolation(error: unknown, target: string): boolean {
  const normalize = (value: unknown) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/_/g, '');

  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002' &&
    normalize(error.meta?.target).includes(normalize(target))
  );
}

async function writeAudit(
  tx: Tx,
  organizationId: string,
  actorId: string,
  action: string,
  employeeId: string,
  metadata: Prisma.InputJsonValue
): Promise<void> {
  await tx.auditLog.create({
    data: {
      organizationId,
      actorId,
      action,
      entityType: 'Employee',
      entityId: employeeId,
      metadata,
    },
  });
}

export interface EmployeeListResult {
  employees: ReturnType<typeof toEmployeeDto>[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    active: number;
    onLeave: number;
    suspended: number;
    terminated: number;
  };
  sort: { field: EmployeeListQuery['sort']; order: EmployeeListQuery['order'] };
}

export async function listEmployees(
  tx: Tx,
  organizationId: string,
  query: EmployeeListQuery
): Promise<EmployeeListResult> {
  const where: Prisma.EmployeeWhereInput = { organizationId };

  const orderBy: Prisma.EmployeeOrderByWithRelationInput[] = [
    { [query.sort]: query.order },
    { id: 'asc' },
  ];

  if (query.search) {
    const search = escapeLikePattern(query.search);
    where.OR = [
      { firstName: { contains: search, mode: 'insensitive' } },
      { lastName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { employeeNumber: { contains: search, mode: 'insensitive' } },
      { jobTitle: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (query.departmentId) {
    where.departmentId = query.departmentId;
  }
  if (query.status) {
    where.status = query.status;
  }

  const [total, employees, grouped] = await Promise.all([
    tx.employee.count({ where }),
    tx.employee.findMany({
      where,
      include: DEPARTMENT_INCLUDE,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    tx.employee.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map(grouped.map((row) => [row.status, row._count._all]));
  const summaryTotal = grouped.reduce((sum, row) => sum + row._count._all, 0);

  return {
    employees: employees.map(toEmployeeDto),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary: {
      total: summaryTotal,
      active: counts.get('ACTIVE') ?? 0,
      onLeave: counts.get('ON_LEAVE') ?? 0,
      suspended: counts.get('SUSPENDED') ?? 0,
      terminated: counts.get('TERMINATED') ?? 0,
    },
    sort: { field: query.sort, order: query.order },
  };
}

export async function getEmployee(tx: Tx, organizationId: string, employeeId: string) {
  const employee = await requireEmployee(tx, organizationId, employeeId);
  return toEmployeeDto(employee);
}

export async function createEmployee(
  tx: Tx,
  organizationId: string,
  actorId: string,
  input: EmployeeCreateInput
) {
  await assertDepartment(tx, organizationId, input.departmentId);

  const employeeNumber = await allocateEmployeeNumber(tx, organizationId);

  try {
    const employee = await tx.employee.create({
      data: {
        organizationId,
        employeeNumber,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle,
        employmentType: input.employmentType,
        joinedAt: new Date(`${input.joinedAt}T00:00:00.000Z`),
        baseSalary: new Prisma.Decimal(input.baseSalary),
        departmentId: input.departmentId ?? null,
      },
      include: DEPARTMENT_INCLUDE,
    });

    await writeAudit(tx, organizationId, actorId, 'employee.created', employee.id, {
      employeeNumber: employee.employeeNumber,
    });

    return toEmployeeDto(employee);
  } catch (error) {
    if (isUniqueViolation(error, 'email')) {
      throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'An employee with this email already exists');
    }
    if (isUniqueViolation(error, 'employee_number')) {
      throw new HttpError(409, 'DUPLICATE_EMPLOYEE_NUMBER', 'Could not allocate a unique employee number');
    }
    if (isForeignKeyViolation(error)) {
      throw new HttpError(
        400,
        'INVALID_DEPARTMENT',
        'Department does not exist in this organization'
      );
    }
    throw error;
  }
}

export async function updateEmployee(
  tx: Tx,
  organizationId: string,
  actorId: string,
  employeeId: string,
  input: EmployeeUpdateInput
) {
  const existing = await requireEmployee(tx, organizationId, employeeId);

  if (input.departmentId !== undefined) {
    await assertDepartment(tx, organizationId, input.departmentId);
  }

  const data: Prisma.EmployeeUpdateInput = {};
  const changedFields: string[] = [];

  if (input.firstName !== undefined && input.firstName !== existing.firstName) {
    data.firstName = input.firstName;
    changedFields.push('firstName');
  }
  if (input.lastName !== undefined && input.lastName !== existing.lastName) {
    data.lastName = input.lastName;
    changedFields.push('lastName');
  }
  if (input.email !== undefined && input.email !== existing.email) {
    data.email = input.email;
    changedFields.push('email');
  }
  if (input.phone !== undefined && input.phone !== existing.phone) {
    data.phone = input.phone;
    changedFields.push('phone');
  }
  if (input.jobTitle !== undefined && input.jobTitle !== existing.jobTitle) {
    data.jobTitle = input.jobTitle;
    changedFields.push('jobTitle');
  }
  if (
    input.employmentType !== undefined &&
    input.employmentType !== existing.employmentType
  ) {
    data.employmentType = input.employmentType;
    changedFields.push('employmentType');
  }
  if (input.joinedAt !== undefined) {
    const joinedAt = new Date(`${input.joinedAt}T00:00:00.000Z`);
    if (joinedAt.getTime() !== existing.joinedAt.getTime()) {
      data.joinedAt = joinedAt;
      changedFields.push('joinedAt');
    }
  }
  if (input.baseSalary !== undefined) {
    const baseSalary = new Prisma.Decimal(input.baseSalary);
    if (!baseSalary.equals(existing.baseSalary)) {
      data.baseSalary = baseSalary;
      changedFields.push('baseSalary');
    }
  }
  if (input.departmentId !== undefined && input.departmentId !== existing.departmentId) {
    data.department = input.departmentId
      ? { connect: { id: input.departmentId } }
      : { disconnect: true };
    changedFields.push('departmentId');
  }

  if (changedFields.length === 0) {
    return toEmployeeDto(existing);
  }

  try {
    const employee = await tx.employee.update({
      where: { id: employeeId, organizationId },
      data,
      include: DEPARTMENT_INCLUDE,
    });

    await writeAudit(tx, organizationId, actorId, 'employee.updated', employee.id, {
      changedFields,
    });

    return toEmployeeDto(employee);
  } catch (error) {
    if (isUniqueViolation(error, 'email')) {
      throw new HttpError(409, 'EMAIL_ALREADY_EXISTS', 'An employee with this email already exists');
    }
    if (isRecordNotFound(error)) {
      throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }
    if (isForeignKeyViolation(error)) {
      throw new HttpError(
        400,
        'INVALID_DEPARTMENT',
        'Department does not exist in this organization'
      );
    }
    throw error;
  }
}

export async function changeEmployeeStatus(
  tx: Tx,
  organizationId: string,
  actorId: string,
  employeeId: string,
  status: EmployeeWithDepartment['status']
) {
  const existing = await requireEmployee(tx, organizationId, employeeId);

  if (existing.status === status) {
    return toEmployeeDto(existing);
  }

  let employee: EmployeeWithDepartment;

  try {
    employee = await tx.employee.update({
      where: { id: employeeId, organizationId },
      data: { status },
      include: DEPARTMENT_INCLUDE,
    });
  } catch (error) {
    if (isRecordNotFound(error)) {
      throw new HttpError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found');
    }
    throw error;
  }

  await writeAudit(tx, organizationId, actorId, 'employee.status_changed', employee.id, {
    from: existing.status,
    to: status,
  });

  return toEmployeeDto(employee);
}
