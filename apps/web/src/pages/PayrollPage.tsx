import React, { useState } from 'react';
import {
  Banknote,
  DollarSign,
  TrendingDown,
  Calendar,
  Plus,
  Receipt,
  FileCheck2,
} from 'lucide-react';
import { mockPayrollRuns } from '../data/mockData';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';
import { formatCurrency, formatDate } from '../lib/utils';
import { PayrollStatus } from '../types';

export const PayrollPage: React.FC = () => {
  const [showRunModal, setShowRunModal] = useState(false);
  const activeCycle = mockPayrollRuns[1]; // October 2026 cycle

  const getStatusBadge = (status: PayrollStatus) => {
    switch (status) {
      case 'PAID':
        return <Badge variant="success" dot size="sm">Disbursed (Paid)</Badge>;
      case 'APPROVED':
        return <Badge variant="brand" dot size="sm">Approved for Payout</Badge>;
      case 'DRAFT':
        return <Badge variant="neutral" dot size="sm">Draft Period</Badge>;
      case 'CALCULATING':
        return <Badge variant="warning" dot size="sm">Calculating...</Badge>;
      case 'VOID':
        return <Badge variant="danger" size="sm">Void</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <DemoDisclaimer moduleName="payroll management" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Payroll Cycles & Payslips</h2>
          <p className="text-xs text-slate-500 mt-1">
            Review monthly salary batches, tax deduction calculations, and individual employee payslips.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowRunModal(true)}
        >
          New Payroll Cycle
        </Button>
      </div>

      {/* Active Run Overview Card */}
      <Card className="border-brand-200 bg-gradient-to-br from-white to-brand-50/20">
        <CardHeader>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-brand-700 uppercase tracking-wider">
                Current Scheduled Cycle
              </span>
              {getStatusBadge(activeCycle.status)}
            </div>
            <CardTitle className="text-lg mt-1">{activeCycle.periodName}</CardTitle>
            <CardDescription>
              Pay date scheduled for {formatDate(activeCycle.payDate)} • {activeCycle.employeeCount} active payees
            </CardDescription>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-500 block">Total Net Disbursement</span>
            <span className="text-2xl font-bold text-slate-900">
              {formatCurrency(activeCycle.totalNet)}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
            <div className="p-3.5 bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <DollarSign className="w-4 h-4 text-emerald-600" />
                <span>Gross Compensation</span>
              </div>
              <p className="text-lg font-bold text-slate-900 mt-1">
                {formatCurrency(activeCycle.totalGross)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <TrendingDown className="w-4 h-4 text-rose-600" />
                <span>Statutory & Tax Deductions</span>
              </div>
              <p className="text-lg font-bold text-slate-900 mt-1">
                {formatCurrency(activeCycle.totalDeductions)}
              </p>
            </div>

            <div className="p-3.5 bg-white rounded-lg border border-slate-200">
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <Receipt className="w-4 h-4 text-brand-600" />
                <span>Generated Payslips</span>
              </div>
              <p className="text-lg font-bold text-slate-900 mt-1">
                {activeCycle.employeeCount} / {activeCycle.employeeCount}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Historical Runs Table */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Historical Payroll Batches</CardTitle>
            <CardDescription>Past and upcoming batch salary distributions</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cycle Description</TableHead>
                <TableHead>Period Window</TableHead>
                <TableHead>Disbursement Date</TableHead>
                <TableHead>Payees</TableHead>
                <TableHead>Gross</TableHead>
                <TableHead>Deductions</TableHead>
                <TableHead>Net Total</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockPayrollRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 rounded-md bg-slate-100 text-slate-600">
                        <FileCheck2 className="w-4 h-4" />
                      </div>
                      <span className="font-semibold text-xs text-slate-900">
                        {run.periodName}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      {formatDate(run.periodStart)} – {formatDate(run.periodEnd)}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {formatDate(run.payDate)}
                  </TableCell>
                  <TableCell className="text-xs font-medium text-slate-800">
                    {run.employeeCount} staff
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {formatCurrency(run.totalGross)}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatCurrency(run.totalDeductions)}
                  </TableCell>
                  <TableCell className="text-xs font-bold text-slate-900">
                    {formatCurrency(run.totalNet)}
                  </TableCell>
                  <TableCell>{getStatusBadge(run.status)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Demo Modal */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
              <Banknote className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Payroll Calculation Engine (Demo)</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Automated payroll calculation, statutory tax deduction engines, PDF payslip compilation, and bank ACH disbursements are under development for Phase 2.
            </p>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowRunModal(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
