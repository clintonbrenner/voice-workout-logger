/**
 * On-phone database (IndexedDB). Nothing ever leaves your phone.
 *
 * Stores:
 *   workouts  – your imported plans
 *   sessions  – each gym visit
 *   sets      – every logged set
 *   aliases   – exercise nicknames you've added
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { CustomAlias, LoggedSet, Session, Workout } from './models';
import { PRESET_WORKOUTS } from './data/presets';
import { newId } from './models';

interface LiftDB extends DBSchema {
  workouts: { key: string; value: Workout };
  sessions: { key: string; value: Session; indexes: { byDate: string } };
  sets: { key: string; value: LoggedSet; indexes: { bySession: string; byExercise: string; byCreated: number } };
  aliases: { key: string; value: CustomAlias };
}

let dbPromise: Promise<IDBPDatabase<LiftDB>> | null = null;

function db(): Promise<IDBPDatabase<LiftDB>> {
  dbPromise ??= openDB<LiftDB>('lift-log', 1, {
    upgrade(d) {
      d.createObjectStore('workouts', { keyPath: 'id' });
      const sessions = d.createObjectStore('sessions', { keyPath: 'id' });
      sessions.createIndex('byDate', 'date');
      const sets = d.createObjectStore('sets', { keyPath: 'id' });
      sets.createIndex('bySession', 'sessionId');
      sets.createIndex('byExercise', 'exercise');
      sets.createIndex('byCreated', 'createdAt');
      d.createObjectStore('aliases', { keyPath: 'alias' });
    },
  });
  return dbPromise;
}

/** Ask Safari not to clear our data when the phone is low on space. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

// ---------- Workouts ----------
export async function getWorkouts(): Promise<Workout[]> {
  const all = await (await db()).getAll('workouts');
  return all.sort((a, b) => a.createdAt - b.createdAt);
}
export async function saveWorkout(w: Workout): Promise<void> {
  await (await db()).put('workouts', w);
}
export async function deleteWorkout(id: string): Promise<void> {
  await (await db()).delete('workouts', id);
}
/** First launch: add the built-in workouts (your Arms day). */
export async function seedIfEmpty(): Promise<void> {
  const d = await db();
  if ((await d.count('workouts')) > 0) return;
  let t = Date.now();
  for (const p of PRESET_WORKOUTS) {
    await d.put('workouts', { id: newId(), name: p.name, exercises: p.exercises, createdAt: t++ });
  }
}

// ---------- Sessions ----------
export async function saveSession(s: Session): Promise<void> {
  await (await db()).put('sessions', s);
}
export async function getSessionsOn(date: string): Promise<Session[]> {
  return (await db()).getAllFromIndex('sessions', 'byDate', date);
}
export async function getAllSessions(): Promise<Session[]> {
  return (await db()).getAll('sessions');
}

// ---------- Sets ----------
export async function saveSet(s: LoggedSet): Promise<void> {
  await (await db()).put('sets', s);
}
export async function deleteSet(id: string): Promise<void> {
  await (await db()).delete('sets', id);
}
export async function getSetsForSession(sessionId: string): Promise<LoggedSet[]> {
  const sets = await (await db()).getAllFromIndex('sets', 'bySession', sessionId);
  return sets.sort((a, b) => a.createdAt - b.createdAt);
}
/** Most recent sets across all sessions, newest first. */
export async function getRecentSets(limit = 500): Promise<LoggedSet[]> {
  const d = await db();
  const out: LoggedSet[] = [];
  let cursor = await d.transaction('sets').store.index('byCreated').openCursor(null, 'prev');
  while (cursor && out.length < limit) {
    out.push(cursor.value);
    cursor = await cursor.continue();
  }
  return out;
}

export async function getAllSets(): Promise<LoggedSet[]> {
  return (await db()).getAll('sets');
}

/** Deletes a session and all its sets. */
export async function deleteSession(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['sessions', 'sets'], 'readwrite');
  const ids = await tx.objectStore('sets').index('bySession').getAllKeys(id);
  await Promise.all([...ids.map((k) => tx.objectStore('sets').delete(k)), tx.objectStore('sessions').delete(id)]);
  await tx.done;
}

/** Adds everything from a backup in one go. */
export async function bulkAdd(data: { workouts: Workout[]; sessions: Session[]; sets: LoggedSet[]; aliases: CustomAlias[] }): Promise<void> {
  const d = await db();
  const tx = d.transaction(['workouts', 'sessions', 'sets', 'aliases'], 'readwrite');
  await Promise.all([
    ...data.workouts.map((x) => tx.objectStore('workouts').put(x)),
    ...data.sessions.map((x) => tx.objectStore('sessions').put(x)),
    ...data.sets.map((x) => tx.objectStore('sets').put(x)),
    ...data.aliases.map((x) => tx.objectStore('aliases').put(x)),
  ]);
  await tx.done;
}

// ---------- Aliases ----------
export async function getAliases(): Promise<CustomAlias[]> {
  return (await db()).getAll('aliases');
}
export async function saveAlias(a: CustomAlias): Promise<void> {
  await (await db()).put('aliases', { alias: a.alias.trim().toLowerCase(), exercise: a.exercise });
}
export async function deleteAlias(alias: string): Promise<void> {
  await (await db()).delete('aliases', alias);
}
