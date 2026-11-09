import { api } from './api';
import type { AttendanceListResult, AttendanceRecordDto } from '../types';

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listAttendance(params: {
  page?: number;
  pageSize?: number;
  workDate?: string;
  status?: string;
}): Promise<AttendanceListResult> {
  return api.get<AttendanceListResult>(`/attendance${query(params)}`);
}

export function punchAttendance(input: {
  action: 'in' | 'out';
  workDate?: string;
  notes?: string | null;
}): Promise<{ record: AttendanceRecordDto }> {
  return api.post<{ record: AttendanceRecordDto }>('/attendance/punch', input);
}
