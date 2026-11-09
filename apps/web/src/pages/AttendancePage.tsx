import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, CheckCircle, Clock, Laptop, Loader2, LogIn, LogOut, RefreshCw, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { ApiError } from '../lib/api';
import { listAttendance, punchAttendance } from '../lib/attendance';
import { formatDate } from '../lib/utils';
import type { AttendanceListResult, AttendanceStatus } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const AttendancePage: React.FC = () => {
  const [workDate, setWorkDate] = useState(today());
  const [data, setData] = useState<AttendanceListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<'in' | 'out' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await listAttendance({ workDate, page: 1, pageSize: 100 });
      setData(result);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setForbidden(true);
      else setError(caught instanceof ApiError ? caught.message : 'Could not load attendance.');
    } finally {
      setLoading(false);
    }
  }, [workDate]);

  useEffect(() => { void load(); }, [load]);

  const punch = async (action: 'in' | 'out') => {
    setActing(action);
    setError(null);
    setNotice(null);
    try {
      await punchAttendance({ action, workDate });
      setNotice(action === 'in' ? 'Clocked in successfully.' : 'Clocked out successfully.');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Punch action failed.');
    } finally {
      setActing(null);
    }
  };

  const getStatusBadge = (status: AttendanceStatus) => {
    switch (status) {
      case 'PRESENT': return <Badge variant="success" dot size="sm">Present</Badge>;
      case 'REMOTE': return <Badge variant="info" dot size="sm">Remote</Badge>;
      case 'HALF_DAY': return <Badge variant="warning" dot size="sm">Half Day</Badge>;
      case 'ON_LEAVE': return <Badge variant="danger" dot size="sm">On Leave</Badge>;
      case 'ABSENT': return <Badge variant="danger" size="sm">Absent</Badge>;
      default: return <Badge variant="neutral" size="sm">{status}</Badge>;
    }
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3"><ShieldAlert className="w-6 h-6" /></div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1">You don’t have access to attendance records.</p>
      </div>
    );
  }

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Attendance & Time Logs</h2>
          <p className="text-xs text-slate-500 mt-1">Daily attendance records and self-service clock in/out.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" icon={acting === 'in' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />} onClick={() => void punch('in')} disabled={!!acting}>Clock In</Button>
          <Button variant="outline" icon={acting === 'out' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />} onClick={() => void punch('out')} disabled={!!acting}>Clock Out</Button>
        </div>
      </div>

      {(error || notice) && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${error ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {error ?? notice}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4"><div className="flex items-center gap-2 text-emerald-600"><CheckCircle className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Present</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{summary?.present ?? 0}</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-sky-600"><Laptop className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Remote</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{summary?.remote ?? 0}</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-amber-600"><Clock className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Half Day</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{summary?.halfDay ?? 0}</p></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-rose-600"><Calendar className="w-4 h-4" /><span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Leave/Absent</span></div><p className="text-2xl font-bold text-slate-900 mt-2">{(summary?.onLeave ?? 0) + (summary?.absent ?? 0)}</p></Card>
      </div>

      <Card>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 gap-3">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <label className="text-xs font-semibold text-slate-800" htmlFor="attendance-date">Work Date</label>
            <input id="attendance-date" type="date" value={workDate} onChange={(e) => setWorkDate(e.target.value)} className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-700" />
          </div>
          <Button variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => void load()} disabled={loading}>Refresh</Button>
        </div>
        <CardContent className="p-0">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> Loading attendance…</div>
          ) : !data || data.records.length === 0 ? (
            <EmptyState icon={<Calendar className="w-6 h-6" />} title="No attendance records" description="No records found for the selected date." className="m-4" />
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Department</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Check In</TableHead><TableHead>Check Out</TableHead></TableRow></TableHeader>
              <TableBody>
                {data.records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell><div><p className="text-xs font-semibold text-slate-800">{record.employeeName}</p><p className="text-[10px] text-slate-400">{record.employeeNumber}</p></div></TableCell>
                    <TableCell className="text-xs text-slate-600">{record.departmentName ?? '—'}</TableCell>
                    <TableCell className="text-xs text-slate-600">{formatDate(record.workDate)}</TableCell>
                    <TableCell>{getStatusBadge(record.status)}</TableCell>
                    <TableCell className="text-xs text-slate-600">{record.checkInTime ? new Date(record.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                    <TableCell className="text-xs text-slate-600">{record.checkOutTime ? new Date(record.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
