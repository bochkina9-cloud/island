import { Noise2D } from '../core/noise';
import { hashString, makeRng } from '../core/rng';
import { RAFT_CARGO, type ResourceKind } from './data';
import { CHEST_SIZE, type Entity, type GameState, INVENTORY_SIZE, SAVE_VERSION, type WorldSettings, encodeBytes } from './state';

/** Size of the archipelago map in world units (1 unit ≈ 1 metre). */
export const MAP_SIZE = 256;

export type Biome = 'deep' | 'shallow' | 'sand' | 'grass' | 'forest' | 'rock';
export type IslandKind = 'home' | 'forest' | 'rocky';

export interface Island {
  kind: IslandKind;
  name: string;
  x: number;
  z: number;
  r: number;
}

export const ISLAND_NAMES: Record<IslandKind, string> = {
  home: 'Бухта спасения',
  forest: 'Лесной остров',
  rocky: 'Скалистый остров',
};

/** Height of land; the shoreline is at 0, below is water. */
export const SHORE = 0;
const SAND_TOP = 0.07;

/**
 * The terrain is a pure function of the seed, so it is never saved:
 * loading regenerates it and only entities (what the player changed) come from the save.
 */
export class Terrain {
  readonly seed: number;
  readonly islands: Island[];
  private elevation: Noise2D;
  private forestNoise: Noise2D;
  private rockNoise: Noise2D;
  /** Ponds are fresh water inside islands. */
  readonly ponds: { x: number; z: number; r: number }[] = [];
  private heightCache: Float32Array;
  readonly res = 4; // samples per unit in the cache
  /** The hand-laid starting bay: where the hero stands, with the beach to the west. */
  readonly bay: { x: number; z: number };

