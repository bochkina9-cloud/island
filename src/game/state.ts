import { type Difficulty, type EntityKind, type ItemId, ITEMS } from './data';

export const SAVE_VERSION = 2;
export const INVENTORY_SIZE = 12;
export const CHEST_SIZE = 9;

export interface Slot {
  item: ItemId;
  count: number;
  /** Remaining uses / burn seconds for tools. */
  durability?: number;
}

export type DeathMode = 'classic' | 'soft';
export type GoalMode = 'escape' | 'free';

export interface WorldSettings {
  seedText: string;
  deathMode: DeathMode;
  difficulty: Difficulty;
  goal: GoalMode;
}

export interface Entity {
  id: number;
  kind: EntityKind;
  x: number;
  z: number;
  /** Visual variant. */
  v?: number;
  /** Work done so far on a resource. */
  work?: number;
  /** Day when a harvested resource grows back. */
  regrowOn?: number;
  /** Campfire fuel seconds. */
  fuel?: number;
  /** Chest or raft cargo. */
  slots?: (Slot | null)[];
  /** Rain catcher: sips of water stored. */
  water?: number;
  /** Animals and drops. */
  hp?: number;
  item?: Slot;
}

export interface PlayerState {
  x: number;
  z: number;
  hp: number;
  hunger: number;
  thirst: number;
  hand: Slot | null;
  inv: (Slot | null)[];
  spawnX: number;
  spawnZ: number;
  /** Id of the raft the player is sailing, if any. */
  onRaft?: number;
}

export interface Weather {
  /** Day and time of day (0..1) when the next storm starts. */
  stormDay: number;
  stormAt: number;
  /** Length in fractions of a day. */
  stormLength: number;
  warned: boolean;
}

export interface GameState {
  version: number;
  settings: WorldSettings;
  /** Day number starting at 1 and time of day 0..1. */
  day: number;
  time: number;
  player: PlayerState;
  entities: Entity[];
  nextId: number;
  /** Explored map cells, base64 of a Uint8Array. */
  explored: string;
  deaths: number;
  weather: Weather;
}

// ---------- Inventory helpers (pure, tested) ----------

export function countItem(inv: (Slot | null)[], item: ItemId): number {
  return inv.reduce((n, s) => (s && s.item === item ? n + s.count : n), 0);
}

/** Adds items; returns how many did not fit. */
export function addItem(inv: (Slot | null)[], item: ItemId, count: number, durability?: number): number {
  const def = ITEMS[item];
  let left = count;
  if (def.stack > 1) {
    for (const s of inv) {
      if (left <= 0) break;
      if (s && s.item === item && s.count < def.stack) {
        const put = Math.min(def.stack - s.count, left);
        s.count += put;
        left -= put;
      }
    }
  }
  for (let i = 0; i < inv.length && left > 0; i++) {
    if (!inv[i]) {
      const put = Math.min(def.stack, left);
      inv[i] = { item, count: put, ...(def.durability ? { durability: durability ?? def.durability } : {}) };
      left -= put;
    }
  }
  return left;
}

/** Removes items if there are enough; returns false (and changes nothing) otherwise. */
export function removeItem(inv: (Slot | null)[], item: ItemId, count: number): boolean {
  if (countItem(inv, item) < count) return false;
  let left = count;
  for (let i = inv.length - 1; i >= 0 && left > 0; i--) {
    const s = inv[i];
    if (s && s.item === item) {
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count <= 0) inv[i] = null;
    }
  }
  return true;
}

export function hasAll(inv: (Slot | null)[], needs: Partial<Record<ItemId, number>>): boolean {
  return Object.entries(needs).every(([id, n]) => countItem(inv, id as ItemId) >= (n ?? 0));
}

// ---------- Explored map encoding ----------

export function encodeBytes(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function decodeBytes(text: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  if (!text) return out;
  const raw = atob(text);
  for (let i = 0; i < Math.min(raw.length, size); i++) out[i] = raw.charCodeAt(i);
  return out;
}
