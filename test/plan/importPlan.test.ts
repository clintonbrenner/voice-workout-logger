import { describe, expect, it } from 'vitest';
import { importPlan, AI_PROMPT, FORMAT_EXAMPLE } from '../../src/plan/importPlan';
import armsText from '../fixtures/plan-arms.txt?raw';

describe('your Arms plan (pasted from ChatGPT)', () => {
  const days = importPlan(armsText);

  it('finds one day with all 7 exercises', () => {
    expect(days).toHaveLength(1);
    expect(days[0].exercises.map((e) => e.name)).toEqual([
      'EZ-Bar Preacher Curl',
      'Overhead Cable Triceps Extension',
      'Incline Dumbbell Curl',
      'Rope Triceps Pushdown',
      'Dumbbell Hammer Curl',
      'Seated Wrist Curl',
      'Reverse Wrist Curl',
    ]);
  });

  it('reads sets, rep ranges, rest and muscle group', () => {
    const [preacher, , incline, , hammer, wrist] = days[0].exercises;
    expect(preacher).toMatchObject({ sets: 3, repsMin: 8, repsMax: 12, restSecMin: 90, restSecMax: 90, muscleGroup: 'Biceps' });
    expect(incline).toMatchObject({ sets: 3, repsMin: 10, repsMax: 12, restSecMin: 75, restSecMax: 90 });
    expect(hammer.muscleGroup).toBe('Brachialis + Brachioradialis');
    expect(wrist).toMatchObject({ sets: 2, repsMin: 15, repsMax: 20, restSecMin: 60 });
  });

  it('keeps the coaching cue as a note', () => {
    expect(days[0].exercises[0].notes).toMatch(/controlled eccentric/);
  });
});

describe('other common formats', () => {
  it('multi-day with "Name: 4x6-8 @ 185"', () => {
    const days = importPlan(`
Day 1 - Push
Bench Press: 4x6-8 @ 185
Incline DB Press 3 x 10
- Lateral Raises: 3 sets of 15

Day 2 - Pull
1. Deadlift — 3×5 @ 315 lb
2. Barbell Row 4 x 8-10
`);
    expect(days.map((d) => d.name)).toEqual(['Day 1 - Push', 'Day 2 - Pull']);
    expect(days[0].exercises).toEqual([
      { name: 'Bench Press', sets: 4, repsMin: 6, repsMax: 8, targetWeightLb: 185 },
      { name: 'Incline DB Press', sets: 3, repsMin: 10, repsMax: 10 },
      { name: 'Lateral Raises', sets: 3, repsMin: 15, repsMax: 15 },
    ]);
    expect(days[1].exercises).toEqual([
      { name: 'Deadlift', sets: 3, repsMin: 5, repsMax: 5, targetWeightLb: 315 },
      { name: 'Barbell Row', sets: 4, repsMin: 8, repsMax: 10 },
    ]);
  });

  it('markdown with bold names and headings', () => {
    const days = importPlan(`
## Leg Day
- **Back Squat** — 5 sets × 5 reps @ 225 lbs (rest 3 min)
- **Romanian Deadlift**: 3 × 8–10
- **Leg Press** 3x12, Rest: 90s
`);
    expect(days).toHaveLength(1);
    expect(days[0].name).toBe('Leg Day');
    expect(days[0].exercises).toEqual([
      { name: 'Back Squat', sets: 5, repsMin: 5, repsMax: 5, targetWeightLb: 225, restSecMin: 180, restSecMax: 180 },
      { name: 'Romanian Deadlift', sets: 3, repsMin: 8, repsMax: 10 },
      { name: 'Leg Press', sets: 3, repsMin: 12, repsMax: 12, restSecMin: 90, restSecMax: 90 },
    ]);
  });

  it('"Sets: 3, Reps: 10-12" style', () => {
    const days = importPlan(`
Upper Body
Pull-Ups
Sets: 4, Reps: 6-10
Face Pulls
Sets: 3, Reps: 15
`);
    expect(days[0].name).toBe('Upper Body');
    expect(days[0].exercises).toEqual([
      { name: 'Pull-Ups', sets: 4, repsMin: 6, repsMax: 10 },
      { name: 'Face Pulls', sets: 3, repsMin: 15, repsMax: 15 },
    ]);
  });

  it('markdown table', () => {
    const days = importPlan(`
**Monday – Chest & Triceps**

| Exercise | Sets | Reps | Rest | Notes |
|---|---|---|---|---|
| Bench Press | 4 | 6–8 | 2 min | Pause on chest |
| Cable Fly | 3 | 12-15 | 60 sec | |
| Skull Crushers | 3 | 10 | 90 sec | |
`);
    expect(days[0].name).toBe('Monday – Chest & Triceps');
    expect(days[0].exercises).toEqual([
      { name: 'Bench Press', sets: 4, repsMin: 6, repsMax: 8, restSecMin: 120, restSecMax: 120, notes: 'Pause on chest' },
      { name: 'Cable Fly', sets: 3, repsMin: 12, repsMax: 15, restSecMin: 60, restSecMax: 60 },
      { name: 'Skull Crushers', sets: 3, repsMin: 10, repsMax: 10, restSecMin: 90, restSecMax: 90 },
    ]);
  });

  it('names with no sets/reps still come through (with defaults to fix)', () => {
    const days = importPlan(`Workout A:\n1. Squat\n2. Bench Press\n3. Row`);
    expect(days[0].exercises.map((e) => e.name)).toEqual(['Squat', 'Bench Press', 'Row']);
    expect(days[0].exercises[0]).toMatchObject({ sets: 3, repsMin: 10 });
  });

  it('the format shown in the app imports cleanly (and is in the AI prompt)', () => {
    expect(AI_PROMPT).toContain(FORMAT_EXAMPLE);
    const days = importPlan(FORMAT_EXAMPLE);
    expect(days.map((d) => d.name)).toEqual(['Day 1 - Push', 'Day 2 - Pull']);
    expect(days[0].exercises[0]).toEqual({
      name: 'Bench Press', sets: 4, repsMin: 6, repsMax: 8, targetWeightLb: 185, restSecMin: 120, restSecMax: 120,
    });
    expect(days[1].exercises[0].name).toBe('Deadlift');
  });

  it('timed exercises in seconds or minutes', () => {
    const days = importPlan(`Core
Hollow Body Hold: 3 x 30 sec
Plank 3 x 45-60 seconds
Side Plank: 2 x 1 min
Dead Bug: 3 x 10`);
    expect(days[0].exercises).toEqual([
      { name: 'Hollow Body Hold', sets: 3, repsMin: 30, repsMax: 30, unit: 'seconds' },
      { name: 'Plank', sets: 3, repsMin: 45, repsMax: 60, unit: 'seconds' },
      { name: 'Side Plank', sets: 2, repsMin: 60, repsMax: 60, unit: 'seconds' },
      { name: 'Dead Bug', sets: 3, repsMin: 10, repsMax: 10 },
    ]);
  });

  it('timed exercise in a table', () => {
    const days = importPlan(`| Exercise | Sets | Reps |\n|---|---|---|\n| Plank | 3 | 45 sec |\n| Crunch | 3 | 15 |`);
    expect(days[0].exercises[0]).toMatchObject({ name: 'Plank', repsMin: 45, unit: 'seconds' });
    expect(days[0].exercises[1].unit).toBeUndefined();
  });

  it('empty or junk text gives nothing', () => {
    expect(importPlan('')).toEqual([]);
    expect(importPlan('Here is your plan! Let me know if you have questions.')).toEqual([]);
  });
});
