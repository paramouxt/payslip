import { compareIsoDates, diffDays, isoDate, type IsoDate } from '../../dates/iso-date';

/** The UK tax year runs 6 April → 5 April. PAYE periods key off PAYMENT date. */
export function ukTaxYearOf(date: IsoDate): { taxYear: string; startsOn: IsoDate } {
  const year = Number(date.slice(0, 4));
  const boundary = isoDate(`${year.toString()}-04-06`);
  const startYear = compareIsoDates(date, boundary) >= 0 ? year : year - 1;
  return {
    taxYear: `${startYear.toString()}-${((startYear + 1) % 100).toString().padStart(2, '0')}`,
    startsOn: isoDate(`${startYear.toString()}-04-06`),
  };
}

/**
 * 1-based statutory pay period for a payment date. Fortnightly = HMRC weeks
 * paired: week n = floor(daysSince/7)+1; fortnight = ceil(week/2).
 */
export function ukPeriodIndexForPayDate(
  payDate: IsoDate,
  periodsPerYear: 26 | 52 | 12
): { taxYear: string; periodIndex: number } {
  const { taxYear, startsOn } = ukTaxYearOf(payDate);
  const daysSince = diffDays(startsOn, payDate); // 0-based
  const week = Math.floor(daysSince / 7) + 1;
  const periodIndex =
    periodsPerYear === 52
      ? week
      : periodsPerYear === 26
        ? Math.ceil(week / 2)
        : Math.min(12, Math.floor(daysSince / 30.44) + 1);
  return { taxYear, periodIndex };
}
