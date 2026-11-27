/**
 * The main parser: one spoken clip → one logged set.
 *
 *   parseSet("bench, 185, 8 reps", ctx)
 *   → { exercise: "Bench Press", weightLb: 185, reps: 8, uncertain: [] }
 *
 * How it works:
 *   1. normalize()        clean up the words
 *   2. convertNumbers()   "one eighty five" → 185
 *   3. split on corrections ("I mean", "no", "actually"…) into segments
 *   4. read each segment: which number is the weight, which is reps, which words
 *      name the exercise
 *   5. later segments override earlier ones ("135, oh I mean 185" → 185)
 *   6. fill gaps from context: the selected exercise, "same weight", bodyweight
 *   7. flag anything missing or doubtful in `uncertain` — never guess silently
 */
import { normalize } from './normalize';
import { convertNumbers, type Tok } from './numbers';
import { DEFAULT_EXERCISES, isBodyweightExercise, matchExercise, type KnownExercise } from './exercises';

export type Field = 'exercise' | 'weight' | 'reps';

/** A previously logged set (used for "same weight", "same as last"). */
export interface PreviousSet {
  exercise: string;
  weightLb: number | null;
  reps: number;
  bodyweight?: boolean;
}

export interface ParseContext {
  /** Exercise names in today's workout. Matched first. */
  planExercises?: string[];
  /** All known exercises with aliases. Defaults to the built-in list. */
  knownExercises?: KnownExercise[];
  /** The exercise selected in the menu; used when no exercise is spoken. */
  activeExercise?: string | null;
  /** Recent sets, newest first. */
  history?: PreviousSet[];
  /** Exercises logged in seconds instead of reps (holds, planks…). */
  timedExercises?: string[];
}

export interface ParsedSet {
  exercise: string | null;
  /** Where the exercise came from. */
  exerciseSource: 'spoken' | 'active' | 'last' | 'none';
  /** For bodyweight sets this is the ADDED weight (0 if none). */
  weightLb: number | null;
  /** Reps, or seconds when unit is 'seconds'. */
  reps: number | null;
  unit: 'reps' | 'seconds';
  bodyweight: boolean;
  /** Fields the UI should highlight for you to check. */
  uncertain: Field[];
  /** True if you corrected yourself mid-sentence. */
  corrected: boolean;
  /** Other exercises it might have been (for a quick-pick list). */
  alternatives: string[];
  /** The words we think named the exercise. */
  heardExercise: string;
  transcript: string;
}

// ---------------------------------------------------------------------------
// Segment reading
// ---------------------------------------------------------------------------

const CORRECTION_PHRASES: string[][] = [
  ['i', 'mean'], ['i', 'meant'], ['make', 'that'], ['make', 'it'], ['scratch', 'that'],
  ['no'], ['nope'], ['actually'], ['sorry'], ['wait'], ['correction'], ['rather'], ['oops'],
];

/** Words that are never part of an exercise name. */
const NOT_EXERCISE = new Set([
  'for', 'x', 'times', 'by', 'at', 'with', 'lb', 'reps', 'and', 'a', 'an', 'the', 'of', 'set', 'sets',
  'did', 'do', 'i', 'just', 'got', 'um', 'uh', 'oh', 'so', 'ok', 'that', 'was', 'my', 'then', 'last',
  'please', 'log', 'it', 'me', 'per', 'side', 'each', 'hand', 'arm', 'weight', 'plus', 'next', 'yeah',
  'is', 'this', 'one', 'like', 'about', 'around', 'total', 'like', 'hmm', 'okay', 'to', 'in',
  'sec', 'min', 'added',
]);

const SEPARATORS = new Set(['for', 'x', 'times', 'by']);
const PLATE_EXTRAS: Record<string, number> = { quarter: 25, dime: 10, nickel: 5 };
const PLATE = 45; // one 45 lb plate per side
const BAR = 45;
/** Numbers above this are almost never reps, so they must be a weight. */
const MAX_LIKELY_REPS = 30;

interface Segment {
  weight: number | null;
  reps: number | null;
  /** Fields in the order they were mentioned (for corrections). */
  mentions: ('weight' | 'reps')[];
  /** Numbers with no clue about what they are. */
  loose: number[];
  exerciseWords: string[];
  bodyweight: boolean;
  sameAll: boolean;
  sameWeight: boolean;
  sameReps: boolean;
  doubtful: Set<'weight' | 'reps'>;
  /** A time was spoken ("30 seconds", "1 minute"): reps holds seconds. */
  timed: boolean;
  /** Two bare numbers were swapped (smaller one taken as reps). */
  swapped?: boolean;
}

