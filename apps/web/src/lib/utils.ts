import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(dateString: string): string {
  // Date-only values are calendar dates, not instants; parse them as local time
  // so they do not shift to the previous day in negative UTC offsets.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateString);
  const date = new Date(dateOnly ? `${dateString}T00:00:00` : dateString);

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
