import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Format integer pence for display. UI-only concern — engines never format. */
export function formatPence(pence: number, currency = 'GBP', locale = 'en-GB'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(pence / 100);
}

export function formatHours(hours: number): string {
  return `${(Math.round(hours * 100) / 100).toString()}h`;
}
