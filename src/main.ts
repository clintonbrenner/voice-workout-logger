/**
 * MILESTONE 1 SPIKE
 * A bare page with a giant record button that shows the raw transcript.
 * Goal: prove voice capture works on your iPhone, both in a Safari tab and
 * when launched from the Home Screen, before we build anything else.
 */
import './style.css';
import { WebSpeechEngine } from './speech/webSpeech';

// ---------- Grab page elements ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const recordBtn = $<HTMLButtonElement>('record');
const stateEl = $('state');
const transcriptEl = $('transcript');
const interimEl = $('interim');
const diagEl = $('diag');
const logEl = $<HTMLOListElement>('log');
const micTestBtn = $<HTMLButtonElement>('mic-test');
const modeBtn = $<HTMLButtonElement>('mode-toggle');

// ---------- Small helpers ----------
function log(msg: string): void {
  const li = document.createElement('li');
  const t = new Date().toLocaleTimeString([], { hour12: false });
  li.textContent = `${t}  ${msg}`;
  logEl.prepend(li);
}

function setState(text: string, kind: 'idle' | 'rec' | 'busy' | 'err' = 'idle'): void {
  stateEl.textContent = text;
  stateEl.dataset.kind = kind;
}

/** Short buzz where supported. (iPhone Safari ignores navigator.vibrate — we'll
 *  try an iOS-specific trick in a later milestone.) */
function buzz(ms = 30): void {
  navigator.vibrate?.(ms);
}

// ---------- Diagnostics: what does this phone support? ----------
const isStandalone =
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

const engine = new WebSpeechEngine();

function renderDiag(micPermission = 'unknown'): void {
  // Since iOS 26, Safari freezes the iOS number in its user-agent string at 18.x
  // (a privacy measure), so we show the Safari version instead. From iOS 26 on,
  // the Safari version matches the iOS version.
  const safariMatch = navigator.userAgent.match(/Version\/(\d+(?:\.\d+)?)/);
  // Home Screen apps often leave the Safari version out entirely.
  const safari = safariMatch ? safariMatch[1] : 'hidden by iOS';
  const rows: [string, string, boolean | null][] = [
    ['Launched from', isStandalone ? 'Home Screen' : 'Browser tab', null],
    ['Safari version', safari, null],
    ['HTTPS (secure)', String(window.isSecureContext), window.isSecureContext],
    ['Speech recognition', engine.isSupported() ? 'available' : 'NOT available', engine.isSupported()],
    ['Mic recording (fallback)', 'MediaRecorder' in window ? 'available' : 'NOT available', 'MediaRecorder' in window],
    ['Mic permission', micPermission, micPermission === 'granted' ? true : micPermission === 'denied' ? false : null],
    ['Wake Lock', 'wakeLock' in navigator ? 'available' : 'NOT available', 'wakeLock' in navigator],
  ];
  diagEl.innerHTML = rows
    .map(([k, v, ok]) => `<div><span>${k}</span><b class="${ok === null ? '' : ok ? 'ok' : 'bad'}">${v}</b></div>`)
    .join('');
}
renderDiag();
// Permissions API for the mic isn't available everywhere; ignore failures.
navigator.permissions
  ?.query({ name: 'microphone' as PermissionName })
  .then((p) => {
    renderDiag(p.state);
    p.onchange = () => renderDiag(p.state);
  })
  .catch(() => {});

// ---------- Recording logic ----------
type Mode = 'hold' | 'toggle';
let mode: Mode = (localStorage.getItem('recordMode') as Mode) || 'hold';
let recording = false;
let clipStartedAt = 0;

function updateModeLabel(): void {
  modeBtn.textContent = mode === 'hold' ? 'Mode: hold to talk (tap to switch)' : 'Mode: tap to start/stop (tap to switch)';
  recordBtn.setAttribute('aria-label', mode === 'hold' ? 'Hold to record' : 'Tap to record');
}
updateModeLabel();

