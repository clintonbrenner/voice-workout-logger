/**
 * The Edit / manual-add sheet that slides up from the bottom.
 * Big +/- steppers so you rarely need the keyboard (you can still tap a
 * number to type it).
 */
import { h, mount, $ } from './dom';
import { haptic } from '../device';

export interface SheetValues {
  exercise: string | null;
  weightLb: number | null;
  reps: number | null;
  bodyweight: boolean;
  notes: string;
}

export interface SheetOptions {
  title: string;
  values: SheetValues;
  exercises: string[];
  /** Fields to highlight (from the voice parser). */
  highlight?: string[];
  saveLabel?: string;
  onSave: (v: SheetValues & { exercise: string; reps: number }) => void;
  onDelete?: () => void;
  onCancel?: () => void;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function openEditSheet(opts: SheetOptions): void {
  const v: SheetValues = { ...opts.values };
  const highlight = new Set(opts.highlight ?? []);
  const sheet = $('sheet');

  const close = () => {
    sheet.hidden = true;
    mount(sheet);
  };

  const render = () => {
    const exerciseOptions = [...new Set([...(v.exercise ? [v.exercise] : []), ...opts.exercises])];
    const canSave = !!v.exercise && v.reps !== null && v.reps > 0 && (v.bodyweight || v.weightLb !== null);

    const stepper = (
      label: string,
      field: 'weightLb' | 'reps',
      steps: number[],
      suffix: string,
    ) => {
      const value = v[field];
      const input = h('input', {
        class: 'step-value',
        type: 'number',
        inputmode: field === 'reps' ? 'numeric' : 'decimal',
        value: value === null ? '' : String(value),
        placeholder: '?',
        onchange: (e: Event) => {
          const n = parseFloat((e.target as HTMLInputElement).value);
          v[field] = Number.isFinite(n) ? n : null;
          highlight.delete(field === 'reps' ? 'reps' : 'weight');
          render();
        },
      });
      const bump = (d: number) => () => {
        haptic();
        const base = v[field] ?? (field === 'reps' ? 0 : 45);
        v[field] = Math.max(0, round(base + d));
        highlight.delete(field === 'reps' ? 'reps' : 'weight');
        render();
      };
      const neg = steps.map((s) => h('button', { class: 'step-btn', type: 'button', onclick: bump(-s) }, `−${s}`));
      const pos = steps.map((s) => h('button', { class: 'step-btn', type: 'button', onclick: bump(s) }, `+${s}`)).reverse();
      return h(
        'div',
        { class: `field ${highlight.has(field === 'reps' ? 'reps' : 'weight') ? 'doubt' : ''}` },
        h('div', { class: 'field-label' }, label),
        // layout: [−5][−2.5]  value  [+2.5][+5]
        h('div', { class: 'stepper' }, ...neg, h('div', { class: 'step-center' }, input, h('span', null, suffix)), ...pos),
      );
    };

    mount(
      sheet,
      h('div', { class: 'sheet-backdrop', onclick: () => { opts.onCancel?.(); close(); } }),
      h(
        'div',
        { class: 'sheet-panel', role: 'dialog', 'aria-label': opts.title },
        h('div', { class: 'sheet-title' }, opts.title),

        h(
          'div',
          { class: `field ${highlight.has('exercise') ? 'doubt' : ''}` },
          h('div', { class: 'field-label' }, 'Exercise'),
          h(
            'select',
            {
              class: 'big-select',
              onchange: (e: Event) => {
                v.exercise = (e.target as HTMLSelectElement).value || null;
                highlight.delete('exercise');
                render();
              },
            },
            v.exercise ? null : h('option', { value: '', selected: true }, 'Choose…'),
            exerciseOptions.map((name) => h('option', { value: name, selected: name === v.exercise }, name)),
          ),
        ),

        stepper(v.bodyweight ? 'Added weight' : 'Weight', 'weightLb', [5, 2.5], 'lb'),
        h(
          'button',
          {
            class: `toggle ${v.bodyweight ? 'on' : ''}`,
            type: 'button',
            onclick: () => {
              v.bodyweight = !v.bodyweight;
              if (v.bodyweight && v.weightLb === null) v.weightLb = 0;
              render();
            },
          },
          v.bodyweight ? '✓ Bodyweight exercise' : 'Bodyweight exercise?',
        ),
        stepper('Reps', 'reps', [1], ''),

        h('input', {
          class: 'note-input',
          type: 'text',
          placeholder: 'Note (optional)',
          value: v.notes,
          oninput: (e: Event) => (v.notes = (e.target as HTMLInputElement).value),
        }),

        h(
          'div',
          { class: 'sheet-actions' },
          opts.onDelete
            ? h('button', { class: 'btn danger', type: 'button', onclick: () => { opts.onDelete!(); close(); } }, 'Delete')
            : null,
          h('button', { class: 'btn', type: 'button', onclick: () => { opts.onCancel?.(); close(); } }, 'Cancel'),
          h(
            'button',
            {
              class: 'btn primary',
              type: 'button',
              disabled: !canSave,
              onclick: () => {
                if (!canSave) return;
                haptic();
                opts.onSave({ ...v, exercise: v.exercise!, reps: v.reps!, weightLb: v.weightLb ?? 0 });
                close();
              },
            },
            opts.saveLabel ?? 'Save',
          ),
        ),
      ),
    );
  };

  render();
  sheet.hidden = false;
}
