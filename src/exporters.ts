/**
 * Getting your data out: CSV for spreadsheets, plain text for ChatGPT/Claude,
 * and a full JSON backup you can restore from.
 */
import { e1rm, formatSet, type CustomAlias, type LoggedSet, type Session, type Workout } from './models';
import { groupSession, round1 } from './stats';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------
export const CSV_COLUMNS = [
  'date', 'workout', 'exercise', 'set_number', 'weight_lb', 'reps', 'e1rm_lb', 'bodyweight', 'notes', 'raw_transcript',
] as const;

/** Quotes a value only when needed (commas, quotes, line breaks). */
function cell(v: string | number | boolean | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per set. Starts with a byte-order mark so Excel reads it as UTF-8,
 * and uses Windows line endings, which both Excel and Google Sheets like.
 */
export function toCsv(sets: LoggedSet[], sessions: Session[]): string {
  const sessionName = new Map(sessions.map((s) => [s.id, s.workoutName]));
  const ordered = [...sets].sort((a, b) => a.createdAt - b.createdAt);
  const setNo = new Map<string, number>();
  const rows = ordered.map((s) => {
    const key = `${s.sessionId}|${s.exercise}`;
    const n = (setNo.get(key) ?? 0) + 1;
    setNo.set(key, n);
    const weight = s.weightLb ?? '';
    const est = s.weightLb !== null && s.weightLb > 0 ? round1(e1rm(s.weightLb, s.reps)) : '';
    return [s.date, sessionName.get(s.sessionId) ?? '', s.exercise, n, weight, s.reps, est, s.bodyweight ? 'yes' : 'no', s.notes, s.transcript]
      .map(cell)
      .join(',');
  });
  return '﻿' + [CSV_COLUMNS.join(','), ...rows].join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Plain-text summary
// ---------------------------------------------------------------------------
export function sessionText(session: Session, sets: LoggedSet[]): string {
  const date = new Date(`${session.date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const lines = [`${session.workoutName} — ${date}`];
  for (const g of groupSession(sets, session.id)) {
    const list = g.sets.map((s) => formatSet(s).replace(' lb', '').replace(' × ', '×')).join(', ');
    const notes = g.sets.map((s) => s.notes).filter(Boolean);
    lines.push(`${g.exercise}: ${list}${notes.length ? ` (${notes.join('; ')})` : ''}`);
  }
  lines.push('(weights in lb, shown as weight×reps)');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Backup / restore
// ---------------------------------------------------------------------------
export interface Backup {
  app: 'lift-log';
  version: 1;
  exportedAt: string;
  workouts: Workout[];
  sessions: Session[];
  sets: LoggedSet[];
  aliases: CustomAlias[];
}

export function makeBackup(data: Omit<Backup, 'app' | 'version' | 'exportedAt'>): Backup {
  return { app: 'lift-log', version: 1, exportedAt: new Date().toISOString(), ...data };
}

/** Checks a file really is a Lift Log backup. Throws a readable error if not. */
export function readBackup(text: string): Backup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a Lift Log backup (not valid JSON).");
  }
  const b = data as Partial<Backup>;
  if (b?.app !== 'lift-log' || !Array.isArray(b.sets) || !Array.isArray(b.sessions)) {
    throw new Error("That file isn't a Lift Log backup.");
  }
  return {
    app: 'lift-log',
    version: 1,
    exportedAt: b.exportedAt ?? '',
    workouts: b.workouts ?? [],
    sessions: b.sessions,
    sets: b.sets,
    aliases: b.aliases ?? [],
  };
}

/** What a restore would add (items whose id isn't already on the phone). */
export function restorePlan(backup: Backup, existing: { workouts: Workout[]; sessions: Session[]; sets: LoggedSet[]; aliases: CustomAlias[] }) {
  const has = <T>(list: T[], key: (x: T) => string) => new Set(list.map(key));
  const w = has(existing.workouts, (x) => x.id);
  const se = has(existing.sessions, (x) => x.id);
  const st = has(existing.sets, (x) => x.id);
  const al = has(existing.aliases, (x) => x.alias);
  return {
    workouts: backup.workouts.filter((x) => !w.has(x.id)),
    sessions: backup.sessions.filter((x) => !se.has(x.id)),
    sets: backup.sets.filter((x) => !st.has(x.id)),
    aliases: backup.aliases.filter((x) => !al.has(x.alias)),
  };
}

// ---------------------------------------------------------------------------
// Handing a file to the user (iPhone share sheet, or a download elsewhere)
// ---------------------------------------------------------------------------
export async function shareFile(name: string, content: string, type: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // fall through to download
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return 'downloaded';
}
