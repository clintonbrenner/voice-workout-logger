/**
 * Rest timer: starts after each logged set, using the rest time from your plan.
 *
 * - A green ring around the record button drains as the rest runs out, with the
 *   time above it.
 * - At zero the numbers flash white and blue (no sound) until you tap +30,
 *   tap ✕, or start your next set.
 * - Survives the app reloading itself (e.g. after a microphone reset).
 */
import { $ } from './ui/dom';

const KEY = 'liftlog.rest';
const DEFAULT_REST = 90;
const RING_LENGTH = 2 * Math.PI * 47; // circumference of the ring (r = 47)

interface Rest {
  endAt: number; // ms timestamp
  total: number; // seconds, for the ring
}

let rest: Rest | null = load();
let ticker: number | undefined;

function load(): Rest | null {
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Rest | null;
    // Forget timers that ran out long ago (more than 10 minutes).
    return r && Date.now() - r.endAt < 10 * 60_000 ? r : null;
  } catch {
    return null;
  }
}

function save(): void {
  if (rest) localStorage.setItem(KEY, JSON.stringify(rest));
  else localStorage.removeItem(KEY);
}

/** Rest time in seconds for an exercise, from the plan (the longer end of a range). */
export function restSecondsFor(plan: { restSecMin?: number; restSecMax?: number } | undefined): number {
  return plan?.restSecMax ?? plan?.restSecMin ?? DEFAULT_REST;
}

export function startRest(seconds: number): void {
  rest = { endAt: Date.now() + seconds * 1000, total: seconds };
  save();
  render();
}

export function addThirty(): void {
  if (!rest) return;
  const remaining = Math.max(0, rest.endAt - Date.now());
  // Once it has run out, +30 starts a fresh 30 seconds.
  rest = remaining > 0 ? { endAt: rest.endAt + 30_000, total: rest.total + 30 } : { endAt: Date.now() + 30_000, total: 30 };
  save();
  render();
}

export function dismissRest(): void {
  rest = null;
  save();
  render();
}

function fmt(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render(): void {
  const box = $('rest');
  const svg = $('rest-ring-svg');
  const ring = $('rest-ring');
  const time = $('rest-time');
  clearInterval(ticker);
  if (!rest) {
    box.hidden = true;
    svg.setAttribute('hidden', '');
    time.classList.remove('flash');
    return;
  }
  box.hidden = false;
  svg.removeAttribute('hidden');
  const tick = () => {
    if (!rest) return;
    const left = rest.endAt - Date.now();
    const done = left <= 0;
    time.textContent = done ? '0:00' : fmt(left);
    time.classList.toggle('flash', done);
    const frac = done ? 0 : Math.min(1, left / (rest.total * 1000));
    ring.style.strokeDasharray = `${RING_LENGTH}`;
    ring.style.strokeDashoffset = `${RING_LENGTH * (1 - frac)}`;
  };
  tick();
  ticker = window.setInterval(tick, 250);
}

/** Wire up the buttons and restore a timer that was running before a reload. */
export function initRestTimer(): void {
  $('rest-add').addEventListener('click', addThirty);
  $('rest-close').addEventListener('click', dismissRest);
  render();
}
