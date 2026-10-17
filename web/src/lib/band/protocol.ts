// Contract between the armband firmware and the web app. Change both sides together.
// The band the team built uses the simpler UART text protocol at the bottom of this file;
// the app speaks both and picks whichever service the band offers.
//
// GATT service BAND_SERVICE_UUID, advertised with the name prefix "RehabBand":
//   DATA     notify  18-byte DataPacket at ~20 Hz while connected
//   COMMAND  write   1 opcode byte + optional little-endian argument
//   DAILY    notify  8-byte DailyRecord per minute after a DUMP_DAILY command;
//                    the dump ends with one all-zero record
//
// DataPacket, little-endian:
//   off  type    field
//   0    uint32  board millis()
//   4    int16   elevation, 0.01°   (angle between the arm and gravity, 0 when hanging at ZERO time)
//   6    int16   angular rate, 0.1°/s
//   8    int16×4 quaternion w,x,y,z, Q14 (value / 16384), game rotation vector
//   16   uint8   battery %, 255 = unknown
//   17   uint8   flags: bit0 calibrated, bit1 daily-use mode, bit2 sensor ok
//
// DailyRecord, little-endian:
//   0    uint32  minute start, unix seconds (board time is set by SYNC_TIME on connect)
//   4    uint16  max elevation in that minute, 0.1°
//   6    uint8   raises above 90° in that minute
//   7    uint8   active seconds in that minute (0–60)

export const BAND_NAME_PREFIX = 'RehabBand';
export const BAND_SERVICE_UUID = 'f78880cb-642c-467a-9663-6f5165ebeed0';
export const BAND_DATA_UUID = '32aae1a1-4647-4191-b1d0-19f3b3925fe8';
export const BAND_COMMAND_UUID = 'fb79dbb5-9b34-45fb-8196-3505e9d324ac';
export const BAND_DAILY_UUID = '6df82280-3a4f-4f6b-9dfd-0f83ebe99a54';

export const DATA_PACKET_BYTES = 18;
export const DAILY_RECORD_BYTES = 8;

export const Cmd = {
  /** Arm hanging relaxed: store the current gravity direction as 0°. */
  ZERO: 0x01,
  START_SESSION: 0x02,
  END_SESSION: 0x03,
  /** Stop streaming and log per-minute summaries to flash until the next connection. */
  DAILY_MODE: 0x04,
  /** Argument: uint32 unix seconds. Sent on every connect; the board has no real-time clock. */
  SYNC_TIME: 0x05,
  /** Stream all stored DailyRecords on the DAILY characteristic, then clear them. */
  DUMP_DAILY: 0x06,
} as const;

export type Command = (typeof Cmd)[keyof typeof Cmd];

export interface BandSample {
  boardMs: number;
  elevationDeg: number;
  rateDps: number;
  quat: [number, number, number, number];
  batteryPct: number | null;
  calibrated: boolean;
  dailyMode: boolean;
  sensorOk: boolean;
  /** The limit the band itself is warning at, as it reports it: null when off, undefined when the band has no limit feature. */
  limitDeg?: number | null;
  /** The band reports the arm above its limit. */
  overLimit?: boolean;
}

export interface DailyRecord {
  minuteStart: Date;
  maxElevationDeg: number;
  raisesOver90: number;
  activeSeconds: number;
}

const Q14 = 16384;

export function parseDataPacket(view: DataView): BandSample {
  if (view.byteLength < DATA_PACKET_BYTES) throw new Error(`Band packet too short: ${view.byteLength} bytes`);
  const battery = view.getUint8(16);
  const flags = view.getUint8(17);
  return {
    boardMs: view.getUint32(0, true),
    elevationDeg: view.getInt16(4, true) / 100,
    rateDps: view.getInt16(6, true) / 10,
    quat: [view.getInt16(8, true) / Q14, view.getInt16(10, true) / Q14, view.getInt16(12, true) / Q14, view.getInt16(14, true) / Q14],
    batteryPct: battery === 255 ? null : battery,
    calibrated: (flags & 0b001) !== 0,
    dailyMode: (flags & 0b010) !== 0,
    sensorOk: (flags & 0b100) !== 0,
  };
}