  constructor(seedText: string) {
    this.seed = hashString(seedText);
    this.elevation = new Noise2D(this.seed);
    this.forestNoise = new Noise2D(this.seed ^ 0x9e3779b9);
    this.rockNoise = new Noise2D(this.seed ^ 0x85ebca6b);
    this.islands = placeIslands(this.seed);
    const n = MAP_SIZE * this.res;
    this.heightCache = new Float32Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        this.heightCache[j * n + i] = this.rawHeight(i / this.res, j / this.res);
      }
    }
    this.bay = this.sculptBay();
    this.placePonds();
  }

  /**
   * Reshapes the west coast of the home island into the bay from the reference picture:
   * sea along the left, a sandy beach, then a grass meadow rising gently to the right.
   * The rest of the island stays as the seed made it; the bay blends into it.
   */
  private sculptBay(): { x: number; z: number } {
    const home = this.home;
    const rng = makeRng(this.seed ^ 0x6a09e667);
    const bz = home.z + (rng() - 0.5) * home.r * 0.3;
    // The natural waterline on that row, scanning from the centre westwards.
    let coast = home.x - home.r;
    for (let x = home.x; x > home.x - home.r * 1.6; x -= 0.5) {
      if (this.rawHeight(x, bz) < SHORE) {
        coast = x;
        break;
      }
    }
    const bx = Math.max(home.x - home.r * 0.9, coast) + 6;
    const n = MAP_SIZE * this.res;
    const phase = rng() * 6.28;
    for (let j = Math.floor((bz - 24) * this.res); j <= Math.ceil((bz + 24) * this.res); j++) {
      for (let i = Math.floor((bx - 26) * this.res); i <= Math.ceil((bx + 22) * this.res); i++) {
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const u = i / this.res - bx;
        const v = j / this.res - bz;
        // How much of the designed shape applies: all of it in the middle, fading out at the edges.
        const wv = 1 - smoothstep(12, 22, Math.abs(v));
        const wu = 1 - smoothstep(10, 20, u);
        const w = wv * wu;
        if (w <= 0) continue;
        // Waterline wanders a little; further out at the top where the shore rocks are.
        // As in the picture: the water comes within ~3.5 m of the hero, the coast turns away
        // to the upper left, and the beach widens towards the bottom of the screen.
        const sx = -3.6 + Math.sin(v * 0.22 + phase) * 0.6 + Math.sin(v * 0.57 + phase * 2) * 0.3 - Math.max(0, -v - 4) * 0.35 - Math.max(0, v - 3) * 0.3;
        const sand = 2.2 + Math.max(0, v - 2) * 0.22;
        const d = u - sx; // metres inland from the waterline
        let target: number;
        if (d < 0) target = Math.max(-0.6, d * 0.05 - 0.01);
        else if (d < sand) target = (d / sand) * 0.072;
        else target = 0.075 + (d - sand) * 0.008;
        target += this.elevation.noise(u * 0.3 + 40, v * 0.3) * 0.008;
        const k = j * n + i;
        // Out at sea the shape only ever deepens the water, so no land appears from nowhere.
        const raw = this.heightCache[k];
        const t = d < 0 && raw < target ? raw : target;
        this.heightCache[k] = raw + (t - raw) * w;
      }
    }
    return { x: bx, z: bz };
  }

  private rawHeight(x: number, z: number): number {
    let best = -1;
    for (const is of this.islands) {
      const d = Math.hypot(x - is.x, z - is.z) / is.r;
      if (d > 1.6) continue;
      const bias = is.kind === 'rocky' ? 0.12 : 0;
      const v = 1 - d * 1.25 + bias;
      if (v > best) best = v;
    }
    if (best <= -1) return -1;
    const n = this.elevation.fbm(x * 0.035, z * 0.035, 5) * 0.5;
    return best + n - 0.28;
  }

  /** Smooth height at any point (bilinear over the cache). */
  height(x: number, z: number): number {
    if (x < 0 || z < 0 || x > MAP_SIZE || z > MAP_SIZE) return -1;
    const n = MAP_SIZE * this.res;
    const fx = Math.min(n - 1.001, x * this.res);
    const fz = Math.min(n - 1.001, z * this.res);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const h = this.heightCache;
    const a = h[j * n + i];
    const b = h[j * n + i + 1];
    const c = h[(j + 1) * n + i];
    const d = h[(j + 1) * n + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  /** The island whose area this point belongs to. */
  islandAt(x: number, z: number): Island {
    let best = this.islands[0];
    let bestV = -Infinity;
    for (const is of this.islands) {
      const v = 1 - Math.hypot(x - is.x, z - is.z) / is.r;
      if (v > bestV) {
        bestV = v;
        best = is;
      }
    }
    return best;
  }

  inPond(x: number, z: number): boolean {
    return this.ponds.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < p.r * p.r);
  }

  biome(x: number, z: number): Biome {
    const h = this.height(x, z);
    if (h < SHORE - 0.12) return 'deep';
    if (h < SHORE) return 'shallow';
    if (h < SAND_TOP) return 'sand';
    const kind = this.islandAt(x, z).kind;
    const rock = this.rockNoise.fbm(x * 0.05, z * 0.05, 3);
    const forest = this.forestNoise.fbm(x * 0.04, z * 0.04, 3);
    if (kind === 'rocky') {
      if (h > 0.12 && rock > -0.3) return 'rock';
      return forest > 0.25 ? 'forest' : 'grass';
    }
    if (kind === 'forest') {
      if (h > 0.6 && rock > 0.2) return 'rock';
      return h > 0.09 && forest > -0.25 ? 'forest' : 'grass';
    }
    if (h > 0.5 || (h > 0.2 && rock > 0.3)) return 'rock';
    if (h > 0.12 && forest > 0.08) return 'forest';
    return 'grass';
  }

  /** Dry land a person can stand on. */
  walkable(x: number, z: number): boolean {
    return this.height(x, z) >= SHORE + 0.005 && !this.inPond(x, z);
  }

  /** Open sea a raft can float on. */
  sailable(x: number, z: number): boolean {
    return x > 2 && z > 2 && x < MAP_SIZE - 2 && z < MAP_SIZE - 2 && this.height(x, z) < SHORE - 0.01;
  }

  private placePonds() {
    const rng = makeRng(this.seed ^ 0x51ed27);
    const wanted: Record<IslandKind, number> = { home: 2, forest: 1, rocky: 0 };
    for (const is of this.islands) {
      let placed = 0;
      for (let attempt = 0; attempt < 400 && placed < wanted[is.kind]; attempt++) {
        const a = rng() * Math.PI * 2;
        const r = rng() * is.r * 0.6;
        const x = is.x + Math.cos(a) * r;
        const z = is.z + Math.sin(a) * r;
        const b = this.biome(x, z);
        if ((b === 'grass' || b === 'forest') && this.height(x, z) > 0.18 && this.islandAt(x, z) === is) {
          const nearBay = this.bay && Math.hypot(x - this.bay.x, z - this.bay.z) < 18;
          if (!nearBay && this.ponds.every((p) => (p.x - x) ** 2 + (p.z - z) ** 2 > 22 * 22)) {
            this.ponds.push({ x, z, r: 1.6 + rng() * 1.2 });
            placed++;
          }
        }
      }
    }
  }

  get home(): Island {
    return this.islands.find((i) => i.kind === 'home')!;
  }

  /**
   * A walkable grassy spot near the western beach of the home island, so the sea is on the
   * left of the screen like in the reference picture.
   */
  findSpawn(): { x: number; z: number } {
    return { ...this.bay };
  }

  /** x of the waterline west of a point (within 14 m), or null if there is no sea there. */
  shoreWest(x: number, z: number): number | null {
    for (let d = 0; d < 14; d += 0.25) {
      if (this.sailable(x - d, z)) return x - d + 0.25;
    }
    return null;
  }
}

