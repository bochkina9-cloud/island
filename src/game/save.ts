import { type GameState, SAVE_VERSION } from './state';
import { createWorld } from './world';

const DB_NAME = 'island';
const STORE = 'saves';
export const SLOTS = [1, 2, 3];

export interface SaveRecord {
  slot: number;
  savedAt: number;
  state: GameState;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'slot' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    t.onerror = () => reject(t.error);
  });
}

export async function listSaves(): Promise<Map<number, SaveRecord>> {
  const all = await tx<SaveRecord[]>('readonly', (s) => s.getAll() as IDBRequest<SaveRecord[]>);
  return new Map(all.map((r) => [r.slot, r]));
}

export async function writeSave(slot: number, state: GameState): Promise<void> {
  await tx('readwrite', (s) => s.put({ slot, savedAt: Date.now(), state } satisfies SaveRecord));
}

export async function deleteSave(slot: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(slot));
}

/** Brings older saves up to date; throws for saves from a newer version of the game. */
export function migrate(state: GameState): GameState {
  if (!state || typeof state !== 'object' || !state.player || !Array.isArray(state.entities)) {
    throw new Error('Это не файл сохранения Island');
  }
  if (state.version > SAVE_VERSION) throw new Error('Сохранение сделано в более новой версии игры');
  if (state.version === 1) {
    // 0.1 had a single island; the archipelago is generated anew and the survivor keeps their things.
    const { state: fresh } = createWorld(state.settings);
    const p = fresh.player;
    p.inv = state.player.inv;
    p.hand = state.player.hand;
    p.hp = state.player.hp;
    p.hunger = state.player.hunger;
    p.thirst = state.player.thirst;
    fresh.day = state.day;
    fresh.time = state.time;
    fresh.deaths = state.deaths;
    fresh.weather.stormDay = state.day + 2;
    state = fresh;
  }
  return state;
}

export function exportSave(state: GameState) {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `island-день${state.day}-${state.settings.seedText}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function importSaveFile(): Promise<GameState> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return reject(new Error('Файл не выбран'));
      try {
        resolve(migrate(JSON.parse(await file.text())));
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    input.click();
  });
}
