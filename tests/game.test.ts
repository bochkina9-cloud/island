import { describe, expect, it } from 'vitest';
import { RECIPES, seasonOf } from '../src/game/data';
import { Game } from '../src/game/sim';
import { type WorldSettings, addItem, countItem, removeItem } from '../src/game/state';
import { MAP_SIZE, createWorld } from '../src/game/world';
import { migrate } from '../src/game/save';

const settings: WorldSettings = { seedText: 'бухта-1234', deathMode: 'soft', difficulty: 'normal', goal: 'free' };
const still = { x: 0, z: 0 };

describe('world generation', () => {
  it('is deterministic for a seed', () => {
    const a = createWorld(settings).state;
    const b = createWorld(settings).state;
    expect(a.entities).toEqual(b.entities);
    expect(a.player.x).toBe(b.player.x);
    const c = createWorld({ ...settings, seedText: 'другое' }).state;
    expect(c.entities).not.toEqual(a.entities);
  });

  it('builds three separate islands, each with its own resources', () => {
    for (const seedText of ['a', 'b', 'c', 'риф-5', 'лагуна-77']) {
      const { state, terrain } = createWorld({ ...settings, seedText });
      const on = (kind: string) => new Set(state.entities.filter((e) => terrain.islandAt(e.x, e.z).kind === kind).map((e) => e.kind));
      const home = on('home');
      for (const k of ['palm', 'tree', 'sapling', 'grass_tuft', 'flint_ground', 'berry_bush', 'pond', 'boar']) {
        expect(home, `${seedText} home: ${k}`).toContain(k);
      }
      for (const k of ['tree', 'vines', 'berry_bush', 'pond', 'boar']) expect(on('forest'), `${seedText} forest: ${k}`).toContain(k);
      for (const k of ['boulder', 'flint_ground', 'nest']) expect(on('rocky'), `${seedText} rocky: ${k}`).toContain(k);
      expect(on('rocky')).not.toContain('pond');
      expect(terrain.islandAt(state.player.x, state.player.z).kind).toBe('home');
      expect(terrain.walkable(state.player.x, state.player.z)).toBe(true);
      // Islands are separated by sea: the straight line between centres crosses water.
      const [a, b] = [terrain.islands[0], terrain.islands[1]];
      let water = false;
      for (let t = 0; t <= 1; t += 0.02) water ||= terrain.sailable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
      expect(water).toBe(true);
      // The archipelago does not touch the map border.
      expect(terrain.walkable(1, 1)).toBe(false);
      expect(terrain.walkable(MAP_SIZE - 1, MAP_SIZE / 2)).toBe(false);
    }
  });
});

describe('inventory', () => {
  it('stacks, overflows and removes', () => {
    const inv = new Array(3).fill(null);
    expect(addItem(inv, 'wood', 25)).toBe(0);
    expect(inv[0]).toEqual({ item: 'wood', count: 20 });
    expect(inv[1]).toEqual({ item: 'wood', count: 5 });
    expect(addItem(inv, 'axe', 2)).toBe(1); // tools do not stack: one fits, one is left
    expect(inv[2]).toMatchObject({ item: 'axe', count: 1, durability: 60 });
    expect(removeItem(inv, 'wood', 30)).toBe(false);
    expect(countItem(inv, 'wood')).toBe(25);
    expect(removeItem(inv, 'wood', 22)).toBe(true);
    expect(countItem(inv, 'wood')).toBe(3);
  });
});

