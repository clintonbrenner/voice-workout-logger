/**
 * The Plan tab:
 *   - your saved workouts (use / edit / delete)
 *   - import: one tap to paste from the clipboard (or upload a file, or type),
 *     instant preview you can fix, then Save
 *   - exercise nicknames (aliases)
 *   - settings + diagnostics
 */
import { h, mount, $ } from './dom';
import { haptic, isStandalone, testMicLevel } from '../device';
import type { PlannedExercise } from '../models';
import { importPlan, AI_PROMPT, FORMAT_EXAMPLE, type ImportedDay } from '../plan/importPlan';
import * as store from '../store';
import { state } from '../store';
import { DEFAULT_EXERCISES } from '../parser';
import { showToast } from './workoutView';

/** Plan being reviewed before saving (null = not reviewing). */
interface DraftDay extends ImportedDay {
  id?: string;
}
let draft: DraftDay[] | null = null;
let pasteText = '';
let aliasExercise = '';
let aliasText = '';

export const debugLog: string[] = [];
export function log(msg: string): void {
  debugLog.unshift(`${new Date().toLocaleTimeString([], { hour12: false })}  ${msg}`);
  debugLog.length = Math.min(debugLog.length, 100);
}

export function renderPlan(): void {
  mount($('view-plan'), draft ? reviewEditor() : [workoutsSection(), importSection(), aliasSection(), settingsSection(), diagnosticsSection()]);
}

// ---------------------------------------------------------------------------
// Saved workouts
// ---------------------------------------------------------------------------
function workoutsSection() {
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Your workouts'),
    state.workouts.length === 0 ? h('p', { class: 'muted' }, 'None yet — import one below.') : null,
    state.workouts.map((w) =>
      h(
        'div',
        { class: `plan-row ${w.id === state.selectedWorkoutId ? 'active' : ''}` },
        h('div', { class: 'plan-row-main' }, h('b', null, w.name), h('div', { class: 'muted' }, `${w.exercises.length} exercises`)),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: async () => { haptic(); await store.selectWorkout(w.id); store.setTab('workout'); },
        }, w.id === state.selectedWorkoutId ? 'Selected' : 'Use'),
        h('button', {
          class: 'btn small', type: 'button',
          onclick: () => { draft = [{ id: w.id, name: w.name, exercises: structuredClone(w.exercises) }]; renderPlan(); },
        }, 'Edit'),
        h('button', {
          class: 'btn small danger', type: 'button',
          onclick: () => { if (confirm(`Delete "${w.name}"? Logged sets are kept.`)) void store.removeWorkout(w.id); },
        }, '✕'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
function startReview(text: string): void {
  if (!text.trim()) return showToast('Enter or paste your workout first.');
  const days = importPlan(text);
  if (days.length === 0) {
    showToast("Couldn't find any exercises — check it matches the format above.");
    pasteText = text;
    renderPlan();
    return;
  }
  haptic();
  draft = days;
  renderPlan();
  window.scrollTo(0, 0);
}

async function pasteFromClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text.trim()) return showToast('Clipboard is empty — copy your workout first.');
    startReview(text);
  } catch {
    showToast('Long-press the box and tap Paste.');
  }
}

function importSection() {
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Import a plan'),
    h('p', { class: 'muted' }, 'Enter workout here, in the following format:'),
    h('pre', { class: 'format-example' }, FORMAT_EXAMPLE),
    h('textarea', {
      class: 'paste-box', rows: 6, placeholder: 'Type or paste your workout…', value: pasteText,
      oninput: (e: Event) => (pasteText = (e.target as HTMLTextAreaElement).value),
    }),
    h('div', { class: 'grid2' },
      h('button', { class: 'btn', type: 'button', onclick: () => void pasteFromClipboard() }, '📋 Paste'),
      h('button', { class: 'btn primary', type: 'button', onclick: () => startReview(pasteText) }, 'Import'),
    ),
    h('button', {
      class: 'btn full', type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(AI_PROMPT);
          showToast('Copied — paste it into ChatGPT or Claude along with your plan.');
        } catch {
          showToast("Couldn't copy. Try again.");
        }
      },
    }, 'Copy AI prompt'),
  );
}

// ---------------------------------------------------------------------------
// Review / edit before saving
// ---------------------------------------------------------------------------
function numInput(value: number | undefined, onchange: (n: number | undefined) => void, placeholder = '') {
  return h('input', {
    class: 'num', type: 'number', inputmode: 'decimal', value: value ?? '', placeholder,
    onchange: (e: Event) => {
      const n = parseFloat((e.target as HTMLInputElement).value);
      onchange(Number.isFinite(n) ? n : undefined);
    },
  });
}

