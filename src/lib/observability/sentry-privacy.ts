import type { Event } from '@sentry/nextjs';

const SENSITIVE_KEY =
  /email|subject|body|raw|mime|attachment|token|authorization|cookie|password|secret|bank|address|employee|national|ninumber|reference|amount|pence|gross|net|tax|pension|payslip|payroll|locals|vars/i;

function sanitizeString(value: string): string {
  let sanitized = value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[Filtered email]')
    .replace(/(?:GBP|£)\s*[-+]?\d[\d,]*(?:\.\d{1,2})?/gi, '[Filtered amount]')
    .replace(
      /\b(gross|net|tax|pension|amount|pay)\s*[:=]?\s*[-+]?\d[\d,]*(?:\.\d{1,2})?/gi,
      '$1 [Filtered amount]'
    );
  if (/^(?:https?:\/\/|\/)/.test(sanitized)) {
    sanitized = sanitized.replace(/([?#]).*$/, '$1[Filtered]');
  }
  return sanitized;
}

function scrub(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key)) return '[Filtered]';
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.map((item) => scrub(item));
  if (!value || typeof value !== 'object') return value;

  const clean: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    clean[childKey] = scrub(childValue, childKey);
  }
  return clean;
}

/**
 * Last-line Sentry privacy boundary. Domain code must still avoid logging PII;
 * this strips request/user data, payroll values, and unsafe error messages.
 */
export function scrubSentryEvent<T extends Event>(event: T): T {
  const clean = scrub(event) as T;
  delete clean.user;
  if (clean.request) {
    clean.request = {
      method: clean.request.method,
      url: clean.request.url ? sanitizeString(clean.request.url) : undefined,
    };
  }
  if (clean.message) clean.message = 'Captured application error';
  if (clean.exception?.values) {
    clean.exception.values = clean.exception.values.map((exception) => ({
      ...exception,
      value: exception.type ? `Captured ${exception.type}` : 'Captured error',
    }));
  }
  return clean;
}
