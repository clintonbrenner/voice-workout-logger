import { describe, expect, it } from 'vitest';
import type { LoggedSet, Session } from '../src/models';
import { personalRecords, repsAtWeight, sessionPoints, trend, weightsUsed, exercisesLogged } from '../src/stats';
import { toCsv, sessionText, makeBackup, readBackup, restorePlan } from '../src/exporters';

let t = 1000;
function set(sessionId: string, date: string, exercise: string, weightLb: number | null, reps: number, extra: Partial<LoggedSet> = {}): LoggedSet {
  t += 1;
  return { id: `id${t}`, sessionId, date, exercise, weightLb, reps, bodyweight: false, notes: '', transcript: '', createdAt: t, ...extra };
}

const sessions: Session[] = [
  { id: 's1', workoutId: null, workoutName: 'Arms', date: '2026-11-17', startedAt: 1 },
  { id: 's2', workoutId: null, workoutName: 'Arms', date: '2026-11-24', startedAt: 2 },
];
const P = 'EZ-Bar Preacher Curl';
const sets: LoggedSet[] = [
  set('s1', '2026-11-17', P, 60, 10),
  set('s1', '2026-11-17', P, 60, 9),
  set('s1', '2026-11-17', 'Rope Triceps Pushdown', 50, 12),
  set('s2', '2026-11-24', P, 65, 10, { transcript: 'preacher 65 for 10' }),
  set('s2', '2026-11-24', P, 65, 8, { notes: 'grip slipped, "ugh"' }),
  set('s2', '2026-11-24', P, 60, 12),
];

describe('per-session progress points', () => {
  const pts = sessionPoints(sets, P);
  it('one point per session, oldest first', () => {
    expect(pts.map((p) => p.date)).toEqual(['2026-11-17', '2026-11-24']);
  });
  it('top set, e1RM, volume', () => {
    expect(pts[0]).toMatchObject({ topWeight: 60, topReps: 10, volume: 60 * 10 + 60 * 9, totalReps: 19, sets: 2 });
    expect(pts[0].bestE1rm).toBe(80); // 60 × (1 + 10/30)
    expect(pts[1]).toMatchObject({ topWeight: 65, topReps: 10, sets: 3 });
    expect(pts[1].bestE1rm).toBe(86.7);
  });
  it('reps at a given weight', () => {
    expect(repsAtWeight(sets, P, 60)).toEqual([{ date: '2026-11-17', reps: 10 }, { date: '2026-11-24', reps: 12 }]);
  });
  it('weights used, most common first', () => {
    expect(weightsUsed(sets, P)).toEqual([60, 65]);
  });
  it('exercises, most recent first', () => {
    expect(exercisesLogged(sets)).toEqual([P, 'Rope Triceps Pushdown']);
  });
});

describe('personal records', () => {
  const pr = personalRecords(sets, P);
  it('heaviest weight with its date', () => {
    expect(pr.heaviest).toEqual({ weightLb: 65, reps: 10, date: '2026-11-24' });
  });
  it('best estimated 1RM', () => {
    expect(pr.bestE1rm).toMatchObject({ value: 86.7, weightLb: 65, reps: 10 });
  });
  it('most reps at each weight, keeping the date it was set', () => {
    expect(pr.mostRepsAt).toEqual([
      { weightLb: 65, reps: 10, date: '2026-11-24' },
      { weightLb: 60, reps: 12, date: '2026-11-24' },
    ]);
  });
  it('nothing logged → no records', () => {
    expect(personalRecords(sets, 'Squat')).toEqual({ heaviest: null, bestE1rm: null, mostRepsAt: [] });
  });
});

describe('trend', () => {
  it.each<[number[], string]>([
    [[100, 105, 110, 115], 'up'],
    [[115, 110, 105, 100], 'down'],
    [[100, 101, 100, 100.5], 'flat'],
    [[100], 'none'],
    [[50, 50, 100, 105, 110, 115, 120], 'up'],
  ])('%j → %s', (v, expected) => expect(trend(v)).toBe(expected));
});

describe('CSV export', () => {
  const csv = toCsv(sets, sessions);
  const lines = csv.replace('﻿', '').trim().split('\r\n');
  it('starts with a BOM so Excel reads it as UTF-8', () => {
    expect(csv.startsWith('﻿')).toBe(true);
  });
  it('has the agreed columns', () => {
    expect(lines[0]).toBe('date,workout,exercise,set_number,weight_lb,reps,e1rm_lb,bodyweight,notes,raw_transcript');
  });
  it('one row per set with per-exercise set numbers', () => {
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe('2026-11-17,Arms,EZ-Bar Preacher Curl,1,60,10,80,no,,');
    expect(lines[3]).toBe('2026-11-17,Arms,Rope Triceps Pushdown,1,50,12,70,no,,');
    expect(lines[4]).toBe('2026-11-24,Arms,EZ-Bar Preacher Curl,1,65,10,86.7,no,,preacher 65 for 10');
  });
  it('quotes commas and quotes safely', () => {
    expect(lines[5]).toBe('2026-11-24,Arms,EZ-Bar Preacher Curl,2,65,8,82.3,no,"grip slipped, ""ugh""",');
  });
  it('bodyweight sets: weight 0, no e1RM', () => {
    const bw = toCsv([set('s1', '2026-11-17', 'Pull-Up', 0, 10, { bodyweight: true })], sessions);
    expect(bw).toContain('Pull-Up,1,0,10,,yes');
  });
});

describe('copy as text', () => {
  it('summarises a session', () => {
    expect(sessionText(sessions[1], sets)).toBe(
      'Arms — Tue, Nov 24, 2026\n' +
        'EZ-Bar Preacher Curl: 65×10, 65×8, 60×12 (grip slipped, "ugh")\n' +
        '(weights in lb, shown as weight×reps)',
    );
  });
});

describe('backup and restore', () => {
  const backup = makeBackup({ workouts: [], sessions, sets, aliases: [{ alias: 'rope', exercise: 'Rope Triceps Pushdown' }] });

  it('round-trips through JSON', () => {
    expect(readBackup(JSON.stringify(backup))).toEqual(backup);
  });
  it('rejects other files', () => {
    expect(() => readBackup('hello')).toThrow(/isn't a Lift Log backup/);
    expect(() => readBackup('{"foo":1}')).toThrow(/isn't a Lift Log backup/);
  });
  it('restore only adds what is missing (no duplicates)', () => {
    const plan = restorePlan(backup, { workouts: [], sessions: [sessions[0]], sets: sets.slice(0, 3), aliases: [] });
    expect(plan.sessions.map((s) => s.id)).toEqual(['s2']);
    expect(plan.sets).toHaveLength(3);
    expect(plan.aliases).toHaveLength(1);
  });
});
