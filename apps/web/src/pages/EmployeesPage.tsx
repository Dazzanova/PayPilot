import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Users,
  Search,
  Filter,
  Plus,
  Briefcase,
  Mail,
  Pencil,
  RefreshCw,
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
import { EmployeeFormModal } from '../components/employees/EmployeeFormModal';
import { EmployeeStatusDialog } from '../components/employees/EmployeeStatusDialog';
import { ApiError } from '../lib/api';
import { listDepartments, listEmployees } from '../lib/employees';
import { formatCurrency, formatDate } from '../lib/utils';
import type {
  DepartmentDto,
  EmployeeDto,
  EmployeeListResult,
  EmployeeStatus,
} from '../types';

const PAGE_SIZES = [10, 25, 50];

const statusVariant = (status: EmployeeStatus) => {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'ON_LEAVE') return 'warning' as const;
  if (status === 'TERMINATED') return 'danger' as const;
  return 'neutral' as const;
};

export const EmployeesPage: React.FC = () => {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [status, setStatus] = useState<'' | EmployeeStatus>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [data, setData] = useState<EmployeeListResult | null>(null);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<EmployeeDto | null>(null);

  // Ignore responses from superseded queries so fast filter changes cannot
  // render an older result over a newer one.
  const requestIdRef = useRef(0);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);

    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    listDepartments()
      .then((result) => setDepartments(result.departments))
      .catch(() => setDepartments([]));
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const result = await listEmployees({
        page,
        pageSize,
        search: search || undefined,
        departmentId: departmentId || undefined,
        status: status || undefined,
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      if (caught instanceof ApiError && caught.status === 403) {
        setForbidden(true);
      } else {
        setError(
          caught instanceof ApiError ? caught.message : 'Could not load employees'
        );
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [page, pageSize, search, departmentId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deleting the last row on a page (or tightening a filter) can leave the
  // requested page past the end; step back to the last real page.
  useEffect(() => {
    if (data && data.pagination.page > data.pagination.totalPages) {
      setPage(data.pagination.totalPages);
    }
  }, [data]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (employee: EmployeeDto) => {
    setEditing(employee);
    setFormOpen(true);
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          You don't have access to the employee directory. Contact an administrator
          if you need it.
        </p>
      </div>
    );
  }

  const summary = data?.summary;
  const pagination = data?.pagination;
  const hasFilters = Boolean(search || departmentId || status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Workforce Directory</h2>
          <p className="text-xs text-slate-500 mt-1">
            Live employee records for your organization.
          </p>
        </div>
        <Button
          variant="primary"
          icon={<Plus className="w-4 h-4" />}
          onClick={openCreate}
        >
          Add Employee
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            Total Headcount
          </p>
          <p className="text-2xl font-bold text-slate-900 mt-1">
            {summary?.total ?? '—'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            Active Status
          </p>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            {summary?.active ?? '—'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            On Leave
          </p>
          <p className="text-2xl font-bold text-amber-600 mt-1">
            {summary?.onLeave ?? '—'}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            Departments
          </p>
          <p className="text-2xl font-bold text-brand-600 mt-1">
            {departments.length}
          </p>
        </Card>
      </div>

      <Card>
        <div className="p-4 border-b border-slate-100 flex flex-col lg:flex-row items-center justify-between gap-3 bg-slate-50/50">
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              placeholder="Search by name, email, ID, or job title..."
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              aria-label="Search employees"
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-brand-500 focus:border-brand-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={departmentId}
              onChange={(event) => {
                setDepartmentId(event.target.value);
                setPage(1);
              }}
              aria-label="Filter by department"
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Departments</option>
              {departments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.name} ({department.code})
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as '' | EmployeeStatus);
                setPage(1);
              }}
              aria-label="Filter by status"
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ON_LEAVE">On leave</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="TERMINATED">Terminated</option>
            </select>
            <Button
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={() => void load()}
              disabled={loading}
            >
              Refresh
            </Button>
          </div>
        </div>

        {error && (
          <div className="mx-4 mt-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
            <span>{error}</span>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              Retry
            </Button>
          </div>
        )}

        <CardContent className="p-0">
          {loading && !data ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading employees…
            </div>
          ) : !loading && data && data.employees.length === 0 ? (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title={hasFilters ? 'No matching employees' : 'No employees yet'}
              description={
                hasFilters
                  ? 'Try clearing the search or filters.'
                  : 'Add your first employee to start building the directory.'
              }
              actionLabel={hasFilters ? undefined : 'Add employee'}
              onAction={openCreate}
              className="m-4"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>ID Code</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Job Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Statutory</TableHead>
                  <TableHead>Base Salary (monthly)</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.employees.map((employee) => (
                  <TableRow key={employee.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 font-semibold flex items-center justify-center text-xs shrink-0">
                          {employee.firstName[0]}
                          {employee.lastName[0]}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 text-xs">
                            {employee.firstName} {employee.lastName}
                          </div>
                          <div className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Mail className="w-3 h-3" /> {employee.email}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {employee.employeeNumber}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-medium text-slate-700">
                        {employee.departmentName ?? 'Unassigned'}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      <div className="flex items-center gap-1.5">
                        <Briefcase className="w-3.5 h-3.5 text-slate-400" />
                        {employee.jobTitle}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-[11px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                        {employee.employmentType.replace(/_/g, ' ')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(employee.status)} dot size="sm">
                        {employee.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                          {employee.state ?? 'No state'}
                        </span>
                        <Badge
                          variant={employee.pfApplicable ? 'success' : 'neutral'}
                          size="sm"
                        >
                          PF
                        </Badge>
                        <Badge
                          variant={employee.esiApplicable ? 'success' : 'neutral'}
                          size="sm"
                        >
                          ESI
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="font-medium text-slate-800 text-xs">
                      {formatCurrency(Number(employee.baseSalary))} / mo
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(employee.joinedAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(employee)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Edit ${employee.firstName} ${employee.lastName}`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatusTarget(employee)}
                          className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          aria-label={`Change status for ${employee.firstName} ${employee.lastName}`}
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            {pagination
              ? `Showing ${
                  pagination.total === 0
                    ? 0
                    : (pagination.page - 1) * pagination.pageSize + 1
                }–${Math.min(
                  pagination.page * pagination.pageSize,
                  pagination.total
                )} of ${pagination.total}`
              : 'No results'}
          </div>
          <div className="flex items-center gap-2">
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1.5"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination || pagination.page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={
                !pagination || pagination.page >= pagination.totalPages || loading
              }
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </Card>

      {formOpen && (
        <EmployeeFormModal
          key={editing?.id ?? 'new'}
          open={formOpen}
          employee={editing}
          departments={departments}
          onClose={() => setFormOpen(false)}
          onSaved={() => void load()}
        />
      )}

      <EmployeeStatusDialog
        key={statusTarget?.id ?? 'none'}
        employee={statusTarget}
        onClose={() => setStatusTarget(null)}
        onSaved={() => void load()}
      />
    </div>
  );
};
