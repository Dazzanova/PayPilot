import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowLeft,
  Download,
  FileSpreadsheet,
  Filter,
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
import { PayrollImportStatusBadge } from '../components/payroll/PayrollImportStatusBadge';
import { ApiError } from '../lib/api';
import {
  downloadExceptionReport,
  getPayrollImport,
  listPayrollImportFindings,
  listPayrollImportRecords,
} from '../lib/payrollImports';
import { formatDate } from '../lib/utils';
import type {
  Pagination,
  PayrollImportBatch,
  PayrollImportFinding,
  PayrollImportRecord,
  ValidationSeverity,
} from '../types';

type Tab = 'findings' | 'records';

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatAmount(value: string | null, currency: string | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency ?? 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function formatPeriod(start: string | null, end: string | null): string {
  if (!start || !end) return '—';
  return `${formatDate(start)} – ${formatDate(end)}`;
}

const severityVariant = (severity: ValidationSeverity) => {
  if (severity === 'ERROR') return 'danger' as const;
  if (severity === 'WARNING') return 'warning' as const;
  return 'info' as const;
};

const Pager: React.FC<{
  pagination: Pagination | null;
  loading: boolean;
  onPage: (page: number) => void;
}> = ({ pagination, loading, onPage }) => (
  <div className="px-4 py-3 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
    <div>
      {pagination
        ? `Showing ${
            pagination.total === 0
              ? 0
              : (pagination.page - 1) * pagination.pageSize + 1
          }–${Math.min(pagination.page * pagination.pageSize, pagination.total)} of ${
            pagination.total
          }`
        : 'No results'}
    </div>
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!pagination || pagination.page <= 1 || loading}
        onClick={() => onPage(Math.max(1, (pagination?.page ?? 1) - 1))}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={!pagination || pagination.page >= pagination.totalPages || loading}
        onClick={() => onPage((pagination?.page ?? 1) + 1)}
      >
        Next
      </Button>
    </div>
  </div>
);

