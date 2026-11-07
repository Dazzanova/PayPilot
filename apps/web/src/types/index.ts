export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'HR_MANAGER' | 'MANAGER' | 'EMPLOYEE';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl?: string;
  organization: {
    id: string;
    name: string;
    plan: string;
  };
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description: string;
  headOfDepartment: string;
  employeeCount: number;
  allocatedBudget: number;
}

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACTOR' | 'INTERN';
export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'SUSPENDED' | 'TERMINATED';

export interface Employee {
  id: string;
  employeeNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  jobTitle: string;
  departmentId: string;
  departmentName: string;
  employmentType: EmploymentType;
  status: EmployeeStatus;
  joinedAt: string;
  baseSalary: number;
  avatarUrl?: string;
}

export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'REMOTE';

export interface AttendanceRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string;
  workDate: string;
  status: AttendanceStatus;
  checkInTime: string | null;
  checkOutTime: string | null;
  workDurationHours?: number;
}

export type LeaveType = 'ANNUAL' | 'SICK' | 'CASUAL' | 'MATERNITY' | 'PATERNITY' | 'UNPAID' | 'BEREAVEMENT';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNumber: string;
  departmentName: string;
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  totalDays: number;
  reason: string;
  status: LeaveStatus;
  reviewedBy?: string;
  createdAt: string;
}

export type PayrollStatus = 'DRAFT' | 'CALCULATING' | 'APPROVED' | 'PAID' | 'VOID';

export interface PayrollRun {
  id: string;
  periodName: string;
  periodStart: string;
  periodEnd: string;
  payDate: string;
  status: PayrollStatus;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  employeeCount: number;
}

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
  departmentId: string | null;
  departmentName: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DepartmentDto {
  id: string;
  name: string;
  code: string;
  description: string | null;
}

export interface EmployeeListResult {
  employees: EmployeeDto[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  summary: {
    total: number;
    active: number;
    onLeave: number;
    suspended: number;
    terminated: number;
  };
  sort: { field: string; order: string };
}

export interface EmployeeCreateInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  jobTitle: string;
  departmentId?: string | null;
  employmentType: EmploymentType;
  joinedAt: string;
  baseSalary: string;
}

export type EmployeeUpdateInput = Partial<EmployeeCreateInput>;

export interface EmployeeFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  departmentId?: string;
  status?: EmployeeStatus;
  sort?: 'lastName' | 'joinedAt' | 'employeeNumber' | 'createdAt';
  order?: 'asc' | 'desc';
}

export interface ActivityItem {
  id: string;
  actorName: string;
  action: string;
  target: string;
  timestamp: string;
  type: 'leave' | 'payroll' | 'employee' | 'attendance' | 'department';
}

export interface UpcomingBirthdayOrJoiner {
  id: string;
  employeeName: string;
  jobTitle: string;
  departmentName: string;
  type: 'birthday' | 'anniversary' | 'new_joiner';
  dateString: string;
  relativeBadge: string;
}