function reviewEditor() {
  const days = draft!;
  const exerciseRow = (day: DraftDay, ex: PlannedExercise, i: number) =>
    h(
      'div',
      { class: 'review-ex' },
      h('div', { class: 'review-ex-top' },
        h('input', { class: 'text', type: 'text', value: ex.name, oninput: (e: Event) => (ex.name = (e.target as HTMLInputElement).value) }),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': 'Remove', onclick: () => { day.exercises.splice(i, 1); renderPlan(); } }, '✕'),
      ),
      h('div', { class: 'review-ex-nums' },
        h('label', null, 'Sets', numInput(ex.sets, (n) => (ex.sets = n ?? 1))),
        h('label', null, 'Reps', numInput(ex.repsMin, (n) => { ex.repsMin = n ?? 1; if (ex.repsMax < ex.repsMin) ex.repsMax = ex.repsMin; })),
        h('label', null, 'to', numInput(ex.repsMax, (n) => (ex.repsMax = Math.max(n ?? ex.repsMin, ex.repsMin)))),
        h('label', null, 'lb', numInput(ex.targetWeightLb, (n) => (ex.targetWeightLb = n), '—')),
      ),
      ex.muscleGroup || ex.restSecMin ? h('div', { class: 'muted small' },
        [ex.muscleGroup, ex.restSecMin ? `rest ${ex.restSecMin === ex.restSecMax ? ex.restSecMin : `${ex.restSecMin}–${ex.restSecMax}`}s` : null].filter(Boolean).join(' · ')) : null,
    );

  const total = days.reduce((n, d) => n + d.exercises.length, 0);
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, days[0]?.id ? 'Edit workout' : `Found ${days.length} workout${days.length > 1 ? 's' : ''}, ${total} exercises`),
    h('p', { class: 'muted' }, 'Check names and numbers, fix anything that’s off, then save.'),
    days.map((day, di) =>
      h(
        'div',
        { class: 'review-day' },
        h('div', { class: 'review-ex-top' },
          h('input', { class: 'text day-name', type: 'text', value: day.name, 'aria-label': 'Workout name', oninput: (e: Event) => (day.name = (e.target as HTMLInputElement).value) }),
          days.length > 1 ? h('button', { class: 'btn small danger', type: 'button', onclick: () => { days.splice(di, 1); renderPlan(); } }, '✕') : null,
        ),
        day.exercises.map((ex, i) => exerciseRow(day, ex, i)),
        h('button', {
          class: 'btn', type: 'button',
          onclick: () => { day.exercises.push({ name: 'New exercise', sets: 3, repsMin: 10, repsMax: 10 }); renderPlan(); },
        }, '+ Add exercise'),
      ),
    ),
    h('div', { class: 'sheet-actions sticky-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => { draft = null; renderPlan(); } }, 'Cancel'),
      h('button', {
        class: 'btn primary', type: 'button',
        onclick: async () => {
          const clean = days
            .map((d) => ({ ...d, name: d.name.trim() || 'Workout', exercises: d.exercises.filter((e) => e.name.trim()) }))
            .filter((d) => d.exercises.length);
          if (!clean.length) return showToast('Nothing to save.');
          draft = null;
          pasteText = '';
          await store.saveWorkouts(clean);
          haptic();
          showToast(`Saved ${clean.length} workout${clean.length > 1 ? 's' : ''}`);
          store.setTab('workout');
        },
      }, 'Save'),
    ),
  );
}

// ---------------------------------------------------------------------------
// Aliases
// ---------------------------------------------------------------------------
function aliasSection() {
  const names = [...new Set([...state.workouts.flatMap((w) => w.exercises.map((e) => e.name)), ...DEFAULT_EXERCISES.map((e) => e.name)])];
  if (!aliasExercise || !names.includes(aliasExercise)) aliasExercise = names[0] ?? '';
  const builtIn = DEFAULT_EXERCISES.filter((e) => e.aliases?.length);

  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Exercise nicknames'),
    h('p', { class: 'muted' }, 'Teach the app what you call things, e.g. “rope” = Rope Triceps Pushdown.'),
    h('div', { class: 'alias-form' },
      h('input', {
        class: 'text', type: 'text', placeholder: 'Nickname (what you say)', value: aliasText,
        oninput: (e: Event) => (aliasText = (e.target as HTMLInputElement).value),
      }),
      h('select', { class: 'big-select', onchange: (e: Event) => (aliasExercise = (e.target as HTMLSelectElement).value) },
        names.map((n) => h('option', { value: n, selected: n === aliasExercise }, n))),
      h('button', {
        class: 'btn primary', type: 'button',
        onclick: async () => {
          if (!aliasText.trim()) return;
          await store.addAlias(aliasText, aliasExercise);
          showToast(`“${aliasText.trim()}” → ${aliasExercise}`);
          aliasText = '';
          renderPlan();
        },
      }, 'Add'),
    ),
    state.aliases.length
      ? h('div', { class: 'chips' }, state.aliases.map((a) =>
          h('button', {
            class: 'chip', type: 'button',
            onclick: () => { if (confirm(`Remove nickname “${a.alias}”?`)) void store.removeAlias(a.alias).then(renderPlan); },
          }, `${a.alias} → ${a.exercise} ✕`)))
      : null,
    h('details', null, h('summary', { class: 'muted' }, 'Built-in nicknames'),
      h('ul', { class: 'muted small' }, builtIn.map((e) => h('li', null, `${e.name}: ${e.aliases!.join(', ')}`)))),
  );
}