engine.handlers = {
  onEvent: (name) => log(`speech: ${name}`),
  onInterim: (text) => {
    interimEl.textContent = text;
  },
  onFinal: (text) => {
    const secs = ((performance.now() - clipStartedAt) / 1000).toFixed(1);
    interimEl.textContent = '';
    if (text) {
      transcriptEl.textContent = `“${text}”`;
      setState(`Heard (clip ${secs}s)`);
      log(`FINAL: ${text}`);
    } else {
      transcriptEl.textContent = '(nothing heard — try again, a bit louder/longer)';
      setState('No speech detected', 'err');
      log('FINAL: <empty>');
    }
    recordBtn.classList.remove('busy');
  },
  onError: (code, message) => {
    setState(`Error: ${code}`, 'err');
    log(`ERROR ${code}: ${message}`);
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      transcriptEl.textContent =
        'Mic or speech access was blocked. Check Settings → Apps → Safari → Microphone, and that Siri & Dictation is on (Settings → General → Keyboard → Enable Dictation).';
    }
    stopRecording(true);
  },
};

function startRecording(): void {
  if (recording) return;
  recording = true;
  clipStartedAt = performance.now();
  recordBtn.classList.add('rec');
  recordBtn.classList.remove('busy');
  setState('Listening…', 'rec');
  interimEl.textContent = '';
  buzz();
  log('button: start');
  engine.start(); // must happen synchronously inside the touch handler on iOS
}

function stopRecording(fromError = false): void {
  if (!recording) return;
  recording = false;
  recordBtn.classList.remove('rec');
  log('button: stop');
  if (!fromError) {
    recordBtn.classList.add('busy');
    setState('Processing…', 'busy');
    buzz(15);
    // Give Safari a moment to catch the last word before stopping.
    setTimeout(() => engine.stop(), 250);
  }
}

// Pointer events cover both touch (iPhone) and mouse (PC testing).
recordBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (mode === 'hold') {
    recordBtn.setPointerCapture(e.pointerId); // keep tracking even if your thumb slides off
    startRecording();
  } else {
    recording ? stopRecording() : startRecording();
  }
});
const endHold = () => {
  if (mode === 'hold') stopRecording();
};
recordBtn.addEventListener('pointerup', endHold);
recordBtn.addEventListener('pointercancel', endHold);
// Stop iOS from showing the long-press menu / magnifier on the button.
recordBtn.addEventListener('contextmenu', (e) => e.preventDefault());

modeBtn.addEventListener('click', () => {
  mode = mode === 'hold' ? 'toggle' : 'hold';
  localStorage.setItem('recordMode', mode);
  updateModeLabel();
});

// ---------- Fallback-path test: can we record raw audio in this mode? ----------
// If Safari's speech recognition fails in Home Screen mode, plan B is to record a
// clip and transcribe it in the cloud. This button checks that plan B is possible.
micTestBtn.addEventListener('click', async () => {
  try {
    log('mic test: requesting mic…');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType });
      log(`mic test: OK — recorded ${(blob.size / 1024).toFixed(1)} KB (${rec.mimeType || 'unknown type'})`);
      renderDiag('granted');
    };
    rec.start();
    micTestBtn.textContent = 'Recording 2s…';
    setTimeout(() => {
      rec.stop();
      micTestBtn.textContent = 'Test raw mic recording (fallback path)';
    }, 2000);
  } catch (err) {
    log(`mic test: FAILED — ${(err as Error).name}: ${(err as Error).message}`);
  }
});

log(`loaded (${isStandalone ? 'standalone' : 'browser tab'})`);

// ---------- Offline support ----------
// Only on the real deployed site (not during `npm run dev`, where it would get in the way).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(() => navigator.serviceWorker.ready)
    .then(async () => {
      // The files for this first visit loaded before the helper was running,
      // so save them now — this makes the very first visit enough for offline use.
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin));
      const cache = await caches.open('lift-log-v1');
      await cache.addAll([location.href.split('#')[0], ...urls]);
      log('offline copy saved');
    })
    .catch((err) => log(`offline setup failed: ${(err as Error).message}`));
}
