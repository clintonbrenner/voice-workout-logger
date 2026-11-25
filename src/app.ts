/**
 * App start-up: tabs, the record button, and offline support.
 *
 * Voice flow:
 *   press record → Safari listens → release → transcript → parseSet()
 *   → confirmation card → auto-saves after a few seconds (or tap Save/Edit/Undo)
 */
import './style.css';
import { $ } from './ui/dom';
import { WebSpeechEngine } from './speech/webSpeech';
import { parseSet } from './parser';
import { haptic, keepScreenAwake } from './device';
import * as store from './store';
import { state, type Tab } from './store';
import { renderWorkout, acceptPending, armAutoAccept, clearAutoAccept, renderConfirm, showToast } from './ui/workoutView';
import { renderPlan, log } from './ui/planView';
import { renderHistory } from './ui/historyView';
import { renderProgress } from './ui/progressView';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const tabs = $('tabs');
tabs.addEventListener('click', (e) => {
  const tab = (e.target as HTMLElement).closest('button')?.dataset.tab as Tab | undefined;
  if (tab) {
    haptic();
    store.setTab(tab);
    window.scrollTo(0, 0);
  }
});

let lastTab: Tab | null = null;
function render(): void {
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === state.tab);
  for (const t of ['workout', 'plan', 'progress', 'history'] as Tab[]) $(`view-${t}`).hidden = state.tab !== t;
  $('dock').hidden = state.tab !== 'workout';
  if (state.tab === 'workout') renderWorkout();
  // The plan tab re-draws itself on its own actions (so typing isn't interrupted),
  // but refresh it when you switch to it or when its data changes elsewhere.
  if (state.tab === 'plan' && (lastTab !== 'plan' || !document.activeElement?.matches('input, textarea, select'))) renderPlan();
  if (state.tab === 'history') void renderHistory();
  if (state.tab === 'progress') void renderProgress();
  lastTab = state.tab;
  updateRecordLabel();
}
store.onChange(render);

// Keep the list scrollable above the dock, whatever its height.
new ResizeObserver(([e]) => {
  document.documentElement.style.setProperty('--dock-h', `${Math.ceil(e.contentRect.height)}px`);
}).observe($('dock'));

// ---------------------------------------------------------------------------
// Record button
// ---------------------------------------------------------------------------
const recordBtn = $<HTMLButtonElement>('record');
const live = $('live');
const engine = new WebSpeechEngine();
let recording = false;

function updateRecordLabel(): void {
  if (recording) return;
  const hint = state.settings.recordMode === 'hold' ? 'Hold to log a set' : 'Tap to log a set';
  live.textContent = state.activeExercise ? `${hint} · ${state.activeExercise}` : hint;
  recordBtn.setAttribute('aria-label', state.settings.recordMode === 'hold' ? 'Hold to record' : 'Tap to record');
}

engine.handlers = {
  onEvent: (name) => log(`speech: ${name}`),
  onInterim: (text) => (live.textContent = text || 'Listening…'),
  onFinal: (text) => {
    recordBtn.classList.remove('busy');
    log(`heard: ${text || '<nothing>'}`);
    if (!text) {
      live.textContent = "Didn't catch that — try again";
      return;
    }
    const parsed = parseSet(text, store.parseContext());
    log(`parsed: ${JSON.stringify({ ex: parsed.exercise, w: parsed.weightLb, r: parsed.reps, unsure: parsed.uncertain })}`);
    store.setPending(parsed);
    armAutoAccept();
    updateRecordLabel();
  },
  onError: (code, message) => {
    log(`ERROR ${code}: ${message}`);
    recording = false;
    recordBtn.classList.remove('rec', 'busy');
    live.textContent =
      code === 'not-allowed' || code === 'service-not-allowed'
        ? 'Mic or dictation blocked — check Settings → Safari → Microphone, and that Dictation is on.'
        : `Voice error: ${code}. Try again, or use + to add manually.`;
  },
};

function startRecording(): void {
  if (recording) return;
  recording = true;
  clearAutoAccept();
  // A finished result is still on the card? Save it before the next one.
  if (state.pending) {
    if (store.isComplete(state.pending)) void acceptPending();
    else store.setPending(null);
  }
  recordBtn.classList.add('rec');
  recordBtn.classList.remove('busy');
  live.textContent = 'Listening…';
  haptic();
  engine.start(); // must run right inside the touch handler on iOS
  // Starting to log counts as starting the workout.
  if (!state.session) void store.startSession().then(() => keepScreenAwake(true));
}

function stopRecording(): void {
  if (!recording) return;
  recording = false;
  recordBtn.classList.remove('rec');
  recordBtn.classList.add('busy');
  live.textContent = 'Processing…';
  haptic();
  setTimeout(() => engine.stop(), 250); // let Safari catch the last word
}

recordBtn.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (state.settings.recordMode === 'hold') {
    recordBtn.setPointerCapture(e.pointerId);
    startRecording();
  } else if (recording) stopRecording();
  else startRecording();
});
const endHold = () => {
  if (state.settings.recordMode === 'hold') stopRecording();
};
recordBtn.addEventListener('pointerup', endHold);
recordBtn.addEventListener('pointercancel', endHold);
recordBtn.addEventListener('contextmenu', (e) => e.preventDefault());

// Development only: lets us test the voice flow on a PC by typing a transcript
// into the browser console: simulateVoice("hammer curls 30 for 12")
if (import.meta.env.DEV) {
  (window as unknown as { simulateVoice: (t: string) => void }).simulateVoice = (t) => {
    if (state.pending && store.isComplete(state.pending)) void acceptPending();
    engine.handlers.onFinal?.(t);
  };
}

if (!engine.isSupported()) {
  live.textContent = 'Voice not available here — use + on an exercise to add sets.';
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
store
  .init()
  .then(() => {
    if (state.session) void keepScreenAwake(true);
    renderConfirm();
    log('ready');
  })
  .catch((err) => {
    showToast(`Couldn't open storage: ${(err as Error).message}`);
    log(`init failed: ${(err as Error).message}`);
  });

// ---------------------------------------------------------------------------
// Offline support (only on the deployed site)
// ---------------------------------------------------------------------------
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`)
    .then(() => navigator.serviceWorker.ready)
    .then(async () => {
      // Save this first visit's files so the app opens offline right away.
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => u.startsWith(location.origin));
      const cache = await caches.open('lift-log-v2');
      await cache.addAll([location.href.split('#')[0], ...urls]);
      log('offline copy saved');
    })
    .catch((err) => log(`offline setup failed: ${(err as Error).message}`));

  // iPhone often just resumes the app instead of reloading it, so check for a
  // newer version on start and whenever you come back to the app.
  const checkForUpdate = async () => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
      const { version } = (await res.json()) as { version: string };
      if (version && version !== __APP_VERSION__ && !recording) {
        log(`update available: ${version}`);
        showToast('A new version is ready.', () => location.reload(), 'Update', 15000);
      }
    } catch {
      /* offline — try again later */
    }
  };
  void checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForUpdate();
  });
}
