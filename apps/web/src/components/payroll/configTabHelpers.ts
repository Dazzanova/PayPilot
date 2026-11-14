import { ApiError } from '../../lib/api';

export const inputClass =
  'w-full text-sm border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500';

export const inputErrorClass =
  'w-full text-sm border border-rose-400 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-rose-400';

export function collectFieldErrors(caught: unknown): Record<string, string> {
  if (!(caught instanceof ApiError)) return {};
  const errors: Record<string, string> = {};
  for (const detail of caught.details ?? []) {
    errors[detail.path] = detail.message;
  }
  return errors;
}

export function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof ApiError ? caught.message : fallback;
}

export function isNotFound(caught: unknown): boolean {
  return caught instanceof ApiError && caught.status === 404;
}

export function moneyError(value: string): string | null {
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value.trim())) return 'Enter a valid amount';
  return null;
}

export function rateError(value: string): string | null {
  if (value.trim() === '') return 'Enter a rate';
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return 'Rate must be between 0 and 100';
  }
  if (Math.abs(rate * 100 - Math.round(rate * 100)) > 1e-6) {
    return 'Rate can have at most two decimals';
  }
  return null;
}
