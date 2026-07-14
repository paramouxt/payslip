import type { PayslipParser, RotaParser } from './types';
import { tracsisPayslipParserV1 } from './tracsis/payslip-parser';
import { tracsisRotaParserV1 } from './tracsis/rota-parser';

/**
 * Parser registry — the one sanctioned home for per-employer *code* (§12).
 * Keyed by employer slug; versioned so archived email can be re-parsed by
 * old and new parsers and compared.
 */
export class ParserRegistry {
  private readonly rotaParsers = new Map<string, RotaParser>();
  private readonly payslipParsers = new Map<string, PayslipParser>();

  register(parser: RotaParser): void {
    this.rotaParsers.set(parser.employerSlug, parser);
  }

  registerPayslip(parser: PayslipParser): void {
    this.payslipParsers.set(parser.employerSlug, parser);
  }

  findRotaParser(employerSlug: string): RotaParser | null {
    return this.rotaParsers.get(employerSlug) ?? null;
  }

  findPayslipParser(employerSlug: string): PayslipParser | null {
    return this.payslipParsers.get(employerSlug) ?? null;
  }
}

export function buildDefaultParserRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(tracsisRotaParserV1);
  registry.registerPayslip(tracsisPayslipParserV1);
  return registry;
}
