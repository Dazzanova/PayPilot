import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Receipt,
  RefreshCw,
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
import { EmptyState } from '../components/ui/EmptyState';
import { ApiError } from '../lib/api';
import { listMyPayslips } from '../lib/payroll';
import { formatDate, formatMoney } from '../lib/utils';
import type { PayslipDto } from '../types';

function payslipStatusBadge(status: PayslipDto['status']) {
  if (status === 'PAID') {
    return (
      <Badge variant="success" dot size="sm">
        Paid
      </Badge>
    );
  }
  if (status === 'ISSUED') {
    return (
      <Badge variant="brand" dot size="sm">
        Issued
      </Badge>
    );
  }
  return (
    <Badge variant="neutral" size="sm">
      Draft
    </Badge>
  );
}

export const MyPayslipsPage: React.FC = () => {
  const [payslips, setPayslips] = useState<PayslipDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listMyPayslips();
      setPayslips(result.payslips);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your payslips.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">My Payslips</h2>
          <p className="text-xs text-slate-500 mt-1">
            Your pay history, with earnings and deduction breakdowns.
          </p>
        </div>
        <Button
          variant="outline"
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={() => void load()}
          disabled={loading}
        >
          Refresh
        </Button>
      </div>

      {error && (
        <div className="px-3 py-2 rounded-lg text-xs border bg-rose-50 border-rose-200 text-rose-700">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pay history</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-xs">Loading payslips…</span>
            </div>
          ) : payslips.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Receipt className="w-6 h-6" />}
                title="No payslips yet"
                description="Payslips appear here after HR calculates and approves a payroll run."
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
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">Deductions</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payslips.map((payslip) => (
                    <React.Fragment key={payslip.id}>
                      <TableRow
                        className="cursor-pointer"
                        onClick={() =>
                          setExpanded(expanded === payslip.id ? null : payslip.id)
                        }
                      >
                        <TableCell className="font-medium text-slate-900">
                          {formatDate(payslip.periodStart)} – {formatDate(payslip.periodEnd)}
                        </TableCell>
                        <TableCell>{formatDate(payslip.payDate)}</TableCell>
                        <TableCell>{payslipStatusBadge(payslip.status)}</TableCell>
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
                          <TableCell colSpan={7} className="p-0">
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
    </div>
  );
};
