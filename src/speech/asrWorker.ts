/**
 * Background worker that runs the on-device speech-to-text model (Moonshine),
 * so the screen never freezes while it works.
 *
 * Messages in:  { type: 'load' }  |  { type: 'transcribe', id, audio: Float32Array (16 kHz mono) }
 * Messages out: { type: 'progress', pct, file } | { type: 'ready', device, ms }
 *               { type: 'result', id, text, ms } | { type: 'error', id?, message }
 */
import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

export const MODEL_ID = 'onnx-community/moonshine-base-ONNX';

// Download models from Hugging Face once, then keep them in the browser's cache (works offline).
env.allowLocalModels = false;
env.useBrowserCache = true;

let asr: AutomaticSpeechRecognitionPipeline | null = null;
let loading: Promise<void> | null = null;
let device = 'wasm';

async function hasWebGPU(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!(gpu && (await gpu.requestAdapter()));
  } catch {
    return false;
  }
}

async function load(): Promise<void> {
  const t0 = performance.now();
  // Per-file download progress, combined into one overall percentage.
  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress' && p.file && p.total) {
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      postMessage({ type: 'progress', pct: Math.round((loaded / total) * 100), mb: Math.round(total / 1e6) });
    }
  };

  // Always the compressed (8-bit) model on the processor: it's ~4× smaller than
  // the full-precision one the graphics-chip path needs (~60 MB vs ~250 MB),
  // which matters on a phone, and it runs everywhere (iPhone, Android, PC).
  void hasWebGPU; // kept for a possible later speed-up
  device = 'wasm';
  asr = (await pipeline('automatic-speech-recognition', MODEL_ID, {
    device: 'wasm', dtype: 'q8', progress_callback,
  })) as AutomaticSpeechRecognitionPipeline;
  postMessage({ type: 'ready', device, ms: Math.round(performance.now() - t0) });
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { type: string; id?: number; audio?: Float32Array };
  try {
    if (msg.type === 'load') {
      loading ??= load();
      await loading;
      if (asr) postMessage({ type: 'ready', device, ms: 0 });
    } else if (msg.type === 'transcribe') {
      loading ??= load();
      await loading;
      const t0 = performance.now();
      const out = (await asr!(msg.audio!)) as { text: string };
      postMessage({ type: 'result', id: msg.id, text: out.text.trim(), ms: Math.round(performance.now() - t0) });
    }
  } catch (err) {
    loading = null;
    postMessage({ type: 'error', id: msg.id, message: (err as Error).message ?? String(err) });
  }
};
