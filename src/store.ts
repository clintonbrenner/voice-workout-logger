/**
 * App state + the actions that change it.
 * Views call these actions; after each change, `onChange` listeners re-draw the screen.
 */
import * as db from './db';
import { localDate, newId, type CustomAlias, type LoggedSet, type PlannedExercise, type Session, type Workout } from './models';
import { DEFAULT_EXERCISES, type KnownExercise, type ParseContext, type ParsedSet, type Field } from './parser';

export interface Settings {
  recordMode: 'hold' | 'toggle';
  /** Seconds before a confident set is saved automatically. 0 = always tap Save. */
  autoAcceptSec: number;
}

/** A set waiting on the confirmation card. */
export interface Pending {
  exercise: string | null;
  weightLb: number | null;
  reps: number | null;
  bodyweight: boolean;
  transcript: string;
  uncertain: Field[];
  alternatives: string[];
  corrected: boolean;
}

export type Tab = 'workout' | 'plan' | 'progress' | 'history';

export interface State {
  tab: Tab;
  workouts: Workout[];
  selectedWorkoutId: string | null;
  session: Session | null;
  /** Sets in the current session, oldest first. */
  sessionSets: LoggedSet[];
  /** Sets from all sessions, newest first. */
  recentSets: LoggedSet[];
  activeExercise: string | null;
  aliases: CustomAlias[];
  pending: Pending | null;
  settings: Settings;
}

const SETTINGS_KEY = 'liftlog.settings';
const WORKOUT_KEY = 'liftlog.selectedWorkout';