describe('gameplay', () => {
  function newGame() {
    const { state, terrain } = createWorld(settings);
    return new Game(state, terrain, 42);
  }

  /** Runs the game until the current task finishes. */
  function run(game: Game, seconds: number) {
    for (let t = 0; t < seconds; t += 0.05) game.update(0.05, still);
  }

  it('gathers by hand, crafts an axe and chops a tree', () => {
    const game = newGame();
    const p = game.state.player;
    const flint = game.state.entities.filter((e) => e.kind === 'flint_ground')
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    game.actOn(flint.id);
    run(game, 10);
    expect(countItem(p.inv, 'flint')).toBe(1);

    const sapling = game.state.entities.filter((e) => e.kind === 'sapling')
      .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    p.x = sapling.x + 1;
    p.z = sapling.z;
    game.actOn(sapling.id);
    run(game, 10);
    expect(countItem(p.inv, 'twigs')).toBe(2);
    expect(sapling.regrowOn).toBe(4); // 2 days × 1.5 in the dry season

    expect(game.craft(RECIPES.find((r) => r.id === 'axe')!)).toBe(true);
    expect(countItem(p.inv, 'axe')).toBe(1);

    // Teleport next to a tree and chop it down.
    const tree = game.state.entities.find((e) => e.kind === 'tree')!;
    p.x = tree.x + 1;
    p.z = tree.z;
    game.actOn(tree.id);
    run(game, 10);
    expect(countItem(p.inv, 'wood')).toBe(4);
    expect(tree.kind).toBe('stump');
    expect(p.hand?.item).toBe('axe');
    expect(p.hand?.durability).toBe(54);
  });

  it('hunger and thirst fall over a day and the day counter advances', () => {
    const game = newGame();
    game.state.entities = game.state.entities.filter((e) => e.kind !== 'boar');
    run(game, 480);
    expect(game.state.day).toBe(2);
    expect(game.state.player.thirst).toBeLessThan(10);
    expect(game.state.player.hunger).toBeLessThan(50);
  });

  it('builds a campfire that burns out and cooks meat', () => {
    const game = newGame();
    const p = game.state.player;
    addItem(p.inv, 'wood', 2);
    addItem(p.inv, 'grass', 3);
    addItem(p.inv, 'meat', 1);
    expect(game.place('campfire', p.x + 1.5, p.z)).toBe(true);
    const fire = game.state.entities.find((e) => e.kind === 'campfire')!;
    expect(game.lights().length).toBe(1);
    game.actOn(fire.id);
    run(game, 3);
    expect(countItem(p.inv, 'meat')).toBe(0);
    expect(countItem(p.inv, 'meat_cooked')).toBe(1);
    run(game, 100);
    expect(fire.fuel).toBe(0);
    expect(game.lights().length).toBe(0);
  });

  it('soft death keeps items on the ground and respawns at camp', () => {
    const game = newGame();
    const p = game.state.player;
    addItem(p.inv, 'flint', 3);
    const deathX = p.x + 2;
    p.x = deathX;
    p.hp = 0.01;
    p.hunger = 0;
    p.thirst = 0;
    run(game, 0.2);
    expect(game.dead).toBe(false);
    expect(p.x).toBe(p.spawnX);
    expect(countItem(p.inv, 'flint')).toBe(0);
    const drop = game.state.entities.find((e) => e.kind === 'drop' && e.item?.item === 'flint');
    expect(drop?.item?.count).toBe(3);
  });

  it('save and load restore the same world', () => {
    const game = newGame();
    addItem(game.state.player.inv, 'rope', 2);
    run(game, 5);
    const saved = JSON.parse(JSON.stringify(game.snapshot()));
    const loaded = new Game(saved);
    expect(loaded.state.player).toEqual(game.state.player);
    expect(loaded.state.entities).toEqual(game.state.entities);
    expect(loaded.terrain.height(40, 40)).toBe(game.terrain.height(40, 40));
    expect(loaded.explored).toEqual(game.explored);
  });
});

/** Breadth-first search over 2×2-unit sea cells from the player to water next to the given island. */
function seaRoute(game: Game, target: 'forest' | 'rocky'): { x: number; z: number }[] {
  const c = 2;
  const n = MAP_SIZE / c;
  const t = game.terrain;
  const sea = (i: number, j: number) => t.sailable(i * c + 1, j * c + 1);
  const goal = (i: number, j: number) => {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = (i + di) * c + 1;
      const z = (j + dj) * c + 1;
      if (t.walkable(x, z) && t.islandAt(x, z).kind === target) return true;
    }
    return false;
  };
  const start = [Math.floor(game.player.x / c), Math.floor(game.player.z / c)];
  const prev = new Int32Array(n * n).fill(-1);
  const queue = [start[1] * n + start[0]];
  prev[queue[0]] = queue[0];
  while (queue.length) {
    const cur = queue.shift()!;
    const i = cur % n;
    const j = Math.floor(cur / n);
    if (goal(i, j)) {
      const path: { x: number; z: number }[] = [];
      for (let k = cur; k !== prev[k]; k = prev[k]) path.unshift({ x: (k % n) * c + 1, z: Math.floor(k / n) * c + 1 });
      return path;
    }
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const k = nj * n + ni;
      if (prev[k] !== -1 || !sea(ni, nj)) continue;
      prev[k] = cur;
      queue.push(k);
    }
  }
  return [];
}

