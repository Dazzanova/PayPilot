import React, { useState } from 'react';
import {
  CalendarCheck,
  Clock,
  Laptop,
  AlertCircle,
  Calendar,
  CheckCircle,
} from 'lucide-react';
import { mockAttendanceRecords } from '../data/mockData';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';
import { formatDate } from '../lib/utils';
import { AttendanceStatus } from '../types';

export const AttendancePage: React.FC = () => {
  const [showPunchModal, setShowPunchModal] = useState(false);

  const getStatusBadge = (status: AttendanceStatus) => {
    switch (status) {
      case 'PRESENT':
        return <Badge variant="success" dot size="sm">Present (On-Site)</Badge>;
      case 'REMOTE':
        return <Badge variant="info" dot size="sm">Remote</Badge>;
      case 'HALF_DAY':
        return <Badge variant="warning" dot size="sm">Half Day</Badge>;
      case 'ON_LEAVE':
        return <Badge variant="danger" dot size="sm">On Leave</Badge>;
      default:
        return <Badge variant="neutral" size="sm">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <DemoDisclaimer moduleName="attendance tracking" />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Attendance & Time Logs</h2>
          <p className="text-xs text-slate-500 mt-1">
            Monitor daily employee punch records, on-site presence, remote check-ins, and shift durations.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            icon={<Clock className="w-4 h-4" />}
            onClick={() => setShowPunchModal(true)}
          >
            Clock In / Out (Demo)
          </Button>
        </div>
      </div>

      {/* Attendance Stats Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-emerald-600">
            <CheckCircle className="w-4 h-4" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">On-Site Present</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">126</p>
          <span className="text-[11px] text-slate-400 mt-1 block">81.8% of roster</span>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-sky-600">
            <Laptop className="w-4 h-4" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Remote Check-In</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">21</p>
          <span className="text-[11px] text-slate-400 mt-1 block">13.6% of roster</span>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-amber-600">
            <Clock className="w-4 h-4" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Half Day</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">3</p>
          <span className="text-[11px] text-slate-400 mt-1 block">Approved half shifts</span>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-2 text-rose-600">
            <AlertCircle className="w-4 h-4" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Absent / Leave</span>
          </div>
          <p className="text-2xl font-bold text-slate-900 mt-2">4</p>
          <span className="text-[11px] text-slate-400 mt-1 block">Approved time-off</span>
        </Card>
      </div>

      {/* Table Container */}
      <Card>
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-semibold text-slate-800">
              Work Date: October 13, 2026 (Demo Day)
            </span>
          </div>
          <Badge variant="brand" size="sm">
            Live Daily View
          </Badge>
        </div>

        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Work Date</TableHead>
                <TableHead>Attendance Status</TableHead>
                <TableHead>Check-In</TableHead>
                <TableHead>Check-Out</TableHead>
                <TableHead>Work Hours</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockAttendanceRecords.map((att) => (
                <TableRow key={att.id}>
                  <TableCell>
                    <div>
                      <div className="font-semibold text-slate-900 text-xs">
                        {att.employeeName}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {att.employeeNumber}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {att.departmentName}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(att.workDate)}
                  </TableCell>
                  <TableCell>{getStatusBadge(att.status)}</TableCell>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {att.checkInTime || '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-slate-700">
                    {att.checkOutTime || '—'}
                  </TableCell>
                  <TableCell className="text-xs font-medium text-slate-800">
                    {att.workDurationHours ? `${att.workDurationHours} hrs` : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Demo Punch Modal */}
      {showPunchModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Virtual Time Clock (Demo)</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              Real-time attendance punch capture and biometric/geofenced device integration are part of the upcoming workforce operations milestone.
            </p>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowPunchModal(false)}>
                Got it
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
