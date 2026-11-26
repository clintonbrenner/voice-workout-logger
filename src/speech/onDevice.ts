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

/*
 * ONE shared audio context for the whole app.
 *
 * iPhone only lets a page switch audio on during a *completed* tap (finger lifted),
 * NOT when a finger first touches down — and the record button starts on touch-down
 * because you hold it. So we switch audio on the first time you lift your finger
 * anywhere in the app, and then keep it on. Every recording reuses it.
 */
let sharedCtx: AudioContext | null = null;

function audioContext(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedCtx = new Ctx();
  }
  return sharedCtx;
}

/** Switch audio on (only works during a real tap; harmless otherwise). */
export function unlockAudio(): void {
  try {
    const ctx = audioContext();
    if (ctx.state !== 'running') void ctx.resume().catch(() => {});
  } catch {
    /* no Web Audio here */
  }
}
for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
  window.addEventListener(type, unlockAudio, { capture: true, passive: true });
}

/*
 * When you switch to another app (e.g. Music), iOS takes the audio away. The old
 * audio connection can come back "zombie" (mic icon on, but only silence), so we
 * throw it away and build a fresh one on your next tap.
 */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && sharedCtx) {
    void sharedCtx.close().catch(() => {});
    sharedCtx = null;
  }
});

/**
 * Tells iPhone what kind of audio we need (Safari's Audio Session API, iOS 16.4+).
 * 'play-and-record' while recording; 'auto' afterwards so we don't hold on to it.
 */
export function setAudioSession(type: 'play-and-record' | 'auto'): void {
  try {
    const s = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (s) s.type = type;
  } catch {
    /* not supported */
  }
}

/** True once the mic has been used since the app (re)loaded. */
export let micUsedThisLoad = false;

export function audioUnlocked(): boolean {
  return sharedCtx?.state === 'running';
}

/**
 * Records raw audio from the mic.
 * Normally through the shared audio context (allows the live word preview).
 * If audio isn't switched on yet (e.g. the very first press after opening the app),
 * it falls back to the browser's built-in recorder, which needs no tap — that clip
 * just has no live preview.
 */
export class ClipRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;
  private chunks: Float32Array[] = [];
  /** Backup path: the browser's MediaRecorder. */
  private mediaRec: MediaRecorder | null = null;
  private blobs: Blob[] = [];
  /** 'live' = audio context (with preview), 'backup' = MediaRecorder. */
  mode: 'live' | 'backup' = 'live';
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
    micUsedThisLoad = true;
    setAudioSession('play-and-record');
    const ctx = audioContext();
    unlockAudio(); // works if this IS a real tap (e.g. the Diagnostics test button)
    this.ctx = ctx;
    this.chunks = [];
    this.blobs = [];
    this.startedAt = performance.now();
    this.soundAfterMs = -1;
    this.peak = 0;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.device = this.stream.getAudioTracks()[0]?.label ?? '';
    if (ctx.state !== 'running') {
      // Give a pending resume a moment to land.
      await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 150))]);
    }
    if (ctx.state !== 'running' && typeof MediaRecorder !== 'undefined') {
      this.startBackup(this.stream);
      return;
    }
    this.mode = 'live';
    const source = ctx.createMediaStreamSource(this.stream);
    this.source = source;
    // ScriptProcessor is old but works everywhere, including Safari.
    this.node = ctx.createScriptProcessor(4096, 1, 1);
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
    const mute = ctx.createGain();
    mute.gain.value = 0; // must be connected to the speakers to run, but silently
    this.mute = mute;
    source.connect(this.node);
    this.node.connect(mute);
    mute.connect(ctx.destination);
  }

  /** Backup recording with MediaRecorder (no tap needed, no live preview). */
  private startBackup(stream: MediaStream): void {
    this.mode = 'backup';
    this.mediaRec = new MediaRecorder(stream);
    this.mediaRec.ondataavailable = (e) => {
      if (e.data.size) this.blobs.push(e.data);
    };
    this.mediaRec.start(250);
    // We can't watch the sound level on this path; give Bluetooth a short moment, then go.
    setTimeout(() => {
      if (this.soundAfterMs < 0 && this.mediaRec) {
        this.soundAfterMs = Math.round(performance.now() - this.startedAt);
        this.onSound?.();
      }
    }, 300);
  }

  /** Everything recorded so far (16 kHz), without stopping — for the live preview. */
  snapshot(): Promise<Float32Array> {
    if (this.mode === 'backup') return Promise.resolve(new Float32Array(0));
    return resample(this.joined(), this.ctx?.sampleRate ?? TARGET_RATE);
  }

  /** Seconds recorded so far (0 on the backup path, which has no preview). */
  get seconds(): number {
    if (this.mode === 'backup') return 0;
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
    setAudioSession('auto');
    if (this.mode === 'backup' && this.mediaRec) {
      const rec = this.mediaRec;
      this.mediaRec = null;
      await new Promise<void>((resolve) => {
        rec.onstop = () => resolve();
        if (rec.state !== 'inactive') rec.stop();
        else resolve();
      });
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      if (!this.blobs.length) return new Float32Array(0);
      const audio = await decodeFile(await new Blob(this.blobs, { type: rec.mimeType }).arrayBuffer());
      // Work out loudness afterwards (couldn't watch it live on this path).
      let sum = 0;
      let peak = 0;
      const win = 1600; // 0.1 s windows
      for (let i = 0; i < audio.length; i += win) {
        sum = 0;
        const end = Math.min(audio.length, i + win);
        for (let j = i; j < end; j++) sum += audio[j] * audio[j];
        peak = Math.max(peak, Math.min(100, Math.round(Math.sqrt(sum / (end - i)) * 400)));
      }
      this.peak = peak;
      return audio;
    }
    // Live path: unhook our nodes but keep the shared audio context running for next time.
    this.source?.disconnect();
    this.node?.disconnect();
    this.mute?.disconnect();
    this.source = this.node = this.mute = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const raw = this.joined();
    return resample(raw, this.ctx?.sampleRate ?? TARGET_RATE);
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
          `on-device: clip ${secs} s, loudest ${peak}/100, mic ${soundAfterMs < 0 ? 'NEVER gave sound' : `live after ${soundAfterMs} ms`} (${device || 'mic'}, ${this.rec.mode === 'live' ? 'audio unlocked' : 'backup recorder'})`,
        );
        if (audio.length < 16000 * 0.3 || peak < 3) {
          // Nothing (or only silence) came through — don't let the model guess.
          this.handlers.onEvent?.('on-device: clip was silent — skipped');
          // Held for a while but the mic never gave any sound: it's stuck ("zombie" mic).
          if (soundAfterMs < 0 || (peak === 0 && audio.length > 16000)) this.handlers.onEvent?.('mic-dead');
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
