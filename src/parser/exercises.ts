/**
 * Exercise names: the built-in catalog (with aliases) and the fuzzy matcher
 * that turns spoken words like "hammer curls" into "Dumbbell Hammer Curl".
 *
 * Matching order of preference:
 *   1. exercises in today's plan (they get a bonus)
 *   2. known exercises and their aliases
 *   3. if it's a close call between several, prefer the one currently selected
 *      in the menu; otherwise flag it as uncertain so you can pick.
 */
import { normalize } from './normalize';

export interface KnownExercise {
  name: string;
  aliases?: string[];
  /** True for pull-ups, dips, etc. (no weight needed). */
  bodyweight?: boolean;
}

export const DEFAULT_EXERCISES: KnownExercise[] = [
  { name: 'Bench Press', aliases: ['bench', 'flat bench', 'barbell bench'] },
  { name: 'Incline Bench Press', aliases: ['incline bench', 'incline press'] },
  { name: 'Dumbbell Bench Press', aliases: ['db bench', 'dumbbell bench'] },
  { name: 'Squat', aliases: ['back squat', 'barbell squat'] },
  { name: 'Front Squat' },
  { name: 'Deadlift', aliases: ['deads', 'dl', 'conventional deadlift'] },
  { name: 'Romanian Deadlift', aliases: ['rdl', 'romanian'] },
  { name: 'Overhead Press', aliases: ['ohp', 'military press', 'shoulder press'] },
  { name: 'Barbell Row', aliases: ['row', 'bent over row', 'bb row'] },
  { name: 'Pull-Up', aliases: ['pullup'], bodyweight: true },
  { name: 'Chin-Up', aliases: ['chinup'], bodyweight: true },
  { name: 'Dip', aliases: ['dips'], bodyweight: true },
  { name: 'Push-Up', aliases: ['pushup'], bodyweight: true },
  { name: 'Lat Pulldown', aliases: ['pulldown'] },
  { name: 'Seated Cable Row', aliases: ['cable row'] },
  { name: 'Leg Press' },
  { name: 'Leg Curl', aliases: ['hamstring curl'] },
  { name: 'Leg Extension' },
  { name: 'Lunge' },
  { name: 'Hip Thrust' },
  { name: 'Calf Raise' },
  { name: 'Lateral Raise', aliases: ['lat raise', 'side raise'] },
  { name: 'Face Pull' },
  { name: 'Barbell Curl', aliases: ['bicep curl', 'bb curl'] },
  { name: 'Hammer Curl' },
  { name: 'Triceps Pushdown', aliases: ['pushdown'] },
  { name: 'Skull Crusher', aliases: ['skullcrusher', 'lying triceps extension'] },
];

/** Shorthand words → the word used in exercise names. */
const SYNONYMS: Record<string, string> = {
  db: 'dumbbell',
  bb: 'barbell',
  tri: 'tricep',
  bi: 'bicep',
  ext: 'extension',
};

/** Words that never help identify an exercise. */
const NOISE = new Set(['the', 'a', 'an', 'of', 'on', 'my', 'some']);

/** Crude singular form: curls→curl, triceps→tricep, presses→press (but press stays press). */
function stem(w: string): string {
  if (w.endsWith('sses')) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Turns a name or spoken phrase into comparable tokens. */
export function exerciseTokens(words: string[]): string[] {
  return words
    .map((w) => SYNONYMS[w] ?? w)
    .map(stem)
    .filter((w) => !NOISE.has(w));
}

function nameTokens(name: string): string[] {
  return exerciseTokens(normalize(name));
}

/** Edit distance between two strings (number of single-letter changes). */
function levenshtein(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** 1.0 = identical, 0 = nothing alike. */
function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  return len === 0 ? 1 : 1 - levenshtein(a, b) / len;
}

/** Same word, allowing small spelling/dictation differences in longer words. */
function tokensMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return Math.min(a.length, b.length) >= 4 && similarity(a, b) >= 0.75;
}

/**
 * How well spoken tokens match a candidate name (0–1).
 * Mostly "how many of the words I said appear in the name" (recall),
 * plus a bit of "how much of the name did I say" (precision) as a tie-breaker.
 */
