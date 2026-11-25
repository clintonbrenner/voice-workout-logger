/**
 * The Workout tab: workout picker, today's exercise menu, the confirmation
 * card after each voice clip, and the "Logged · Undo" toast.
 * (The record button itself lives in app.ts, because it must never be re-created
 * while your thumb is on it.)
 */
import { h, mount, $ } from './dom';
import { openEditSheet } from './editSheet';
import { haptic, isStandalone, keepScreenAwake, warmUpMic } from '../device';
import { formatSet, formatTarget, type LoggedSet } from '../models';
import * as store from '../store';
import { state } from '../store';

// ---------------------------------------------------------------------------
// Header + exercise list
// ---------------------------------------------------------------------------
export function renderWorkout(): void {
  const workout = store.selectedWorkout();
  const session = state.session;

  mount(
    $('workout-header'),
    h(
      'select',
      {
        class: 'workout-select',
        'aria-label': 'Workout',
        onchange: (e: Event) => void store.selectWorkout((e.target as HTMLSelectElement).value),
      },
      state.workouts.length === 0 ? h('option', null, 'No workouts — import one in Plan') : null,
      state.workouts.map((w) => h('option', { value: w.id, selected: w.id === workout?.id }, w.name)),
    ),
    session
      ? h('button', { class: 'btn finish', type: 'button', onclick: confirmFinish }, 'Finish')
      : h('button', { class: 'btn primary', type: 'button', onclick: startWorkout }, 'Start'),
  );

  const list = store.menuExercises();
  mount(
    $('exercise-list'),
    installCard(),
    list.length === 0
      ? h('p', { class: 'empty' }, 'No exercises yet. Go to the Plan tab to import your workout.')
      : list.map((ex) => exerciseCard(ex.name, ex.sets ? formatTarget(ex) : 'Extra exercise', ex.sets, ex.restSecMin, ex.restSecMax)),
  );

  renderConfirm();
}

/** Shown in a normal browser tab: how to install the app on the Home Screen. */
function installCard() {
  if (isStandalone || localStorage.getItem('liftlog.hideInstall') === '1') return null;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return h('section', { class: 'panel install' },
    h('b', null, 'Install Lift Log on your Home Screen'),
    ios
      ? h('ol', { class: 'small' },
          h('li', null, 'Tap the Share button (square with an arrow) in Safari.'),
          h('li', null, 'Scroll down and tap “Add to Home Screen”.'),
          h('li', null, 'Tap Add, then open Lift Log from its icon.'))
      : h('p', { class: 'small muted' }, 'Use your browser menu → “Install app” or “Add to Home screen”.'),
    h('p', { class: 'small muted' }, 'It then opens full-screen and works offline. Your data stays on this device.'),
    h('button', { class: 'btn small', type: 'button', onclick: () => { localStorage.setItem('liftlog.hideInstall', '1'); renderWorkout(); } }, 'Got it'));
}

function exerciseCard(name: string, target: string, targetSets: number, restMin?: number, restMax?: number) {
  const done = store.setsFor(name);
  const last = store.lastTime(name);
  const active = state.activeExercise === name;
  const complete = targetSets > 0 && done.length >= targetSets;
  const rest = restMin ? ` · rest ${restMin === restMax ? `${restMin}s` : `${restMin}–${restMax}s`}` : '';

  return h(
    'div',
    {
      class: `ex-card ${active ? 'active' : ''} ${complete ? 'complete' : ''}`,
      onclick: () => {
        store.setActive(name);
        haptic();
      },
    },
    h(
      'div',
      { class: 'ex-top' },
      h('div', { class: 'ex-name' }, complete ? '✓ ' : '', name),
      h(
        'button',
        {
          class: 'add-btn',
          type: 'button',
          'aria-label': `Add a set of ${name}`,
          onclick: (e: Event) => {
            e.stopPropagation();
            manualAdd(name);
          },
        },
        '+',
      ),
    ),
    h('div', { class: 'ex-target' }, `${target}${rest}`, h('span', { class: 'ex-count' }, targetSets ? ` · ${done.length}/${targetSets}` : '')),
    done.length
      ? h(
          'div',
          { class: 'chips' },
          done.map((s, i) =>
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                onclick: (e: Event) => {
                  e.stopPropagation();
                  editSet(s);
                },
              },
              h('b', null, `${i + 1}`),
              ` ${formatSet(s)}`,
            ),
          ),
        )
      : null,
    last.length ? h('div', { class: 'ex-last' }, `Last time: ${last.map(formatSet).join(', ')}`) : null,
  );
}

async function startWorkout(): Promise<void> {
  haptic();
  // Ask for the mic now, so the iPhone prompt doesn't interrupt your first set.
  void warmUpMic();
  void keepScreenAwake(true);
  await store.startSession();
}

function confirmFinish(): void {
  const n = state.sessionSets.length;
  if (confirm(n ? `Finish this workout? (${n} set${n === 1 ? '' : 's'} logged)` : 'End this workout? Nothing was logged.')) {
    void keepScreenAwake(false);
    void store.finishSession();
  }
}

function exerciseChoices(): string[] {
  const plan = store.menuExercises().map((e) => e.name);
  const all = store.knownExercises().map((e) => e.name).filter((n) => !plan.includes(n)).sort();
  return [...plan, ...all];
}

