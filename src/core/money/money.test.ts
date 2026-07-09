import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { Money, roundToInt } from './money';

describe('roundToInt', () => {
  it('HALF_UP rounds halves away from zero', () => {
    expect(roundToInt(2.5, 'HALF_UP')).toBe(3);
    expect(roundToInt(-2.5, 'HALF_UP')).toBe(-3);
    expect(roundToInt(2.4, 'HALF_UP')).toBe(2);
    expect(roundToInt(2.6, 'HALF_UP')).toBe(3);
    expect(roundToInt(-2.4, 'HALF_UP')).toBe(-2);
  });

  it('HALF_EVEN breaks ties towards the even neighbour', () => {
    expect(roundToInt(2.5, 'HALF_EVEN')).toBe(2);
    expect(roundToInt(3.5, 'HALF_EVEN')).toBe(4);
    expect(roundToInt(-2.5, 'HALF_EVEN')).toBe(-2);
    expect(roundToInt(-3.5, 'HALF_EVEN')).toBe(-4);
    expect(roundToInt(2.51, 'HALF_EVEN')).toBe(3);
  });

  it('FLOOR/CEIL/TRUNCATE behave directionally around zero', () => {
    expect(roundToInt(2.6, 'FLOOR')).toBe(2);
    expect(roundToInt(-2.4, 'FLOOR')).toBe(-3);
    expect(roundToInt(2.4, 'CEIL')).toBe(3);
    expect(roundToInt(-2.6, 'CEIL')).toBe(-2);
    expect(roundToInt(2.9, 'TRUNCATE')).toBe(2);
    expect(roundToInt(-2.9, 'TRUNCATE')).toBe(-2);
  });

  it('neutralises binary float noise before deciding', () => {
    // 0.1 + 0.2 = 0.30000000000000004; 167.5316 arrives as ...15999999998
    expect(roundToInt((0.1 + 0.2) * 10, 'HALF_UP')).toBe(3);
    expect(roundToInt(1388 * 0.1207, 'HALF_UP')).toBe(168);
  });

  it('rejects non-finite input', () => {
    expect(() => roundToInt(Number.NaN, 'HALF_UP')).toThrow(DomainError);
    expect(() => roundToInt(Number.POSITIVE_INFINITY, 'HALF_UP')).toThrow(DomainError);
  });
});

describe('Money', () => {
  it('requires integer minor units and a plausible currency', () => {
    expect(() => Money.of(2.5, 'GBP')).toThrow(DomainError);
    expect(() => Money.of(100, 'gbp')).toThrow(DomainError);
    expect(() => Money.of(100, 'POUND')).toThrow(DomainError);
    expect(Money.of(100, 'GBP').pence).toBe(100);
  });

  it('adds and subtracts within one currency only', () => {
    const a = Money.of(150, 'GBP');
    const b = Money.of(50, 'GBP');
    expect(a.add(b).pence).toBe(200);
    expect(a.subtract(b).pence).toBe(100);
    expect(() => a.add(Money.of(1, 'EUR'))).toThrow(/currency mismatch/);
  });

  it('derives the Tracsis rolled-up holiday amounts from 12.07%', () => {
    // £13.88 → £1.68 and £15.06 → £1.82 (the figures from the brief).
    expect(Money.of(1388, 'GBP').percent(12.07, 'HALF_UP').pence).toBe(168);
    expect(Money.of(1506, 'GBP').percent(12.07, 'HALF_UP').pence).toBe(182);
  });

  it('multiplies by fractional factors with explicit rounding', () => {
    expect(Money.of(1388, 'GBP').multiply(8.5, 'HALF_UP').pence).toBe(11798);
    expect(Money.of(999, 'GBP').multiply(1 / 3, 'HALF_EVEN').pence).toBe(333);
  });

  it('sums an empty list to zero', () => {
    expect(Money.sum([], 'GBP').isZero).toBe(true);
  });

  it('renders a stable debug string', () => {
    expect(Money.of(-12345, 'GBP').toString()).toBe('GBP -123.45');
    expect(Money.of(5, 'GBP').toString()).toBe('GBP 0.05');
  });
});
