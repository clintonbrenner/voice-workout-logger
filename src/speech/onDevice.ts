/**
 * On-device speech-to-text: records a clip with the microphone, then has the
 * Moonshine model (running in a background worker) turn it into text.
 * No internet needed after the one-time model download; audio never leaves the phone.
 */

// ---------------------------------------------------------------------------
// Model (lives in a worker)
// ---------------------------------------------------------------------------
type Listener = (msg: { type: string; [k: string]: unknown }) => void;

let worker: Worker | null = null;
const listeners = new Set<Listener>();
let nextId = 1;

export interface ModelStatus {
  state: 'not-loaded' | 'loading' | 'ready' | 'error';
  pct: number;
  mb: number;
  device: string;
  error?: string;
}
export const modelStatus: ModelStatus = { state: 'not-loaded', pct: 0, mb: 0, device: '' };

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./asrWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') Object.assign(modelStatus, { state: 'loading', pct: msg.pct, mb: msg.mb });
      if (msg.type === 'ready') Object.assign(modelStatus, { state: 'ready', pct: 100, device: msg.device });
      if (msg.type === 'error' && modelStatus.state !== 'ready') Object.assign(modelStatus, { state: 'error', error: msg.message });
      listeners.forEach((fn) => fn(msg));
    };
  }
  return worker;
}

export function onModelMessage(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Downloads (first time) and prepares the model. */
export function loadModel(): Promise<void> {
  if (modelStatus.state === 'ready') return Promise.resolve();
  modelStatus.state = 'loading';
  return new Promise((resolve, reject) => {
    const off = onModelMessage((msg) => {
      if (msg.type === 'ready') {
        off();
        resolve();
      } else if (msg.type === 'error') {
        off();
        reject(new Error(String(msg.message)));
      }
    });
    getWorker().postMessage({ type: 'load' });
  });
}

/** Requests run one at a time (the model can't do two at once), so queue them. */
let queue: Promise<unknown> = Promise.resolve();

/** Turns 16 kHz mono audio into text. */
export function transcribe(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const run = queue.then(() => transcribeNow(audio));
  queue = run.catch(() => {});
  return run;
}

function transcribeNow(audio: Float32Array): Promise<{ text: string; ms: number }> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const off = onModelMessage((msg) => {
      if (msg.id !== id) return;
      off();
      if (msg.type === 'result') resolve({ text: String(msg.text), ms: Number(msg.ms) });
      else reject(new Error(String(msg.message)));
    });
    getWorker().postMessage({ type: 'transcribe', id, audio }, [audio.buffer]);
  });
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------
const TARGET_RATE = 16000;

/**
 * Records raw audio from the mic.
 * IMPORTANT on iPhone: call start() directly inside the tap handler, because the
 * audio context has to be created and resumed during the tap.
 */
export class ClipRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  /** Which microphone is being used (e.g. "AirPods"). */
  device = '';
  /** Called once, when real sound (not silence) first arrives from the mic. */
  onSound: (() => void) | null = null;
  private startedAt = 0;
  /** ms from pressing until real sound arrived (AirPods can take a while to switch). */
  soundAfterMs = -1;
  /** Loudest moment of the clip, 0–100. */
  peak = 0;

  async start(): Promise<void> {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    const resumed = this.ctx.resume(); // during the tap — before any waiting
    this.chunks = [];
    this.startedAt = performance.now();
    this.soundAfterMs = -1;
    this.peak = 0;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    await resumed;
    this.device = this.stream.getAudioTracks()[0]?.label ?? '';
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessor is old but works everywhere, including Safari.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      let max = 0;
      let sum = 0;
      for (const v of data) {
        const a = Math.abs(v);
        if (a > max) max = a;
        sum += v * v;
      }
      if (this.soundAfterMs < 0) {
        // While Bluetooth headphones switch into "call mode" the mic delivers pure
        // silence. Skip that, and only count the mic as live once real sound arrives.
        if (max < 1e-4) return;
        this.soundAfterMs = Math.round(performance.now() - this.startedAt);
        this.onSound?.();
      }
      this.peak = Math.max(this.peak, Math.min(100, Math.round(Math.sqrt(sum / data.length) * 400)));
      this.chunks.push(new Float32Array(data));
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0; // must be connected to the speakers to run, but silently
    source.connect(this.node);
    this.node.connect(mute);
    mute.connect(this.ctx.destination);
  }

  /** Everything recorded so far (16 kHz), without stopping — for the live preview. */
  snapshot(): Promise<Float32Array> {
    return resample(this.joined(), this.ctx?.sampleRate ?? TARGET_RATE);
  }

  /** Seconds recorded so far. */
  get seconds(): number {
    const rate = this.ctx?.sampleRate ?? TARGET_RATE;
    return this.chunks.reduce((n, c) => n + c.length, 0) / rate;
  }

  private joined(): Float32Array {
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const raw = new Float32Array(length);
    let offset = 0;
    for (const c of this.chunks) {
      raw.set(c, offset);
      offset += c.length;
    }
    return raw;
  }

  /** Stops recording and returns 16 kHz mono audio ready for the model. */
  async stop(): Promise<Float32Array> {
    const ctx = this.ctx;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const raw = this.joined();
    const rate = ctx?.sampleRate ?? TARGET_RATE;
    void ctx?.close();
    this.ctx = null;
    return resample(raw, rate);
  }
}

