import React, { useState, useMemo } from 'react';
import {
  CalendarOff,
  Plus,
  Clock,
  CheckCircle2,
  XCircle,
  Calendar,
} from 'lucide-react';
import { mockLeaveRequests } from '../data/mockData';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';
import { formatDate } from '../lib/utils';
import { LeaveStatus } from '../types';

export const LeavePage: React.FC = () => {
  const [statusFilter, setStatusFilter] = useState<'ALL' | LeaveStatus>('ALL');
  const [showApplyModal, setShowApplyModal] = useState(false);

  const filteredRequests = useMemo(() => {
    if (statusFilter === 'ALL') return mockLeaveRequests;
    return mockLeaveRequests.filter((r) => r.status === statusFilter);
  }, [statusFilter]);

  const pendingCount = mockLeaveRequests.filter((r) => r.status === 'PENDING').length;
  const approvedCount = mockLeaveRequests.filter((r) => r.status === 'APPROVED').length;
  const rejectedCount = mockLeaveRequests.filter((r) => r.status === 'REJECTED').length;

  const getStatusBadge = (status: LeaveStatus) => {
    switch (status) {
      case 'PENDING':
        return <Badge variant="warning" dot size="sm">Pending Review</Badge>;
      case 'APPROVED':
        return <Badge variant="success" dot size="sm">Approved</Badge>;
      case 'REJECTED':
        return <Badge variant="danger" dot size="sm">Rejected</Badge>;
      case 'CANCELLED':
        return <Badge variant="neutral" size="sm">Cancelled</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <DemoDisclaimer moduleName="leave management" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Leave Requests & Approvals</h2>
          <p className="text-xs text-slate-500 mt-1">
            Track annual leaves, sick days, family leaves, and manager approval queues.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowApplyModal(true)}
        >
          Request Time Off
        </Button>
      </div>

      {/* Status KPI Counters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          className={`p-4 cursor-pointer transition-all ${
            statusFilter === 'PENDING' ? 'ring-2 ring-amber-500 bg-amber-50/20' : ''
          }`}
          onClick={() => setStatusFilter(statusFilter === 'PENDING' ? 'ALL' : 'PENDING')}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Awaiting Decision</span>
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-2xl font-bold text-amber-600 mt-2">{pendingCount}</p>
          <span className="text-[11px] text-slate-400 mt-1 block">Requires manager review</span>
        </Card>

        <Card
          className={`p-4 cursor-pointer transition-all ${
            statusFilter === 'APPROVED' ? 'ring-2 ring-emerald-500 bg-emerald-50/20' : ''
          }`}
          onClick={() => setStatusFilter(statusFilter === 'APPROVED' ? 'ALL' : 'APPROVED')}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Approved Requests</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-2xl font-bold text-emerald-600 mt-2">{approvedCount}</p>
          <span className="text-[11px] text-slate-400 mt-1 block">Scheduled for calendar sync</span>
        </Card>

        <Card
          className={`p-4 cursor-pointer transition-all ${
            statusFilter === 'REJECTED' ? 'ring-2 ring-rose-500 bg-rose-50/20' : ''
          }`}
          onClick={() => setStatusFilter(statusFilter === 'REJECTED' ? 'ALL' : 'REJECTED')}
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Rejected Requests</span>
            <XCircle className="w-4 h-4 text-rose-500" />
          </div>
          <p className="text-2xl font-bold text-rose-600 mt-2">{rejectedCount}</p>
          <span className="text-[11px] text-slate-400 mt-1 block">Historical rejected applications</span>
        </Card>
      </div>

      {/* Leave Requests Table */}
      <Card>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-800">
              Applications ({filteredRequests.length})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                statusFilter === 'ALL'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('PENDING')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                statusFilter === 'PENDING'
                  ? 'bg-amber-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Pending
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('APPROVED')}
              className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                statusFilter === 'APPROVED'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              Approved
            </button>
          </div>
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Leave Type</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reviewer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.map((req) => (
                <TableRow key={req.id}>
                  <TableCell>
                    <div>
                      <div className="font-semibold text-slate-900 text-xs">
                        {req.employeeName}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {req.employeeNumber}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {req.departmentName}
                  </TableCell>
                  <TableCell>
                    <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                      {req.leaveType}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-700">
                    {formatDate(req.startDate)} - {formatDate(req.endDate)}
                  </TableCell>
                  <TableCell className="text-xs font-semibold text-slate-800">
                    {req.totalDays} {req.totalDays === 1 ? 'day' : 'days'}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500 max-w-xs truncate">
                    {req.reason}
                  </TableCell>
                  <TableCell>{getStatusBadge(req.status)}</TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {req.reviewedBy || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Demo Modal */}
      {showApplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mb-4">
              <CalendarOff className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Leave Application Form (Demo)</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Workflow multi-step approval rules, entitlement balance validation, and automated calendar invitations are scheduled for the leave workflow increment.
            </p>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowApplyModal(false)}>
                Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
