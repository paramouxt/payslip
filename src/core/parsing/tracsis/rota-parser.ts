import type { RotaParser } from '../types';

/**
 * Tracsis rota parser, version 0: deliberately refuses everything.
 *
 * Real rota emails have not yet been provided (phase-1 §9 Q2), and the
 * constitution forbids guessing: ambiguity ⇒ quarantine. Refusing here routes
 * every Tracsis rota email into the quarantine UI, where manual resolution
 * both keeps the product usable and captures the fixtures that version 1 of
 * this parser will be built and tested against.
 */
export const tracsisRotaParserV0: RotaParser = {
  id: 'tracsis-rota',
  version: '0.0.0',
  employerSlug: 'tracsis-events',
  parse() {
    return { ok: false, reason: 'AWAITING_SAMPLE_EMAILS' };
  },
};
