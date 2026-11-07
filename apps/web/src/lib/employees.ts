import { api } from './api';
import type {
  DepartmentDto,
  EmployeeCreateInput,
  EmployeeDto,
  EmployeeFilters,
  EmployeeListResult,
  EmployeeStatus,
  EmployeeUpdateInput,
} from '../types';

function toQueryString(filters: EmployeeFilters): string {
  const params = new URLSearchParams();

  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.search?.trim()) params.set('search', filters.search.trim());
  if (filters.departmentId) params.set('departmentId', filters.departmentId);
  if (filters.status) params.set('status', filters.status);
  if (filters.sort) params.set('sort', filters.sort);
  if (filters.order) params.set('order', filters.order);

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function listEmployees(filters: EmployeeFilters): Promise<EmployeeListResult> {
  return api.get<EmployeeListResult>(`/employees${toQueryString(filters)}`);
}

export function getEmployee(id: string): Promise<{ employee: EmployeeDto }> {
  return api.get<{ employee: EmployeeDto }>(`/employees/${id}`);
}

export function createEmployee(input: EmployeeCreateInput): Promise<{ employee: EmployeeDto }> {
  return api.post<{ employee: EmployeeDto }>('/employees', input);
}

export function updateEmployee(
  id: string,
  input: EmployeeUpdateInput
): Promise<{ employee: EmployeeDto }> {
  return api.patch<{ employee: EmployeeDto }>(`/employees/${id}`, input);
}

export function changeEmployeeStatus(
  id: string,
  status: EmployeeStatus
): Promise<{ employee: EmployeeDto }> {
  return api.patch<{ employee: EmployeeDto }>(`/employees/${id}/status`, { status });
}

export function listDepartments(): Promise<{ departments: DepartmentDto[] }> {
  return api.get<{ departments: DepartmentDto[] }>('/departments');
}