/** Home island in the south, forest and rocky islands across the sea to the north-east and north-west. */
function placeIslands(seed: number): Island[] {
  const rng = makeRng(seed ^ 0x2545f491);
  const j = (k: number) => (rng() - 0.5) * 2 * k;
  const c = MAP_SIZE / 2;
  const flip = rng() < 0.5 ? 1 : -1; // which side the forest island is on
  return [
    { kind: 'home', name: ISLAND_NAMES.home, x: c + j(8), z: c + 48 + j(6), r: 40 },
    { kind: 'forest', name: ISLAND_NAMES.forest, x: c + flip * (66 + j(6)), z: c - 52 + j(8), r: 36 },
    { kind: 'rocky', name: ISLAND_NAMES.rocky, x: c - flip * (64 + j(6)), z: c - 46 + j(8), r: 30 },
  ];
}

type Table = Partial<Record<Biome, [ResourceKind, number][]>>;

const TABLES: Record<IslandKind, Table> = {
  home: {
    sand: [['palm', 0.07], ['driftwood', 0.025], ['flint_ground', 0.02], ['coconut_ground', 0.015]],
    grass: [['grass_tuft', 0.12], ['sapling', 0.07], ['berry_bush', 0.04], ['palm', 0.03], ['tree', 0.03], ['flint_ground', 0.015], ['boulder', 0.008]],
    forest: [['tree', 0.17], ['palm', 0.05], ['sapling', 0.08], ['grass_tuft', 0.06], ['berry_bush', 0.04]],
    rock: [['boulder', 0.1], ['flint_ground', 0.05]],
  },
  forest: {
    sand: [['palm', 0.05], ['driftwood', 0.03], ['coconut_ground', 0.01]],
    grass: [['grass_tuft', 0.1], ['sapling', 0.06], ['berry_bush', 0.07], ['tree', 0.06], ['vines', 0.02]],
    forest: [['tree', 0.19], ['vines', 0.05], ['berry_bush', 0.05], ['sapling', 0.05], ['grass_tuft', 0.03]],
    rock: [['boulder', 0.1], ['flint_ground', 0.03]],
  },
  rocky: {
    sand: [['driftwood', 0.03], ['flint_ground', 0.04], ['nest', 0.02]],
    grass: [['grass_tuft', 0.08], ['sapling', 0.04], ['nest', 0.02], ['berry_bush', 0.01]],
    forest: [['tree', 0.12], ['sapling', 0.04]],
    rock: [['boulder', 0.06], ['flint_ground', 0.05], ['nest', 0.025], ['grass_tuft', 0.02]],
  },
};

