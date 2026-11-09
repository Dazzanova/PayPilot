import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, Clock, CheckCircle, XCircle, Plus, Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import { createLeaveRequest, listLeaveRequests, reviewLeaveRequest } from '../lib/leave';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../lib/utils';
import type { LeaveListResult, LeaveStatus, LeaveType } from '../types';

const LEAVE_TYPES: LeaveType[] = ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'BEREAVEMENT'];

export const LeavePage: React.FC = () => {
  const { user } = useAuth();
  const isHr = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_MANAGER';
  const [statusFilter, setStatusFilter] = useState<'ALL' | LeaveStatus>('ALL');
  const [data, setData] = useState<LeaveListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [form, setForm] = useState({ leaveType: 'ANNUAL' as LeaveType, startDate: '', endDate: '', reason: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await listLeaveRequests({ page: 1, pageSize: 100, status: statusFilter === 'ALL' ? undefined : statusFilter });
      setData(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setForbidden(true);
      else setError(caught instanceof ApiError ? caught.message : 'Could not load leave requests.');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { void load(); }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createLeaveRequest(form);
      setOpen(false);
      setForm({ leaveType: 'ANNUAL', startDate: '', endDate: '', reason: '' });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not submit leave request.');
    } finally {
      setSaving(false);
    }
  };

  const review = async (id: string, action: 'approve' | 'reject') => {
    setReviewing(`${id}:${action}`);
    setError(null);
    try {
      await reviewLeaveRequest(id, action);
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Review action failed.');
    } finally {
      setReviewing(null);
    }
  };

  const getStatusBadge = (status: LeaveStatus) => {
    switch (status) {
      case 'APPROVED': return <Badge variant="success" dot size="sm">Approved</Badge>;
      case 'PENDING': return <Badge variant="warning" dot size="sm">Pending</Badge>;
      case 'REJECTED': return <Badge variant="danger" dot size="sm">Rejected</Badge>;
      case 'CANCELLED': return <Badge variant="neutral" size="sm">Cancelled</Badge>;
      default: return <Badge variant="neutral" size="sm">{status}</Badge>;
    }
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3"><ShieldAlert className="w-6 h-6" /></div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1">You don’t have access to leave requests.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Leave Requests</h2>
          <p className="text-xs text-slate-500 mt-1">Submit time-off requests and review pending approvals.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={<RefreshCw className="w-4 h-4" />} onClick={() => void load()} disabled={loading}>Refresh</Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => setOpen(true)}>New Leave Request</Button>
        </div>
      </div>

      {error && <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="p-4"><div className="flex items-center gap-2 text-amber-600"><Clock className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Pending</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{data?.summary.pending ?? 0}</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-emerald-600"><CheckCircle className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Approved</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{data?.summary.approved ?? 0}</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-rose-600"><XCircle className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Rejected</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{data?.summary.rejected ?? 0}</p></Card>
      </div>

      <Card>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2 text-slate-600"><Calendar className="w-4 h-4" /><span className="text-xs font-semibold">Leave requests</span></div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'ALL' | LeaveStatus)} className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700">
            <option value="ALL">All Statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading leave requests…</div>
          ) : !data || data.requests.length === 0 ? (
            <EmptyState icon={<Calendar className="w-6 h-6" />} title="No leave requests" description="No requests match the current filter." className="m-4" />
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Type</TableHead><TableHead>Dates</TableHead><TableHead>Days</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.requests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell><div><p className="text-xs font-semibold text-slate-800">{request.employeeName}</p><p className="text-[10px] text-slate-400">{request.employeeNumber}</p></div></TableCell>
                    <TableCell className="text-xs text-slate-600">{request.leaveType}</TableCell>
                    <TableCell className="text-xs text-slate-600">{formatDate(request.startDate)} – {formatDate(request.endDate)}</TableCell>
                    <TableCell className="text-xs text-slate-600">{request.totalDays}</TableCell>
                    <TableCell>{getStatusBadge(request.status)}</TableCell>
                    <TableCell className="text-right">
                      {request.status === 'PENDING' && isHr ? (
                        <div className="inline-flex gap-1.5">
                          <Button size="sm" variant="outline" onClick={() => void review(request.id, 'approve')} disabled={!!reviewing}>{reviewing === `${request.id}:approve` ? '…' : 'Approve'}</Button>
                          <Button size="sm" variant="ghost" onClick={() => void review(request.id, 'reject')} disabled={!!reviewing}>{reviewing === `${request.id}:reject` ? '…' : 'Reject'}</Button>
                        </div>
                      ) : <span className="text-[11px] text-slate-400">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="New Leave Request">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Leave Type</label>
            <select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value as LeaveType })} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2">
              {LEAVE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-slate-700 mb-1">Start Date</label><input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" /></div>
            <div><label className="block text-xs font-medium text-slate-700 mb-1">End Date</label><input required type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" /></div>
          </div>
          <div><label className="block text-xs font-medium text-slate-700 mb-1">Reason</label><textarea required minLength={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2" rows={3} /></div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Submitting…' : 'Submit Request'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
