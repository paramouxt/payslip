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
  /**
   * Names this tenant's person goes by on team-wide rotas (employer config
   * `rosterNames`). Grid-style rotas list the whole team; a parser needs
   * these to select the right row — and must refuse, never guess, when no
   * row or more than one row matches.
   */
  selfIdentifiers: string[];
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

/** Text-only payslip input. PDF decoding is an integration concern. */
export interface PayslipParseInput {
  filename: string;
  mimeType: string;
  textContent: string;
}

export type PayslipLineKind = 'BASE' | 'HOLIDAY';

/** Employer-labelled earning line, preserving printed arithmetic as evidence. */
export interface CandidatePayslipLine {
  code: string;
  roleSlug: string;
  kind: PayslipLineKind;
  /** Decimal hours scaled by 100 (for example 7.50 hours is 750). */
  hoursHundredths: number;
  ratePence: number;
  amountPence: number;
}

/** A parser proposal. Every monetary value is integer pence. */
export interface CandidatePayslip {
  payDate: IsoDate;
  taxPeriod: number;
  taxCode: string;
  paymentPeriod: string;
  grossPence: number;
  taxPence: number;
  niPence: number;
  pensionPence: number;
  netPence: number;
  ytd: {
    grossPence: number;
    taxPence: number;
    niPence: number;
    pensionPence: number;
  };
  lines: CandidatePayslipLine[];
}

export type PayslipParseOutcome =
  { ok: true; payslip: CandidatePayslip; confidence: number } | { ok: false; reason: string };

export interface PayslipParser {
  readonly id: string;
  readonly version: string;
  readonly employerSlug: string;
  parse(input: PayslipParseInput): PayslipParseOutcome;
}