// ---------------------------------------------------------------------------
// Settings + diagnostics
// ---------------------------------------------------------------------------
function segmented<T extends string | number>(options: [T, string][], value: T, onpick: (v: T) => void) {
  return h('div', { class: 'segmented' }, options.map(([v, label]) =>
    h('button', { class: v === value ? 'on' : '', type: 'button', onclick: () => { haptic(); onpick(v); renderPlan(); } }, label)));
}

function settingsSection() {
  const s = state.settings;
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, 'Settings'),
    h('div', { class: 'setting' }, h('div', null, 'Record button'),
      segmented<'hold' | 'toggle'>([['hold', 'Hold to talk'], ['toggle', 'Tap start / stop']], s.recordMode, (v) => store.saveSettings({ recordMode: v }))),
    h('div', { class: 'setting' }, h('div', null, 'Auto-save a clear result after'),
      segmented<number>([[0, 'Never'], [3, '3 s'], [4, '4 s'], [6, '6 s']], s.autoAcceptSec, (v) => store.saveSettings({ autoAcceptSec: v }))),  );
}

let diagOpen = false;

/** Mic level test: shows a live meter, then a verdict. */
async function runMicTest(meter: HTMLElement, result: HTMLElement, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  result.textContent = 'Say something for 3 seconds…';
  // (testMicLevel must be called right away, inside the tap — no waiting before it)
  try {
    const { peak, device, detail } = await testMicLevel(3, (pct) => (meter.style.width = `${pct}%`));
    meter.style.width = '0%';
    const verdict = peak >= 15 ? 'Mic is working ✓' : peak >= 4 ? 'Very quiet — speak up or move the phone closer' : 'No sound reaching the app ✗';
    result.textContent = `Loudest: ${peak}/100 — ${verdict} (mic: ${device})`;
    log(`mic test: peak ${peak}, mic "${device}", ${detail}`);
  } catch (e) {
    result.textContent = `Mic test failed: ${(e as Error).name} — ${(e as Error).message}`;
    log(`mic test failed: ${(e as Error).message}`);
  } finally {
    btn.disabled = false;
  }
}

function diagnosticsSection() {
  const safari = navigator.userAgent.match(/Version\/(\d+(?:\.\d+)?)/)?.[1] ?? 'hidden by iOS';
  const speech = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  const meter = h('div', { class: 'meter-fill' });
  const result = h('div', { class: 'small' }, 'Checks that sound is reaching the app.');
  const btn: HTMLButtonElement = h('button', {
    class: 'btn small', type: 'button',
    onclick: () => void runMicTest(meter, result, btn),
  }, 'Test microphone');
  return h(
    'details',
    { class: 'panel', open: diagOpen, ontoggle: (e: Event) => (diagOpen = (e.target as HTMLDetailsElement).open) },
    h('summary', null, 'Diagnostics'),
    h('div', { class: 'mic-test' }, btn, h('div', { class: 'meter' }, meter), result),
    h('div', { class: 'diag' },
      [
        ['App version', __APP_VERSION__],
        ['Launched from', isStandalone ? 'Home Screen' : 'Browser tab'],
        ['Safari version', safari],
        ['Speech recognition', speech ? 'available' : 'NOT available'],
        ['Wake Lock', 'wakeLock' in navigator ? 'available' : 'NOT available'],
        ['Logged sets (all time)', String(state.recentSets.length)],
      ].map(([k, v]) => h('div', null, h('span', null, k), h('b', null, v))),
    ),
    h('button', {
      class: 'btn small', type: 'button',
      onclick: async () => {
        // Newest-first log plus the key facts, ready to paste into a message.
        const text = [
          `Lift Log ${__APP_VERSION__} · ${isStandalone ? 'Home Screen' : 'Browser tab'} · Safari ${safari}`,
          ...debugLog,
        ].join('\n');
        try {
          await navigator.clipboard.writeText(text);
          showToast('Log copied — paste it into a message.');
        } catch {
          showToast("Couldn't copy. Try again.");
        }
      },
    }, 'Copy log'),
    h('ol', { class: 'log' }, debugLog.map((l) => h('li', null, l))),
  );
}
