import { describe, expect, it } from 'vitest';
import { parseSet, type ParseContext, type ParsedSet } from '../../src/parser';
import { PRESET_WORKOUTS } from '../../src/data/presets';

const ARMS = PRESET_WORKOUTS[0].exercises.map((e) => e.name);

/** No plan loaded: matches against the built-in exercise list. */
const general: ParseContext = {};
/** Your Arms day. */
const arms: ParseContext = { planExercises: ARMS };

type Expect = Partial<Pick<ParsedSet, 'exercise' | 'weightLb' | 'reps' | 'bodyweight' | 'uncertain' | 'corrected'>>;

function check(text: string, ctx: ParseContext, expected: Expect) {
  const r = parseSet(text, ctx);
  const picked = Object.fromEntries(Object.keys(expected).map((k) => [k, r[k as keyof ParsedSet]]));
  expect(picked, `"${text}"`).toEqual(expected);
}

describe('basic phrasings (no plan)', () => {
  it.each<[string, Expect]>([
    ['bench, 185, 8 reps', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 for 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['Bench 185 for 8.', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench press 185 times 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 x 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185x8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 by 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['8 reps at 185 on bench', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 8 reps 185 pounds', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['squat 225 5 reps', { exercise: 'Squat', weightLb: 225, reps: 5, uncertain: [] }],
    ['squat 225 5', { exercise: 'Squat', weightLb: 225, reps: 5, uncertain: [] }],
    ['squats two twenty five for five', { exercise: 'Squat', weightLb: 225, reps: 5, uncertain: [] }],
    ['bench one eighty five for eight', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench a hundred and five for twelve', { exercise: 'Bench Press', weightLb: 105, reps: 12, uncertain: [] }],
    ['deadlift 315 for 3', { exercise: 'Deadlift', weightLb: 315, reps: 3, uncertain: [] }],
    ['dead lift three fifteen for three', { exercise: 'Deadlift', weightLb: 315, reps: 3, uncertain: [] }],
    ['RDL 185 for 10', { exercise: 'Romanian Deadlift', weightLb: 185, reps: 10, uncertain: [] }],
    ['R D L 185 for 10', { exercise: 'Romanian Deadlift', weightLb: 185, reps: 10, uncertain: [] }],
    ['OHP 95 for 8', { exercise: 'Overhead Press', weightLb: 95, reps: 8, uncertain: [] }],
    ['overhead press 95 for 8', { exercise: 'Overhead Press', weightLb: 95, reps: 8, uncertain: [] }],
    ['military press ninety five for eight', { exercise: 'Overhead Press', weightLb: 95, reps: 8, uncertain: [] }],
    ['incline bench 155 for 10', { exercise: 'Incline Bench Press', weightLb: 155, reps: 10, uncertain: [] }],
    ['lat pulldown 140 for 12', { exercise: 'Lat Pulldown', weightLb: 140, reps: 12, uncertain: [] }],
    ['lateral raises 20 for 15', { exercise: 'Lateral Raise', weightLb: 20, reps: 15, uncertain: [] }],
    ['dumbbell bench 70s for 10', { exercise: 'Dumbbell Bench Press', weightLb: 70, reps: 10, uncertain: [] }],
    ['bench 22.5 for 10', { exercise: 'Bench Press', weightLb: 22.5, reps: 10, uncertain: [] }],
  ])('%s', (text, expected) => check(text, general, expected));
});

describe('speech-to-text mistakes', () => {
  it.each<[string, Expect]>([
    ['bench 185 4 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 1854 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 for ate', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 48', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench one eighty five four eight', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 8 wraps', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 lbs 8 rep', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['benches 185 for 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['squad 225 for 5', { exercise: 'Squat', weightLb: 225, reps: 5, uncertain: [] }],
    ['um bench uh 185 for 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
  ])('%s', (text, expected) => check(text, general, expected));
});

describe('plates', () => {
  it.each<[string, Expect]>([
    ['bench a plate for 10', { weightLb: 135, reps: 10, uncertain: [] }],
    ['bench 1 plate for 10', { weightLb: 135, reps: 10, uncertain: [] }],
    ['squat 2 plates for 5', { weightLb: 225, reps: 5, uncertain: [] }],
    ['squat two plates for five', { weightLb: 225, reps: 5, uncertain: [] }],
    ['deadlift 3 plates 3 reps', { weightLb: 315, reps: 3, uncertain: [] }],
    ['deadlift four plates for 1', { weightLb: 405, reps: 1, uncertain: [] }],
    ['bench plate and a quarter for 8', { weightLb: 185, reps: 8, uncertain: [] }],
    ['squat 2 plates and a 25 for 5', { weightLb: 275, reps: 5, uncertain: [] }],
    ['squat 2 plates and 8 reps', { weightLb: 225, reps: 8, uncertain: [] }],
  ])('%s', (text, expected) => check(text, general, expected));
});

describe('bodyweight', () => {
  it.each<[string, Expect]>([
    ['bodyweight pull-ups 10', { exercise: 'Pull-Up', weightLb: 0, reps: 10, bodyweight: true, uncertain: [] }],
    ['pull ups 10', { exercise: 'Pull-Up', weightLb: 0, reps: 10, bodyweight: true, uncertain: [] }],
    ['pullups 12 reps', { exercise: 'Pull-Up', weightLb: 0, reps: 12, bodyweight: true, uncertain: [] }],
    ['dips 15', { exercise: 'Dip', weightLb: 0, reps: 15, bodyweight: true, uncertain: [] }],
    ['pull ups bodyweight plus 25 for 6', { exercise: 'Pull-Up', weightLb: 25, reps: 6, bodyweight: true, uncertain: [] }],
    ['body weight chin ups 8', { exercise: 'Chin-Up', weightLb: 0, reps: 8, bodyweight: true, uncertain: [] }],
  ])('%s', (text, expected) => check(text, general, expected));
});

describe('your Arms plan', () => {
  it.each<[string, Expect]>([
    ['preacher curl 60 for 10', { exercise: 'EZ-Bar Preacher Curl', weightLb: 60, reps: 10, uncertain: [] }],
    // exactly what the on-device model produced in testing:
    ['Preacher curl 135 oh i mean 65 410.', { exercise: 'EZ-Bar Preacher Curl', weightLb: 65, reps: 10, uncertain: [] }],
    ['easy bar preacher 60 for 10', { exercise: 'EZ-Bar Preacher Curl', weightLb: 60, reps: 10, uncertain: [] }],
    ['EZ bar curl 60 for 10', { exercise: 'EZ-Bar Preacher Curl', weightLb: 60, reps: 10, uncertain: [] }],
    ['overhead extension 50 for 12', { exercise: 'Overhead Cable Triceps Extension', weightLb: 50, reps: 12, uncertain: [] }],
    ['overhead tricep extension 50 for 12', { exercise: 'Overhead Cable Triceps Extension', weightLb: 50, reps: 12, uncertain: [] }],
    ['incline curls 25 for 10', { exercise: 'Incline Dumbbell Curl', weightLb: 25, reps: 10, uncertain: [] }],
    ['rope pushdown 60 for 12', { exercise: 'Rope Triceps Pushdown', weightLb: 60, reps: 12, uncertain: [] }],
    ['rope push downs 60 for 12', { exercise: 'Rope Triceps Pushdown', weightLb: 60, reps: 12, uncertain: [] }],
    ['tricep pushdown 60 for 12', { exercise: 'Rope Triceps Pushdown', weightLb: 60, reps: 12, uncertain: [] }],
    ['hammer curls 30 for 12', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['hammer curl thirty for twelve', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['seated wrist curl 25 for 20', { exercise: 'Seated Wrist Curl', weightLb: 25, reps: 20, uncertain: [] }],
    ['reverse wrist curl 15 for 15', { exercise: 'Reverse Wrist Curl', weightLb: 15, reps: 15, uncertain: [] }],
    ['reverse curls 15 for 15', { exercise: 'Reverse Wrist Curl', weightLb: 15, reps: 15, uncertain: [] }],
    ['dumbbell curl 25 for 10', { exercise: 'Incline Dumbbell Curl', uncertain: ['exercise'] }],
  ])('%s', (text, expected) => check(text, arms, expected));

  it('"curl" alone is ambiguous on arm day → flagged', () => {
    const r = parseSet('curl 30 for 12', arms);
    expect(r.uncertain).toEqual(['exercise']);
    expect(r.alternatives.length).toBeGreaterThan(0);
  });

  it('"curl" alone resolves to the selected curl', () => {
    check('curl 30 for 12', { ...arms, activeExercise: 'Dumbbell Hammer Curl' }, {
      exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [],
    });
  });

  it('"wrist curl" is a close call between seated and reverse → flagged', () => {
    expect(parseSet('wrist curl 20 for 15', arms).uncertain).toEqual(['exercise']);
  });
});

describe('no exercise spoken → uses the selected one', () => {
  const ctx: ParseContext = { ...arms, activeExercise: 'Incline Dumbbell Curl' };
  it.each<[string, Expect]>([
    ['25 for 10', { exercise: 'Incline Dumbbell Curl', weightLb: 25, reps: 10, uncertain: [] }],
    ['twenty five for ten', { exercise: 'Incline Dumbbell Curl', weightLb: 25, reps: 10, uncertain: [] }],
    ['25 pounds 10 reps', { exercise: 'Incline Dumbbell Curl', weightLb: 25, reps: 10, uncertain: [] }],
    ['10 reps at 25', { exercise: 'Incline Dumbbell Curl', weightLb: 25, reps: 10, uncertain: [] }],
  ])('%s', (text, expected) => check(text, ctx, expected));

  it('no exercise and nothing selected → exercise flagged', () => {
    check('185 for 8', general, { exercise: null, weightLb: 185, reps: 8, uncertain: ['exercise'] });
  });
});

describe('"same" phrases', () => {
  const ctx: ParseContext = {
    ...arms,
    activeExercise: 'Dumbbell Hammer Curl',
    history: [
      { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12 },
      { exercise: 'Rope Triceps Pushdown', weightLb: 60, reps: 15 },
    ],
  };
  it.each<[string, Expect]>([
    ['same weight 10 reps', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 10, uncertain: [] }],
    ['same weight 10', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 10, uncertain: [] }],
    ['same as last', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['same as last time', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['same again', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['same', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['repeat', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [] }],
    ['same 10 reps', { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 10, uncertain: [] }],
    ['35 same reps', { exercise: 'Dumbbell Hammer Curl', weightLb: 35, reps: 12, uncertain: [] }],
    ['rope pushdown same weight 12', { exercise: 'Rope Triceps Pushdown', weightLb: 60, reps: 12, uncertain: [] }],
  ])('%s', (text, expected) => check(text, ctx, expected));

  it('"same" with no history → flagged', () => {
    check('same as last', { activeExercise: 'Bench Press' }, { uncertain: ['weight', 'reps'] });
  });

  it('just reps: borrows the weight from your last set but flags it', () => {
    check('11', ctx, { exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 11, uncertain: ['weight'] });
  });
});

describe('corrections ("I mean", "no", "actually"…)', () => {
  it.each<[string, Expect]>([
    ['135, oh I mean 185', { weightLb: 185, corrected: true }],
    ['bench 135 oh I mean 185 for 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [], corrected: true }],
    ['bench 185 for 8, no, 9', { exercise: 'Bench Press', weightLb: 185, reps: 9, uncertain: [], corrected: true }],
    ['bench 185 for 8 I mean 9 reps', { exercise: 'Bench Press', weightLb: 185, reps: 9, uncertain: [] }],
    ['bench 135 for 8 actually 185', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
    ['bench 185 for 8 sorry 6', { exercise: 'Bench Press', weightLb: 185, reps: 6, uncertain: [] }],
    ['bench 185 for 8 wait 195', { exercise: 'Bench Press', weightLb: 195, reps: 8, uncertain: [] }],
    ['bench 185 for 8 make that 7', { exercise: 'Bench Press', weightLb: 185, reps: 7, uncertain: [] }],
    ['bench 185 for 8 scratch that 195 for 6', { exercise: 'Bench Press', weightLb: 195, reps: 6, uncertain: [] }],
    ['squat I mean bench 185 for 8', { exercise: 'Bench Press', weightLb: 185, reps: 8, uncertain: [] }],
  ])('%s', (text, expected) => check(text, general, expected));

  it('corrects the exercise on arm day', () => {
    check('curl, I mean hammer curl, 30 for 12', arms, {
      exercise: 'Dumbbell Hammer Curl', weightLb: 30, reps: 12, uncertain: [], corrected: true,
    });
  });

  it('a plain "one oh five" is a number, not a correction', () => {
    check('bench one oh five for 10', general, { weightLb: 105, reps: 10, corrected: false });
  });
});

describe('flags instead of silent guesses', () => {
  it.each<[string, ParseContext, Expect]>([
    ['bench 185', general, { exercise: 'Bench Press', weightLb: 185, reps: null, uncertain: ['reps'] }],
    ['bench 8', general, { exercise: 'Bench Press', weightLb: null, reps: 8, uncertain: ['weight'] }],
    ['bench', general, { weightLb: null, reps: null, uncertain: ['weight', 'reps'] }],
    ['', general, { exercise: null, uncertain: ['exercise', 'weight', 'reps'] }],
    ['bench 185 for 8 3', general, { uncertain: ['weight', 'reps'] }],
    ['bench 1850 for 8', general, { uncertain: ['weight'] }],
    ['bench 185 for 200', general, { uncertain: ['reps'] }],
    ['blorp 185 for 8', general, { uncertain: ['exercise'] }],
    ['the thing 185 for 8', { activeExercise: 'Bench Press' }, { exercise: 'Bench Press', uncertain: ['exercise'] }],
  ])('%s', (text, ctx, expected) => check(text, ctx, expected));
});

describe('keeps the raw transcript', () => {
  it('returns it unchanged', () => {
    expect(parseSet('Bench, 185, 8 reps', general).transcript).toBe('Bench, 185, 8 reps');
  });
});
