import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Ban,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Loader2,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
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
import { Modal } from '../components/ui/Modal';
import { ApiError } from '../lib/api';
import {
  approvePayrollRun,
  calculatePayrollRun,
  downloadPayrollRunCsv,
  getPayrollRun,
  payPayrollRun,
  voidPayrollRun,
} from '../lib/payroll';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, formatMoney } from '../lib/utils';
import type { PayrollRunDto, PayrollStatus, PayslipDto } from '../types';

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

export const PayrollRunDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const isHr = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'HR_MANAGER';

  const [run, setRun] = useState<PayrollRunDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const result = await getPayrollRun(id);
      setRun(result.run);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) setForbidden(true);
      else setError(caught instanceof ApiError ? caught.message : 'Could not load the payroll run.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const action = async (name: 'calculate' | 'approve' | 'pay' | 'export') => {
    if (!run) return;
    setPending(name);
    setError(null);
    try {
      if (name === 'calculate') await calculatePayrollRun(run.id);
      if (name === 'approve') await approvePayrollRun(run.id);
      if (name === 'pay') await payPayrollRun(run.id);
      if (name === 'export') {
        const { blob, filename } = await downloadPayrollRunCsv(run.id);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename ?? 'payroll.csv';
        anchor.click();
        URL.revokeObjectURL(url);
      }
      if (name !== 'export') await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Payroll action failed.');
    } finally {
      setPending(null);
    }
  };

  const submitVoid = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!run) return;
    setSaving(true);
    setError(null);
    try {
      await voidPayrollRun(run.id, voidReason);
      setVoidOpen(false);
      setVoidReason('');
      await load();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not void the payroll run.');
    } finally {
      setSaving(false);
    }
  };

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

  if (loading || !run) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-xs">Loading payroll run…</span>
      </div>
    );
  }

  const renderLines = (payslip: PayslipDto) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 bg-slate-50/60">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Earnings
        </p>
        {payslip.lines
          .filter((line) => line.kind === 'EARNING')
          .map((line) => (
            <div key={line.id} className="flex justify-between text-xs py-1">
              <span className="text-slate-600">{line.label}</span>
              <span className="font-medium text-slate-900">
                {formatMoney(Number(line.amount), payslip.currency)}
              </span>
            </div>
          ))}
      </div>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2">
          Deductions
        </p>
        {payslip.lines
          .filter((line) => line.kind === 'DEDUCTION')
          .map((line) => (
            <div key={line.id} className="flex justify-between text-xs py-1">
              <span className="text-slate-600">{line.label}</span>
              <span className="font-medium text-slate-900">
                {formatMoney(Number(line.amount), payslip.currency)}
              </span>
            </div>
          ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            to="/payroll"
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50"
            title="Back to payroll runs"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold text-slate-900">
                {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
              </h2>
              {statusBadge(run.status)}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Pay date {formatDate(run.payDate)} · {run.payslipCount} payslips
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(run.status === 'DRAFT' || run.status === 'CALCULATED') && isHr && (
            <Button
              variant="outline"
              icon={<Calculator className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => void action('calculate')}
            >
              Calculate
            </Button>
          )}
          {run.status === 'CALCULATED' && isHr && (
            <Button
              variant="outline"
              icon={<CheckCircle2 className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => void action('approve')}
            >
              Approve
            </Button>
          )}
          {run.status === 'APPROVED' && isHr && (
            <Button
              icon={<Send className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => void action('pay')}
            >
              Pay
            </Button>
          )}
          {(run.status === 'APPROVED' || run.status === 'PAID') && isHr && (
            <Button
              variant="danger"
              icon={<Ban className="w-4 h-4" />}
              disabled={pending !== null}
              onClick={() => setVoidOpen(true)}
            >
              Void
            </Button>
          )}
          <Button
            variant="outline"
            icon={<Download className="w-4 h-4" />}
            disabled={pending !== null}
            onClick={() => void action('export')}
          >
            CSV
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      {run.status === 'VOID' && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-amber-50 border-amber-200 text-amber-800">
          Voided{run.voidedAt ? ` on ${formatDate(run.voidedAt)}` : ''}
          {run.voidReason ? `: ${run.voidReason}` : ''}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Gross', value: run.totalGross },
          { label: 'Deductions', value: run.totalDeductions },
          { label: 'Net', value: run.totalNet },
        ].map((item) => (
          <Card key={item.label} className="p-4">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
              {item.label}
            </p>
            <p className="text-2xl font-bold text-slate-900 mt-2">
              {formatMoney(Number(item.value), run.payslips[0]?.currency ?? 'USD')}
            </p>
          </Card>
        ))}
        <Card className="p-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Employees
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-2">{run.payslipCount}</p>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payslips</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {run.payslips.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No payslips yet. Calculate the run to generate them.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Paid days</TableHead>
                    <TableHead className="text-right">Unpaid days</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.payslips.map((payslip) => (
                    <React.Fragment key={payslip.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpanded(expanded === payslip.id ? null : payslip.id)
                        }
                      >
                        <TableCell>
                          <div className="font-medium text-slate-900">{payslip.employeeName}</div>
                          <div className="text-[11px] text-slate-500">
                            {payslip.employeeNumber}
                          </div>
                        </TableCell>
                        <TableCell>{payslip.departmentName ?? '—'}</TableCell>
                        <TableCell className="text-right">{payslip.paidDays}</TableCell>
                        <TableCell className="text-right">{payslip.unpaidDays}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(Number(payslip.grossPay), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(Number(payslip.totalDeductions), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatMoney(Number(payslip.netPay), payslip.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {expanded === payslip.id ? (
                            <ChevronUp className="w-4 h-4 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400" />
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === payslip.id && (
                        <TableRow>
                          <TableCell colSpan={8} className="p-0">
                            {renderLines(payslip)}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal
        open={voidOpen}
        title="Void payroll run"
        description="Voiding keeps the payslips for audit but ends the run. A reason is required."
        onClose={() => setVoidOpen(false)}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setVoidOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="detail-void-form" variant="danger" disabled={saving}>
              {saving ? 'Voiding…' : 'Void run'}
            </Button>
          </div>
        }
      >
        <form id="detail-void-form" className="space-y-3" onSubmit={submitVoid}>
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
