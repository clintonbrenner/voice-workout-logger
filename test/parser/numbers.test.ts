import { describe, expect, it } from 'vitest';
import { normalize } from '../../src/parser/normalize';
import { convertNumbers } from '../../src/parser/numbers';

const nums = (text: string) => convertNumbers(normalize(text)).filter((t) => typeof t === 'number');
const toks = (text: string) => convertNumbers(normalize(text));

describe('number words → digits', () => {
  it.each([
    ['one eighty five', [185]],
    ['one eighty-five', [185]],
    ['a hundred and five', [105]],
    ['one hundred five', [105]],
    ['one hundred and eighty five', [185]],
    ['one oh five', [105]],
    ['one o five', [105]],
    ['two twenty five', [225]],
    ['two twenty-five', [225]],
    ['one thirty five', [135]],
    ['one fifteen', [115]],
    ['three fifteen', [315]],
    ['four oh five', [405]],
    ['ninety five', [95]],
    ['forty five', [45]],
    ['seventy', [70]],
    ['eight', [8]],
    ['twelve', [12]],
    ['a hundred', [100]],
    ['two hundred', [200]],
    ['twenty five twelve', [25, 12]],
    ['twenty twelve', [20, 12]],
    ['thirty ten', [30, 10]],
    ['twenty two and a half', [22.5]],
    ['22 and a half', [22.5]],
    ['22 point 5', [22.5]],
    ['22.5', [22.5]],
    ['185', [185]],
    ['1,000', [1000]],
  ])('%s → %j', (text, expected) => {
    expect(nums(text)).toEqual(expected);
  });
});

describe('speech-to-text repairs', () => {
  it('"ate" heard instead of "eight"', () => {
    expect(nums('185 for ate')).toEqual([185, 8]);
  });
  it('"for" heard as "4" between two numbers', () => {
    expect(toks('185 4 8')).toEqual([185, 'for', 8]);
  });
  it('"for" heard as "four" between two number words', () => {
    expect(toks('one eighty five four eight')).toEqual([185, 'for', 8]);
  });
  it('"for" glued onto the weight: 1854 8', () => {
    expect(toks('1854 8')).toEqual([185, 'for', 8]);
  });
  it('"for" glued onto the reps: 65 410 → 65 for 10, 185 48 → 185 for 8', () => {
    expect(toks('65 410')).toEqual([65, 'for', 10]);
    expect(toks('185 48')).toEqual([185, 'for', 8]);
    expect(toks('135 412')).toEqual([135, 'for', 12]);
  });
  it('real weights starting with 4 are left alone', () => {
    expect(toks('405 for 3')).toEqual([405, 'for', 3]); // 4-0-5: "05" isn't reps
    expect(toks('bench 45')).toEqual(['bench', 45]); // nothing before it
    expect(toks('20 for 4')).toEqual([20, 'for', 4]);
  });
  it('splits 185lbs and 185x8', () => {
    expect(toks('185lbs')).toEqual([185, 'lb']);
    expect(toks('185x8')).toEqual([185, 'x', 8]);
    expect(toks('185×8')).toEqual([185, 'x', 8]);
  });
  it('a real 4 is kept when not between numbers', () => {
    expect(nums('4 reps')).toEqual([4]);
    expect(nums('185 for 4')).toEqual([185, 4]);
  });
});

describe('normalize', () => {
  it('joins spelled-out letters', () => {
    expect(normalize('R D L')).toEqual(['rdl']);
    expect(normalize('o h p 95')).toEqual(['ohp', '95']);
  });
  it('merges compound words', () => {
    expect(normalize('pull-ups')).toEqual(['pullup']);
    expect(normalize('pull ups')).toEqual(['pullup']);
    expect(normalize('body weight')).toEqual(['bodyweight']);
    expect(normalize('easy bar curl')).toEqual(['ez', 'bar', 'curl']);
  });
  it('unifies units and reps', () => {
    expect(normalize('185 pounds 8 wraps')).toEqual(['185', 'lb', '8', 'reps']);
    expect(normalize('185 lbs. 8 rep')).toEqual(['185', 'lb', '8', 'reps']);
  });
});
