/**
 * Turns a pasted workout plan (ChatGPT output, notes, a table…) into
 * days → exercises → target sets × reps.
 *
 * It's deliberately forgiving. It understands things like:
 *   "Bench Press: 4x6-8 @ 185"          "3 sets × 8–12 reps"
 *   "- Lateral Raises: 3 sets of 15"    "1. Deadlift — 3×5 @ 315 lb"
 *   "Sets: 3, Reps: 10-12"              "Rest: 75–90 sec" / "Rest 2 min"
 *   Markdown tables: | Exercise | Sets | Reps | Weight |
 *   Day headers: "Day 1 - Push", "## Pull", "Monday:", "Leg day"
 *   The name on one line and "BICEPS • 3 sets × 8–12 reps" on the next.
 *
 * Whatever it can't work out, you fix on the review screen before saving.
 */
import type { PlannedExercise } from '../data/presets';

export interface ImportedDay {
  name: string;
  exercises: PlannedExercise[];
}

/** Used when only a name is given, so the review screen has something to adjust. */
const DEFAULT_TARGET = { sets: 3, repsMin: 10, repsMax: 10 };

const DASH = '(?:-|–|—|to)';
// "3 sets × 8–12 reps", "3x10", "4 × 6-8", "3 sets of 15"
const SETS_X_REPS = new RegExp(
  `(\\d+)\\s*(?:sets?)?\\s*(?:x|×|\\*|of)\\s*(\\d+)(?:\\s*${DASH}\\s*(\\d+))?\\s*(?:reps?)?`,
  'i',
);
// "Sets: 3" + "Reps: 10-12" (any order, same line)
const SETS_LABEL = /\bsets?\s*[:=]?\s*(\d+)/i;
const REPS_LABEL = new RegExp(`\\breps?\\s*[:=]?\\s*(\\d+)(?:\\s*${DASH}\\s*(\\d+))?`, 'i');
const WEIGHT = /(?:@\s*(\d+(?:\.\d+)?)\s*(?:lbs?|pounds)?)|(?:(\d+(?:\.\d+)?)\s*(?:lbs?|pounds)\b)/i;
const REST = new RegExp(
  `\\brest\\b\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)(?:\\s*${DASH}\\s*(\\d+(?:\\.\\d+)?))?\\s*(s|secs?|seconds?|m|mins?|minutes?)?`,
  'i',
);

const DAY_WORDS =
  /^(day\s*\d+|week\s*\d+|session\s*\d+|workout\s*[a-z0-9]?\b|(mon|tues|wednes|thurs|fri|satur|sun)day|push|pull|legs?|leg day|upper|lower|arms?|arm day|chest|back|shoulders|full[\s-]?body|glutes|core|today'?s workout)\b/i;

interface Parsed {
  setsReps?: { sets: number; repsMin: number; repsMax: number; index: number; length: number };
  weight?: number;
  restSec?: [number, number];
}

function parseLine(line: string): Parsed {
  const out: Parsed = {};
  const m = SETS_X_REPS.exec(line);
  if (m) {
    const a = Number(m[2]);
    const b = m[3] ? Number(m[3]) : a;
    out.setsReps = { sets: Number(m[1]), repsMin: Math.min(a, b), repsMax: Math.max(a, b), index: m.index, length: m[0].length };
  } else {
    const s = SETS_LABEL.exec(line);
    const r = REPS_LABEL.exec(line);
    if (s && r) {
      const a = Number(r[1]);
      const b = r[2] ? Number(r[2]) : a;
      const index = Math.min(s.index, r.index);
      out.setsReps = { sets: Number(s[1]), repsMin: Math.min(a, b), repsMax: Math.max(a, b), index, length: 0 };
    }
  }
  const w = WEIGHT.exec(line);
  if (w) out.weight = Number(w[1] ?? w[2]);
  const rest = REST.exec(line);
  if (rest) {
    const unit = (rest[3] ?? '').toLowerCase();
    // No unit: small numbers are minutes ("Rest 2"), big ones seconds ("Rest 90")
    const mult = unit.startsWith('m') || (!unit && Number(rest[1]) <= 5) ? 60 : 1;
    const lo = Number(rest[1]) * mult;
    const hi = rest[2] ? Number(rest[2]) * mult : lo;
    out.restSec = [lo, hi];
  }
  return out;
}

/** Strips markdown, bullets and numbering from a line. */
function clean(line: string): string {
  return line
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*#+\s*/, '')
    .replace(/^\s*[-*•▪◦>]+\s+/, '')
    .trim();
}

const NUMBERED = /^\s*(?:\d+|[a-z])[.)]\s+(.+)$/i;

