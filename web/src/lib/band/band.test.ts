import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebBluetoothBand } from './band';
import {
  BAND_COMMAND_UUID,
  BAND_DATA_UUID,
  BAND_SERVICE_UUID,
  Cmd,
  encodeDataPacket,
  LineSplitter,
  parseUartLine,
  UART_RX_UUID,
  UART_SERVICE_UUID,
  UART_TX_UUID,
  type BandSample,
} from './protocol';

describe('UART band lines', () => {
  it('reads elevation, rate and the zeroed flag', () => {
    expect(parseUartLine('1200,42.5,-10.25,0.12,-0.03,0.98,1\r')).toMatchObject({ elevationDeg: 42.5, rateDps: -10.25, calibrated: true, batteryPct: null });
    expect(parseUartLine('1200,42.5,0,0,0,0,0')?.calibrated).toBe(false);
  });

  it('reads the limit the band reports, and whether the arm is over it', () => {
    expect(parseUartLine('5000,95.5,3,0,0,0,1,90,1')).toMatchObject({ limitDeg: 90, overLimit: true });
    expect(parseUartLine('5000,40,3,0,0,0,1,0,0')).toMatchObject({ limitDeg: null, overLimit: false });
    // Older firmware has no limit fields at all.
    expect(parseUartLine('5000,40,3,0,0,0,1')?.limitDeg).toBeUndefined();
  });

  it('rejects partial or garbled lines', () => {
    expect(parseUartLine('1200,42.5,-10.25,0.12')).toBeNull();
    expect(parseUartLine('1200,,0,0,0,0,1')).toBeNull();
    expect(parseUartLine('hello,world,a,b,c,d,e')).toBeNull();
  });

  it('reassembles lines however the notifications split them', () => {
    const lines = new LineSplitter();
    // One line per notification with no newline, as the test page assumes.
    expect(lines.push('1,10,0,0,0,0,1')).toEqual(['1,10,0,0,0,0,1']);
    // A line split across notifications.
    expect(lines.push('2,20,0,0')).toEqual([]);
    expect(lines.push(',0,0,1\n')).toEqual(['2,20,0,0,0,0,1']);
    // Several lines in one notification.
    expect(lines.push('3,30,0,0,0,0,1\n4,40,0,0,0,0,0\n')).toEqual(['3,30,0,0,0,0,1', '4,40,0,0,0,0,0']);
  });

  it('keeps every field when a newline-terminated line splits after the zeroed flag', () => {
    const lines = new LineSplitter();
    expect(lines.push('1,10,0,0,0,0,1,90,0\n')).toEqual(['1,10,0,0,0,0,1,90,0']);
    expect(lines.push('2,95,0,0,0,0,1')).toEqual([]);
    expect(lines.push(',90,1\n')).toEqual(['2,95,0,0,0,0,1,90,1']);
  });
});

/** A GATT characteristic that records writes and can push notifications. */
class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  writes: Uint8Array[] = [];
  readonly properties = { write: true };

  async startNotifications() {
    return this;
  }
  async stopNotifications() {
    return this;
  }
  async writeValueWithResponse(bytes: Uint8Array) {
    this.writes.push(new Uint8Array(bytes));
  }
  async writeValueWithoutResponse(bytes: Uint8Array) {
    this.writes.push(new Uint8Array(bytes));
  }
  notify(bytes: ArrayBuffer | Uint8Array) {
    const buffer = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
    this.value = new DataView(buffer);
    this.dispatchEvent(new Event('characteristicvaluechanged'));
  }
}

/** Stands in for navigator.bluetooth with a band that offers exactly these services. */
function stubBluetooth(services: Record<string, Record<string, FakeCharacteristic>>) {
  const server = {
    getPrimaryService: async (uuid: string) => {
      const chars = services[uuid];
      if (!chars) throw new Error(`No service ${uuid}`);
      return {
        getCharacteristic: async (id: string) => {
          if (!chars[id]) throw new Error(`No characteristic ${id}`);
          return chars[id];
        },
      };
    },
  };
  const device = Object.assign(new EventTarget(), { name: 'ReachBack', gatt: { connect: async () => server, disconnect: () => undefined } });
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => device } });
}

describe('Bluetooth band connection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('talks to the band as built: text lines in, "z" to zero', async () => {
    const tx = new FakeCharacteristic();
    const rx = new FakeCharacteristic();
    stubBluetooth({ [UART_SERVICE_UUID]: { [UART_TX_UUID]: tx, [UART_RX_UUID]: rx } });

    const band = new WebBluetoothBand();
    const seen: BandSample[] = [];
    band.onSample((s) => seen.push(s));
    await band.connect();
    expect(band.status).toBe('connected');
    expect(band.hasDailyLog).toBe(false);

    const text = new TextEncoder();
    tx.notify(text.encode('1200,42.5,10,0.1,0.2,0.3,0\n'));
    tx.notify(text.encode('1250,47.25,-3.5,0.1'));
    tx.notify(text.encode(',0.2,0.3,1\n'));
    expect(seen.map((s) => [s.elevationDeg, s.rateDps, s.calibrated])).toEqual([
      [42.5, 10, false],
      [47.25, -3.5, true],
    ]);

    await band.send(Cmd.ZERO);
    await band.send(Cmd.START_SESSION); // nothing to send: this band has no sessions
    expect(rx.writes.map((w) => new TextDecoder().decode(w))).toEqual(['z']);
  });

  it("sends the PT's limit and reminder, and test beeps, one write at a time", async () => {
    const tx = new FakeCharacteristic();
    const rx = new FakeCharacteristic();
    stubBluetooth({ [UART_SERVICE_UUID]: { [UART_TX_UUID]: tx, [UART_RX_UUID]: rx } });
    const band = new WebBluetoothBand();
    await band.connect();

    await Promise.all([band.configure({ limitDeg: 90, reminderMinutes: 30 }), band.beep()]);
    await band.configure({ limitDeg: null, reminderMinutes: 0 });
    expect(rx.writes.map((w) => new TextDecoder().decode(w))).toEqual(['c90', 'b', 'r30', 'c0', 'r0']);
  });

  it('still speaks the binary contract to firmware that offers it', async () => {
    const data = new FakeCharacteristic();
    const command = new FakeCharacteristic();
    stubBluetooth({ [BAND_SERVICE_UUID]: { [BAND_DATA_UUID]: data, [BAND_COMMAND_UUID]: command } });

    const band = new WebBluetoothBand();
    const seen: BandSample[] = [];
    band.onSample((s) => seen.push(s));
    await band.connect();
    expect(command.writes[0][0]).toBe(Cmd.SYNC_TIME);

    data.notify(encodeDataPacket({ boardMs: 5, elevationDeg: 88.5, rateDps: 1, quat: [1, 0, 0, 0], batteryPct: 70, calibrated: true, dailyMode: false, sensorOk: true }));
    expect(seen[0]).toMatchObject({ elevationDeg: 88.5, batteryPct: 70 });
  });
});
