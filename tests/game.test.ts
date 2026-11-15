import { describe, expect, it } from 'vitest';
import { RECIPES } from '../src/game/data';
import { Game } from '../src/game/sim';
import { type WorldSettings, addItem, countItem, removeItem } from '../src/game/state';
import { MAP_SIZE, createWorld } from '../src/game/world';

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

  it('builds an island with everything needed to start', () => {
    for (const seedText of ['a', 'b', 'c', 'риф-5', 'лагуна-77']) {
      const { state, terrain } = createWorld({ ...settings, seedText });
      const kinds = new Set(state.entities.map((e) => e.kind));
      for (const k of ['palm', 'tree', 'sapling', 'grass_tuft', 'flint_ground', 'boulder', 'berry_bush', 'pond', 'boar']) {
        expect(kinds, `${seedText}: ${k}`).toContain(k);
      }
      expect(terrain.walkable(state.player.x, state.player.z)).toBe(true);
      // The island does not touch the map border.
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
    return new Game(state, terrain);
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
    game.actOn(sapling.id);
    run(game, 10);
    expect(countItem(p.inv, 'twigs')).toBe(2);
    expect(sapling.regrowOn).toBe(3);

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
