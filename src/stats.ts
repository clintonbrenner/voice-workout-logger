/**
 * Progress maths: per-session numbers for one exercise, personal records,
 * and simple up / flat / down trends.
 */
import { e1rm, type LoggedSet, type Session } from './models';

/** One point on a chart: one session's numbers for one exercise. */
export interface SessionPoint {
  sessionId: string;
  date: string;
  /** Heaviest set (ties → more reps). */
  topWeight: number;
  topReps: number;
  /** Best estimated 1-rep max in the session (Epley). */
  bestE1rm: number;
  /** Sum of weight × reps. */
  volume: number;
  totalReps: number;
  sets: number;
}

/** The weight that counts for maths. Bodyweight sets use the added weight. */
const w = (s: LoggedSet) => s.weightLb ?? 0;

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Groups an exercise's sets into one point per session, oldest first. */
export function sessionPoints(sets: LoggedSet[], exercise: string): SessionPoint[] {
  const bySession = new Map<string, LoggedSet[]>();
  for (const s of sets) {
    if (s.exercise !== exercise) continue;
    const list = bySession.get(s.sessionId) ?? [];
    list.push(s);
    bySession.set(s.sessionId, list);
  }
  const points: SessionPoint[] = [];
  for (const [sessionId, list] of bySession) {
    const top = list.reduce((a, b) => (w(b) > w(a) || (w(b) === w(a) && b.reps > a.reps) ? b : a));
    points.push({
      sessionId,
      date: list[0].date,
      topWeight: w(top),
      topReps: top.reps,
      bestE1rm: round1(Math.max(...list.map((s) => e1rm(w(s), s.reps)))),
      volume: list.reduce((sum, s) => sum + w(s) * s.reps, 0),
      totalReps: list.reduce((sum, s) => sum + s.reps, 0),
      sets: list.length,
    });
  }
  const first = (id: string) => Math.min(...(bySession.get(id) ?? []).map((s) => s.createdAt));
  return points.sort((a, b) => first(a.sessionId) - first(b.sessionId));
}

/** For "reps at a given weight": best reps per session at exactly that weight. */
export function repsAtWeight(sets: LoggedSet[], exercise: string, weightLb: number): { date: string; reps: number }[] {
  const best = new Map<string, { date: string; reps: number; t: number }>();
  for (const s of sets) {
    if (s.exercise !== exercise || w(s) !== weightLb) continue;
    const cur = best.get(s.sessionId);
    if (!cur || s.reps > cur.reps) best.set(s.sessionId, { date: s.date, reps: s.reps, t: cur?.t ?? s.createdAt });
  }
  return [...best.values()].sort((a, b) => a.t - b.t).map(({ date, reps }) => ({ date, reps }));
}

/** Weights you've used for an exercise, most-used first. */
export function weightsUsed(sets: LoggedSet[], exercise: string): number[] {
  const count = new Map<number, number>();
  for (const s of sets) if (s.exercise === exercise) count.set(w(s), (count.get(w(s)) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([wt]) => wt);
}

export interface PersonalRecords {
  heaviest: { weightLb: number; reps: number; date: string } | null;
  bestE1rm: { value: number; weightLb: number; reps: number; date: string } | null;
  /** Most reps at each weight, heaviest weight first. */
  mostRepsAt: { weightLb: number; reps: number; date: string }[];
}

export function personalRecords(sets: LoggedSet[], exercise: string): PersonalRecords {
  const mine = sets.filter((s) => s.exercise === exercise).sort((a, b) => a.createdAt - b.createdAt);
  let heaviest: PersonalRecords['heaviest'] = null;
  let best: PersonalRecords['bestE1rm'] = null;
  const reps = new Map<number, { weightLb: number; reps: number; date: string }>();
  // Oldest first, and only strictly-better sets replace a record, so each PR keeps the date it was FIRST set.
  for (const s of mine) {
    if (!heaviest || w(s) > heaviest.weightLb || (w(s) === heaviest.weightLb && s.reps > heaviest.reps)) {
      heaviest = { weightLb: w(s), reps: s.reps, date: s.date };
    }
    const est = round1(e1rm(w(s), s.reps));
    if (!best || est > best.value) best = { value: est, weightLb: w(s), reps: s.reps, date: s.date };
    const r = reps.get(w(s));
    if (!r || s.reps > r.reps) reps.set(w(s), { weightLb: w(s), reps: s.reps, date: s.date });
  }
  return { heaviest, bestE1rm: best, mostRepsAt: [...reps.values()].sort((a, b) => b.weightLb - a.weightLb) };
}

export type Trend = 'up' | 'flat' | 'down' | 'none';

/**
 * Direction of the last `n` values, using a best-fit line.
 * "Flat" if the line moves less than 2% over the period.
 */
export function trend(values: number[], n = 5): Trend {
  const v = values.slice(-n);
  if (v.length < 2) return 'none';
  const xs = v.map((_, i) => i);
  const mx = (v.length - 1) / 2;
  const my = v.reduce((a, b) => a + b, 0) / v.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < v.length; i++) {
    num += (xs[i] - mx) * (v[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  const slope = num / den;
  const change = (slope * (v.length - 1)) / (Math.abs(my) || 1);
  if (change > 0.02) return 'up';
  if (change < -0.02) return 'down';
  return 'flat';
}

export const TREND_ICON: Record<Trend, string> = { up: '▲', flat: '▬', down: '▼', none: '' };

/** Exercises you've logged, most recently trained first. */
export function exercisesLogged(sets: LoggedSet[]): string[] {
  const last = new Map<string, number>();
  for (const s of sets) last.set(s.exercise, Math.max(last.get(s.exercise) ?? 0, s.createdAt));
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
}

/** Sets in a session grouped by exercise, in the order you did them, with set numbers. */
export function groupSession(sets: LoggedSet[], sessionId: string): { exercise: string; sets: LoggedSet[] }[] {
  const groups: { exercise: string; sets: LoggedSet[] }[] = [];
  for (const s of sets.filter((x) => x.sessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)) {
    let g = groups.find((x) => x.exercise === s.exercise);
    if (!g) groups.push((g = { exercise: s.exercise, sets: [] }));
    g.sets.push(s);
  }
  return groups;
}

/** Sessions that actually have sets, newest first. */
export function sessionsWithSets(sessions: Session[], sets: LoggedSet[]): Session[] {
  const has = new Set(sets.map((s) => s.sessionId));
  return sessions.filter((s) => has.has(s.id)).sort((a, b) => b.startedAt - a.startedAt);
}
