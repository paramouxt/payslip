import { isoDate, type IsoDate } from '../../dates/iso-date';
import type {
  CandidatePayslip,
  CandidatePayslipLine,
  PayslipParseInput,
  PayslipParseOutcome,
  PayslipParser,
} from '../types';

const MONEY = String.raw`(\d[\d,]*\.\d{2})`;
const RATE_CLASS_BY_CODE: Readonly<Record<string, string>> = {
  TIERBV2H: 'hands-free',
  TIERBV4H: 'reserved-parking',
};

function refuse(reason: string): PayslipParseOutcome {
  return { ok: false, reason };
}

function toPence(value: string): number {
  const [pounds = '0', pennies = '00'] = value.replaceAll(',', '').split('.');
  return Number(pounds) * 100 + Number(pennies);
}

function toHoursHundredths(value: string): number {
  const [hours = '0', fraction = ''] = value.split('.');
  return Number(hours) * 100 + Number(fraction.padEnd(2, '0'));
}

function firstMoney(text: string, label: RegExp): number | null {
  const match = new RegExp(`${label.source}\\s+${MONEY}`, label.flags).exec(text);
  return match?.[1] ? toPence(match[1]) : null;
}

function finalMoney(text: string): number | null {
  const values = [...text.matchAll(new RegExp(MONEY, 'g'))];
  const value = values.at(-1)?.[1];
  return value ? toPence(value) : null;
}

function parsePayDate(text: string): IsoDate | null {
  const match = /\b(\d{2})[-/](\d{2})[-/](\d{4})\b/.exec(text);
  if (!match) return null;
  try {
    return isoDate(`${match[3] ?? ''}-${match[2] ?? ''}-${match[1] ?? ''}`);
  } catch {
    return null;
  }
}

function parseLines(text: string): CandidatePayslipLine[] | null {
  const seenCodes = [...text.matchAll(/\b(TIERBV[A-Z0-9]+)\s+(?:Wage|HP)\b/gi)].map(
    (match) => match[1]?.toUpperCase() ?? ''
  );
  if (seenCodes.some((code) => !RATE_CLASS_BY_CODE[code])) return null;

  const linePattern = new RegExp(
    `\\b(TIERBV(?:2H|4H))\\s+(Wage|HP)\\s+(\\d+\\.\\d{2})\\s+${MONEY}\\s+${MONEY}\\b`,
    'gi'
  );
  const lines: CandidatePayslipLine[] = [];
  for (const match of text.matchAll(linePattern)) {
    const code = match[1]?.toUpperCase() ?? '';
    const description = match[2]?.toUpperCase() ?? '';
    const hours = match[3];
    const rate = match[4];
    const amount = match[5];
    const rateClassSlug = RATE_CLASS_BY_CODE[code];
    if (!hours || !rate || !amount || !rateClassSlug) return null;
    lines.push({
      code,
      rateClassSlug,
      kind: description === 'HP' ? 'HOLIDAY' : 'BASE',
      hoursHundredths: toHoursHundredths(hours),
      ratePence: toPence(rate),
      amountPence: toPence(amount),
    });
  }
  return lines.length > 0 ? lines : null;
}

function parseCandidate(textContent: string): CandidatePayslip | PayslipParseOutcome {
  const text = textContent.replace(/\s+/g, ' ').trim();
  const payDate = parsePayDate(text);
  if (!payDate) return refuse('PAY_DATE_NOT_FOUND');

  const taxPeriodMatch = /\bTax Period\s*:\s*(\d{1,3})\b/i.exec(text);
  const taxCodeMatch = /\bTax Code\s*:\s*([0-9]{1,5}[A-Z]{1,2}|[A-Z]{1,4})\b/i.exec(text);
  const paymentPeriodMatch =
    /\bPayment Period\s*:\s*(FOUR WEEKLY|FORTNIGHTLY|WEEKLY|MONTHLY)\b/i.exec(text);
  if (!taxPeriodMatch?.[1]) return refuse('TAX_PERIOD_NOT_FOUND');
  if (!taxCodeMatch?.[1]) return refuse('TAX_CODE_NOT_FOUND');
  if (!paymentPeriodMatch?.[1]) return refuse('PAYMENT_PERIOD_NOT_FOUND');

  const lines = parseLines(text);
  if (!lines) return refuse('UNKNOWN_OR_MISSING_EARNING_LINE');

  const grossPence = firstMoney(text, /\bTotal Gross Pay(?!\s+TD)/i);
  const taxPence = firstMoney(text, /\bPAYE Tax/i);
  const niPence = firstMoney(text, /\bNational Insurance(?!\s+TD)/i);
  const pensionPence = firstMoney(text, /\bPension\s*\([^)]*\)/i);
  const netPence = finalMoney(text);
  const ytdGrossPence = firstMoney(text, /\bTotal Gross Pay TD/i);
  const ytdTaxPence = firstMoney(text, /\bTax Paid TD/i);
  const ytdNiPence = firstMoney(text, /\bNational Insurance TD/i);
  const ytdPensionPence = firstMoney(text, /\bpensionIncTD/i);

  const totals = [
    grossPence,
    taxPence,
    niPence,
    pensionPence,
    netPence,
    ytdGrossPence,
    ytdTaxPence,
    ytdNiPence,
    ytdPensionPence,
  ];
  if (totals.some((value) => value === null)) return refuse('REQUIRED_TOTAL_NOT_FOUND');
  if (
    grossPence === null ||
    taxPence === null ||
    niPence === null ||
    pensionPence === null ||
    netPence === null ||
    ytdGrossPence === null ||
    ytdTaxPence === null ||
    ytdNiPence === null ||
    ytdPensionPence === null
  ) {
    return refuse('REQUIRED_TOTAL_NOT_FOUND');
  }

  const earningsPence = lines.reduce((sum, line) => sum + line.amountPence, 0);
  if (earningsPence !== grossPence) return refuse('EARNINGS_DO_NOT_MATCH_GROSS');
  if (grossPence - taxPence - niPence - pensionPence !== netPence) {
    return refuse('DEDUCTIONS_DO_NOT_MATCH_NET');
  }
  if (
    ytdGrossPence < grossPence ||
    ytdTaxPence < taxPence ||
    ytdNiPence < niPence ||
    ytdPensionPence < pensionPence
  ) {
    return refuse('YTD_TOTAL_BELOW_CURRENT');
  }

  return {
    payDate,
    taxPeriod: Number(taxPeriodMatch[1]),
    taxCode: taxCodeMatch[1].toUpperCase(),
    paymentPeriod: paymentPeriodMatch[1].toUpperCase(),
    grossPence,
    taxPence,
    niPence,
    pensionPence,
    netPence,
    ytd: {
      grossPence: ytdGrossPence,
      taxPence: ytdTaxPence,
      niPence: ytdNiPence,
      pensionPence: ytdPensionPence,
    },
    lines,
  };
}

export const tracsisPayslipParserV1: PayslipParser = {
  id: 'tracsis-payslip',
  version: '1.1.0',
  employerSlug: 'tracsis-events',
  parse(input: PayslipParseInput): PayslipParseOutcome {
    if (!/\.pdf$/i.test(input.filename) && input.mimeType !== 'application/pdf') {
      return refuse('NOT_A_PDF');
    }
    const candidate = parseCandidate(input.textContent);
    if ('ok' in candidate) return candidate;
    return { ok: true, payslip: candidate, confidence: 1 };
  },
};
