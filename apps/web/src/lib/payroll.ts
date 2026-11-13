import { api } from './api';
import type {
  DeductionRuleDto,
  PayrollRunDto,
  PayrollRunsResult,
  PayrollStatus,
  PayslipDto,
} from '../types';

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const value = search.toString();
  return value ? `?${value}` : '';
}

export function listPayrollRuns(params: {
  page?: number;
  pageSize?: number;
  status?: PayrollStatus;
  from?: string;
  to?: string;
}): Promise<PayrollRunsResult> {
  return api.get<PayrollRunsResult>(`/payroll-runs${query(params)}`);
}

export function getPayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.get<{ run: PayrollRunDto }>(`/payroll-runs/${id}`);
}

export function createPayrollRun(input: {
  periodStart: string;
  periodEnd: string;
  payDate: string;
}): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>('/payroll-runs', input);
}

export function calculatePayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/calculate`);
}

export function approvePayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/approve`);
}

export function payPayrollRun(id: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/pay`);
}

export function voidPayrollRun(id: string, reason: string): Promise<{ run: PayrollRunDto }> {
  return api.post<{ run: PayrollRunDto }>(`/payroll-runs/${id}/void`, { reason });
}

export function downloadPayrollRunCsv(id: string) {
  return api.download(`/payroll-runs/${id}/export`);
}

export function listMyPayslips(): Promise<{ payslips: PayslipDto[] }> {
  return api.get<{ payslips: PayslipDto[] }>('/payslips/me');
}

export function getPayslip(id: string): Promise<{ payslip: PayslipDto }> {
  return api.get<{ payslip: PayslipDto }>(`/payslips/${id}`);
}

export function listDeductionRules(): Promise<{ rules: DeductionRuleDto[] }> {
  return api.get<{ rules: DeductionRuleDto[] }>('/payroll-deduction-rules');
}

export function createDeductionRule(input: {
  name: string;
  type: 'RATE' | 'FIXED';
  value: number;
  taxable: boolean;
  active: boolean;
}): Promise<{ rule: DeductionRuleDto }> {
  return api.post<{ rule: DeductionRuleDto }>('/payroll-deduction-rules', input);
}

export function updateDeductionRule(
  id: string,
  input: Partial<{
    name: string;
    type: 'RATE' | 'FIXED';
    value: number;
    taxable: boolean;
    active: boolean;
  }>
): Promise<{ rule: DeductionRuleDto }> {
  return api.patch<{ rule: DeductionRuleDto }>(`/payroll-deduction-rules/${id}`, input);
}

export function deleteDeductionRule(id: string): Promise<{ deleted: boolean }> {
  return api.delete<{ deleted: boolean }>(`/payroll-deduction-rules/${id}`);
}