export const BOARS: Record<IslandKind, number> = { home: 2, forest: 4, rocky: 0 };

/** Builds a fresh world: terrain is implied by the seed, entities are generated here. */
export function createWorld(settings: WorldSettings, opts: { camp?: boolean } = {}): { state: GameState; terrain: Terrain } {
  const terrain = new Terrain(settings.seedText);
  const rng = makeRng(terrain.seed ^ 0xabcdef);
  const entities: Entity[] = [];
  let nextId = 1;
  const add = (e: Omit<Entity, 'id'>) => entities.push({ id: nextId++, ...e });
  const spawn = terrain.findSpawn();

  const step = 1.5;
  for (let z = 2; z < MAP_SIZE - 2; z += step) {
    for (let x = 2; x < MAP_SIZE - 2; x += step) {
      const px = x + (rng() - 0.5) * step;
      const pz = z + (rng() - 0.5) * step;
      const r = rng();
      const v = Math.floor(rng() * 3);
      const b = terrain.biome(px, pz);
      if (b === 'deep' || b === 'shallow' || terrain.inPond(px, pz)) continue;
      // Keep the starting clearing open.
      if ((px - spawn.x) ** 2 + (pz - spawn.z) ** 2 < 9) continue;
      if (terrain.ponds.some((p) => (p.x - px) ** 2 + (p.z - pz) ** 2 < (p.r + 1) ** 2)) continue;
      const table = TABLES[terrain.islandAt(px, pz).kind][b] ?? [];
      let acc = 0;
      for (const [kind, p] of table) {
        acc += p;
        if (r < acc) {
          add({ kind, x: px, z: pz, v });
          break;
        }
      }
    }
  }
  if (opts.camp !== false) buildCamp(terrain, spawn, entities, add);
  // Guarantee the first tools are reachable: flint and saplings near the start.
  for (const [kind, dx, dz] of [['flint_ground', 3, 1], ['flint_ground', -3.5, 2], ['sapling', 4, -3], ['grass_tuft', -4, -2], ['grass_tuft', 5, 3]] as const) {
    const p = { x: spawn.x + dx, z: spawn.z + dz };
    if (terrain.walkable(p.x, p.z)) add({ kind, ...p, v: 0 });
  }
  for (const p of terrain.ponds) add({ kind: 'pond', x: p.x, z: p.z });
  for (const is of terrain.islands) {
    for (let i = 0; i < BOARS[is.kind]; i++) {
      const p = randomSpot(terrain, rng, ['forest', 'grass'], spawn, 18, is);
      if (p) add({ kind: 'boar', ...p, hp: 60 });
    }
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
    // The first storm comes on day 3, so there is time to build a shelter.
    weather: { stormDay: 3, stormAt: 0.2 + rng() * 0.3, stormLength: 0.16, warned: false },
  };
  return { state, terrain };
}

/**
 * The castaway's camp from the reference picture: sea and a moored raft on the left, rocks along
 * the shore, a campfire, a canvas lean-to and a chest, cliffs behind. Positions are relative to the
 * spawn point and checked against the terrain.
 */
