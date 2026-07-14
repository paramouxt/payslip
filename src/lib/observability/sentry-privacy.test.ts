import { describe, expect, it } from 'vitest';
import type { Event } from '@sentry/nextjs';
import { scrubSentryEvent } from './sentry-privacy';

describe('Sentry privacy boundary', () => {
  it('removes identity, request secrets, and payroll values while preserving stack evidence', () => {
    const event: Event = {
      event_id: 'event-1',
      message: 'Payslip for worker@example.test has gross £945.48',
      user: { id: 'person-1', email: 'worker@example.test' },
      request: {
        method: 'POST',
        url: 'https://example.test/api/ingest?email=worker@example.test',
        headers: { authorization: 'Bearer secret-token' },
        data: { body: 'raw email', grossPence: 94_548 },
      },
      extra: {
        employeeReference: 'ABC123',
        netPence: 81_176,
        safeState: 'quarantined',
      },
      exception: {
        values: [
          {
            type: 'ParserError',
            value: 'worker@example.test gross £945.48 token secret-token',
            stacktrace: {
              frames: [{ filename: 'src/core/parsing/parser.ts', lineno: 42 }],
            },
          },
        ],
      },
    };

    const clean = scrubSentryEvent(event);
    const serialized = JSON.stringify(clean);
    expect(serialized).not.toContain('worker@example.test');
    expect(serialized).not.toContain('945.48');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('ABC123');
    expect(clean.user).toBeUndefined();
    expect(clean.request).toEqual({
      method: 'POST',
      url: 'https://example.test/api/ingest?[Filtered]',
    });
    expect(clean.exception?.values?.[0]).toMatchObject({
      type: 'ParserError',
      value: 'Captured ParserError',
      stacktrace: { frames: [{ filename: 'src/core/parsing/parser.ts', lineno: 42 }] },
    });
  });
});
