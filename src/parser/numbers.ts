/**
 * Step 2 of parsing: turn number words into real numbers.
 *
 *   "one eighty five"      → 185   (gym-style: hundreds digit + rest)
 *   "a hundred and five"   → 105
 *   "one oh five"          → 105
 *   "twenty two and a half"→ 22.5
 *   "twenty five twelve"   → 25, 12  (two separate numbers)
 *
 * Also repairs the classic dictation slip where "for" becomes "4":
 *   "185 4 8"  → 185 for 8
 *   "1854 8"   → 185 for 8
 */

/** A token is either a number or a (lowercase) word. */
export type Tok = number | string;

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

const has = (o: Record<string, number>, w: string | undefined) => w !== undefined && Object.hasOwn(o, w);

/** Reads a number 0–99 starting at words[i]. Returns [value, nextIndex] or null. */
function readUnder100(words: string[], i: number): [number, number] | null {
  const w = words[i];
  if (has(TENS, w)) {
    const next = words[i + 1];
    if (has(UNITS, next) && UNITS[next] >= 1) return [TENS[w] + UNITS[next], i + 2];
    return [TENS[w], i + 1];
  }
  if (has(UNITS, w)) return [UNITS[w], i + 1];
  if (has(TEENS, w)) return [TEENS[w], i + 1];
  return null;
}

/** After "hundred": optional "and", then optional 0–99. */
function readAfterHundred(base: number, words: string[], j: number): [number, number] {
  let k = j;
  if (words[k] === 'and' && readUnder100(words, k + 1)) k++;
  const r = readUnder100(words, k);
  return r ? [base + r[0], r[1]] : [base, j];
}

/** Reads one spoken number starting at words[i]. */
function readSpokenNumber(words: string[], i: number): [number, number] | null {
  if (words[i] === 'a' && words[i + 1] === 'hundred') return readAfterHundred(100, words, i + 2);

  const first = readUnder100(words, i);
  if (!first) return null;
  const [v, j] = first;

  if (words[j] === 'hundred') return readAfterHundred(Math.max(v, 1) * 100, words, j + 1);

  // Gym-style weights: a single digit word followed by a 10–99 word
  // "one eighty five" = 185, "two twenty five" = 225, "one fifteen" = 115
  const isSingleDigit = v >= 1 && v <= 9 && j === i + 1;
  if (isSingleDigit) {
    if (has(TENS, words[j]) || has(TEENS, words[j])) {
      const rest = readUnder100(words, j)!;
      return [v * 100 + rest[0], rest[1]];
    }
    // "one oh five" = 105
    const z = words[j];
    const after = words[j + 1];
    if ((z === 'oh' || z === 'o' || z === 'zero') && has(UNITS, after) && UNITS[after] >= 1) {
      return [v * 100 + UNITS[after], j + 2];
    }
  }
  return [v, j];
}

export function convertNumbers(words: string[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < words.length; ) {
    const w = words[i];
    if (/^\d+(\.\d+)?$/.test(w)) {
      out.push(parseFloat(w));
      i++;
      continue;
    }
    const spoken = readSpokenNumber(words, i);
    if (spoken) {
      out.push(spoken[0]);
      i = spoken[1];
      continue;
    }
    out.push(w);
    i++;
  }
  return fixUps(out);
}

/** Second pass: decimals, "and a half", and the "for"→"4" repair. */
function fixUps(toks: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (typeof t === 'number') {
      // "22 and a half" → 22.5
      if (toks[i + 1] === 'and' && toks[i + 2] === 'a' && toks[i + 3] === 'half') {
        out.push(t + 0.5);
        i += 3;
        continue;
      }
      // "22 point 5" → 22.5
      const dec = toks[i + 2];
      if (toks[i + 1] === 'point' && typeof dec === 'number' && Number.isInteger(dec) && dec < 10) {
        out.push(t + dec / 10);
        i += 2;
        continue;
      }
      // "1854 8" → "185 for 8" (dictation glued "for"/"4" onto the weight)
      if (t >= 1000 && Number.isInteger(t) && t % 10 === 4 && typeof toks[i + 1] === 'number') {
        out.push(Math.floor(t / 10), 'for');
        continue;
      }
      // "65 410" → "65 for 10" (glued "for"/"4" onto the reps): a weight, then a
      // number that's "4" + a believable rep count, but too big to be reps itself.
      const s = String(t);
      const rest = Number(s.slice(1));
      if (
        typeof out[out.length - 1] === 'number' && Number.isInteger(t) && t > 30 &&
        s.length >= 2 && s.length <= 3 && s[0] === '4' && s[1] !== '0' && rest >= 1 && rest <= 30
      ) {
        out.push('for', rest);
        continue;
      }
    }
    out.push(t);
  }
  // "185 4 8" → "185 for 8" (a lone 4 sandwiched between two numbers)
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i] === 4 && typeof out[i - 1] === 'number' && typeof out[i + 1] === 'number') {
      out[i] = 'for';
    }
  }
  return out;
}