function buildCamp(terrain: Terrain, spawn: { x: number; z: number }, entities: Entity[], add: (e: Omit<Entity, 'id'>) => void) {
  // Clear generated clutter from the camp clearing.
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (Math.hypot(e.x - spawn.x, e.z - spawn.z) < 9 && e.kind !== 'pond') entities.splice(i, 1);
  }
  const placed: { x: number; z: number }[] = [spawn];
  const free = (x: number, z: number) => terrain.walkable(x, z) && terrain.height(x, z) > 0.03 && placed.every((q) => Math.hypot(q.x - x, q.z - z) > 1.6);
  // Wanted spot, or the nearest free dry spot within 3 m of it.
  const land = (dx: number, dz: number, e: Omit<Entity, 'id' | 'x' | 'z'>) => {
    for (let r = 0; r <= 3; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += r ? Math.PI / 8 : 7) {
        const x = spawn.x + dx + Math.cos(a) * r;
        const z = spawn.z + dz + Math.sin(a) * r;
        if (free(x, z)) {
          placed.push({ x, z });
          add({ ...e, x, z });
          return;
        }
      }
    }
  };
  const shore = (dz: number, inland: number, e: Omit<Entity, 'id' | 'x' | 'z'>) => {
    const z = spawn.z + dz;
    if (inland < 0) {
      // Afloat, just off the beach: the nearest open water to the wanted spot.
      for (let r = 0; r <= 4; r += 0.5) {
        for (const k of [0, 1, -1]) {
          const zz = z + k * r;
          const s2 = terrain.shoreWest(spawn.x + 4, zz);
          if (s2 === null) continue;
          for (let d = inland; d >= inland - 2; d -= 0.4) {
            if (terrain.sailable(s2 + d, zz) && terrain.sailable(s2 + d - 1.2, zz)) {
              add({ ...e, x: s2 + d, z: zz });
              return;
            }
          }
        }
      }
      return;
    }
    // Rocks sit right at the waterline: search along the shore for a free spot.
    for (let r = 0; r <= 3; r += 0.5) {
      for (const k of [0, 1, -1]) {
        const zz = z + k * r;
        const s2 = terrain.shoreWest(spawn.x + 4, zz);
        if (s2 === null) continue;
        const x = s2 + inland + 0.3;
        if (terrain.walkable(x, zz) && placed.every((q) => Math.hypot(q.x - x, q.z - zz) > 1.4)) {
          placed.push({ x, z: zz });
          add({ ...e, x, z: zz });
          return;
        }
      }
    }
  };
  land(2.6, -0.3, { kind: 'campfire', fuel: 150 });
  land(4.2, -3.4, { kind: 'shelter' });
  land(6.3, -2.2, { kind: 'chest', slots: new Array(CHEST_SIZE).fill(null) });
  land(7.6, -6.6, { kind: 'cliff', v: 0 });
  land(4.6, -7.6, { kind: 'cliff', v: 1 });
  land(5.6, 2.6, { kind: 'stones', v: 0 });
  land(1.4, 3.8, { kind: 'stones', v: 1 });
  shore(-6.5, 0.6, { kind: 'boulder', v: 0 });
  shore(-4.8, 1.6, { kind: 'boulder', v: 1 });
  shore(-7.4, 2.4, { kind: 'boulder', v: 2 });
  shore(-3.4, 0.4, { kind: 'stones', v: 2 });
  shore(2.2, -1.4, { kind: 'raft', slots: new Array(RAFT_CARGO).fill(null), hp: 100 });
}

export function randomSpot(
  terrain: Terrain,
  rng: () => number,
  biomes: Biome[],
  avoid?: { x: number; z: number },
  minDist = 0,
  island?: Island,
): { x: number; z: number } | null {
  for (let i = 0; i < 400; i++) {
    const x = island ? island.x + (rng() - 0.5) * island.r * 2 : 4 + rng() * (MAP_SIZE - 8);
    const z = island ? island.z + (rng() - 0.5) * island.r * 2 : 4 + rng() * (MAP_SIZE - 8);
    if (!biomes.includes(terrain.biome(x, z)) || !terrain.walkable(x, z)) continue;
    if (island && terrain.islandAt(x, z) !== island) continue;
    if (avoid && (avoid.x - x) ** 2 + (avoid.z - z) ** 2 < minDist * minDist) continue;
    return { x, z };
  }
  return null;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
