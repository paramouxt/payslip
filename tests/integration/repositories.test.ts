import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConcurrencyError } from '@/core/errors';
import { isoDate } from '@/core/dates/iso-date';
import { resolvePeriodFor } from '@/core/domain/payroll-period/scheme';
import { Shift } from '@/core/domain/shift/shift';
import { createTenantRepositories, type TenantRepositories } from '@/server/repositories';
import { buildTracsisEmployerTemplate } from '@/server/templates/tracsis';

/**
 * Runs against a real Postgres (schema already migrated) when
 * TEST_DATABASE_URL is set; self-skips otherwise. CI provides a service
 * container. These tests are the teeth behind ADR 10: tenant isolation is
 * asserted, not assumed.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('repositories (Postgres)', () => {
  let db: PrismaClient;
  let alice: TenantRepositories;
  let bob: TenantRepositories;
  let employerId: string;
  let contractId: string;

  beforeAll(async () => {
    db = new PrismaClient({ datasourceUrl: url });
    const [a, b] = await Promise.all([
      db.user.create({ data: { email: `alice-${randomUUID()}@test.local` } }),
      db.user.create({ data: { email: `bob-${randomUUID()}@test.local` } }),
    ]);
    alice = createTenantRepositories(db, { userId: a.id });
    bob = createTenantRepositories(db, { userId: b.id });

    ({ employerId } = await alice.employers.createFromConfig(buildTracsisEmployerTemplate()));
    const contract = await alice.contracts.create({
      employerId,
      startDate: isoDate('2026-04-06'),
    });
    contractId = contract.id;
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('round-trips the employer aggregate through config', async () => {
    const loaded = await alice.employers.getConfig(employerId);
    expect(loaded).not.toBeNull();
    expect(loaded!.config.slug).toBe('tracsis-events');
    expect(loaded!.config.rules).toHaveLength(2);
    expect(loaded!.activeRuleSetVersion).toBe(1);
    expect(Object.keys(loaded!.rateClassIdsBySlug).sort()).toEqual([
      'hands-free',
      'reserved-parking',
    ]);
    // Role default linkage survived slug↔id mapping.
    const hf = loaded!.config.roles.find((r) => r.slug === 'hands-free');
    expect(hf?.defaultRateClassSlug).toBe('hands-free');
  });

  it('enforces tenant isolation across every repository', async () => {
    expect(await bob.employers.list()).toHaveLength(0);
    expect(await bob.employers.getConfig(employerId)).toBeNull();
    expect(await bob.contracts.getById(contractId)).toBeNull();
    await expect(
      bob.contracts.create({ employerId, startDate: isoDate('2026-05-01') })
    ).rejects.toThrow(/not found for tenant/);
    expect(await bob.shifts.listBetween(isoDate('2026-01-01'), isoDate('2027-01-01'))).toHaveLength(
      0
    );
  });

  it('persists the shift aggregate: create, amend, history, optimistic concurrency', async () => {
    const created = Shift.create({
      identity: {
        id: `shift_${randomUUID()}`,
        userId: (
          await db.user.findFirstOrThrow({ where: { employers: { some: { id: employerId } } } })
        ).id,
        employerId,
        contractId,
      },
      details: {
        externalRef: null,
        date: isoDate('2026-06-14'),
        startAt: new Date('2026-06-14T07:00:00Z'),
        endAt: new Date('2026-06-14T17:00:00Z'),
        timezone: 'Europe/London',
        roleId: null,
        venue: 'Bicester Village',
        notes: null,
      },
      evidence: { actor: 'user', occurredAt: new Date() },
    });
    await alice.shifts.create(created.shift, created.event);

    const amended = created.shift.amend(
      { endAt: new Date('2026-06-14T15:00:00Z') },
      { actor: 'user', occurredAt: new Date() }
    );
    await alice.shifts.applyEvent(amended.shift, amended.event);

    const loaded = await alice.shifts.getWithHistory(created.shift.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.shift.version).toBe(2);
    expect(loaded!.events.map((e) => e.kind)).toEqual(['CREATED', 'MANUAL_EDIT']);
    expect(loaded!.events[1]!.diff?.endAt).toBeDefined();
    // Replay equals projection.
    const replayed = Shift.fromEvents(
      {
        id: created.shift.id,
        userId: created.shift.userId,
        employerId,
        contractId,
      },
      loaded!.events
    );
    expect(replayed.snapshot).toEqual(loaded!.shift.snapshot);

    // A second apply of the same event must fail the version check.
    await expect(alice.shifts.applyEvent(amended.shift, amended.event)).rejects.toThrow(
      ConcurrencyError
    );

    // Bob cannot see or touch it.
    expect(await bob.shifts.getById(created.shift.id)).toBeNull();
    await expect(
      bob.shifts.applyEvent(amended.shift, {
        ...amended.event,
        seq: 3,
      })
    ).rejects.toThrow(ConcurrencyError);
  });

  it('deduplicates email ingestion by key', async () => {
    const dedupeKey = `test-${randomUUID()}`;
    const input = {
      dedupeKey,
      receivedAt: new Date(),
      subject: 'Rota w/c 15 June',
      fromAddress: 'rota@tracsis.com',
    };
    const first = await alice.emailMessages.insertIfNew(input);
    const second = await alice.emailMessages.insertIfNew(input);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it('materialises payroll periods idempotently from the scheme', async () => {
    const scheme = buildTracsisEmployerTemplate().payPeriodScheme;
    const span = resolvePeriodFor(scheme, isoDate('2026-04-20'));
    const p1 = await alice.payrollPeriods.ensure(employerId, span);
    const p2 = await alice.payrollPeriods.ensure(employerId, span);
    expect(p1.id).toBe(p2.id);
    expect(p1).toMatchObject({
      sequence: 1,
      startDate: '2026-04-15',
      endDate: '2026-04-28',
      expectedPayDate: '2026-05-06',
    });
    const listed = await alice.payrollPeriods.listRange(
      employerId,
      isoDate('2026-04-01'),
      isoDate('2026-05-01')
    );
    expect(listed.some((p) => p.id === p1.id)).toBe(true);
  });
});