function stripNumbering(s: string): string {
  const m = NUMBERED.exec(s);
  return (m ? m[1] : s).trim();
}

/** "BICEPS" → "Biceps"; leaves "Incline DB Press" alone. */
function tidyCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Trims separators like "•", ":", "-", "|" from the ends. */
function trimSeparators(s: string): string {
  return s.replace(/^[\s•:|–—-]+|[\s•:|–—(\-,]+$/g, '').trim();
}

function looksLikeProse(s: string): boolean {
  return s.split(/\s+/).length >= 7 || /[.!?]$/.test(s);
}

/** True if this line is just "sets × reps" (maybe after a muscle group), i.e. it
 *  describes the exercise named on the line above. */
function isDetailsOnlyLine(line: string | undefined): boolean {
  if (!line) return false;
  const c = clean(line);
  const p = parseLine(c);
  if (!p.setsReps) return false;
  const before = trimSeparators(c.slice(0, p.setsReps.index));
  return !before || before === before.toUpperCase() || /•/.test(c);
}

function isDayHeader(raw: string, cleaned: string, parsed: Parsed, nextLine: string | undefined): boolean {
  if (parsed.setsReps) return false;
  // "Pull-Ups" followed by "Sets: 4, Reps: 6-10" is an exercise, not a "Pull" day.
  if (isDetailsOnlyLine(nextLine)) return false;
  if (/^\s*#+\s/.test(raw)) return true; // markdown heading
  if (NUMBERED.test(cleaned)) return false;
  const words = cleaned.split(/\s+/).length;
  if (words > 6) return false;
  if (DAY_WORDS.test(cleaned)) return true;
  return /:$/.test(cleaned) && !/^rest\b/i.test(cleaned) && !/^notes?\b/i.test(cleaned);
}

// ---------------------------------------------------------------------------
// Markdown tables
// ---------------------------------------------------------------------------
function parseTableRow(line: string): string[] | null {
  if ((line.match(/\|/g) ?? []).length < 2) return null;
  return line.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => clean(c));
}

interface TableCols { name: number; sets: number; reps: number; weight: number; rest: number; notes: number; group: number }

function tableColumns(cells: string[]): TableCols | null {
  const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
  const cols = {
    name: find(/exercise|movement|lift|name/i),
    sets: find(/^sets?\b/i),
    reps: find(/^reps?\b|rep range/i),
    weight: find(/weight|load|lbs?/i),
    rest: find(/rest/i),
    notes: find(/notes?|cues?|tips?/i),
    group: find(/muscle|target|focus/i),
  };
  return cols.name >= 0 && (cols.sets >= 0 || cols.reps >= 0) ? cols : null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
export function importPlan(text: string): ImportedDay[] {
  const days: ImportedDay[] = [];
  let day: ImportedDay | null = null;
  let current: PlannedExercise | null = null;
  let pendingName: string | null = null;
  let table: TableCols | null = null;

  const ensureDay = () => {
    if (!day) {
      day = { name: 'Workout', exercises: [] };
      days.push(day);
    }
    return day;
  };
  const addExercise = (ex: PlannedExercise) => {
    ensureDay().exercises.push(ex);
    current = ex;
  };
  /** A name we saw but never got sets/reps for: still add it with defaults. */
  const flushPending = () => {
    if (pendingName) addExercise({ name: pendingName, ...DEFAULT_TARGET });
    pendingName = null;
  };

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];

    // --- Tables ---
    const cells = parseTableRow(raw);
    if (cells) {
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // |---|---|
      const header = tableColumns(cells);
      if (header) {
        table = header;
        continue;
      }
      if (table) {
        const t: TableCols = table;
        const get = (i: number) => (i >= 0 ? cells[i] ?? '' : '');
        const name = stripNumbering(get(t.name));
        if (!name) continue;
        const reps = /(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?/.exec(get(t.reps));
        const sets = /(\d+)/.exec(get(t.sets));
        const p = parseLine(`${get(t.sets)} x ${get(t.reps)}`);
        const a = reps ? Number(reps[1]) : DEFAULT_TARGET.repsMin;
        const b = reps?.[2] ? Number(reps[2]) : a;
        const ex: PlannedExercise = {
          name,
          sets: sets ? Number(sets[1]) : p.setsReps?.sets ?? DEFAULT_TARGET.sets,
          repsMin: Math.min(a, b),
          repsMax: Math.max(a, b),
        };
        const w = /(\d+(?:\.\d+)?)/.exec(get(t.weight));
        if (w) ex.targetWeightLb = Number(w[1]);
        const r = parseLine(`rest ${get(t.rest)}`).restSec;
        if (r && get(t.rest)) [ex.restSecMin, ex.restSecMax] = r;
        if (get(t.notes)) ex.notes = get(t.notes);
        if (get(t.group)) ex.muscleGroup = tidyCase(get(t.group));
        addExercise(ex);
        continue;
      }
    } else {
      table = null;
    }

    const line = clean(raw);
    if (!line) continue;
    const parsed = parseLine(line);

    // --- "Rest: 90 sec" on its own line ---
    if (/^rest\b/i.test(line) && parsed.restSec && !parsed.setsReps) {
      const c = current as PlannedExercise | null;
      if (c) [c.restSecMin, c.restSecMax] = parsed.restSec;
      continue;
    }

    // --- Day header ---
    if (isDayHeader(raw, line, parsed, lines[li + 1])) {
      flushPending();
      const name = trimSeparators(line.replace(/:$/, ''));
      if (day && day.exercises.length === 0) day.name = name;
      else {
        day = { name, exercises: [] };
        days.push(day);
      }
      current = null;
      continue;
    }

    // --- A line with sets × reps ---
    if (parsed.setsReps) {
      const before = trimSeparators(line.slice(0, parsed.setsReps.index));
      let name: string | null = null;
      let group: string | undefined;
      const beforeIsGroup = before && (before === before.toUpperCase() || /•/.test(line.slice(0, parsed.setsReps.index)));
      if (before && !(pendingName && beforeIsGroup)) {
        name = stripNumbering(before);
        pendingName = null;
      } else {
        name = pendingName;
        pendingName = null;
        if (before) group = tidyCase(before);
      }
      if (!name) continue;
      const ex: PlannedExercise = {
        name: trimSeparators(name),
        sets: parsed.setsReps.sets,
        repsMin: parsed.setsReps.repsMin,
        repsMax: parsed.setsReps.repsMax,
      };
      if (group) ex.muscleGroup = group;
      if (parsed.weight) ex.targetWeightLb = parsed.weight;
      if (parsed.restSec) [ex.restSecMin, ex.restSecMax] = parsed.restSec;
      addExercise(ex);
      continue;
    }

    // --- Numbered line without sets/reps: an exercise name; details likely follow ---
    if (NUMBERED.test(line)) {
      flushPending();
      pendingName = trimSeparators(stripNumbering(line));
      current = null;
      continue;
    }

    // --- Prose: a note for the current exercise (or intro text we ignore) ---
    if (looksLikeProse(line)) {
      if (current) {
        const c: PlannedExercise = current;
        c.notes = c.notes ? `${c.notes} ${line}` : line;
      }
      continue;
    }

    // --- Short un-numbered line: probably an exercise name ---
    flushPending();
    pendingName = trimSeparators(line);
    current = null;
  }
  flushPending();
  return days.filter((d) => d.exercises.length > 0);
}

/** Paste this into ChatGPT to get plans in a format that imports perfectly. */
export const CHATGPT_PROMPT = `Please format my workout plan as plain text exactly like this, with no tables and no extra commentary:

Day 1 - Push
Bench Press: 4 x 6-8 @ 185 lb, rest 120 sec
Incline Dumbbell Press: 3 x 8-10, rest 90 sec
Lateral Raise: 3 x 12-15

Day 2 - Pull
Deadlift: 3 x 5 @ 315 lb, rest 180 sec

Rules: one exercise per line, "sets x reps" (a rep range like 8-12 is fine), add "@ weight lb" only if there is a target weight, and start each workout day with its own header line.`;
