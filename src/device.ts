/**
 * Phone features: haptic taps, keeping the screen awake, and getting the
 * microphone prompt out of the way at the start of a workout.
 */

// ---------- Haptics ----------
// Android: navigator.vibrate. iPhone Safari ignores that, but since iOS 18 tapping a
// "switch" checkbox gives a tiny haptic click — so we keep a hidden one and tap it.
let hapticLabel: HTMLLabelElement | null = null;
let micOn = false;

/**
 * While the mic is recording, haptics are switched off: on iPhone a haptic tick
 * during recording can interrupt the microphone ("aborted"). This also disables
 * the invisible haptic switches under buttons (via the body class).
 */
export function setMicOn(on: boolean): void {
  micOn = on;
  document.body.classList.toggle('mic-on', on);
}

export function haptic(): void {
  if (micOn) return;
  try {
    if (navigator.vibrate?.(15)) return;
  } catch {
    /* ignore */
  }
  if (!hapticLabel) {
    hapticLabel = document.createElement('label');
    hapticLabel.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    hapticLabel.ariaHidden = 'true';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    hapticLabel.appendChild(input);
    document.body.appendChild(hapticLabel);
  }
  hapticLabel.click();
}

// ---------- Screen wake lock ----------
let wantAwake = false;
let sentinel: WakeLockSentinel | null = null;

export async function keepScreenAwake(on: boolean): Promise<void> {
  wantAwake = on;
  if (!on) {
    await sentinel?.release().catch(() => {});
    sentinel = null;
    return;
  }
  if (!('wakeLock' in navigator) || sentinel) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => (sentinel = null));
  } catch {
    /* not allowed right now (e.g. low battery mode) */
  }
}
// iOS drops the lock when the app is backgrounded; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wantAwake) void keepScreenAwake(true);
});

// ---------- Microphone warm-up ----------
/** Triggers the mic permission prompt now (at "Start workout"), then lets go of the mic. */
export async function warmUpMic(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/**
 * Listens for a few seconds and reports the loudest sound level (0–100).
 * Near 0 means no sound is reaching the app (mic busy, blocked, or routed to
 * disconnected headphones). `onLevel` gets live updates for a meter.
 */
export interface MicTestResult {
  peak: number;
  /** Which microphone iOS used, e.g. "iPhone Microphone" or "AirPods". */
  device: string;
  /** Extra detail for the log. */
  detail: string;
}

export async function testMicLevel(seconds: number, onLevel: (pct: number) => void): Promise<MicTestResult> {
  // iPhone only lets audio processing start straight from a tap, so create and
  // resume the audio context BEFORE waiting for the microphone.
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  const resumed = ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const track = stream.getAudioTracks()[0];
  try {
    await resumed;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    let peak = 0;
    const end = performance.now() + seconds * 1000;
    while (performance.now() < end) {
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      // RMS → rough 0–100 scale (normal speech up close lands around 30–80)
      const pct = Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 400));
      peak = Math.max(peak, pct);
      onLevel(pct);
      await new Promise((r) => setTimeout(r, 60));
    }
    return {
      peak,
      device: track?.label || 'unknown',
      detail: `audio=${ctx.state} track=${track?.readyState}${track?.muted ? ' MUTED' : ''} enabled=${track?.enabled}`,
    };
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
  }
}

export const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;
