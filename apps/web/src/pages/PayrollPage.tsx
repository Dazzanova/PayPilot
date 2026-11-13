import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  Banknote,
  Plus,
  RefreshCw,
  Download,
  Calculator,
  CheckCircle2,
  Send,
  Ban,
  Eye,
  Loader2,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import {
  approvePayrollRun,
  calculatePayrollRun,
  createPayrollRun,
  downloadPayrollRunCsv,
  listPayrollRuns,
  payPayrollRun,
  voidPayrollRun,
} from '../lib/payroll';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, formatMoney } from '../lib/utils';
import type { PayrollRunSummaryDto, PayrollStatus } from '../types';

const STATUS_LABELS: Record<PayrollStatus, string> = {
  DRAFT: 'Draft',
  CALCULATING: 'Calculating',
  CALCULATED: 'Calculated',
  APPROVED: 'Approved',
  PAID: 'Paid',
  VOID: 'Void',
};

function statusBadge(status: PayrollStatus) {
  const variant =
    status === 'PAID'
      ? 'success'
      : status === 'APPROVED'
        ? 'brand'
        : status === 'VOID'
          ? 'danger'
          : status === 'CALCULATED' || status === 'CALCULATING'
            ? 'info'
            : 'neutral';
  return (
    <Badge variant={variant} dot size="sm">
      {STATUS_LABELS[status]}
    </Badge>
  );
}

export const PayrollPage: React.FC = () => {
  const { user } = useAuth();
  const isHr = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_MANAGER';

  const [runs, setRuns] = useState<PayrollRunSummaryDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ periodStart: '', periodEnd: '', payDate: '' });
  const [voidTarget, setVoidTarget] = useState<PayrollRunSummaryDto | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await listPayrollRuns({ page: 1, pageSize: 50 });
      setRuns(result.runs);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setForbidden(true);
      else setError(caught instanceof ApiError ? caught.message : 'Could not load payroll runs.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (user?.role === 'EMPLOYEE') {
    return <Navigate to="/payroll/my-payslips" replace />;
  }

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1">You don’t have access to payroll runs.</p>
      </div>
    );
  }

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPayrollRun(form);
      setCreateOpen(false);
      setForm({ periodStart: '', periodEnd: '', payDate: '' });
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the payroll run.');
    } finally {
      setSaving(false);
    }
  };

  const runAction = async (
    id: string,
    action: 'calculate' | 'approve' | 'pay' | 'export'
  ) => {
    setPending(`${id}:${action}`);
    setError(null);
    try {
      if (action === 'calculate') await calculatePayrollRun(id);
      if (action === 'approve') await approvePayrollRun(id);
      if (action === 'pay') await payPayrollRun(id);
      if (action === 'export') {
        const { blob, filename } = await downloadPayrollRunCsv(id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename ?? 'payroll.csv';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      if (action !== 'export') await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Payroll action failed.');
    } finally {
      setPending(null);
    }
  };

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!voidTarget) return;
    setSaving(true);
    setError(null);
    try {
      await voidPayrollRun(voidTarget.id, voidReason);
      setVoidTarget(null);
      setVoidReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not void the payroll run.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Payroll Runs</h2>
          <p className="text-xs text-slate-500 mt-1">
            Calculate, approve, and disburse payroll from salary, attendance, and approved leave.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => void load()}
            disabled={loading}
          >
            Refresh
          </Button>
          {isHr && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => setCreateOpen(true)}>
              New Run
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading payroll runs…</span>
            </div>
          ) : runs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Banknote className="w-6 h-6" />}
                title="No payroll runs yet"
                description={
                  isHr
                    ? 'Create a run for a pay period, calculate it, then approve and pay.'
                    : 'Payroll runs will appear here once HR creates them.'
                }
                actionLabel={isHr ? 'New Run' : undefined}
                onAction={isHr ? () => setCreateOpen(true) : undefined}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Period</TableHead>
                    <TableHead>Pay date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Employees</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((run) => (
                    <TableRow key={run.id}>
                      <TableCell>
                        <Link
                          to={`/payroll/runs/${run.id}`}
                          className="font-medium text-slate-900 hover:text-brand-600"
                        >
                          {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                        </Link>
                      </TableCell>
                      <TableCell>{formatDate(run.payDate)}</TableCell>
                      <TableCell>{statusBadge(run.status)}</TableCell>
                      <TableCell className="text-right">{run.payslipCount}</TableCell>
                      <TableCell className="text-right">
                        {formatMoney(Number(run.totalGross))}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(Number(run.totalDeductions))}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(Number(run.totalNet))}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={`/payroll/runs/${run.id}`}
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100"
                            title="View detail"
                          >
                            <Eye className="w-4 h-4" />
                          </Link>
                          {(run.status === 'DRAFT' || run.status === 'CALCULATED') && isHr && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={
                                pending === `${run.id}:calculate` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Calculator className="w-3.5 h-3.5" />
                                )
                              }
                              disabled={pending !== null}
                              onClick={() => void runAction(run.id, 'calculate')}
                            >
                              Calculate
                            </Button>
                          )}
                          {run.status === 'CALCULATED' && isHr && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                              disabled={pending !== null}
                              onClick={() => void runAction(run.id, 'approve')}
                            >
                              Approve
                            </Button>
                          )}
                          {run.status === 'APPROVED' && isHr && (
                            <Button
                              size="sm"
                              icon={<Send className="w-3.5 h-3.5" />}
                              disabled={pending !== null}
                              onClick={() => void runAction(run.id, 'pay')}
                            >
                              Pay
                            </Button>
                          )}
                          {(run.status === 'APPROVED' || run.status === 'PAID') && isHr && (
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<Ban className="w-3.5 h-3.5" />}
                              disabled={pending !== null}
                              onClick={() => setVoidTarget(run)}
                            >
                              Void
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Download className="w-3.5 h-3.5" />}
                            disabled={pending !== null}
                            onClick={() => void runAction(run.id, 'export')}
                          >
                            CSV
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={createOpen}
        title="New payroll run"
        description="Choose the pay period and pay date. The run starts as a draft."
        onClose={() => setCreateOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="create-run-form" disabled={saving}>
              {saving ? 'Creating…' : 'Create run'}
            </Button>
          </div>
        }
      >
        <form id="create-run-form" className="space-y-4" onSubmit={submitCreate}>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Period start</label>
            <input
              type="date"
              required
              value={form.periodStart}
              onChange={(event) => setForm({ ...form, periodStart: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Period end</label>
            <input
              type="date"
              required
              value={form.periodEnd}
              onChange={(event) => setForm({ ...form, periodEnd: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Pay date</label>
            <input
              type="date"
              required
              value={form.payDate}
              onChange={(event) => setForm({ ...form, payDate: event.target.value })}
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
            />
          </div>
        </form>
      </Modal>

      <Modal
        open={voidTarget !== null}
        title="Void payroll run"
        description="Voiding keeps the payslips for audit but ends the run. A reason is required."
        onClose={() => setVoidTarget(null)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" form="void-run-form" variant="danger" disabled={saving}>
              {saving ? 'Voiding…' : 'Void run'}
            </Button>
          </div>
        }
      >
        <form id="void-run-form" className="space-y-3" onSubmit={submitVoid}>
          <textarea
            required
            rows={3}
            maxLength={500}
            value={voidReason}
            onChange={(event) => setVoidReason(event.target.value)}
            placeholder="Reason for voiding this run"
            className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2"
          />
        </form>
      </Modal>
    </div>
  );
};
