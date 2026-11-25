/**
 * The Progress tab: pick an exercise → a chart over time, your personal
 * records, trend arrows, and a table of every set you can sort.
 */
import {
  Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler,
} from 'chart.js';
import { h, mount, $ } from './dom';
import { haptic } from '../device';
import * as db from '../db';
import { e1rm, formatSet, type LoggedSet } from '../models';
import {
  exercisesLogged, personalRecords, repsAtWeight, round1, sessionPoints, trend, weightsUsed, TREND_ICON, type Trend,
} from '../stats';
import { state } from '../store';
import { editSet } from './workoutView';

// Only load the chart pieces we use (keeps the app small).
Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

type Metric = 'top' | 'e1rm' | 'volume' | 'reps';
type SortKey = 'date' | 'weight' | 'reps' | 'e1rm';

const METRICS: [Metric, string][] = [
  ['top', 'Heaviest'],
  ['e1rm', 'Est. 1RM'],
  ['volume', 'Volume'],
  ['reps', 'Reps'],
];
const SORTS: [SortKey, string][] = [['date', 'Newest'], ['weight', 'Weight'], ['reps', 'Reps'], ['e1rm', 'Est. 1RM']];

let sets: LoggedSet[] = [];
let exercise: string | null = null;
let metric: Metric = 'e1rm';
let sortBy: SortKey = 'date';
let repsWeight: number | null = null;
let chart: Chart | null = null;

export async function renderProgress(): Promise<void> {
  sets = await db.getAllSets();
  draw();
}

const shortDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const longDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const trendClass = (t: Trend) => `trend ${t}`;

function seg<T extends string>(options: [T, string][], value: T, pick: (v: T) => void) {
  return h('div', { class: 'segmented' }, options.map(([v, label]) =>
    h('button', { class: v === value ? 'on' : '', type: 'button', onclick: () => { haptic(); pick(v); draw(); } }, label)));
}