/** "+" on an exercise card: start from your last set of it. */
function manualAdd(exercise: string): void {
  const prev = store.setsFor(exercise).at(-1) ?? store.lastTime(exercise).at(-1);
  openEditSheet({
    title: 'Add set',
    values: {
      exercise,
      weightLb: prev?.weightLb ?? null,
      reps: prev?.reps ?? null,
      bodyweight: prev?.bodyweight ?? false,
      notes: '',
    },
    exercises: exerciseChoices(),
    saveLabel: 'Add set',
    onSave: async (v) => {
      await store.addSet(v);
      showToast('Set added');
    },
  });
}

/** Tap a logged set to fix or delete it. */
export function editSet(s: LoggedSet): void {
  openEditSheet({
    title: 'Edit set',
    values: { exercise: s.exercise, weightLb: s.weightLb, reps: s.reps, bodyweight: s.bodyweight, notes: s.notes },
    exercises: exerciseChoices(),
    onSave: (v) => void store.updateSet(s, v),
    onDelete: async () => {
      const removed = await store.removeSet(s.id, s);
      if (removed) showToast('Set deleted', () => void store.restoreSet(removed));
    },
  });
}

// ---------------------------------------------------------------------------
// Confirmation card
// ---------------------------------------------------------------------------
let autoTimer: number | undefined;

export function clearAutoAccept(): void {
  clearTimeout(autoTimer);
  autoTimer = undefined;
}

/** Saves the pending set. Returns false if it's missing something. */
export async function acceptPending(): Promise<boolean> {
  clearAutoAccept();
  const p = state.pending;
  if (!p || !store.isComplete(p)) return false;
  state.pending = null;
  haptic();
  const set = await store.addSet({
    exercise: p.exercise!,
    weightLb: p.weightLb,
    reps: p.reps!,
    bodyweight: p.bodyweight,
    transcript: p.transcript,
  });
  showToast(`Logged ${set.exercise}: ${formatSet(set)}`, () => void store.removeSet(set.id));
  return true;
}

function discardPending(): void {
  clearAutoAccept();
  haptic();
  store.setPending(null);
}

function editPending(): void {
  clearAutoAccept();
  const p = state.pending!;
  openEditSheet({
    title: 'Fix this set',
    values: { exercise: p.exercise, weightLb: p.weightLb, reps: p.reps, bodyweight: p.bodyweight, notes: '' },
    exercises: exerciseChoices(),
    highlight: p.uncertain,
    saveLabel: 'Log set',
    onSave: async (v) => {
      state.pending = null;
      const set = await store.addSet({ ...v, transcript: p.transcript });
      showToast(`Logged ${set.exercise}: ${formatSet(set)}`, () => void store.removeSet(set.id));
    },
  });
}

/** Start the auto-save countdown for a fresh, confident result. */
export function armAutoAccept(): void {
  clearAutoAccept();
  const p = state.pending;
  const secs = state.settings.autoAcceptSec;
  if (!p || !secs || p.uncertain.length || !store.isComplete(p)) return;
  autoTimer = window.setTimeout(() => void acceptPending(), secs * 1000);
  renderConfirm();
}

export function renderConfirm(): void {
  const el = $('confirm');
  const p = state.pending;
  if (!p) {
    el.hidden = true;
    mount(el);
    return;
  }
  const doubt = (f: string) => (p.uncertain.includes(f as never) ? 'doubt' : '');
  const weightText = p.bodyweight
    ? p.weightLb ? `BW+${p.weightLb}` : 'BW'
    : p.weightLb !== null ? `${p.weightLb} lb` : '? lb';
  const counting = autoTimer !== undefined;
  const pickAlt = p.uncertain.includes('exercise') && p.alternatives.length;

  mount(
    el,
    h(
      'div',
      { class: 'confirm-body', onclick: editPending },
      h('div', { class: `confirm-ex ${doubt('exercise')}` }, p.exercise ?? 'Which exercise?'),
      h(
        'div',
        { class: 'confirm-set' },
        h('span', { class: doubt('weight') }, weightText),
        ' × ',
        h('span', { class: doubt('reps') }, p.reps ?? '?'),
      ),
      h('div', { class: 'confirm-transcript' }, `“${p.transcript}”`, p.corrected ? ' · correction applied' : ''),
    ),
    pickAlt
      ? h(
          'div',
          { class: 'alts' },
          [p.exercise, ...p.alternatives].filter(Boolean).slice(0, 4).map((name) =>
            h(
              'button',
              {
                class: 'chip',
                type: 'button',
                onclick: () => {
                  haptic();
                  store.updatePending({ exercise: name, uncertain: p.uncertain.filter((f) => f !== 'exercise') });
                  armAutoAccept();
                },
              },
              name,
            ),
          ),
        )
      : null,
    h(
      'div',
      { class: 'confirm-actions' },
      h('button', { class: 'btn', type: 'button', onclick: discardPending }, 'Undo'),
      h('button', { class: 'btn', type: 'button', onclick: editPending }, 'Edit'),
      h(
        'button',
        { class: 'btn primary', type: 'button', disabled: !store.isComplete(p), onclick: () => void acceptPending() },
        'Save',
      ),
    ),
    counting
      ? h('div', { class: 'countdown', style: `animation-duration:${state.settings.autoAcceptSec}s` })
      : null,
  );
  el.hidden = false;
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
let toastTimer: number | undefined;

export function showToast(text: string, undo?: () => void, actionLabel = 'Undo', ms = 5000): void {
  const el = $('toast');
  clearTimeout(toastTimer);
  mount(
    el,
    h('span', null, text),
    undo
      ? h('button', {
          class: 'toast-undo',
          type: 'button',
          onclick: () => {
            undo();
            el.hidden = true;
            haptic();
          },
        }, actionLabel)
      : null,
  );
  el.hidden = false;
  toastTimer = window.setTimeout(() => (el.hidden = true), ms);
}
