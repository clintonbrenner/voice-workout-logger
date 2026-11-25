/**
 * The History tab: past workouts, and getting your data out
 * (CSV for spreadsheets, text for ChatGPT/Claude, backup & restore).
 */
import { h, mount, $ } from './dom';
import { haptic } from '../device';
import * as db from '../db';
import { formatSet, localDate, type LoggedSet, type Session } from '../models';
import { groupSession, sessionsWithSets } from '../stats';
import { toCsv, sessionText, makeBackup, readBackup, restorePlan, shareFile } from '../exporters';
import * as store from '../store';
import { state } from '../store';
import { showToast, editSet } from './workoutView';

const BACKUP_KEY = 'liftlog.lastBackup';
const REMIND_KEY = 'liftlog.backupReminder';
const REMIND_AFTER_DAYS = 14;

let allSessions: Session[] = [];
let allSets: LoggedSet[] = [];
const open = new Set<string>();

/** Loads everything from the phone's database, then draws. */
export async function renderHistory(): Promise<void> {
  [allSessions, allSets] = await Promise.all([db.getAllSessions(), db.getAllSets()]);
  draw();
}

function fmtDate(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function stamp(): string {
  return localDate().replace(/-/g, '');
}

function backupDue(): boolean {
  if (localStorage.getItem(REMIND_KEY) === 'off' || allSets.length === 0) return false;
  const last = Number(localStorage.getItem(BACKUP_KEY) ?? 0);
  return Date.now() - last > REMIND_AFTER_DAYS * 86_400_000;
}

async function exportCsv(sessionId?: string): Promise<void> {
  const sets = sessionId ? allSets.filter((s) => s.sessionId === sessionId) : allSets;
  if (!sets.length) return showToast('Nothing logged yet.');
  const name = sessionId
    ? `lift-log-${allSessions.find((s) => s.id === sessionId)?.date ?? stamp()}.csv`
    : `lift-log-all-${stamp()}.csv`;
  const r = await shareFile(name, toCsv(sets, allSessions), 'text/csv');
  if (r === 'downloaded') showToast(`Saved ${name}`);
}

async function exportBackup(): Promise<void> {
  const backup = makeBackup({ workouts: await db.getWorkouts(), sessions: allSessions, sets: allSets, aliases: await db.getAliases() });
  const r = await shareFile(`lift-log-backup-${stamp()}.json`, JSON.stringify(backup), 'application/json');
  if (r !== 'cancelled') {
    localStorage.setItem(BACKUP_KEY, String(Date.now()));
    showToast('Backup created. Keep it somewhere safe, like iCloud Drive.');
    draw();
  }
}

async function restoreFrom(file: File): Promise<void> {
  try {
    const backup = readBackup(await file.text());
    const existing = { workouts: await db.getWorkouts(), sessions: allSessions, sets: allSets, aliases: await db.getAliases() };
    const add = restorePlan(backup, existing);
    const total = add.sets.length + add.sessions.length + add.workouts.length + add.aliases.length;
    if (!total) return showToast('Everything in that backup is already on this phone.');
    const msg = `Add from backup?\n\n${add.sessions.length} workouts logged, ${add.sets.length} sets, ${add.workouts.length} plans, ${add.aliases.length} nicknames.\n\nNothing on this phone will be overwritten or deleted.`;
    if (!confirm(msg)) return;
    await db.bulkAdd(add);
    await store.init();
    await renderHistory();
    showToast(`Restored ${add.sets.length} sets.`);
  } catch (e) {
    showToast((e as Error).message);
  }
}

async function copyText(session: Session): Promise<void> {
  try {
    await navigator.clipboard.writeText(sessionText(session, allSets));
    haptic();
    showToast('Copied — paste it into ChatGPT or Claude.');
  } catch {
    showToast("Couldn't copy. Try again.");
  }
}

async function deleteSession(session: Session, count: number): Promise<void> {
  if (!confirm(`Delete ${session.workoutName} on ${fmtDate(session.date)}?\n\nThis removes all ${count} sets and can't be undone (unless you have a backup).`)) return;
  await db.deleteSession(session.id);
  if (state.session?.id === session.id) await store.finishSession();
  await store.init();
  await renderHistory();
  showToast('Workout deleted.');
}

function draw(): void {
  const sessions = sessionsWithSets(allSessions, allSets);
  const totalSets = allSets.length;

  mount(
    $('view-history'),
    backupDue()
      ? h('div', { class: 'panel banner' },
          h('div', null, h('b', null, 'Time for a backup'), h('div', { class: 'muted small' }, 'Your data only lives on this phone. A backup file keeps it safe.')),
          h('button', { class: 'btn primary small', type: 'button', onclick: () => void exportBackup() }, 'Back up'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { localStorage.setItem(REMIND_KEY, 'off'); draw(); } }, 'Don’t remind'))
      : null,

    h('section', { class: 'panel' },
      h('h2', null, 'Your data'),
      h('p', { class: 'muted' }, `${sessions.length} workouts · ${totalSets} sets logged`),
      h('div', { class: 'grid2' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => void exportCsv() }, 'Export CSV'),
        h('button', { class: 'btn', type: 'button', onclick: () => void exportBackup() }, 'Back up'),
        h('label', { class: 'btn file-btn' }, 'Restore backup', h('input', {
          type: 'file', accept: '.json,application/json',
          onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void restoreFrom(f); },
        })),
        h('button', { class: 'btn', type: 'button', onclick: () => store.setTab('progress') }, 'See progress'),
      ),
      h('p', { class: 'muted small' },
        'CSV opens in Excel or Google Sheets (one row per set). ',
        localStorage.getItem(BACKUP_KEY) ? `Last backup: ${new Date(Number(localStorage.getItem(BACKUP_KEY))).toLocaleDateString()}.` : 'No backup yet.'),
    ),

    sessions.length === 0
      ? h('p', { class: 'empty' }, 'No workouts logged yet. They’ll show up here.')
      : sessions.map((session) => sessionCard(session)),
  );
}

function sessionCard(session: Session) {
  const groups = groupSession(allSets, session.id);
  const count = groups.reduce((n, g) => n + g.sets.length, 0);
  const isOpen = open.has(session.id);
  const live = state.session?.id === session.id;

  return h(
    'section',
    { class: 'panel session' },
    h('button', {
      class: 'session-head', type: 'button',
      onclick: () => { isOpen ? open.delete(session.id) : open.add(session.id); draw(); },
    },
      h('div', null,
        h('div', { class: 'session-date' }, fmtDate(session.date), live ? h('span', { class: 'live-badge' }, 'today') : null),
        h('div', { class: 'muted small' }, `${session.workoutName} · ${groups.length} exercises · ${count} sets`)),
      h('span', { class: 'chev' }, isOpen ? '▴' : '▾'),
    ),
    isOpen
      ? h('div', null,
          groups.map((g) =>
            h('div', { class: 'session-ex' },
              h('div', { class: 'session-ex-name' }, g.exercise),
              h('div', { class: 'chips' }, g.sets.map((s, i) =>
                h('button', { class: 'chip', type: 'button', onclick: () => editSet(s) }, h('b', null, `${i + 1}`), ` ${formatSet(s)}`))),
            )),
          h('div', { class: 'row session-actions' },
            h('button', { class: 'btn small', type: 'button', onclick: () => void copyText(session) }, 'Copy as text'),
            h('button', { class: 'btn small', type: 'button', onclick: () => void exportCsv(session.id) }, 'CSV'),
            h('button', { class: 'btn small danger', type: 'button', onclick: () => void deleteSession(session, count) }, 'Delete'),
          ),
        )
      : null,
  );
}
