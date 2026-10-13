import React, { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Filter,
  Plus,
  Briefcase,
  Mail,
} from 'lucide-react';
import { mockEmployees, mockDepartments } from '../data/mockData';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '../components/ui/Table';
import { DemoDisclaimer } from '../components/ui/DemoDisclaimer';
import { formatCurrency, formatDate } from '../lib/utils';
import { Employee } from '../types';

export const EmployeesPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDept, setSelectedDept] = useState('ALL');
  const [showDemoModal, setShowDemoModal] = useState(false);

  const filteredEmployees = useMemo(() => {
    return mockEmployees.filter((emp) => {
      const matchesSearch =
        `${emp.firstName} ${emp.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.employeeNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.jobTitle.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesDept = selectedDept === 'ALL' || emp.departmentId === selectedDept;

      return matchesSearch && matchesDept;
    });
  }, [searchTerm, selectedDept]);

  const activeCount = mockEmployees.filter((e) => e.status === 'ACTIVE').length;
  const onLeaveCount = mockEmployees.filter((e) => e.status === 'ON_LEAVE').length;

  return (
    <div className="space-y-6">
      {/* Demo Sandbox Alert */}
      <DemoDisclaimer moduleName="employees directory" />

      {/* Module Overview Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Workforce Directory</h2>
          <p className="text-xs text-slate-500 mt-1">
            Central repository of employee records, organization assignments, and compensation tiers.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={() => setShowDemoModal(true)}
        >
          Add Employee
        </Button>
      </div>

      {/* Roster Metric Counters */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Total Headcount</p>
          <p className="text-2xl font-bold text-slate-900 mt-1">{mockEmployees.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Active Status</p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">{activeCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">On Approved Leave</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{onLeaveCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Departments</p>
          <p className="text-2xl font-bold text-brand-600 mt-1">{mockDepartments.length}</p>
        </Card>
      </div>

      {/* Search and Filters Bar */}
      <Card>
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name, ID, or job title..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="ALL">All Departments</option>
              {mockDepartments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.code})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Employee Roster Table */}
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>ID Code</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Job Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Base Salary</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-10 text-slate-400">
                    No employees matching filter criteria.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((emp: Employee) => (
                  <TableRow key={emp.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-semibold flex items-center justify-center text-xs shrink-0">
                          {emp.firstName?.[0] || ''}
                          {emp.lastName?.[0] || ''}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 text-xs">
                            {emp.firstName} {emp.lastName}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {emp.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {emp.employeeNumber}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium text-slate-700">
                        {emp.departmentName}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                        {emp.jobTitle}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {emp.employmentType.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={emp.status === 'ACTIVE' ? 'success' : 'warning'}
                        dot
                        size="sm"
                      >
                        {emp.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-medium text-slate-800 text-xs">
                      {formatCurrency(emp.baseSalary)} / yr
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(emp.joinedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Demo Action Modal Notice */}
      {showDemoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-4">
              <Users className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Employee Creation (Demo View)</h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              In this initial architecture milestone, CRUD mutations are intentionally scoped to read-only mock data. Full employee onboarding with validation schemas and Supabase persistence will be activated in the next milestone.
            </p>
            <div className="mt-5 flex justify-end">
              <Button variant="primary" size="sm" onClick={() => setShowDemoModal(false)}>
                Understood
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
