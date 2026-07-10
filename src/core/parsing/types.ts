import type { IsoDate } from '../dates/iso-date';

export type EmailClassificationKind =
  'ROTA' | 'ROTA_CHANGE' | 'CANCELLATION' | 'PAYSLIP' | 'PAY_COMMS' | 'OTHER';

/** What a rota parser is given: content only, never I/O (§12). */
export interface RotaParseInput {
  subject: string;
  fromAddress: string;
  receivedAt: Date;
  plaintextBody: string | null;
  htmlBody: string | null;
  attachments: { filename: string; mimeType: string }[];
}

/** A parser's proposal for one shift — the pipeline prices and applies it. */
export interface CandidateShift {
  externalRef: string | null;
  date: IsoDate;
  /** Wall-clock HH:mm in the employer's timezone. */
  startTime: string;
  endTime: string;
  roleSlug: string | null;
  venue: string | null;
  notes: string | null;
}

export type RotaParseOutcome =
  { ok: true; shifts: CandidateShift[]; confidence: number } | { ok: false; reason: string };

export interface RotaParser {
  readonly id: string;
  readonly version: string;
  readonly employerSlug: string;
  parse(input: RotaParseInput): RotaParseOutcome;
}
