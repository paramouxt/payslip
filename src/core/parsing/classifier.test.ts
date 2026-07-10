import { describe, expect, it } from 'vitest';
import { classifyEmail } from './classifier';

const employers = [{ slug: 'tracsis-events', senderPatterns: [{ fromDomain: 'tracsis.com' }] }];

function email(subject: string, fromAddress = 'rota@tracsis.com', attachments: string[] = []) {
  return { subject, fromAddress, attachmentNames: attachments };
}

describe('classifyEmail', () => {
  it('classifies employer mail by subject heuristics', () => {
    expect(classifyEmail(email('Rota w/c 15 June'), employers)).toEqual({
      classification: 'ROTA',
      employerSlug: 'tracsis-events',
    });
    expect(classifyEmail(email('Shift CANCELLED Sat 14 Jun'), employers).classification).toBe(
      'CANCELLATION'
    );
    expect(classifyEmail(email('Updated deployment schedule'), employers).classification).toBe(
      'ROTA_CHANGE'
    );
    expect(
      classifyEmail(email('Your payslip', 'payroll@tracsis.com', ['payslip.pdf']), employers)
        .classification
    ).toBe('PAYSLIP');
    expect(classifyEmail(email('Christmas party!'), employers).classification).toBe('PAY_COMMS');
  });

  it('ignores mail from unmatched senders', () => {
    expect(classifyEmail(email('Rota attached', 'spam@evil.example'), employers)).toEqual({
      classification: 'OTHER',
      employerSlug: null,
    });
  });

  it('an empty pattern never matches (no accidental catch-all)', () => {
    const result = classifyEmail(email('rota', 'x@y.com'), [{ slug: 'e', senderPatterns: [{}] }]);
    expect(result.classification).toBe('OTHER');
  });
});
