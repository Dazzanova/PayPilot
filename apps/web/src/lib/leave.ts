import { api } from './api';
import type { LeaveListResult, LeaveRequestDto, LeaveType } from '../types';

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listLeaveRequests(params: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<LeaveListResult> {
  return api.get<LeaveListResult>(`/leave-requests${query(params)}`);
}

export function createLeaveRequest(input: {
  leaveType: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
}): Promise<{ request: LeaveRequestDto }> {
  return api.post<{ request: LeaveRequestDto }>('/leave-requests', input);
}

export function reviewLeaveRequest(
  id: string,
  action: 'approve' | 'reject'
): Promise<{ request: LeaveRequestDto }> {
  return api.patch<{ request: LeaveRequestDto }>(`/leave-requests/${id}/review`, { action });
}
