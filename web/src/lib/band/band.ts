import {
  BAND_COMMAND_UUID,
  BAND_DAILY_UUID,
  BAND_DATA_UUID,
  BAND_NAME_PREFIX,
  BAND_SERVICE_UUID,
  Cmd,
  encodeCommand,
  encodeDataPacket,
  LineSplitter,
  parseDailyRecord,
  parseDataPacket,
  parseUartLine,
  UART_RX_UUID,
  UART_SERVICE_UUID,
  UART_TX_UUID,
  UART_ZERO,
  type BandSample,
  type Command,
  type DailyRecord,
} from './protocol';

export type BandStatus = 'disconnected' | 'connecting' | 'connected';

export interface BandSource {
  readonly kind: 'ble' | 'simulated';
  readonly status: BandStatus;
  readonly lastSample: BandSample | null;
  /** Whether dumpDaily() can return anything; only firmware with the daily-use log keeps one. */
  readonly hasDailyLog: boolean;
  connect(): Promise<void>;
  disconnect(): void;
  send(cmd: Command, arg?: number): Promise<void>;
  /** Pulls the per-minute summaries logged while the patient wasn't in a session. */
  dumpDaily(): Promise<DailyRecord[]>;
  /** `receivedAt` is performance.now(), the same clock the camera loop uses. */
  onSample(fn: (sample: BandSample, receivedAt: number) => void): () => void;
  onStatus(fn: (status: BandStatus) => void): () => void;
}

abstract class BaseBand {
  status: BandStatus = 'disconnected';
  lastSample: BandSample | null = null;
  private sampleFns = new Set<(s: BandSample, t: number) => void>();
  private statusFns = new Set<(s: BandStatus) => void>();

  onSample(fn: (s: BandSample, t: number) => void) {
    this.sampleFns.add(fn);
    return () => {
      this.sampleFns.delete(fn);
    };
  }

  onStatus(fn: (s: BandStatus) => void) {
    this.statusFns.add(fn);
    return () => {
      this.statusFns.delete(fn);
    };
  }

  protected setStatus(s: BandStatus) {
    this.status = s;
    for (const fn of this.statusFns) fn(s);
  }

  protected deliver(view: DataView) {
    this.deliverSample(parseDataPacket(view));
  }

  protected deliverSample(sample: BandSample) {
    this.lastSample = sample;
    const t = performance.now();
    for (const fn of this.sampleFns) fn(sample, t);
  }
}

export class WebBluetoothBand extends BaseBand implements BandSource {
  readonly kind = 'ble';
  private device: BluetoothDevice | null = null;
  private command: BluetoothRemoteGATTCharacteristic | null = null;
  private daily: BluetoothRemoteGATTCharacteristic | null = null;
  /** Set when the band speaks the UART text protocol; commands go here instead. */
  private uart: BluetoothRemoteGATTCharacteristic | null = null;