function splitOnCorrections(toks: Tok[]): Tok[][] {
  const segments: Tok[][] = [[]];
  for (let i = 0; i < toks.length; i++) {
    const phrase = CORRECTION_PHRASES.find((p) => p.every((w, k) => toks[i + k] === w));
    if (phrase) {
      segments.push([]);
      i += phrase.length - 1;
    } else {
      segments[segments.length - 1].push(toks[i]);
    }
  }
  return segments.filter((s) => s.length > 0);
}

function readSegment(toks: Tok[]): Segment {
  const seg: Segment = {
    weight: null, reps: null, mentions: [], loose: [], exerciseWords: [],
    bodyweight: false, sameAll: false, sameWeight: false, sameReps: false, doubtful: new Set(), timed: false,
  };
  const used = new Array<boolean>(toks.length).fill(false);
  const num = (i: number): number | null => (typeof toks[i] === 'number' && !used[i] ? (toks[i] as number) : null);
  const set = (field: 'weight' | 'reps', v: number) => {
    seg[field] = v;
    seg.mentions.push(field);
  };

  // --- Pass 1: phrases (plates, bodyweight, "same …") ---
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t === 'plate') {
      // "2 plates", "a plate", or just "plate"
      let count = 1;
      const before = num(i - 1);
      if (before !== null && before >= 1 && before <= 8 && Number.isInteger(before)) {
        count = before;
        used[i - 1] = true;
      } else if (toks[i - 1] === 'a') {
        used[i - 1] = true;
      }
      used[i] = true;
      // "… and a 25" / "and a quarter" = extra plate on each side
      let extra = 0;
      let j = i + 1;
      if (toks[j] === 'and') {
        let k = j + 1;
        if (toks[k] === 'a') k++;
        const n = num(k);
        const word = toks[k];
        if (n !== null && toks[k + 1] !== 'reps') {
          extra = n;
        } else if (typeof word === 'string' && word in PLATE_EXTRAS) {
          extra = PLATE_EXTRAS[word];
        }
        if (extra) for (let m = j; m <= k; m++) used[m] = true;
      }
      set('weight', BAR + count * 2 * PLATE + extra * 2);
    } else if (t === 'bodyweight') {
      seg.bodyweight = true;
      used[i] = true;
    } else if (t === 'plus' && num(i + 1) !== null) {
      // "bodyweight plus 25"
      set('weight', toks[i + 1] as number);
      used[i] = used[i + 1] = true;
    } else if (t === 'same') {
      used[i] = true;
      const next = toks[i + 1];
      if (next === 'weight') {
        seg.sameWeight = true;
        used[i + 1] = true;
      } else if (next === 'reps') {
        seg.sameReps = true;
        used[i + 1] = true;
      } else {
        seg.sameAll = true;
        // swallow "as last set/time", "again"
        let j = i + 1;
        while (['as', 'last', 'time', 'set', 'before', 'again', 'thing'].includes(String(toks[j]))) used[j++] = true;
      }
    } else if (t === 'repeat' || t === 'ditto' || (t === 'again' && !used[i])) {
      seg.sameAll = true;
      used[i] = true;
    }
  }

  // --- Pass 2: numbers and their clues ---
  const looseAt: number[] = [];
  for (let i = 0; i < toks.length; i++) {
    const v = num(i);
    if (v === null) continue;
    const next = toks[i + 1];
    const prev = toks[i - 1];

    if (next === 'lb') {
      set('weight', v);
      used[i] = used[i + 1] = true;
    } else if (next === 'reps') {
      set('reps', v);
      used[i] = used[i + 1] = true;
    } else if (next === 'sec' || next === 'min') {
      // "30 seconds", "1 minute" — a timed set; reps holds the seconds
      set('reps', next === 'min' ? v * 60 : v);
      seg.timed = true;
      used[i] = used[i + 1] = true;
    } else if (typeof next === 'string' && SEPARATORS.has(next) && num(i + 2) !== null && toks[i + 3] !== 'lb') {
      // "185 for 8", "185 x 8", "185 times 8", timed: "5 for 30 seconds"
      const after = toks[i + 3];
      const amount = toks[i + 2] as number;
      set('weight', v);
      set('reps', after === 'min' ? amount * 60 : amount);
      used[i] = used[i + 1] = used[i + 2] = true;
      if (after === 'reps' || after === 'sec' || after === 'min') used[i + 3] = true;
      if (after === 'sec' || after === 'min') seg.timed = true;
    } else if (prev === 'at' || prev === 'with') {
      set('weight', v); // "8 reps at 185"
      used[i] = true;
    } else if (prev === 'for') {
      set('reps', v); // "… for 8"
      used[i] = true;
    } else if (next === 'times') {
      set('reps', v); // "8 times"
      used[i] = used[i + 1] = true;
    } else {
      seg.loose.push(v);
      looseAt.push(i);
      used[i] = true;
    }
  }

  // --- Exercise words: whatever's left that isn't filler ---
  seg.exerciseWords = toks.filter(
    (t, i): t is string => typeof t === 'string' && !used[i] && !NOT_EXERCISE.has(t),
  );

  // --- Make sense of the loose numbers ---
  const L = seg.loose;
  if (L.length > 0) {
    if (seg.weight === null && seg.reps === null && L.length >= 2) {
      // "squat 225 5" → weight first, reps second (unless clearly the other way round)
      let [a, b] = L;
      if (a <= MAX_LIKELY_REPS && b > MAX_LIKELY_REPS) {
        [a, b] = [b, a];
        seg.swapped = true;
      }
      set('weight', a);
      set('reps', b);
      if (L.length > 2) seg.doubtful.add('weight').add('reps');
      seg.loose = [];
    } else if (seg.weight !== null && seg.reps === null) {
      set('reps', L[0]);
      if (L.length > 1) seg.doubtful.add('reps');
      seg.loose = [];
    } else if (seg.reps !== null && seg.weight === null) {
      set('weight', L[0]);
      if (L.length > 1) seg.doubtful.add('weight');
      seg.loose = [];
    } else if (seg.weight !== null && seg.reps !== null) {
      // extra numbers we couldn't place
      seg.doubtful.add('weight').add('reps');
      seg.loose = [];
    }
    // else: exactly one number with no clue — decided later using context
  }
  return seg;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parseSet(transcript: string, ctx: ParseContext = {}): ParsedSet {
  const known = ctx.knownExercises ?? DEFAULT_EXERCISES;
  const history = ctx.history ?? [];
  const toks = convertNumbers(normalize(transcript));
  const segments = splitOnCorrections(toks).map(readSegment);
  const corrected = segments.length > 1;

  // Merge segments: later ones override earlier ones.
  const s: Segment = segments[0] ?? readSegment([]);
  for (const c of segments.slice(1)) {
    if (c.exerciseWords.length) s.exerciseWords = c.exerciseWords;
    for (const f of ['weight', 'reps'] as const) {
      if (c[f] !== null) {
        s[f] = c[f];
        s.doubtful.delete(f);
        if (c.doubtful.has(f)) s.doubtful.add(f);
      }
    }
    s.bodyweight ||= c.bodyweight;
    s.sameAll ||= c.sameAll;
    s.sameWeight ||= c.sameWeight;
    s.sameReps ||= c.sameReps;
    s.timed ||= c.timed;

    // A correction that's just a number: "185 for 8, no, 9"
    if (c.loose.length === 1 && c.weight === null && c.reps === null) {
      const n = c.loose[0];
      if (s.loose.length === 1 && s.weight === null && s.reps === null) {
        s.loose = [n]; // "135, oh I mean 185" — replace the earlier unplaced number
      } else {
        let target = s.mentions[s.mentions.length - 1] ?? null;
        if (target === 'reps' && n > MAX_LIKELY_REPS) target = 'weight';
        if (target) {
          s[target] = n;
          s.doubtful.delete(target);
          s.mentions.push(target);
        } else {
          s.loose = [n];
        }
      }
    }
    s.mentions.push(...c.mentions);
  }

  const uncertain = new Set<Field>();

  // --- Exercise ---
  let exercise: string | null = null;
  let exerciseSource: ParsedSet['exerciseSource'] = 'none';
  let alternatives: string[] = [];
  if (s.exerciseWords.length) {
    const m = matchExercise(s.exerciseWords, {
      plan: ctx.planExercises, known, active: ctx.activeExercise,
    });
    exercise = m.name;
    alternatives = m.alternatives;
    exerciseSource = 'spoken';
    if (!m.confident) uncertain.add('exercise');
    // Nothing matched at all: fall back to the selected exercise, but flag it.
    if (!exercise && ctx.activeExercise) {
      exercise = ctx.activeExercise;
      exerciseSource = 'active';
    }
  } else if (ctx.activeExercise) {
    exercise = ctx.activeExercise;
    exerciseSource = 'active';
  } else if (s.sameAll && history[0]) {
    exercise = history[0].exercise;
    exerciseSource = 'last';
  }

  // The set to copy from for "same …": last set of this exercise, else the last set overall.
  const ref = history.find((h) => exercise && h.exercise.toLowerCase() === exercise.toLowerCase()) ?? history[0];

  // --- Weight / reps from "same …" ---
  let weight = s.weight;
  let reps = s.reps;
  let bodyweight = s.bodyweight;
  if (ref) {
    if (weight === null && (s.sameAll || s.sameWeight)) {
      weight = ref.weightLb;
      bodyweight ||= !!ref.bodyweight;
    }
    if (reps === null && (s.sameAll || s.sameReps)) reps = ref.reps;
  } else if (s.sameAll || s.sameWeight || s.sameReps) {
    // asked for "same" but there's nothing to copy
    if (s.sameAll || s.sameWeight) uncertain.add('weight');
    if (s.sameAll || s.sameReps) uncertain.add('reps');
  }

  const bodyweightExercise = isBodyweightExercise(exercise, known);
  // Timed set: a time was spoken, or the exercise is timed in your plan.
  const timedExercise = !!exercise && (ctx.timedExercises ?? []).some((n) => n.toLowerCase() === exercise!.toLowerCase());
  const timed = s.timed || timedExercise;
  // "5 30" on a hold means 5 lb for 30 s; undo the reps-style "smaller number is reps" swap.
  if (timedExercise && !s.timed && s.swapped && s.weight !== null && s.reps !== null) {
    weight = s.reps;
    reps = s.weight;
  }

  // --- One number with no clue ---
  if (s.loose.length === 1) {
    const n = s.loose[0];
    if (weight !== null && reps === null) reps = n;
    else if (reps !== null && weight === null) weight = n;
    else if (weight === null && reps === null) {
      if (bodyweight || bodyweightExercise || timedExercise) reps = n; // "pull-ups 10", "plank 45"
      else if (n > MAX_LIKELY_REPS) weight = n; // "bench 185" — reps missing
      else reps = n; // "curls 12" / "7": reps (weight comes from your last set, below)
    }
  }

  // --- Only reps said ("7", "7 reps"): keep the same weight as your last set of
  // this exercise. Less to say mid-workout, and less room for error.
  if (weight === null && reps !== null && !bodyweight && !bodyweightExercise) {
    const last = history.find((h) => exercise && h.exercise.toLowerCase() === exercise.toLowerCase());
    if (last && last.weightLb !== null) {
      weight = last.weightLb;
      bodyweight ||= !!last.bodyweight;
    }
  }

  // --- Bodyweight exercises and holds need no weight ---
  if (weight === null && (bodyweight || bodyweightExercise || timed)) {
    weight = 0;
    bodyweight = true;
  }
  if (bodyweightExercise && weight === 0) bodyweight = true;

  // --- Sanity checks: flag, don't guess ---
  for (const f of s.doubtful) uncertain.add(f);
  if (!exercise) uncertain.add('exercise');
  if (weight === null) uncertain.add('weight');
  if (reps === null) uncertain.add('reps');
  if (weight !== null && (weight > 1000 || weight < 0)) uncertain.add('weight');
  const maxAmount = timed ? 3600 : 100; // seconds vs reps
  if (reps !== null && (reps <= 0 || reps > maxAmount || !Number.isInteger(reps))) uncertain.add('reps');

  const order: Field[] = ['exercise', 'weight', 'reps'];
  return {
    exercise,
    exerciseSource,
    weightLb: weight,
    reps,
    unit: timed ? 'seconds' : 'reps',
    bodyweight,
    uncertain: order.filter((f) => uncertain.has(f)),
    corrected,
    alternatives,
    heardExercise: s.exerciseWords.join(' '),
    transcript,
  };
}