describe('vertical slice', () => {
  function newGame() {
    const { state, terrain } = createWorld(settings);
    return new Game(state, terrain, 42);
  }
  function run(game: Game, seconds: number, input = still) {
    for (let t = 0; t < seconds; t += 0.05) game.update(0.05, input);
  }
  /** A point on open water right next to the player's current shore. */
  function waterNear(game: Game) {
    const p = game.player;
    for (let r = 1; r < 40; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += 0.2) {
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (game.terrain.sailable(x, z)) {
          // Stand on the last dry point before the water.
          for (let k = r; k > 0; k -= 0.2) {
            const lx = p.x + Math.cos(a) * k;
            const lz = p.z + Math.sin(a) * k;
            if (game.terrain.walkable(lx, lz)) {
              p.x = lx;
              p.z = lz;
              return { x: x + Math.cos(a) * 0.5, z: z + Math.sin(a) * 0.5 };
            }
          }
        }
      }
    }
    throw new Error('no water');
  }

  it('sails to the forest island with cargo; saving keeps the raft', () => {
    const game = newGame();
    const p = game.state.player;
    addItem(p.inv, 'wood', 8);
    addItem(p.inv, 'rope', 4);
    addItem(p.inv, 'paddle', 1);
    const w = waterNear(game);
    expect(game.place('raft', w.x, w.z)).toBe(true);
    const raft = game.state.entities.find((e) => e.kind === 'raft')!;
    game.actOn(raft.id);
    run(game, 3);
    expect(p.onRaft).toBe(raft.id);

    // Plan a sea route on a coarse grid (going around the home island), then row along it.
    const arrived = () => {
      const spot = game.landingSpot();
      return !!spot && game.terrain.islandAt(spot.x, spot.z).kind === 'forest';
    };
    const route = seaRoute(game, 'forest');
    expect(route.length).toBeGreaterThan(0);
    for (const wp of route) {
      for (let t = 0; t < 20 && Math.hypot(wp.x - p.x, wp.z - p.z) > 0.8 && !arrived(); t += 0.05) {
        const d = Math.hypot(wp.x - p.x, wp.z - p.z);
        game.update(0.05, { x: (wp.x - p.x) / d, z: (wp.z - p.z) / d });
      }
      if (arrived()) break;
    }
    expect(arrived()).toBe(true);

    // Load cargo, save mid-trip and reload.
    addItem(raft.slots!, 'stone', 5);
    const loaded = new Game(JSON.parse(JSON.stringify(game.snapshot())));
    expect(loaded.player.onRaft).toBe(raft.id);
    expect(countItem(loaded.entity(raft.id)!.slots!, 'stone')).toBe(5);

    game.disembark();
    expect(p.onRaft).toBeUndefined();
    expect(game.terrain.walkable(p.x, p.z)).toBe(true);
    expect(game.terrain.islandAt(p.x, p.z).kind).toBe('forest');
  });

  it('every seed lets you sail from home to both other islands', () => {
    for (const seedText of ['a', 'b', 'риф-5', 'лагуна-77', 'бухта-1234']) {
      const { state, terrain } = createWorld({ ...settings, seedText });
      const game = new Game(state, terrain);
      waterNear(game);
      // Start the search from the water itself.
      const w = waterNear(game);
      game.player.x = w.x;
      game.player.z = w.z;
      expect(seaRoute(game, 'forest').length, seedText).toBeGreaterThan(0);
      expect(seaRoute(game, 'rocky').length, seedText).toBeGreaterThan(0);
    }
  });

  it('a storm warns, chills an unsheltered player and fills rain catchers', () => {
    const game = newGame();
    const s = game.state;
    s.day = 3;
    s.time = s.weather.stormAt - 0.06;
    const messages: string[] = [];
    game.on((e) => e.type === 'message' && messages.push(e.text));
    const p = s.player;
    addItem(p.inv, 'wood', 3);
    addItem(p.inv, 'grass', 4);
    addItem(p.inv, 'rope', 1);
    expect(game.place('rain_catcher', p.x + 2, p.z)).toBe(true);
    run(game, 0.08 * 480);
    expect(messages.some((m) => m.includes('шторм'))).toBe(true);
    expect(game.storm).toBeGreaterThan(0.5);
    const before = p.hp;
    p.hunger = 100;
    p.thirst = 100;
    run(game, 20);
    expect(p.hp).toBeLessThan(before);
    const catcher = s.entities.find((e) => e.kind === 'rain_catcher')!;
    expect(catcher.water).toBeGreaterThan(1);
    // After the storm the next one is scheduled a few days later.
    run(game, 0.25 * 480);
    expect(game.storm).toBeLessThan(0.1);
    expect(s.weather.stormDay).toBeGreaterThanOrEqual(5);
  });

  it('fishing from the shore catches fish; a flask holds three sips', () => {
    const game = newGame();
    const p = game.state.player;
    addItem(p.inv, 'fishing_rod', 1);
    game.useSlot(0);
    expect(p.hand?.item).toBe('fishing_rod');
    waterNear(game);
    let caught = 0;
    for (let i = 0; i < 10; i++) {
      expect(game.extraAction()).toBe('fish');
      game.actNearest();
      run(game, 9);
      caught = countItem(p.inv, 'fish');
    }
    expect(caught).toBeGreaterThan(3);

    addItem(p.inv, 'flask', 1);
    const flask = p.inv.find((s) => s?.item === 'flask')!;
    p.thirst = 10;
    const idx = p.inv.indexOf(flask);
    game.useSlot(idx);
    game.useSlot(idx);
    game.useSlot(idx);
    game.useSlot(idx);
    expect(flask.durability).toBe(0);
    expect(p.thirst).toBe(85);
  });

  it('the stone axe chops twice as fast', () => {
    const game = newGame();
    const p = game.state.player;
    addItem(p.inv, 'axe_stone', 1);
    const tree = game.state.entities.find((e) => e.kind === 'tree')!;
    p.x = tree.x + 1;
    p.z = tree.z;
    game.actOn(tree.id);
    run(game, 1.6);
    expect(tree.kind).toBe('stump');
  });

  it('migrates a 0.1 save into the archipelago keeping the inventory', () => {
    const old = createWorld(settings).state as unknown as Record<string, unknown> & { player: { inv: unknown[] } };
    old.version = 1;
    delete old.weather;
    old.player.inv[0] = { item: 'axe', count: 1, durability: 10 };
    old.day = 4;
    const state = migrate(old as never);
    expect(state.version).toBe(3);
    expect(state.day).toBe(4);
    expect(state.player.inv[0]).toEqual({ item: 'axe', count: 1, durability: 10 });
    expect(state.weather.stormDay).toBe(6);
  });
});

