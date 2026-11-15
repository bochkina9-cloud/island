import { Noise2D } from '../core/noise';
import { hashString, makeRng } from '../core/rng';
import type { ResourceKind } from './data';
import { type Entity, type GameState, INVENTORY_SIZE, SAVE_VERSION, type WorldSettings, encodeBytes } from './state';

/** Size of the island map in world units (1 unit ≈ 1 metre). */
export const MAP_SIZE = 128;

export type Biome = 'deep' | 'shallow' | 'sand' | 'grass' | 'forest' | 'rock';

/** Height of land; the shoreline is at 0, below is water. */
export const SHORE = 0;
const SAND_TOP = 0.07;

/**
 * The terrain is a pure function of the seed, so it is never saved:
 * loading regenerates it and only entities (what the player changed) come from the save.
 */
export class Terrain {
  readonly seed: number;
  private elevation: Noise2D;
  private forestNoise: Noise2D;
  private rockNoise: Noise2D;
  /** Pond centres; ponds are fresh water inside the island. */
  readonly ponds: { x: number; z: number; r: number }[] = [];
  private heightCache: Float32Array;
  readonly res = 4; // samples per unit in the cache

  constructor(seedText: string) {
    this.seed = hashString(seedText);
    this.elevation = new Noise2D(this.seed);
    this.forestNoise = new Noise2D(this.seed ^ 0x9e3779b9);
    this.rockNoise = new Noise2D(this.seed ^ 0x85ebca6b);
    const n = MAP_SIZE * this.res;
    this.heightCache = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.heightCache[j * n + i] = this.rawHeight(i / this.res, j / this.res);
      }
    }
    this.placePonds();
  }

  private rawHeight(x: number, z: number): number {
    const nx = (x / MAP_SIZE - 0.5) * 2;
    const nz = (z / MAP_SIZE - 0.5) * 2;
    const d = Math.sqrt(nx * nx + nz * nz);
    const base = 1 - d * 1.35;
    const n = this.elevation.fbm(x * 0.03, z * 0.03, 5) * 0.55;
    return base + n - 0.2;
  }

  /** Smooth height at any point (bilinear over the cache). */
  height(x: number, z: number): number {
    const n = MAP_SIZE * this.res;
    const fx = Math.max(0, Math.min(n - 1.001, x * this.res));
    const fz = Math.max(0, Math.min(n - 1.001, z * this.res));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heightCache;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    let v = a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
    if (x < 0 || z < 0 || x > MAP_SIZE || z > MAP_SIZE) v = -1;
    return v;
  }

  inPond(x: number, z: number): boolean {
    return this.ponds.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r);
  }

  biome(x: number, z: number): Biome {
    const h = this.height(x, z);
    if (h < SHORE - 0.12) return 'deep';
    if (h < SHORE) return 'shallow';
    if (h < SAND_TOP) return 'sand';
    if (h > 0.5 || (h > 0.2 && this.rockNoise.fbm(x * 0.05, z * 0.05, 3) > 0.3)) return 'rock';
    if (h > 0.12 && this.forestNoise.fbm(x * 0.04, z * 0.04, 3) > 0.08) return 'forest';
    return 'grass';
  }

  walkable(x: number, z: number): boolean {
    return this.height(x, z) >= SHORE + 0.005 && !this.inPond(x, z);
  }

  private placePonds() {
    const rng = makeRng(this.seed ^ 0x51ed27);
    for (let attempt = 0; attempt < 400 && this.ponds.length < 3; attempt++) {
      const x = 20 + rng() * (MAP_SIZE - 40);
      const z = 20 + rng() * (MAP_SIZE - 40);
      const b = this.biome(x, z);
      if ((b === 'grass' || b === 'forest') && this.height(x, z) > 0.18) {
        if (this.ponds.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > 30 * 30)) {
          this.ponds.push({ x, z, r: 1.6 + rng() * 1.2 });
        }
      }
    }
  }

  /** A walkable grassy spot near the southern beach, so the sea is in view at the start. */
  findSpawn(): { x: number; z: number } {
    let best = { x: MAP_SIZE / 2, z: MAP_SIZE / 2 };
    let bestScore = -Infinity;
    for (let z = MAP_SIZE * 0.5; z < MAP_SIZE - 4; z += 1) {
      for (let x = MAP_SIZE * 0.3; x < MAP_SIZE * 0.7; x += 1) {
        const h = this.height(x, z);
        if (h > 0.09 && h < 0.16 && this.biome(x, z) === 'grass') {
          const score = z - Math.abs(x - MAP_SIZE / 2) * 0.5;
          if (score > bestScore) {
            bestScore = score;
            best = { x, z };
          }
        }
      }
    }
    return best;
  }
}

