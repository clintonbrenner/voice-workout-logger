/**
 * Step 1 of parsing: clean up the raw transcript and split it into words.
 *
 * - lowercases everything, strips punctuation (but keeps decimals like 22.5)
 * - separates glued-together bits: "185lbs" → "185 lbs", "185x8" → "185 x 8"
 * - fixes common speech-to-text slips: "ate" → "eight", "wraps" → "reps"
 * - unifies units/keywords: pounds/lbs/# → "lb", rep/reps → "reps"
 * - joins spelled-out letters: "r d l" → "rdl", "o h p" → "ohp"
 * - merges split compound words: "pull up" → "pullup", "body weight" → "bodyweight"
 */

/** Single-word replacements. */
const WORD_FIXES: Record<string, string> = {
  // speech-to-text slips
  ate: 'eight',
  fore: 'for',
  // units
  lb: 'lb',
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  // reps (and things dictation hears instead of "reps")
  rep: 'reps',
  reps: 'reps',
  wraps: 'reps',
  raps: 'reps',
  rips: 'reps',
  repetitions: 'reps',
  // time (for timed exercises like holds)
  sec: 'sec',
  secs: 'sec',
  second: 'sec',
  seconds: 'sec',
  min: 'min',
  mins: 'min',
  minute: 'min',
  minutes: 'min',
  // plates
  plates: 'plate',
  quarters: 'quarter',
  // misc
  bw: 'bodyweight',
  okay: 'ok',
  ex: 'x', // "185 ex 8"
};

/** Two-word phrases that should become one token. */
const PHRASE_MERGES: [string, string, string][] = [
  ['body', 'weight', 'bodyweight'],
  ['dumb', 'bell', 'dumbbell'],
  ['dumb', 'bells', 'dumbbell'],
  ['easy', 'bar', 'ez bar'],
  ['pull', 'up', 'pullup'],
  ['pull', 'ups', 'pullup'],
  ['chin', 'up', 'chinup'],
  ['chin', 'ups', 'chinup'],
  ['push', 'up', 'pushup'],
  ['push', 'ups', 'pushup'],
  ['push', 'down', 'pushdown'],
  ['push', 'downs', 'pushdown'],
  ['pull', 'down', 'pulldown'],
  ['pull', 'downs', 'pulldown'],
  ['dead', 'lift', 'deadlift'],
  ['dead', 'lifts', 'deadlift'],
  ['skull', 'crusher', 'skullcrusher'],
  ['skull', 'crushers', 'skullcrusher'],
];

/** Single letters that are real words, so they must NOT be glued together. */
const STANDALONE_LETTERS = new Set(['a', 'i', 'x']);

export function normalize(text: string): string[] {
  let s = text.toLowerCase();
  s = s.replace(/[×*]/g, ' x ');
  s = s.replace(/#/g, ' lb ');
  s = s.replace(/(\d),(\d{3})\b/g, '$1$2'); // 1,000 → 1000
  s = s.replace(/(\d)s\b/g, '$1'); // "the 70s" (dumbbells) → 70
  s = s.replace(/(\d)([a-z])/g, '$1 $2'); // 185lbs → 185 lbs, 185x8 → 185 x8
  s = s.replace(/([a-z])(\d)/g, '$1 $2'); // x8 → x 8
  // periods: keep only decimal points (digit.digit)
  s = s.replace(/\.(?!\d)/g, ' ').replace(/(^|[^\d])\./g, '$1 ');
  s = s.replace(/[-–—_/]/g, ' '); // pull-ups → pull ups
  s = s.replace(/[^a-z0-9.\s]/g, ' '); // drop everything else (commas, quotes, ?!)

  let words = s.split(/\s+/).filter(Boolean).map((w) => WORD_FIXES[w] ?? w);

  // Join runs of 2+ single letters: "r d l" → "rdl"
  const joined: string[] = [];
  for (let i = 0; i < words.length; ) {
    if (isJoinableLetter(words[i])) {
      let j = i;
      while (j < words.length && isJoinableLetter(words[j])) j++;
      if (j - i >= 2) {
        joined.push(words.slice(i, j).join(''));
        i = j;
        continue;
      }
    }
    joined.push(words[i]);
    i++;
  }
  words = joined;

  // Merge two-word compounds
  const merged: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const m = PHRASE_MERGES.find(([a, b]) => words[i] === a && words[i + 1] === b);
    if (m) {
      merged.push(...m[2].split(' '));
      i++;
    } else {
      merged.push(words[i]);
    }
  }
  return merged;
}

function isJoinableLetter(w: string): boolean {
  return w.length === 1 && /[a-z]/.test(w) && !STANDALONE_LETTERS.has(w);
}