describe('seasons, spoilage, salt and fire', () => {
  function newGame() {
    const { state, terrain } = createWorld(settings);
    state.entities = state.entities.filter((e) => e.kind !== 'boar');
    return new Game(state, terrain, 7);
  }
  function run(game: Game, seconds: number) {
    for (let t = 0; t < seconds; t += 0.05) game.update(0.05, still);
  }
  /** Long waits with the survivor kept fed and watered. */
  function runFed(game: Game, seconds: number) {
    for (let t = 0; t < seconds; t += 1) {
      game.player.hunger = 100;
      game.player.thirst = 100;
      run(game, 1);
    }
  }

  it('seasons alternate every 7 days and change thirst', () => {
    expect([1, 7, 8, 14, 15].map(seasonOf)).toEqual(['dry', 'dry', 'rainy', 'rainy', 'dry']);
    const dry = newGame();
    const wet = newGame();
    wet.state.day = 8;
    run(dry, 60);
    run(wet, 60);
    expect(100 - dry.player.thirst).toBeGreaterThan((100 - wet.player.thirst) * 1.5);
  });

  it('merging stacks averages freshness', () => {
    const inv = new Array(2).fill(null);
    addItem(inv, 'berries', 2, undefined, 1);
    addItem(inv, 'berries', 2, undefined, 0.5);
    expect(inv[0].fresh).toBeCloseTo(0.75);
  });

  it('meat rots in two days, stale food feeds less, salted meat keeps', () => {
    const game = newGame();
    const p = game.player;
    addItem(p.inv, 'meat', 1);
    addItem(p.inv, 'jerky', 1);
    runFed(game, 480 * 1.2);
    const meat = p.inv.find((s) => s?.item === 'meat')!;
    expect(meat.fresh).toBeLessThan(0.5);
    p.hunger = 10;
    game.useSlot(p.inv.indexOf(meat));
    expect(p.hunger).toBeCloseTo(10 + 15 * 0.6, 0);
    addItem(p.inv, 'meat', 1);
    runFed(game, 480 * 2.1);
    expect(countItem(p.inv, 'meat')).toBe(0);
    expect(countItem(p.inv, 'rot')).toBe(1);
    expect(p.inv.find((s) => s?.item === 'jerky')!.fresh).toBeGreaterThan(0.85);
  });

  it('food in a chest spoils at half speed', () => {
    const game = newGame();
    const p = game.player;
    addItem(p.inv, 'wood', 4);
    addItem(p.inv, 'rope', 1);
    addItem(p.inv, 'fish', 1);
    expect(game.place('chest', p.x + 1.5, p.z)).toBe(true);
    const chest = game.state.entities.find((e) => e.kind === 'chest')!;
    game.chestPut(chest, p.inv.findIndex((s) => s?.item === 'fish'));
    addItem(p.inv, 'fish', 1);
    runFed(game, 480);
    const inChest = chest.slots!.find((s) => s?.item === 'fish')!;
    const inHand = p.inv.find((s) => s?.item === 'fish')!;
    expect(inChest.fresh!).toBeGreaterThan(inHand.fresh! + 0.2);
  });

  it('a salt pan on the beach makes salt in the dry season, salting needs it', () => {
    const game = newGame();
    const p = game.player;
    addItem(p.inv, 'stone', 4);
    addItem(p.inv, 'wood', 2);
    expect(game.place('salt_pan', p.x, p.z - 3)).toBe(false); // inland: no sea water
    // Find a beach spot by the sea.
    let placed = false;
    for (let r = 1; r < 40 && !placed; r += 0.5) {
      for (let a = 0; a < 6.28 && !placed; a += 0.2) {
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (game.terrain.walkable(x, z) && game.canPlace('salt_pan', x, z)) {
          placed = game.place('salt_pan', x, z);
        } else if (game.terrain.walkable(x, z)) {
          p.x = x;
          p.z = z;
        }
      }
    }
    expect(placed).toBe(true);
    const pan = game.state.entities.find((e) => e.kind === 'salt_pan')!;
    run(game, 240);
    expect(pan.salt).toBeGreaterThan(1.3);
    expect(game.craft(RECIPES.find((r) => r.id === 'jerky')!)).toBe(false);
  });

  it('dry grass near a campfire catches fire; a flask puts it out', () => {
    const game = newGame();
    const p = game.player;
    addItem(p.inv, 'wood', 2);
    addItem(p.inv, 'grass', 3);
    addItem(p.inv, 'flask', 1);
    // Surround a fire with grass.
    expect(game.place('campfire', p.x + 2, p.z)).toBe(true);
    const fire = game.state.entities.find((e) => e.kind === 'campfire')!;
    fire.fuel = 240;
    for (let i = 0; i < 6; i++) {
      game.state.entities.push({ id: 9000 + i, kind: 'grass_tuft', x: fire.x + Math.cos(i) * 1.5, z: fire.z + Math.sin(i) * 1.5 });
    }
    let burning: ReturnType<typeof game.entity>;
    for (let t = 0; t < 400 && !burning; t += 1) {
      run(game, 1);
      burning = game.state.entities.find((e) => (e.burn ?? 0) > 0);
    }
    expect(burning).toBeDefined();
    // Stand on the far side of the burning tuft, away from the fire.
    const dx = burning!.x - fire.x;
    const dz = burning!.z - fire.z;
    const d = Math.hypot(dx, dz);
    p.x = burning!.x + (dx / d) * 1.2;
    p.z = burning!.z + (dz / d) * 1.2;
    game.actOn(burning!.id);
    run(game, 1);
    expect(burning!.burn).toBe(0);
    expect(p.inv.find((s) => s?.item === 'flask')!.durability).toBe(2);
  });

  it('in the rainy season it rains often and the rain catcher fills', () => {
    const game = newGame();
    game.state.day = 8;
    const p = game.player;
    addItem(p.inv, 'wood', 3);
    addItem(p.inv, 'grass', 4);
    addItem(p.inv, 'rope', 1);
    expect(game.place('rain_catcher', p.x + 2, p.z)).toBe(true);
    let rained = false;
    for (let t = 0; t < 480; t += 1) {
      run(game, 1);
      rained ||= game.rain > 0.5;
    }
    expect(rained).toBe(true);
    expect(game.state.entities.find((e) => e.kind === 'rain_catcher')!.water).toBeGreaterThan(1);
  });
});
