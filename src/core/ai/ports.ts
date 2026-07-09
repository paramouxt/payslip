/**
 * AI bounded context — ports only (architecture §14.3 / ADR 13).
 *
 * Boundary rules, enforced by these signatures:
 *  - AI consumes read models (explanation trees, shift history, period
 *    results); it never writes ledger state. Anything it wants changed comes
 *    back as a *proposal* that flows through the same actions a human uses.
 *  - Deterministic engines remain the source of numeric truth. "What if I
 *    drop Saturday?" compiles to a what-if engine run; the AI narrates it.
 *  - Implementations are pluggable and optional: the platform must remain
 *    fully functional (and £0) with every one of these unimplemented.
 *
 * Implementations arrive post-Phase 9. Types marked `unknown` firm up as the
 * read models land in Phase 8.
 */

export interface LanguageModelPort {
  complete(input: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    maxTokens?: number;
  }): Promise<{ content: string }>;
}

export interface AnnualForecast {
  taxYear: string;
  grossPence: number;
  taxPence: number;
  niPence: number;
  netPence: number;
  /** How much of the figure is payslip-backed vs scheduled vs projected. */
  composition: { actualPct: number; scheduledPct: number; projectedPct: number };
}

/** Statistical baseline first; a model provider may refine it later. */
export interface ForecastModel {
  forecastAnnual(input: {
    taxYear: string;
    actualsToDate: unknown;
    scheduledShifts: unknown;
    assumptions?: { weeklyHours?: number };
  }): Promise<AnnualForecast>;
}

export interface ExplanationNarrator {
  /** Turns an engine explanation tree into prose a shift worker would use. */
  narrate(input: { explanationTree: unknown; locale: string }): Promise<{ text: string }>;
}

export interface Recommendation {
  kind: 'ACCEPT_SHIFT' | 'REVIEW_DISCREPANCY' | 'TAX_CODE_CHECK' | 'OTHER';
  summary: string;
  rationale: string;
  /** Optional deep-link the UI can render; never an auto-applied action. */
  actionHref?: string;
}

export interface RecommendationEngine {
  recommend(input: { userId: string; horizonDays: number }): Promise<Recommendation[]>;
}

export interface PayrollQueryAnswer {
  text: string;
  /** Every number cited must trace to an engine run or stored projection. */
  citations: { label: string; ref: string }[];
}

export interface PayrollQueryAgent {
  answer(input: { userId: string; question: string }): Promise<PayrollQueryAnswer>;
}