/** Mirror of the firmware's packer; used by the simulator and tests. */
export function encodeDataPacket(s: BandSample): ArrayBuffer {
  const buf = new ArrayBuffer(DATA_PACKET_BYTES);
  const v = new DataView(buf);
  v.setUint32(0, s.boardMs >>> 0, true);
  v.setInt16(4, clampInt16(Math.round(s.elevationDeg * 100)), true);
  v.setInt16(6, clampInt16(Math.round(s.rateDps * 10)), true);
  s.quat.forEach((q, i) => v.setInt16(8 + i * 2, clampInt16(Math.round(q * Q14)), true));
  v.setUint8(16, s.batteryPct === null ? 255 : Math.max(0, Math.min(100, Math.round(s.batteryPct))));
  v.setUint8(17, (s.calibrated ? 0b001 : 0) | (s.dailyMode ? 0b010 : 0) | (s.sensorOk ? 0b100 : 0));
  return buf;
}

/** Returns null for the all-zero terminator that ends a dump. */
export function parseDailyRecord(view: DataView): DailyRecord | null {
  if (view.byteLength < DAILY_RECORD_BYTES) throw new Error(`Daily record too short: ${view.byteLength} bytes`);
  const seconds = view.getUint32(0, true);
  if (seconds === 0) return null;
  return {
    minuteStart: new Date(seconds * 1000),
    maxElevationDeg: view.getUint16(4, true) / 10,
    raisesOver90: view.getUint8(6),
    activeSeconds: view.getUint8(7),
  };
}

export function encodeCommand(cmd: Command, arg?: number): Uint8Array<ArrayBuffer> {
  if (cmd === Cmd.SYNC_TIME) {
    const out = new Uint8Array(5);
    out[0] = cmd;
    new DataView(out.buffer).setUint32(1, (arg ?? Math.floor(Date.now() / 1000)) >>> 0, true);
    return out;
  }
  return Uint8Array.of(cmd);
}

function clampInt16(n: number): number {
  return Math.max(-32768, Math.min(32767, n));
}

// The band as built speaks plain text over the Nordic UART service instead, at 20 Hz:
//   ms, elevation°, rate °/s, gyro x, gyro y, gyro z, zeroed (1/0), limit° (0 = off), over (1/0)
// Earlier firmware stopped after `zeroed`. Commands are text writes:
//   z        zero: the arm's current position (relaxed at the side) becomes 0°
//   c<deg>   safe limit; the buzzer beeps faster from 10° below it and alarms above it. 0 = off.
//   r<min>   chirp after this many minutes without raising the arm above 60°. 0 = off.
//   m1 / m0  mute / unmute
//   b        test beep
// The band saves the limit and reminder, but forgets the zero at power-off, and it only warns
// once zeroed. It sends no battery level or orientation and keeps no daily-use log.
export const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
/** Band → app, notify. */
export const UART_TX_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
/** App → band, write. */
export const UART_RX_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const UART_ZERO = 'z';
export const UART_BEEP = 'b';
export const uartLimit = (deg: number | null) => `c${deg === null ? 0 : Math.round(deg)}`;
export const uartReminder = (minutes: number) => `r${Math.max(0, Math.round(minutes))}`;

/** One line from the UART band, or null if it isn't a whole, well-formed line. */
export function parseUartLine(line: string): BandSample | null {
  const p = line.trim().split(',');
  if (p.length < 7) return null;
  const elevationDeg = Number(p[1]);
  const rateDps = Number(p[2]);
  if (p[1].trim() === '' || !Number.isFinite(elevationDeg) || !Number.isFinite(rateDps)) return null;
  const sample: BandSample = {
    boardMs: Number(p[0]) || 0,
    elevationDeg,
    rateDps,
    quat: [1, 0, 0, 0], // not sent by this band
    batteryPct: null,
    calibrated: p[6].trim() === '1',
    dailyMode: false,
    sensorOk: true,
  };
  if (p.length >= 9) {
    const limit = Number(p[7]);
    sample.limitDeg = Number.isFinite(limit) && limit > 0 ? limit : null;
    sample.overLimit = p[8].trim() === '1';
  }
  return sample;
}

/**
 * Turns UART notifications into whole lines. A notification usually carries one line, but a small
 * Bluetooth packet size can split a line, and several lines can arrive together.
 */
export class LineSplitter {
  private pending = '';
  private newlines = false;

  push(chunk: string): string[] {
    if (chunk.includes('\n')) this.newlines = true;
    const parts = (this.pending + chunk).split(/\r?\n/);
    this.pending = parts.pop() ?? '';
    // Firmware that never ends lines with a newline: a leftover that already parses is a whole
    // line. Once the band has sent a newline, always wait for it, so a split line keeps every field.
    if (!this.newlines && parseUartLine(this.pending)) {
      parts.push(this.pending);
      this.pending = '';
    }
    // Never let a stream of garbage pile up.
    if (this.pending.length > 256) this.pending = '';
    return parts.filter((line) => line.trim());
  }
}