/** Converts audio to 16 kHz (what speech models expect). */
export async function resample(audio: Float32Array, fromRate: number): Promise<Float32Array> {
  if (fromRate === TARGET_RATE || audio.length === 0) return audio;
  const outLen = Math.round((audio.length * TARGET_RATE) / fromRate);
  const off = new OfflineAudioContext(1, outLen, TARGET_RATE);
  const buf = off.createBuffer(1, audio.length, fromRate);
  buf.getChannelData(0).set(audio);
  const src = off.createBufferSource();
  src.buffer = buf;
  src.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

// ---------------------------------------------------------------------------
// The record button's engine (same interface as Safari's, so the app can swap)
// ---------------------------------------------------------------------------
import type { SpeechEngine, SpeechHandlers } from './types';

const READY_KEY = 'liftlog.onDeviceModel';

/** True once the model has been downloaded on this device (it's cached from then on). */
export function onDeviceChosen(): boolean {
  return localStorage.getItem(READY_KEY) === '1';
}
export function rememberOnDevice(on: boolean): void {
  if (on) localStorage.setItem(READY_KEY, '1');
  else localStorage.removeItem(READY_KEY);
}

export class OnDeviceEngine implements SpeechEngine {
  readonly name = 'On-device (Moonshine)';
  handlers: SpeechHandlers = {};
  private rec = new ClipRecorder();
  private recording = false;
  private cancelled = false;

  isSupported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia && typeof Worker !== 'undefined';
  }

  /** Call directly inside the tap. */
  start(): void {
    this.cancelled = false;
    this.recording = true;
    this.handlers.onEvent?.('on-device: recording');
    let live = false;
    const goLive = (note?: string) => {
      if (live || !this.recording) return;
      live = true;
      if (note) this.handlers.onEvent?.(note);
      this.handlers.onEvent?.('audiostart'); // mic really live → button turns red
      void this.livePreview();
    };
    // Red only once real sound arrives (AirPods may need a moment to switch over).
    this.rec.onSound = () => goLive(`on-device: mic live after ${this.rec.soundAfterMs} ms (${this.rec.device || 'mic'})`);
    this.rec
      .start()
      .then(() => {
        if (!this.recording) return;
        // (Deliberately not sending "start": the app treats that as "live soon" for Safari.)
        this.handlers.onEvent?.('on-device: mic opened, waiting for sound');
        // Safety net: if the mic only gives silence for 3 s, go red anyway so you're not stuck.
        setTimeout(() => goLive('on-device: mic still silent after 3 s'), 3000);
      })
      .catch((e: Error) => {
        this.recording = false;
        this.handlers.onError?.(e.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture', e.message);
      });
  }

  /**
   * While the button is held: re-read the audio so far, again and again, and show
   * the words as you go. (The model can't stream, so this is the next best thing.)
   */
  private async livePreview(): Promise<void> {
    const clip = ++this.clipNo;
    while (this.recording && clip === this.clipNo) {
      await new Promise((r) => setTimeout(r, 300));
      if (!this.recording || modelStatus.state !== 'ready' || this.rec.seconds < 0.6) continue;
      try {
        const { text } = await transcribe(await this.rec.snapshot());
        // Only show it if you're still talking (the final result takes over after release).
        if (this.recording && clip === this.clipNo && text) this.handlers.onInterim?.(text);
      } catch {
        /* a preview failing doesn't matter — the final pass is what counts */
      }
    }
  }
  private clipNo = 0;

  stop(): void {
    if (!this.recording) return;
    this.recording = false;
    void (async () => {
      try {
        const audio = await this.rec.stop();
        if (this.cancelled) return;
        const secs = (audio.length / 16000).toFixed(1);
        const { peak, soundAfterMs, device } = this.rec;
        this.handlers.onEvent?.(
          `on-device: clip ${secs} s, loudest ${peak}/100, mic ${soundAfterMs < 0 ? 'NEVER gave sound' : `live after ${soundAfterMs} ms`} (${device || 'mic'})`,
        );
        if (audio.length < 16000 * 0.3 || peak < 3) {
          // Nothing (or only silence) came through — don't let the model guess.
          this.handlers.onEvent?.('on-device: clip was silent — skipped');
          this.handlers.onFinal?.('');
          return;
        }
        const { text, ms } = await transcribe(audio);
        this.handlers.onEvent?.(`on-device: done in ${ms} ms`);
        if (!this.cancelled) this.handlers.onFinal?.(text);
      } catch (e) {
        this.handlers.onError?.('on-device', (e as Error).message);
      }
    })();
  }

  abort(): void {
    this.cancelled = true;
    if (this.recording) {
      this.recording = false;
      void this.rec.stop();
    }
  }
}

/** Decodes an audio file (e.g. a WAV) and converts it to 16 kHz — used for testing. */
export async function decodeFile(data: ArrayBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const decoded = await ctx.decodeAudioData(data);
  return resample(decoded.getChannelData(0).slice(), decoded.sampleRate);
}