function draw(): void {
  chart?.destroy();
  chart = null;
  const names = exercisesLogged(sets);
  if (!names.length) {
    mount($('view-progress'), h('section', { class: 'panel' }, h('h2', null, 'Progress'),
      h('p', { class: 'muted' }, 'Log a few workouts and your charts and personal records will appear here.')));
    return;
  }
  // Default to the exercise you're on (or trained most recently).
  if (!exercise || !names.includes(exercise)) exercise = names.includes(state.activeExercise ?? '') ? state.activeExercise : names[0];
  const ex = exercise!;

  const points = sessionPoints(sets, ex);
  const weights = weightsUsed(sets, ex);
  if (repsWeight === null || !weights.includes(repsWeight)) repsWeight = weights[0] ?? null;
  const pr = personalRecords(sets, ex);
  const tE1rm = trend(points.map((p) => p.bestE1rm));
  const tTop = trend(points.map((p) => p.topWeight));
  const tVol = trend(points.map((p) => p.volume));

  // ---- chart data for the chosen metric ----
  let labels: string[];
  let values: number[];
  let unit = 'lb';
  if (metric === 'reps') {
    const r = repsWeight !== null ? repsAtWeight(sets, ex, repsWeight) : [];
    labels = r.map((x) => shortDate(x.date));
    values = r.map((x) => x.reps);
    unit = 'reps';
  } else {
    labels = points.map((p) => shortDate(p.date));
    values = points.map((p) => (metric === 'top' ? p.topWeight : metric === 'e1rm' ? p.bestE1rm : p.volume));
  }
  const metricTrend = metric === 'reps' ? trend(values) : metric === 'top' ? tTop : metric === 'e1rm' ? tE1rm : tVol;

  // ---- table ----
  const mine = sets.filter((s) => s.exercise === ex);
  const est = (s: LoggedSet) => e1rm(s.weightLb ?? 0, s.reps);
  const sorted = [...mine].sort((a, b) =>
    sortBy === 'weight' ? (b.weightLb ?? 0) - (a.weightLb ?? 0) || b.reps - a.reps
      : sortBy === 'reps' ? b.reps - a.reps || (b.weightLb ?? 0) - (a.weightLb ?? 0)
        : sortBy === 'e1rm' ? est(b) - est(a)
          : b.createdAt - a.createdAt);

  const canvas = h('canvas', { 'aria-label': `${ex} chart` });

  mount(
    $('view-progress'),
    h('section', { class: 'panel' },
      h('select', {
        class: 'big-select', 'aria-label': 'Exercise',
        onchange: (e: Event) => { exercise = (e.target as HTMLSelectElement).value; draw(); },
      }, names.map((n) => {
        const t = trend(sessionPoints(sets, n).map((p) => p.bestE1rm));
        return h('option', { value: n, selected: n === ex }, `${n} ${TREND_ICON[t]}`);
      })),
      h('div', { class: 'trend-row' },
        trendChip('Est. 1RM', tE1rm), trendChip('Top weight', tTop), trendChip('Volume', tVol)),
    ),

    h('section', { class: 'panel' },
      seg(METRICS, metric, (v) => (metric = v)),
      metric === 'reps' && weights.length
        ? h('div', { class: 'chips weight-pick' }, weights.slice(0, 8).map((w) =>
            h('button', { class: `chip ${w === repsWeight ? 'on' : ''}`, type: 'button', onclick: () => { repsWeight = w; draw(); } }, `${w} lb`)))
        : null,
      values.length < 2
        ? h('p', { class: 'muted chart-empty' }, values.length ? 'One session so far — the line appears after your next one.' : 'No data for this view yet.')
        : null,
      h('div', { class: 'chart-box' }, canvas),
      values.length >= 2
        ? h('div', { class: 'muted small' }, `Last ${Math.min(values.length, 5)} sessions: `, h('span', { class: trendClass(metricTrend) }, `${TREND_ICON[metricTrend]} ${metricTrend}`))
        : null,
    ),

    h('section', { class: 'panel' },
      h('h2', null, 'Personal records'),
      h('div', { class: 'pr-grid' },
        pr.heaviest ? prCard('Heaviest', `${pr.heaviest.weightLb} lb × ${pr.heaviest.reps}`, pr.heaviest.date) : null,
        pr.bestE1rm ? prCard('Best est. 1RM', `${pr.bestE1rm.value} lb`, pr.bestE1rm.date, `${pr.bestE1rm.weightLb} × ${pr.bestE1rm.reps}`) : null,
      ),
      pr.mostRepsAt.length
        ? h('div', null, h('div', { class: 'field-label' }, 'Most reps at each weight'),
            h('table', { class: 'data' }, pr.mostRepsAt.slice(0, 8).map((r) =>
              h('tr', null, h('td', null, `${r.weightLb} lb`), h('td', null, h('b', null, `${r.reps} reps`)), h('td', { class: 'muted' }, longDate(r.date))))))
        : null,
    ),

    h('section', { class: 'panel' },
      h('h2', null, `All sets (${mine.length})`),
      seg(SORTS, sortBy, (v) => (sortBy = v)),
      h('table', { class: 'data sets-table' },
        h('tr', null, h('th', null, 'Date'), h('th', null, 'Set'), h('th', null, 'Est. 1RM')),
        sorted.slice(0, 200).map((s) =>
          h('tr', { onclick: () => editSet(s) },
            h('td', { class: 'muted' }, shortDate(s.date)),
            h('td', null, h('b', null, formatSet(s))),
            h('td', null, s.weightLb ? `${round1(est(s))}` : '—'))),
      ),
    ),
  );

  if (values.length) {
    const css = getComputedStyle(document.documentElement);
    const accent = css.getPropertyValue('--accent').trim() || '#2f80ff';
    chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: values,
          borderColor: accent,
          backgroundColor: 'rgba(47,128,255,0.15)',
          fill: true,
          tension: 0.25,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointBackgroundColor: accent,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.parsed.y} ${unit}` } },
        },
        scales: {
          x: { ticks: { color: '#9a9aa8', maxRotation: 0, autoSkip: true }, grid: { color: '#22222d' } },
          y: { ticks: { color: '#9a9aa8' }, grid: { color: '#22222d' }, grace: '10%' },
        },
      },
    });
  }
}

function trendChip(label: string, t: Trend) {
  return h('div', { class: 'trend-chip' }, h('div', { class: 'muted small' }, label),
    h('div', { class: trendClass(t) }, t === 'none' ? '—' : `${TREND_ICON[t]} ${t}`));
}

function prCard(label: string, value: string, date: string, sub?: string) {
  return h('div', { class: 'pr-card' },
    h('div', { class: 'muted small' }, label),
    h('div', { class: 'pr-value' }, value),
    sub ? h('div', { class: 'small' }, sub) : null,
    h('div', { class: 'muted small' }, longDate(date)));
}
