import { describe, expect, it } from 'vitest';
import { DomainError } from '../../errors';
import { isoDate } from '../../dates/iso-date';
import { Shift, type ShiftDetails, type ShiftEvidence } from './shift';

const identity = {
  id: 'shift_1',
  userId: 'user_1',
  employerId: 'emp_1',
  contractId: 'con_1',
};

const details: ShiftDetails = {
  externalRef: 'TRX-123',
  date: isoDate('2026-06-14'),
  startAt: new Date('2026-06-14T07:00:00Z'),
  endAt: new Date('2026-06-14T17:00:00Z'),
  timezone: 'Europe/London',
  roleId: 'role_hf',
  venue: 'Bicester Village',
  notes: null,
};

const emailEvidence: ShiftEvidence = {
  sourceEmailId: 'email_1',
  occurredAt: new Date('2026-06-10T09:00:00Z'),
};
const userEvidence: ShiftEvidence = { actor: 'user', occurredAt: new Date('2026-06-11T10:00:00Z') };

describe('Shift.create', () => {
  it('creates a SCHEDULED shift with a seq-1 CREATED event carrying evidence', () => {
    const { shift, event } = Shift.create({ identity, details, evidence: emailEvidence });
    expect(shift.status).toBe('SCHEDULED');
    expect(shift.version).toBe(1);
    expect(shift.scheduledHours).toBe(10);
    expect(event).toMatchObject({ seq: 1, kind: 'CREATED', sourceEmailId: 'email_1', diff: null });
  });

  it('enforces temporal invariants', () => {
    expect(() =>
      Shift.create({
        identity,
        details: { ...details, endAt: details.startAt },
        evidence: emailEvidence,
      })
    ).toThrow(/end after it starts/);
    expect(() =>
      Shift.create({
        identity,
        details: { ...details, endAt: new Date('2026-06-15T08:00:00Z') },
        evidence: emailEvidence,
      })
    ).toThrow(/24 hours/);
  });

  it('requires evidence', () => {
    expect(() => Shift.create({ identity, details, evidence: { occurredAt: new Date() } })).toThrow(
      /evidence/
    );
  });
});

describe('Shift.amend', () => {
  it('records a diff and bumps the version; email evidence ⇒ AMENDED', () => {
    const { shift } = Shift.create({ identity, details, evidence: emailEvidence });
    const { shift: amended, event } = shift.amend(
      { endAt: new Date('2026-06-14T15:00:00Z') },
      { sourceEmailId: 'email_2', occurredAt: new Date('2026-06-12T08:00:00Z') }
    );
    expect(amended.version).toBe(2);
    expect(amended.status).toBe('AMENDED');
    expect(event.kind).toBe('AMENDED');
    expect(event.diff?.endAt).toEqual({
      from: '2026-06-14T17:00:00.000Z',
      to: '2026-06-14T15:00:00.000Z',
    });
  });

  it('human evidence ⇒ MANUAL_EDIT', () => {
    const { shift } = Shift.create({ identity, details, evidence: emailEvidence });
    const { event } = shift.amend({ venue: 'Oxford' }, userEvidence);
    expect(event.kind).toBe('MANUAL_EDIT');
    expect(event.actor).toBe('user');
  });

  it('rejects no-op amendments', () => {
    const { shift } = Shift.create({ identity, details, evidence: emailEvidence });
    expect(() => shift.amend({ venue: 'Bicester Village' }, userEvidence)).toThrow(
      /changes nothing/
    );
  });

  it('cannot amend a cancelled shift', () => {
    const { shift } = Shift.create({ identity, details, evidence: emailEvidence });
    const { shift: cancelled } = shift.cancel(emailEvidence);
    expect(() => cancelled.amend({ venue: 'Oxford' }, userEvidence)).toThrow(/reinstate/);
  });
});

describe('cancel / reinstate', () => {
  it('cancels once, then requires reinstatement', () => {
    const { shift } = Shift.create({ identity, details, evidence: emailEvidence });
    const { shift: cancelled, event } = shift.cancel(emailEvidence);
    expect(cancelled.status).toBe('CANCELLED');
    expect(event.kind).toBe('CANCELLED');
    expect(() => cancelled.cancel(emailEvidence)).toThrow(/already cancelled/);

    const { shift: back, event: rEvent } = cancelled.reinstate(userEvidence);
    expect(back.status).toBe('SCHEDULED');
    expect(rEvent.kind).toBe('REINSTATED');
    expect(() => back.reinstate(userEvidence)).toThrow(/only a cancelled/);
  });
});

describe('rate class override', () => {
  it('sets, rejects same-value, and clears', () => {
    const { shift } = Shift.create({ identity, details, evidence: emailEvidence });
    const { shift: withOverride, event } = shift.setRateClassOverride('rc_rp', userEvidence);
    expect(event.kind).toBe('OVERRIDE_SET');
    expect(withOverride.snapshot.rateClassOverrideId).toBe('rc_rp');
    expect(() => withOverride.setRateClassOverride('rc_rp', userEvidence)).toThrow(/unchanged/);

    const { event: cleared } = withOverride.setRateClassOverride(null, userEvidence);
    expect(cleared.kind).toBe('OVERRIDE_CLEARED');
  });
});

describe('Shift.fromEvents', () => {
  it('replays a stream to the same state as the projection', () => {
    const { shift: s1, event: e1 } = Shift.create({ identity, details, evidence: emailEvidence });
    const { shift: s2, event: e2 } = s1.amend(
      { startAt: new Date('2026-06-14T08:00:00Z') },
      emailEvidence
    );
    const { shift: s3, event: e3 } = s2.cancel(userEvidence);

    const rebuilt = Shift.fromEvents(identity, [e1, e2, e3]);
    expect(rebuilt.version).toBe(s3.version);
    expect(rebuilt.snapshot).toEqual(s3.snapshot);
  });

  it('rejects gapped streams and empty streams', () => {
    const { event: e1 } = Shift.create({ identity, details, evidence: emailEvidence });
    expect(() => Shift.fromEvents(identity, [])).toThrow(DomainError);
    expect(() => Shift.fromEvents(identity, [{ ...e1, seq: 2 }])).toThrow(/gap/);
  });
});
