import { api } from './api';
import type {
  PayrollImportBatch,
  PayrollImportFindingsResult,
  PayrollImportRecordsResult,
  PayrollImportsResult,
  ValidationSeverity,
} from '../types';

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listPayrollImports(params: {
  page?: number;
  pageSize?: number;
  status?: string;
}): Promise<PayrollImportsResult> {
  return api.get<PayrollImportsResult>(`/payroll-imports${query(params)}`);
}

export function getPayrollImport(id: string): Promise<{ batch: PayrollImportBatch }> {
  return api.get<{ batch: PayrollImportBatch }>(`/payroll-imports/${id}`);
}

export function listPayrollImportRecords(
  id: string,
  params: { page?: number; pageSize?: number; valid?: 'true' | 'false' }
): Promise<PayrollImportRecordsResult> {
  return api.get<PayrollImportRecordsResult>(`/payroll-imports/${id}/records${query(params)}`);
}

export function listPayrollImportFindings(
  id: string,
  params: { page?: number; pageSize?: number; severity?: ValidationSeverity; ruleCode?: string }
): Promise<PayrollImportFindingsResult> {
  return api.get<PayrollImportFindingsResult>(`/payroll-imports/${id}/findings${query(params)}`);
}

export function uploadPayrollImport(
  filename: string,
  content: string
): Promise<{ batch: PayrollImportBatch }> {
  return api.uploadCsv<{ batch: PayrollImportBatch }>('/payroll-imports', filename, content);
}

export function downloadExceptionReport(id: string) {
  return api.download(`/payroll-imports/${id}/exception-report`);
}