export const PayrollImportDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();

  const [batch, setBatch] = useState<PayrollImportBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('findings');

  const [findings, setFindings] = useState<PayrollImportFinding[]>([]);
  const [findingsPagination, setFindingsPagination] = useState<Pagination | null>(null);
  const [findingsPage, setFindingsPage] = useState(1);
  const [severity, setSeverity] = useState<'' | ValidationSeverity>('');
  const [findingsLoading, setFindingsLoading] = useState(false);
  const [findingsError, setFindingsError] = useState<string | null>(null);

  const [records, setRecords] = useState<PayrollImportRecord[]>([]);
  const [recordsPagination, setRecordsPagination] = useState<Pagination | null>(null);
  const [recordsPage, setRecordsPage] = useState(1);
  const [validFilter, setValidFilter] = useState<'' | 'true' | 'false'>('');
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [recordsError, setRecordsError] = useState<string | null>(null);

  const [reportError, setReportError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const loadBatch = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setForbidden(false);
    setNotFound(false);

    try {
      const result = await getPayrollImport(id);
      setBatch(result.batch);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 403) {
        setForbidden(true);
      } else if (caught instanceof ApiError && caught.status === 404) {
        setNotFound(true);
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not load the import.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadBatch();
  }, [loadBatch]);

  const loadFindings = useCallback(async () => {
    if (!id) return;
    setFindingsLoading(true);
    setFindingsError(null);
    try {
      const result = await listPayrollImportFindings(id, {
        page: findingsPage,
        pageSize: 25,
        severity: severity || undefined,
      });
      setFindings(result.findings);
      setFindingsPagination(result.pagination);
    } catch (caught) {
      setFindingsError(
        caught instanceof ApiError ? caught.message : 'Could not load findings.'
      );
    } finally {
      setFindingsLoading(false);
    }
  }, [id, findingsPage, severity]);

  const loadRecords = useCallback(async () => {
    if (!id) return;
    setRecordsLoading(true);
    setRecordsError(null);
    try {
      const result = await listPayrollImportRecords(id, {
        page: recordsPage,
        pageSize: 25,
        valid: validFilter || undefined,
      });
      setRecords(result.records);
      setRecordsPagination(result.pagination);
    } catch (caught) {
      setRecordsError(
        caught instanceof ApiError ? caught.message : 'Could not load records.'
      );
    } finally {
      setRecordsLoading(false);
    }
  }, [id, recordsPage, validFilter]);

  useEffect(() => {
    if (batch && tab === 'findings') {
      void loadFindings();
    }
  }, [batch, tab, loadFindings]);

  useEffect(() => {
    if (batch && tab === 'records') {
      void loadRecords();
    }
  }, [batch, tab, loadRecords]);

  const handleDownload = async () => {
    if (!id) return;
    setDownloading(true);
    setReportError(null);
    try {
      const { blob, filename } = await downloadExceptionReport(id);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename ?? `payroll-exceptions-${id}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (caught) {
      setReportError(
        caught instanceof ApiError ? caught.message : 'Could not download the report.'
      );
    } finally {
      setDownloading(false);
    }
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

  if (notFound) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="p-3 bg-slate-100 text-slate-500 rounded-full mb-3">
          <FileSpreadsheet className="w-6 h-6" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Import not found</h2>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          This import does not exist in your organization, or it was removed.
        </p>
        <Link to="/payroll/imports" className="mt-4 text-xs font-semibold text-brand-600">
          Back to Payroll Imports
        </Link>
      </div>
    );
  }

  if (loading || !batch) {
    return (
      <div className="flex items-center justify-center gap-2 py-20 text-xs text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading import…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <Link
            to="/payroll/imports"
            className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Payroll Imports
          </Link>
          <h2 className="text-xl font-bold text-slate-900 mt-2 break-all">
            {batch.originalFilename}
          </h2>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <PayrollImportStatusBadge batch={batch} />
            <span className="text-[11px] text-slate-500">
              Uploaded {formatTimestamp(batch.createdAt)}
              {batch.createdBy ? ` by ${batch.createdBy.email}` : ''}
            </span>
          </div>
        </div>

        <Button
          variant="outline"
          icon={
            downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )
          }
          onClick={() => void handleDownload()}
          disabled={downloading}
        >
          {downloading ? 'Preparing…' : 'Exception Report'}
        </Button>
      </div>

      {error && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void loadBatch()}>
            Retry
          </Button>
        </div>
      )}

      {reportError && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{reportError}</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        {[
          { label: 'Data rows', value: batch.rowCount, tone: 'text-slate-900' },
          { label: 'Valid', value: batch.validRowCount, tone: 'text-emerald-600' },
          { label: 'Invalid', value: batch.invalidRowCount, tone: 'text-rose-600' },
          { label: 'Errors', value: batch.errorCount, tone: 'text-rose-600' },
          { label: 'Warnings', value: batch.warningCount, tone: 'text-amber-600' },
        ].map((card) => (
          <Card key={card.label} className="p-4">
            <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
              {card.label}
            </p>
            <p className={`text-2xl font-bold mt-1 ${card.tone}`}>{card.value}</p>
          </Card>
        ))}
      </div>

      <Card className="p-4">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div>
            <dt className="text-slate-500">Pay period</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {formatPeriod(batch.payPeriodStart, batch.payPeriodEnd)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Currency</dt>
            <dd className="mt-1 font-medium text-slate-800">{batch.currency ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Ruleset</dt>
            <dd className="mt-1 font-mono text-[11px] text-slate-700">
              {batch.rulesetVersion}
            </dd>
          </div>
          <div>
            <dt className="text-slate-500">Raw file</dt>
            <dd className="mt-1 font-medium text-slate-800">
              {batch.filePurgedAt
                ? `Purged ${formatTimestamp(batch.filePurgedAt)}`
                : `Retained until ${formatDate(batch.retentionUntil.slice(0, 10))}`}
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <div className="px-4 pt-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setTab('findings')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === 'findings'
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Findings ({batch.errorCount + batch.warningCount + batch.infoCount})
            </button>
            <button
              type="button"
              onClick={() => setTab('records')}
              className={`px-3 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                tab === 'records'
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Records ({batch.rowCount})
            </button>
          </div>

          <div className="flex items-center gap-2 pb-2 sm:pb-0">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            {tab === 'findings' ? (
              <select
                value={severity}
                onChange={(event) => {
                  setSeverity(event.target.value as '' | ValidationSeverity);
                  setFindingsPage(1);
                }}
                aria-label="Filter findings by severity"
                className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All severities</option>
                <option value="ERROR">Errors</option>
                <option value="WARNING">Warnings</option>
                <option value="INFO">Info</option>
              </select>
            ) : (
              <select
                value={validFilter}
                onChange={(event) => {
                  setValidFilter(event.target.value as '' | 'true' | 'false');
                  setRecordsPage(1);
                }}
                aria-label="Filter records by validity"
                className="text-xs bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 focus:outline-none focus:ring-1 focus:ring-brand-500"
              >
                <option value="">All records</option>
                <option value="true">Valid only</option>
                <option value="false">Invalid only</option>
              </select>
            )}
          </div>
        </div>

        <CardContent className="p-0">
          {tab === 'findings' ? (
            findingsError ? (
              <div className="m-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
                <span>{findingsError}</span>
                <Button variant="outline" size="sm" onClick={() => void loadFindings()}>
                  Retry
                </Button>
              </div>
            ) : findingsLoading && findings.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading findings…
              </div>
            ) : findings.length === 0 ? (
              <EmptyState
                icon={<FileSpreadsheet className="w-6 h-6" />}
                title="No findings"
                description={
                  severity
                    ? 'No findings match this severity.'
                    : 'Every row in this import passed the validation rules.'
                }
                className="m-4"
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Rule</TableHead>
                    <TableHead>Field</TableHead>
                    <TableHead>Explanation</TableHead>
                    <TableHead>Expected</TableHead>
                    <TableHead>Actual</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {findings.map((finding) => (
                    <TableRow key={finding.id}>
                      <TableCell className="text-xs text-slate-600">
                        {finding.rowNumber ?? 'File'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={severityVariant(finding.severity)} size="sm">
                          {finding.severity}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-700">
                        {finding.ruleCode}
                      </TableCell>
                      <TableCell className="font-mono text-[11px] text-slate-500">
                        {finding.field ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-700 max-w-sm">
                        {finding.message}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {finding.expected ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-slate-600">
                        {finding.actual ?? '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )
          ) : recordsError ? (
            <div className="m-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700">
              <span>{recordsError}</span>
              <Button variant="outline" size="sm" onClick={() => void loadRecords()}>
                Retry
              </Button>
            </div>
          ) : recordsLoading && records.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-16 text-xs text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading records…
            </div>
          ) : records.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet className="w-6 h-6" />}
              title="No records"
              description={
                validFilter
                  ? 'No records match this validity filter.'
                  : 'This import did not contain any data rows.'
              }
              className="m-4"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Row</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Gross</TableHead>
                  <TableHead>Deductions</TableHead>
                  <TableHead>Net</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {records.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="text-xs text-slate-600">{record.rowNumber}</TableCell>
                    <TableCell>
                      <div className="text-xs font-medium text-slate-800">
                        {record.employeeName ?? 'Unresolved'}
                      </div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {record.employeeNumber}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-slate-600 whitespace-nowrap">
                      {formatPeriod(record.payPeriodStart, record.payPeriodEnd)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-600">
                      {record.currency ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {formatAmount(record.grossPay, record.currency ?? batch.currency)}
                    </TableCell>
                    <TableCell className="text-xs text-slate-700">
                      {formatAmount(record.totalDeductions, record.currency ?? batch.currency)}
                    </TableCell>
                    <TableCell className="text-xs font-medium text-slate-900">
                      {formatAmount(record.netPay, record.currency ?? batch.currency)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={record.isValid ? 'success' : 'danger'} size="sm">
                        {record.isValid ? 'Valid' : 'Invalid'}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>

        {tab === 'findings' ? (
          <Pager
            pagination={findingsPagination}
            loading={findingsLoading}
            onPage={setFindingsPage}
          />
        ) : (
          <Pager
            pagination={recordsPagination}
            loading={recordsLoading}
            onPage={setRecordsPage}
          />
        )}
      </Card>
    </div>
  );
};
