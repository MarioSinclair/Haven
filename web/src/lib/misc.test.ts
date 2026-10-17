import { describe, expect, it } from 'vitest';
import { baselineSourceFor, percentOf, resolveReference, type BaselineRow } from './baseline';
import { Cmd, DAILY_RECORD_BYTES, encodeCommand, encodeDataPacket, parseDailyRecord, parseDataPacket } from './band/protocol';
import { parsePainRating } from './voice/painVoice';

describe('band packets', () => {
  it('round-trips a data packet within the wire precision', () => {
    const sample = {
      boardMs: 123456,
      elevationDeg: 87.43,
      rateDps: -41.2,
      quat: [0.7071, 0, 0.7071, 0] as [number, number, number, number],
      batteryPct: 64,
      calibrated: true,
      dailyMode: false,
      sensorOk: true,
    };
    const parsed = parseDataPacket(new DataView(encodeDataPacket(sample)));
    expect(parsed.boardMs).toBe(123456);
    expect(parsed.elevationDeg).toBeCloseTo(87.43, 2);
    expect(parsed.rateDps).toBeCloseTo(-41.2, 1);
    expect(parsed.quat[0]).toBeCloseTo(0.7071, 3);
    expect(parsed).toMatchObject({ batteryPct: 64, calibrated: true, dailyMode: false, sensorOk: true });
  });

  it('treats battery 255 as unknown', () => {
    const buf = encodeDataPacket({ boardMs: 0, elevationDeg: 0, rateDps: 0, quat: [1, 0, 0, 0], batteryPct: null, calibrated: false, dailyMode: false, sensorOk: false });
    expect(parseDataPacket(new DataView(buf)).batteryPct).toBeNull();
  });

  it('parses daily records and the zero terminator', () => {
    const buf = new ArrayBuffer(DAILY_RECORD_BYTES);
    const v = new DataView(buf);
    v.setUint32(0, 1_760_000_000, true);
    v.setUint16(4, 1034, true);
    v.setUint8(6, 2);
    v.setUint8(7, 41);
    expect(parseDailyRecord(v)).toEqual({ minuteStart: new Date(1_760_000_000_000), maxElevationDeg: 103.4, raisesOver90: 2, activeSeconds: 41 });
    expect(parseDailyRecord(new DataView(new ArrayBuffer(DAILY_RECORD_BYTES)))).toBeNull();
  });

  it('encodes commands, with the time argument for SYNC_TIME', () => {
    expect(Array.from(encodeCommand(Cmd.ZERO))).toEqual([0x01]);
    const sync = encodeCommand(Cmd.SYNC_TIME, 0x01020304);
    expect(Array.from(sync)).toEqual([0x05, 0x04, 0x03, 0x02, 0x01]);
  });
});

describe('reference hierarchy', () => {
  const rows: BaselineRow[] = [
    { exerciseId: 'side_raise', side: 'right', source: 'contralateral', peakDeg: 170, measuredAt: '2026-10-01' },
    { exerciseId: 'side_raise', side: 'left', source: 'first_session', peakDeg: 60, measuredAt: '2026-10-02' },
  ];

  it('prefers a PT goal, then pre-op, then the healthy arm, then the general goal', () => {
    expect(resolveReference(rows, 'side_raise', 'left', 'left', 150, 140)).toEqual({ deg: 140, source: 'clinician_goal' });
    const withPreOp = [...rows, { exerciseId: 'side_raise', side: 'left', source: 'pre_op', peakDeg: 175, measuredAt: '2026-09-20' } as BaselineRow];
    expect(resolveReference(withPreOp, 'side_raise', 'left', 'left', 150)).toEqual({ deg: 175, source: 'pre_op' });
    expect(resolveReference(rows, 'side_raise', 'left', 'left', 150)).toEqual({ deg: 170, source: 'contralateral' });
    expect(resolveReference(rows, 'scaption', 'left', 'left', 150)).toEqual({ deg: 150, source: 'general_goal' });
  });

  it('never uses the other arm as the reference when both sides had surgery', () => {
    expect(resolveReference(rows, 'side_raise', 'left', 'both', 150)).toEqual({ deg: 150, source: 'general_goal' });
  });

  it('labels range checks by when and which arm', () => {
    const surgery = new Date('2026-09-28');
    expect(baselineSourceFor(new Date('2026-09-20'), surgery, 'left', 'left')).toBe('pre_op');
    expect(baselineSourceFor(new Date('2026-10-02'), surgery, 'right', 'left')).toBe('contralateral');
    expect(baselineSourceFor(new Date('2026-10-02'), surgery, 'left', 'left')).toBe('first_session');
    expect(baselineSourceFor(new Date('2026-10-02'), null, 'right', 'both')).toBe('first_session');
  });

  it('expresses progress as a percent of the reference', () => {
    expect(percentOf(119, { deg: 170, source: 'contralateral' })).toBe(70);
  });
});

describe('parsePainRating', () => {
  it.each([
    ['7', 7],
    ["it's about a 4", 4],
    ['ten', 10],
    ['no pain', 0],
    ['maybe three', 3],
    ['banana', null],
  ])('%s → %s', (input, expected) => {
    expect(parsePainRating(input)).toBe(expected);
  });
});