  get hasDailyLog() {
    return !!this.daily;
  }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'bluetooth' in navigator;
  }

  /** Must be called from a click handler: Chrome only opens the device picker on a user gesture. */
  async connect() {
    this.setStatus('connecting');
    this.command = this.daily = this.uart = null;
    try {
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [UART_SERVICE_UUID] }, { services: [BAND_SERVICE_UUID] }, { namePrefix: BAND_NAME_PREFIX }],
        optionalServices: [UART_SERVICE_UUID, BAND_SERVICE_UUID],
      });
      this.device.addEventListener('gattserverdisconnected', () => this.setStatus('disconnected'));
      const server = await this.device.gatt!.connect();
      const uart = await server.getPrimaryService(UART_SERVICE_UUID).catch(() => null);
      if (uart) await this.connectUart(uart);
      else await this.connectBinary(await server.getPrimaryService(BAND_SERVICE_UUID));
      this.setStatus('connected');
    } catch (err) {
      this.setStatus('disconnected');
      throw err;
    }
  }

  /** The band as built: text lines over the Nordic UART service. */
  private async connectUart(service: BluetoothRemoteGATTService) {
    const tx = await service.getCharacteristic(UART_TX_UUID);
    const lines = new LineSplitter();
    const decoder = new TextDecoder();
    tx.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      for (const line of lines.push(decoder.decode(value, { stream: true }))) {
        const sample = parseUartLine(line);
        if (sample) this.deliverSample(sample);
      }
    });
    await tx.startNotifications();
    this.uart = await service.getCharacteristic(UART_RX_UUID);
  }

  /** The binary contract at the top of protocol.ts. */
  private async connectBinary(service: BluetoothRemoteGATTService) {
    const data = await service.getCharacteristic(BAND_DATA_UUID);
    data.addEventListener('characteristicvaluechanged', (e) => {
      const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (value) this.deliver(value);
    });
    await data.startNotifications();
    this.command = await service.getCharacteristic(BAND_COMMAND_UUID);
    this.daily = await service.getCharacteristic(BAND_DAILY_UUID).catch(() => null);
    await this.send(Cmd.SYNC_TIME);
  }

  disconnect() {
    this.device?.gatt?.disconnect();
    this.setStatus('disconnected');
  }

  async send(cmd: Command, arg?: number) {
    if (this.uart) {
      // The UART band only understands zeroing; it has no sessions, clock or log to command.
      if (cmd !== Cmd.ZERO) return;
      const bytes = new TextEncoder().encode(UART_ZERO);
      if (this.uart.properties.write) await this.uart.writeValueWithResponse(bytes);
      else await this.uart.writeValueWithoutResponse(bytes);
      return;
    }
    if (!this.command) throw new Error('Band not connected');
    await this.command.writeValueWithResponse(encodeCommand(cmd, arg));
  }

  async dumpDaily(): Promise<DailyRecord[]> {
    const daily = this.daily;
    if (!daily) throw new Error('This band firmware has no daily-use log');
    const records: DailyRecord[] = [];
    await daily.startNotifications();
    try {
      await new Promise<void>((resolve, reject) => {
        let idle: ReturnType<typeof setTimeout>;
        const arm = () => {
          clearTimeout(idle);
          idle = setTimeout(() => done(new Error('Band stopped sending before the end of the log')), 3000);
        };
        const onValue = (e: Event) => {
          const value = (e.target as BluetoothRemoteGATTCharacteristic).value;
          if (!value) return;
          const record = parseDailyRecord(value);
          if (record) {
            records.push(record);
            arm();
          } else done();
        };
        const done = (err?: Error) => {
          clearTimeout(idle);
          daily.removeEventListener('characteristicvaluechanged', onValue);
          if (err) reject(err);
          else resolve();
        };
        daily.addEventListener('characteristicvaluechanged', onValue);
        arm();
        this.send(Cmd.DUMP_DAILY).catch(done);
      });
    } finally {
      await daily.stopNotifications().catch(() => undefined);
    }
    return records;
  }
}

/**
 * Stands in for the band until the hardware is ready. It follows the camera's angle (plus the
 * small offset and lag a real band shows) and goes through the real packet encoder and parser.
 */
export class SimulatedBand extends BaseBand implements BandSource {
  readonly kind = 'simulated';
  readonly hasDailyLog = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private deg = 0;
  private zeroOffset = 0;
  private startMs = performance.now();

  constructor(private truth: () => number | null) {
    super();
  }

  async connect() {
    this.setStatus('connected');
    this.timer = setInterval(() => this.step(), 50);
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setStatus('disconnected');
  }

  async send(cmd: Command) {
    if (cmd === Cmd.ZERO) this.zeroOffset = this.deg;
  }

  async dumpDaily(): Promise<DailyRecord[]> {
    return [];
  }

  private step() {
    const target = this.truth();
    const prev = this.deg;
    if (target !== null) this.deg += 0.35 * (target - 6 - this.deg);
    const noise = (Math.random() - 0.5) * 1.2;
    this.deliver(
      new DataView(
        encodeDataPacket({
          boardMs: Math.round(performance.now() - this.startMs),
          elevationDeg: Math.max(0, this.deg - this.zeroOffset + noise),
          rateDps: (this.deg - prev) / 0.05,
          quat: [1, 0, 0, 0],
          batteryPct: 87,
          calibrated: true,
          dailyMode: false,
          sensorOk: true,
        }),
      ),
    );
  }
}
