/**
 * The shapes of everything the app stores on your phone.
 */
import type { PlannedExercise } from './data/presets';
export type { PlannedExercise };

/** A workout from your plan, e.g. "Arms" with its exercise list. */
export interface Workout {
  id: string;
  name: string;
  exercises: PlannedExercise[];
  createdAt: number;
}

/** One trip to the gym. */
export interface Session {
  id: string;
  workoutId: string | null;
  workoutName: string;
  /** Local date, YYYY-MM-DD. */
  date: string;
  startedAt: number;
  endedAt?: number;
}

/** One logged set. Set numbers are worked out from the order, so deleting one never leaves a gap. */
export interface LoggedSet {
  id: string;
  sessionId: string;
  date: string;
  exercise: string;
  /** For bodyweight sets: the ADDED weight (0 if none). */
  weightLb: number | null;
  /** Reps, or seconds when unit is 'seconds'. */
  reps: number;
  /** 'seconds' for timed sets (e.g. a 30 s hold); reps if absent. */
  unit?: 'seconds';
  bodyweight: boolean;
  notes: string;
  /** What the phone heard (empty for manual entries). */
  transcript: string;
  createdAt: number;
}

/** A nickname you added for an exercise ("rope" → "Rope Triceps Pushdown"). */
export interface CustomAlias {
  alias: string;
  exercise: string;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Today's date in YOUR time zone, as YYYY-MM-DD. */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Estimated one-rep max (Epley formula). */
export function e1rm(weightLb: number, reps: number): number {
  return reps === 1 ? weightLb : weightLb * (1 + reps / 30);
}

/** "60 lb × 10", "BW × 12", "BW+25 × 6", timed: "5 lb × 30 s" */
export function formatSet(s: Pick<LoggedSet, 'weightLb' | 'reps' | 'bodyweight' | 'unit'>): string {
  const w = s.bodyweight ? (s.weightLb ? `BW+${s.weightLb}` : 'BW') : `${s.weightLb ?? '?'} lb`;
  return `${w} × ${s.reps}${s.unit === 'seconds' ? ' s' : ''}`;
}

/** "3 × 8–12", timed: "3 × 30 s" */
export function formatTarget(e: PlannedExercise): string {
  const reps = e.repsMin === e.repsMax ? `${e.repsMin}` : `${e.repsMin}–${e.repsMax}`;
  return `${e.sets} × ${reps}${e.unit === 'seconds' ? ' s' : ''}${e.targetWeightLb ? ` @ ${e.targetWeightLb} lb` : ''}`;
}
