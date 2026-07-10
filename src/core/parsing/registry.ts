import type { RotaParser } from './types';
import { tracsisRotaParserV0 } from './tracsis/rota-parser';

/**
 * Parser registry — the one sanctioned home for per-employer *code* (§12).
 * Keyed by employer slug; versioned so archived email can be re-parsed by
 * old and new parsers and compared.
 */
export class ParserRegistry {
  private readonly parsers = new Map<string, RotaParser>();

  register(parser: RotaParser): void {
    this.parsers.set(parser.employerSlug, parser);
  }

  findRotaParser(employerSlug: string): RotaParser | null {
    return this.parsers.get(employerSlug) ?? null;
  }
}

export function buildDefaultParserRegistry(): ParserRegistry {
  const registry = new ParserRegistry();
  registry.register(tracsisRotaParserV0);
  return registry;
}