/** Builds a fresh world: terrain is implied by the seed, entities are generated here. */
export function createWorld(settings: WorldSettings): { state: GameState; terrain: Terrain } {
  const terrain = new Terrain(settings.seedText);
  const rng = makeRng(terrain.seed ^ 0xabcdef);
  const entities: Entity[] = [];
  let nextId = 1;
  const add = (e: Omit<Entity, 'id'>) => entities.push({ id: nextId++, ...e });
  const spawn = terrain.findSpawn();

  const table: Record<Exclude<ReturnType<Terrain['biome']>, 'deep' | 'shallow'>, [ResourceKind | 'boar', number][]> = {
    sand: [['palm', 0.07], ['driftwood', 0.025], ['flint_ground', 0.02], ['coconut_ground', 0.015]],
    grass: [['grass_tuft', 0.12], ['sapling', 0.07], ['berry_bush', 0.045], ['palm', 0.03], ['tree', 0.03], ['flint_ground', 0.015], ['boulder', 0.01]],
    forest: [['tree', 0.26], ['palm', 0.06], ['sapling', 0.08], ['grass_tuft', 0.06], ['berry_bush', 0.04]],
    rock: [['boulder', 0.14], ['flint_ground', 0.05], ['sapling', 0.02]],
  };

  const step = 1.5;
  for (let z = 2; z < MAP_SIZE - 2; z += step) {
    for (let x = 2; x < MAP_SIZE - 2; x += step) {
      const px = x + (rng() - 0.5) * step;
      const pz = z + (rng() - 0.5) * step;
      const b = terrain.biome(px, pz);
      if (b === 'deep' || b === 'shallow' || terrain.inPond(px, pz)) continue;
      // Keep the starting clearing open.
      if ((px - spawn.x) ** 2 + (pz - spawn.z) ** 2 < 9) continue;
      if (terrain.ponds.some((p) => (p.x - px) ** 2 + (p.z - pz) ** 2 < (p.r + 1) ** 2)) continue;
      const r = rng();
      let acc = 0;
      for (const [kind, p] of table[b]) {
        acc += p;
        if (r < acc) {
          if (kind !== 'boar') add({ kind, x: px, z: pz, v: Math.floor(rng() * 3) });
          break;
        }
      }
    }
  }
  // Guarantee the first tools are reachable: flint and saplings near the start.
  const near = (dx: number, dz: number) => ({ x: spawn.x + dx, z: spawn.z + dz });
  for (const [kind, dx, dz] of [['flint_ground', 3, 1], ['flint_ground', -3.5, 2], ['sapling', 4, -3], ['grass_tuft', -4, -2], ['grass_tuft', 5, 3]] as const) {
    const p = near(dx, dz);
    if (terrain.walkable(p.x, p.z)) add({ kind, ...p, v: 0 });
  }
  for (const p of terrain.ponds) add({ kind: 'pond', x: p.x, z: p.z });
  for (let i = 0; i < 4; i++) {
    const p = randomSpot(terrain, rng, ['forest', 'grass'], spawn, 18);
    if (p) add({ kind: 'boar', ...p, hp: 60 });
  }

  const state: GameState = {
    version: SAVE_VERSION,
    settings,
    day: 1,
    time: 0.08,
    player: {
      x: spawn.x, z: spawn.z, hp: 100, hunger: 100, thirst: 100,
      hand: null, inv: new Array(INVENTORY_SIZE).fill(null), spawnX: spawn.x, spawnZ: spawn.z,
    },
    entities,
    nextId,
    explored: encodeBytes(new Uint8Array(MAP_SIZE * MAP_SIZE)),
    deaths: 0,
  };
  return { state, terrain };
}

export function randomSpot(
  terrain: Terrain,
  rng: () => number,
  biomes: ReturnType<Terrain['biome']>[],
  avoid?: { x: number; z: number },
  minDist = 0,
): { x: number; z: number } | null {
  for (let i = 0; i < 300; i++) {
    const x = 4 + rng() * (MAP_SIZE - 8);
    const z = 4 + rng() * (MAP_SIZE - 8);
    if (!biomes.includes(terrain.biome(x, z)) || !terrain.walkable(x, z)) continue;
    if (avoid && (avoid.x - x) ** 2 + (avoid.z - z) ** 2 < minDist * minDist) continue;
    return { x, z };
  }
  return null;
}
