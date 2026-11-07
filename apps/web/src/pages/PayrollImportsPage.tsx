import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  FileSpreadsheet,
  Filter,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../components/ui/Table';
import { EmptyState } from '../components/ui/EmptyState';
import { ImportUploadCard } from '../components/payroll/ImportUploadCard';
import { PayrollImportStatusBadge } from '../components/payroll/PayrollImportStatusBadge';
import { ApiError } from '../lib/api';
import { listPayrollImports } from '../lib/payrollImports';
import { formatDate } from '../lib/utils';
import type {
  Pagination,
  PayrollImportBatch,
  PayrollImportStatus,
} from '../types';

const PAGE_SIZE = 25;

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPeriod(batch: PayrollImportBatch): string {
  if (!batch.payPeriodStart || !batch.payPeriodEnd) return '—';
  return `${formatDate(batch.payPeriodStart)} – ${formatDate(batch.payPeriodEnd)}`;
}

export const PayrollImportsPage: React.FC = () => {
  const navigate = useNavigate();
  const [batches, setBatches] = useState<PayrollImportBatch[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [status, setStatus] = useState<'' | PayrollImportStatus>('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [recentBatch, setRecentBatch] = useState<PayrollImportBatch | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);

    try {
      const result = await listPayrollImports({
        page,
        pageSize: PAGE_SIZE,
        status: status || undefined,
      });
      setBatches(result.batches);
      setPagination(result.pagination);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setForbidden(true);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not load imports.');
      }
    } finally {
      setLoading(false);
    }
  }, [page, status, reloadToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUploaded = (batch: PayrollImportBatch) => {
    setRecentBatch(batch);
    setPage(1);
    setReloadToken((current) => current + 1);
  };

  if (forbidden) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-rose-50 text-rose-500 rounded-full mb-3">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Access restricted</h2>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          You don't have access to payroll imports. Contact an administrator if you need
          it.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Payroll Imports</h2>
        <p className="text-xs text-slate-500 mt-1">
          Upload payroll registers and review every validation finding before they feed
          final payroll.
        </p>
      </div>

      <ImportUploadCard onUploaded={handleUploaded} />

      {recentBatch && (
        <div className="flex items-start justify-between gap-3 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>{recentBatch.originalFilename}</strong> imported with{' '}
              {recentBatch.rowCount} row{recentBatch.rowCount === 1 ? '' : 's'} (
              {recentBatch.validRowCount} valid, {recentBatch.invalidRowCount} invalid).{' '}
              <Link to={`/payroll/imports/${recentBatch.id}`} className="underline font-semibold">
                View details
              </Link>
            </span>
          </div>
          <button
            type="button"
            className="text-emerald-700 hover:text-emerald-900"
            onClick={() => setRecentBatch(null)}
            aria-label="Dismiss upload confirmation"
          >
            ×
          </button>
        </div>
      )}

      <Card>
        <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-slate-50/50">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Import history</h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Newest first. Records are retained; raw files are purged after the
              90-day retention window.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as '' | PayrollImportStatus);
                setPage(1);
              }}
              aria-label="Filter by import status"
              className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
            >
              <option value="">All Statuses</option>
              <option value="COMPLETED">Completed</option>
              <option value="FAILED">Failed</option>
              <option value="PROCESSING">Processing</option>
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
          {loading && batches.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading imports…
            </div>
          ) : !loading && batches.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="w-6 h-6" />}
              title={status ? 'No matching imports' : 'No payroll imports yet'}
              description={
                status
                  ? 'Try a different status filter.'
                  : 'Upload a payroll register CSV above to run validation.'
              }
              className="m-4"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rows</TableHead>
                  <TableHead>Valid / Invalid</TableHead>
                  <TableHead>Errors / Warnings</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {batches.map((batch) => (
                  <TableRow key={batch.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <FileSpreadsheet className="w-4 h-4 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-800 text-xs break-all">
                          {batch.originalFilename}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500 whitespace-nowrap">
                      {formatTimestamp(batch.createdAt)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                      {formatPeriod(batch)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {batch.currency ?? '—'}
                    </TableCell>
                    <TableCell>
                      <PayrollImportStatusBadge batch={batch} />
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">{batch.rowCount}</TableCell>
                    <TableCell className="text-xs text-slate-700 whitespace-nowrap">
                      <span className="text-emerald-700">{batch.validRowCount}</span>
                      {' / '}
                      <span className="text-rose-700">{batch.invalidRowCount}</span>
                    </TableCell>
                    <TableCell className="text-xs text-slate-700 whitespace-nowrap">
                      <span className="text-rose-700">{batch.errorCount}</span>
                      {' / '}
                      <span className="text-amber-700">{batch.warningCount}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate(`/payroll/imports/${batch.id}`)}
                      >
                        View
                      </Button>
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
    </div>
  );
};
