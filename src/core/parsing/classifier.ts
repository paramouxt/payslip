import type { EmailClassificationKind } from './types';

/**
 * Sender/subject classification — the cheap, deterministic first stage of the
 * pipeline. Employer sender patterns are configuration (§12); the keyword
 * heuristics here are mechanisms, not employer facts. Anything unmatched is
 * OTHER and ignored downstream (never quarantined noise).
 */

export interface SenderPattern {
  fromDomain?: string;
  fromAddress?: string;
  subjectContains?: string;
}

export interface ClassifierEmployer {
  slug: string;
  senderPatterns: SenderPattern[];
}

export interface ClassifiableEmail {
  fromAddress: string;
  subject: string;
  attachmentNames: string[];
}

export interface ClassificationResult {
  classification: EmailClassificationKind;
  employerSlug: string | null;
}

function matchesPattern(email: ClassifiableEmail, pattern: SenderPattern): boolean {
  const from = email.fromAddress.toLowerCase();
  if (pattern.fromAddress && from !== pattern.fromAddress.toLowerCase()) return false;
  if (pattern.fromDomain && !from.endsWith(`@${pattern.fromDomain.toLowerCase()}`)) return false;
  if (
    pattern.subjectContains &&
    !email.subject.toLowerCase().includes(pattern.subjectContains.toLowerCase())
  ) {
    return false;
  }
  return Boolean(pattern.fromAddress ?? pattern.fromDomain ?? pattern.subjectContains);
}

export function classifyEmail(
  email: ClassifiableEmail,
  employers: ClassifierEmployer[]
): ClassificationResult {
  const employer = employers.find((e) => e.senderPatterns.some((p) => matchesPattern(email, p)));
  if (!employer) return { classification: 'OTHER', employerSlug: null };

  const subject = email.subject.toLowerCase();
  const hasPdf = email.attachmentNames.some((n) => n.toLowerCase().endsWith('.pdf'));

  if (
    subject.includes('payslip') ||
    subject.includes('pay advice') ||
    (hasPdf && subject.includes('pay'))
  ) {
    return { classification: 'PAYSLIP', employerSlug: employer.slug };
  }
  if (subject.includes('cancel')) {
    return { classification: 'CANCELLATION', employerSlug: employer.slug };
  }
  if (subject.includes('amend') || subject.includes('updated') || subject.includes('change')) {
    return { classification: 'ROTA_CHANGE', employerSlug: employer.slug };
  }
  if (
    subject.includes('rota') ||
    subject.includes('shift') ||
    subject.includes('schedule') ||
    subject.includes('deployment')
  ) {
    return { classification: 'ROTA', employerSlug: employer.slug };
  }
  return { classification: 'PAY_COMMS', employerSlug: employer.slug };
}