function scorePhrase(spoken: string[], cand: string[]): number {
  if (spoken.length === 0 || cand.length === 0) return 0;
  if (spoken.join(' ') === cand.join(' ')) return 1;
  const recall = spoken.filter((s) => cand.some((c) => tokensMatch(s, c))).length / spoken.length;
  const precision = cand.filter((c) => spoken.some((s) => tokensMatch(s, c))).length / cand.length;
  const tokenScore = 0.7 * recall + 0.3 * precision;
  // Also compare with spaces removed: "pullups" vs "pull up"
  const glued = similarity(spoken.join(''), cand.join(''));
  return Math.max(tokenScore, glued >= 0.8 ? glued * 0.95 : 0);
}

export interface ExerciseMatch {
  /** Best guess (canonical name), or null if nothing is even close. */
  name: string | null;
  /** False when it's a weak or close call — the UI should highlight it. */
  confident: boolean;
  score: number;
  /** Other likely exercises, for a quick-pick list in the UI. */
  alternatives: string[];
}

export interface MatchOptions {
  plan?: string[];
  known?: KnownExercise[];
  active?: string | null;
}

const PLAN_BONUS = 0.1;
const CLOSE_CALL = 0.08;
const MIN_CONFIDENT = 0.6;
const MIN_GUESS = 0.3;

export function matchExercise(spokenWords: string[], opts: MatchOptions = {}): ExerciseMatch {
  const spoken = exerciseTokens(spokenWords);
  const plan = opts.plan ?? [];
  const known = opts.known ?? DEFAULT_EXERCISES;
  if (spoken.length === 0) return { name: null, confident: false, score: 0, alternatives: [] };

  const planTokens = plan.map((p) => ({ name: p, tokens: nameTokens(p) }));
  const lower = (s: string) => s.toLowerCase();

  /** If a known exercise is really a plan exercise under a shorter name
   *  ("Hammer Curl" → "Dumbbell Hammer Curl"), use the plan's name. */
  function toPlanName(canonical: string): string | null {
    const direct = plan.find((p) => lower(p) === lower(canonical));
    if (direct) return direct;
    const ct = nameTokens(canonical);
    const hits = planTokens.filter((p) => ct.every((t) => p.tokens.some((pt) => tokensMatch(t, pt))));
    return hits.length === 1 ? hits[0].name : null;
  }

  // Build every (phrase → canonical name) pair we could match against.
  const candidates: { canonical: string; tokens: string[]; inPlan: boolean }[] = [];
  for (const p of planTokens) candidates.push({ canonical: p.name, tokens: p.tokens, inPlan: true });
  for (const k of known) {
    const planName = toPlanName(k.name);
    const canonical = planName ?? k.name;
    for (const phrase of [k.name, ...(k.aliases ?? [])]) {
      candidates.push({ canonical, tokens: nameTokens(phrase), inPlan: planName !== null });
    }
  }

  // Best score per canonical exercise.
  const best = new Map<string, number>();
  for (const c of candidates) {
    const s = scorePhrase(spoken, c.tokens) + (c.inPlan ? PLAN_BONUS : 0);
    if (s > (best.get(c.canonical) ?? -1)) best.set(c.canonical, s);
  }
  const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
  const [topName, topScore] = ranked[0];
  if (topScore < MIN_GUESS) return { name: null, confident: false, score: topScore, alternatives: [] };

  const close = ranked.filter(([, s]) => s >= topScore - CLOSE_CALL);
  let name = topName;
  let confident = topScore >= MIN_CONFIDENT && close.length === 1;

  // Close call? If the exercise selected in the menu is one of the contenders, use it.
  if (!confident && opts.active && topScore >= MIN_CONFIDENT) {
    const activeHit = close.find(([n]) => lower(n) === lower(opts.active!));
    if (activeHit) {
      name = activeHit[0];
      confident = true;
    }
  }

  const alternatives = ranked
    .filter(([n, s]) => n !== name && s >= 0.4)
    .slice(0, 4)
    .map(([n]) => n);
  return { name, confident, score: topScore, alternatives };
}

/** Looks up whether an exercise is bodyweight-only. */
export function isBodyweightExercise(name: string | null, known: KnownExercise[] = DEFAULT_EXERCISES): boolean {
  if (!name) return false;
  const k = known.find((e) => e.name.toLowerCase() === name.toLowerCase());
  return !!k?.bodyweight;
}