function loadSettings(): Settings {
  const defaults: Settings = { recordMode: 'hold', autoAcceptSec: 4 };
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export const state: State = {
  tab: 'workout',
  workouts: [],
  selectedWorkoutId: null,
  session: null,
  sessionSets: [],
  recentSets: [],
  activeExercise: null,
  aliases: [],
  pending: null,
  settings: loadSettings(),
};

// ---------- change notifications ----------
type Listener = () => void;
const listeners: Listener[] = [];
export function onChange(fn: Listener): void {
  listeners.push(fn);
}
export function changed(): void {
  listeners.forEach((fn) => fn());
}

// ---------- derived data ----------
export function selectedWorkout(): Workout | null {
  return state.workouts.find((w) => w.id === state.selectedWorkoutId) ?? null;
}

/** Exercises shown in the menu: the plan's, plus any extra ones logged today. */
export function menuExercises(): PlannedExercise[] {
  const plan = selectedWorkout()?.exercises ?? [];
  const extra = [...new Set(state.sessionSets.map((s) => s.exercise))]
    .filter((name) => !plan.some((p) => p.name === name))
    .map((name): PlannedExercise => ({ name, sets: 0, repsMin: 0, repsMax: 0 }));
  return [...plan, ...extra];
}

export function setsFor(exercise: string): LoggedSet[] {
  return state.sessionSets.filter((s) => s.exercise === exercise);
}

/** Sets of this exercise from the most recent EARLIER session ("last time"). */
export function lastTime(exercise: string): LoggedSet[] {
  const prev = state.recentSets.find((s) => s.exercise === exercise && s.sessionId !== state.session?.id);
  if (!prev) return [];
  return state.recentSets.filter((s) => s.sessionId === prev.sessionId && s.exercise === exercise).reverse();
}

/** Every exercise name we know about: built-ins, all plans, your nicknames. */
export function knownExercises(): KnownExercise[] {
  const list: KnownExercise[] = DEFAULT_EXERCISES.map((e) => ({ ...e, aliases: [...(e.aliases ?? [])] }));
  const byName = (n: string) => list.find((e) => e.name.toLowerCase() === n.toLowerCase());
  for (const w of state.workouts) for (const e of w.exercises) if (!byName(e.name)) list.push({ name: e.name, aliases: [] });
  for (const a of state.aliases) {
    const k = byName(a.exercise);
    if (k) k.aliases!.push(a.alias);
    else list.push({ name: a.exercise, aliases: [a.alias] });
  }
  return list;
}

export function parseContext(): ParseContext {
  return {
    planExercises: (selectedWorkout()?.exercises ?? []).map((e) => e.name),
    knownExercises: knownExercises(),
    activeExercise: state.activeExercise,
    history: state.recentSets.map((s) => ({
      exercise: s.exercise, weightLb: s.weightLb, reps: s.reps, bodyweight: s.bodyweight,
    })),
  };
}

/** First exercise in the plan that still has sets to do. */
function nextUnfinished(): string | null {
  const list = menuExercises();
  const next = list.find((e) => e.sets > 0 && setsFor(e.name).length < e.sets);
  return next?.name ?? list[0]?.name ?? null;
}

// ---------- actions ----------
export async function init(): Promise<void> {
  await db.seedIfEmpty();
  void db.requestPersistentStorage();
  state.workouts = await db.getWorkouts();
  state.aliases = await db.getAliases();
  state.recentSets = await db.getRecentSets();
  const saved = localStorage.getItem(WORKOUT_KEY);
  state.selectedWorkoutId = state.workouts.some((w) => w.id === saved) ? saved : state.workouts[0]?.id ?? null;

  // Resume today's unfinished session, if any.
  const today = (await db.getSessionsOn(localDate())).filter((s) => !s.endedAt).sort((a, b) => b.startedAt - a.startedAt);
  if (today[0]) {
    state.session = today[0];
    state.sessionSets = await db.getSetsForSession(today[0].id);
    if (today[0].workoutId && state.workouts.some((w) => w.id === today[0].workoutId)) {
      state.selectedWorkoutId = today[0].workoutId;
    }
  }
  state.activeExercise = nextUnfinished();
  changed();
}

export function saveSettings(patch: Partial<Settings>): void {
  state.settings = { ...state.settings, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
  changed();
}

export function setTab(tab: Tab): void {
  state.tab = tab;
  changed();
}

export async function selectWorkout(id: string): Promise<void> {
  state.selectedWorkoutId = id;
  localStorage.setItem(WORKOUT_KEY, id);
  const w = selectedWorkout();
  if (state.session && w) {
    state.session = { ...state.session, workoutId: w.id, workoutName: w.name };
    await db.saveSession(state.session);
  }
  state.activeExercise = nextUnfinished();
  changed();
}

export function setActive(exercise: string): void {
  state.activeExercise = exercise;
  changed();
}

export async function startSession(): Promise<void> {
  if (state.session) return;
  const w = selectedWorkout();
  state.session = {
    id: newId(),
    workoutId: w?.id ?? null,
    workoutName: w?.name ?? 'Workout',
    date: localDate(),
    startedAt: Date.now(),
  };
  state.sessionSets = [];
  await db.saveSession(state.session);
  state.activeExercise = nextUnfinished();
  changed();
}

export async function finishSession(): Promise<void> {
  if (!state.session) return;
  if (state.sessionSets.length === 0) {
    // nothing logged: just forget it
    state.session = null;
  } else {
    await db.saveSession({ ...state.session, endedAt: Date.now() });
    state.session = null;
  }
  state.sessionSets = [];
  state.pending = null;
  state.activeExercise = nextUnfinished();
  changed();
}

export function setPending(p: ParsedSet | null): void {
  state.pending = p && {
    exercise: p.exercise,
    weightLb: p.weightLb,
    reps: p.reps,
    bodyweight: p.bodyweight,
    transcript: p.transcript,
    uncertain: p.uncertain,
    alternatives: p.alternatives,
    corrected: p.corrected,
  };
  changed();
}

export function updatePending(patch: Partial<Pending>): void {
  if (!state.pending) return;
  state.pending = { ...state.pending, ...patch };
  changed();
}

export function isComplete(p: { exercise: string | null; weightLb: number | null; reps: number | null }): boolean {
  return !!p.exercise && p.weightLb !== null && p.reps !== null && p.reps > 0;
}

export interface SetValues {
  exercise: string;
  weightLb: number | null;
  reps: number;
  bodyweight: boolean;
  notes?: string;
  transcript?: string;
}

/** Saves a new set (starting a session if needed). Returns it. */
export async function addSet(v: SetValues): Promise<LoggedSet> {
  if (!state.session) await startSession();
  const set: LoggedSet = {
    id: newId(),
    sessionId: state.session!.id,
    date: state.session!.date,
    exercise: v.exercise,
    weightLb: v.weightLb,
    reps: v.reps,
    bodyweight: v.bodyweight,
    notes: v.notes ?? '',
    transcript: v.transcript ?? '',
    createdAt: Date.now(),
  };
  await db.saveSet(set);
  state.sessionSets.push(set);
  state.recentSets.unshift(set);
  // Stay on this exercise until its target is met, then move to the next one.
  const target = menuExercises().find((e) => e.name === set.exercise)?.sets ?? 0;
  state.activeExercise = target && setsFor(set.exercise).length >= target ? nextUnfinished() ?? set.exercise : set.exercise;
  changed();
  return set;
}

export async function updateSet(id: string, v: SetValues): Promise<void> {
  const apply = (s: LoggedSet) => (s.id === id ? { ...s, ...v, notes: v.notes ?? s.notes } : s);
  state.sessionSets = state.sessionSets.map(apply);
  state.recentSets = state.recentSets.map(apply);
  const updated = state.recentSets.find((s) => s.id === id) ?? state.sessionSets.find((s) => s.id === id);
  if (updated) await db.saveSet(updated);
  changed();
}

export async function removeSet(id: string): Promise<LoggedSet | undefined> {
  const s = state.recentSets.find((x) => x.id === id) ?? state.sessionSets.find((x) => x.id === id);
  await db.deleteSet(id);
  state.sessionSets = state.sessionSets.filter((x) => x.id !== id);
  state.recentSets = state.recentSets.filter((x) => x.id !== id);
  changed();
  return s;
}

/** Puts a deleted set back (for Undo). */
export async function restoreSet(s: LoggedSet): Promise<void> {
  await db.saveSet(s);
  if (s.sessionId === state.session?.id) {
    state.sessionSets = [...state.sessionSets, s].sort((a, b) => a.createdAt - b.createdAt);
  }
  state.recentSets = [...state.recentSets, s].sort((a, b) => b.createdAt - a.createdAt);
  changed();
}

// ---------- plans ----------
export async function saveWorkouts(list: { id?: string; name: string; exercises: PlannedExercise[] }[]): Promise<void> {
  let t = Date.now();
  let firstId: string | null = null;
  for (const w of list) {
    const existing = w.id ? state.workouts.find((x) => x.id === w.id) : undefined;
    const saved: Workout = { id: existing?.id ?? newId(), name: w.name, exercises: w.exercises, createdAt: existing?.createdAt ?? t++ };
    await db.saveWorkout(saved);
    firstId ??= saved.id;
  }
  state.workouts = await db.getWorkouts();
  // Switch to the new plan, unless you're mid-workout with sets already logged.
  if (firstId && !state.sessionSets.length) await selectWorkout(firstId);
  changed();
}

export async function removeWorkout(id: string): Promise<void> {
  await db.deleteWorkout(id);
  state.workouts = await db.getWorkouts();
  if (state.selectedWorkoutId === id) state.selectedWorkoutId = state.workouts[0]?.id ?? null;
  changed();
}

export async function addAlias(alias: string, exercise: string): Promise<void> {
  if (!alias.trim() || !exercise) return;
  await db.saveAlias({ alias, exercise });
  state.aliases = await db.getAliases();
  changed();
}

export async function removeAlias(alias: string): Promise<void> {
  await db.deleteAlias(alias);
  state.aliases = await db.getAliases();
  changed();
}
