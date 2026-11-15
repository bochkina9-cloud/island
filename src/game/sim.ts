import { makeRng } from '../core/rng';
import {
  CAMPFIRE_MAX_FUEL, DAY_LENGTH_SEC, DIFFICULTY, DUSK_START, ITEMS, type ItemId, NIGHT_START,
  BACKPACK_SLOTS, BOW_RANGE, CELLAR_SIZE, FLAMMABLE, STORAGE_SPOIL, isIngredient, potDish, RAFT_CARGO, RAFT_SPEED, RAIN_CATCHER_MAX, RECIPES, RESOURCES, type Recipe, type ResourceKind,
  SALT_PAN_MAX, SALT_PER_DAY, SEASONS, STRUCTURES, type Season, type StructureKind, seasonDaysLeft, seasonOf,
} from './data';
import {
  CHEST_SIZE, type Entity, type GameState, type Slot, addItem, decodeBytes, encodeBytes, freshness, hasAll, removeItem,
} from './state';
import { BOARS, MAP_SIZE, Terrain, randomSpot } from './world';

export interface MoveInput {
  /** -1..1 on each axis; x → east, z → south (screen down). */
  x: number;
  z: number;
}

export type GameEvent =
  | { type: 'message'; text: string }
  | { type: 'hit'; x: number; z: number }
  | { type: 'dawn'; day: number }
  | { type: 'death'; classic: boolean }
  | { type: 'entities' }
  | { type: 'storm'; active: boolean };

type Task = { kind: 'move'; x: number; z: number } | { kind: 'act'; id: number } | { kind: 'fish'; x: number; z: number };

export interface Projectile {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  t: number;
  dur: number;
}

interface BoarBrain {
  mode: 'wander' | 'chase' | 'flee';
  tx: number;
  tz: number;
  timer: number;
  attackCd: number;
  moving: boolean;
  facing: number;
  hurt: number;
}

export const PLAYER_SPEED = 4.2;
const PLAYER_RADIUS = 0.3;
const REACH = 1.0;

export class Game {
  readonly terrain: Terrain;
  readonly explored: Uint8Array;
  private task: Task | null = null;
  private actCd = 0;
  private exploreCd = 0;
  private rng: () => number;
  private brains = new Map<number, BoarBrain>();
  private listeners: ((e: GameEvent) => void)[] = [];
  /** For rendering. */
  facing = 1;
  moving = false;
  actionPulse = 0;
  hurtPulse = 0;
  dead = false;
  /** Seconds left until a fish bites; null when not fishing. */
  fishing: number | null = null;
  /** Where the float sits while fishing. */
  bobber: { x: number; z: number } | null = null;
  /** Arrows in flight, for rendering. */
  projectiles: Projectile[] = [];
  /** 0..1 strength of the current storm, for rendering. */
  storm = 0;
  /** 0..1 strength of rain (showers in the rainy season, or a storm). */
  rain = 0;
  /** Wind direction during storms (unit vector). */
  wind = { x: 1, z: 0 };
  private coldWarned = false;
  private slowTick = 0;

  /** [rngSeed] makes animal behaviour and random events repeatable (tests). */
  constructor(readonly state: GameState, terrain?: Terrain, rngSeed?: number) {
    this.terrain = terrain ?? new Terrain(state.settings.seedText);
    this.explored = decodeBytes(state.explored, MAP_SIZE * MAP_SIZE);
    this.rng = makeRng(rngSeed ?? (Date.now() ^ this.terrain.seed) >>> 0);
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: GameEvent) {
    for (const l of this.listeners) l(e);
  }

  private say(text: string) {
    this.emit({ type: 'message', text });
  }

  get diff() {
    return DIFFICULTY[this.state.settings.difficulty];
  }

  get player() {
    return this.state.player;
  }

  get season(): Season {
    return seasonOf(this.state.day);
  }

  /** 0 = lush rainy season, 1 = parched dry season; eases in over the first half day of a season. */
  get dryness(): number {
    const s = this.state;
    const into = ((s.day - 1) % 7) + s.time;
    const k = Math.min(1, into / 0.5);
    return this.season === 'dry' ? k : 1 - k;
  }

  /** 0 = full day light, 1 = deep night. */
  get phase(): 'day' | 'dusk' | 'night' {
    const t = this.state.time;
    if (t >= NIGHT_START) return 'night';
    if (t >= DUSK_START) return 'dusk';
    return 'day';
  }

  entity(id: number): Entity | undefined {
    return this.state.entities.find((e) => e.id === id);
  }

  /** Save-ready snapshot. */
  snapshot(): GameState {
    this.state.explored = encodeBytes(this.explored);
    return JSON.parse(JSON.stringify(this.state));
  }

  // ---------------- Main loop ----------------

  update(dt: number, input: MoveInput) {
    if (this.dead) return;
    dt = Math.min(dt, 0.1);
    this.advanceTime(dt);
    this.updateWeather(dt);
    this.updateStats(dt);
    this.updatePlayer(dt, input);
    this.updateRaft(dt);
    this.updateFishing(dt);
    this.updateFires(dt);
    this.updateBoars(dt);
    this.slowTick += dt;
    if (this.slowTick >= 1) {
      this.updateSpoilage(this.slowTick);
      this.updateWildfire(this.slowTick);
      this.updateSaltPans(this.slowTick);
      this.slowTick = 0;
    }
    this.actionPulse = Math.max(0, this.actionPulse - dt);
    for (const pr of this.projectiles) pr.t += dt;
    this.projectiles = this.projectiles.filter((pr) => pr.t < pr.dur);
    this.hurtPulse = Math.max(0, this.hurtPulse - dt);
    this.exploreCd -= dt;
    if (this.exploreCd <= 0) {
      this.exploreCd = 0.25;
      this.markExplored();
    }
  }

  private advanceTime(dt: number) {
    const s = this.state;
    s.time += dt / DAY_LENGTH_SEC;
    if (s.time >= 1) {
      s.time -= 1;
      s.day += 1;
      this.onDawn();
    }
  }

  private onDawn() {
    const s = this.state;
    for (const e of s.entities) {
      if (e.regrowOn !== undefined && e.regrowOn <= s.day) delete e.regrowOn;
    }
    // Keep the boar population steady on each island.
    for (const is of this.terrain.islands) {
      const boars = s.entities.filter((e) => e.kind === 'boar' && this.terrain.islandAt(e.x, e.z) === is).length;
      for (let i = boars; i < BOARS[is.kind]; i++) {
        const p = randomSpot(this.terrain, this.rng, ['forest', 'grass'], this.player, 25, is);
        if (p) this.spawn({ kind: 'boar', ...p, hp: 60 });
      }
    }
    this.emit({ type: 'entities' });
    this.emit({ type: 'dawn', day: s.day });
    if (seasonOf(s.day) !== seasonOf(s.day - 1)) {
      this.say(this.season === 'dry'
        ? 'Начался сухой сезон: дождей не будет, вода нужнее, трава у костра может загореться. Время варить соль.'
        : 'Начался сезон дождей: частые ливни и штормы, еда портится быстрее. Дождесборники наполнятся.');
    } else if (seasonDaysLeft(s.day) === 1) {
      this.say(`Завтра начнётся ${this.season === 'dry' ? 'сезон дождей' : 'сухой сезон'}`);
    } else {
      this.say(`Наступил день ${s.day}`);
    }
  }

  private updateStats(dt: number) {
    const p = this.player;
    const decay = this.diff.decay;
    p.hunger = Math.max(0, p.hunger - dt * 0.13 * decay);
    p.thirst = Math.max(0, p.thirst - dt * 0.2 * decay * SEASONS[this.season].thirst);
    let dh = 0;
    if (p.hunger <= 0) dh -= 0.6;
    if (p.thirst <= 0) dh -= 0.6;
    if (p.hunger > 60 && p.thirst > 60 && this.storm < 0.5) dh += 0.15;
    const cover = this.cover(p.x, p.z);
    if (this.storm > 0.5 && cover < 1 && p.onRaft === undefined) {
      dh -= 0.35 * this.diff.decay * (1 - cover);
      if (!this.coldWarned) {
        this.coldWarned = true;
        this.say('Вы промокли и мёрзнете: укройтесь в шалаше или у костра');
      }
    }
    p.hp = Math.min(100, p.hp + dh * dt);
    // Torch burns while in hand.
    if (p.hand?.item === 'torch') {
      p.hand.durability = (p.hand.durability ?? 0) - dt;
      if (p.hand.durability <= 0) {
        p.hand = null;
        this.say('Факел догорел');
      }
    }
    if (p.hp <= 0) this.die();
  }

  // ---------------- Player ----------------

  private updatePlayer(dt: number, input: MoveInput) {
    const p = this.player;
    let mx = input.x;
    let mz = input.z;
    if (mx !== 0 || mz !== 0) this.task = null;

    this.actCd = Math.max(0, this.actCd - dt);
    if (this.task?.kind === 'fish' && this.nearWater()) {
      this.task = null;
      if (p.hand?.item === 'fishing_rod') this.startFishing();
    }
    if (this.task) {
      const target = this.task.kind !== 'act' ? this.task : this.entity(this.task.id);
      if (!target) {
        this.task = null;
      } else {
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const dist = Math.hypot(dx, dz);
        const ent = target as Entity;
        const ranged = this.task.kind === 'act' && ent.kind === 'boar' && p.hand?.item === 'bow';
        const reach = this.task.kind !== 'act' ? 0.15 : ranged ? BOW_RANGE : REACH + this.radiusOf(ent);
        if (dist > reach) {
          mx = dx / dist;
          mz = dz / dist;
        } else if (this.task.kind !== 'act') {
          this.task = null;
        } else if (this.actCd <= 0) {
          this.facing = dx >= 0 ? 1 : -1;
          const keep = this.perform(target as Entity);
          if (!keep) this.task = null;
        }
      }
    }

    const len = Math.hypot(mx, mz);
    this.moving = len > 0.01;
    if (this.moving) {
      if (len > 1) {
        mx /= len;
        mz /= len;
      }
      if (Math.abs(mx) > 0.1) this.facing = mx > 0 ? 1 : -1;
      this.fishing = null;
      this.bobber = null;
      const step = (p.onRaft !== undefined ? RAFT_SPEED : PLAYER_SPEED) * dt;
      this.tryMove(p, mx * step, 0);
      this.tryMove(p, 0, mz * step);
    }
  }

  /** Where the player may be: dry land on foot, open water on a raft. */
  canStand(x: number, z: number): boolean {
    return this.player.onRaft !== undefined ? this.terrain.sailable(x, z) : this.terrain.walkable(x, z);
  }

  private tryMove(p: { x: number; z: number }, dx: number, dz: number) {
    const nx = p.x + dx;
    const nz = p.z + dz;
    if (!this.canStand(nx, nz)) return;
    if (this.player.onRaft !== undefined) {
      p.x = nx;
      p.z = nz;
      return;
    }
    for (const e of this.state.entities) {
      const r = this.solidRadius(e);
      if (!r) continue;
      const ddx = nx - e.x;
      const ddz = nz - e.z;
      const min = r + PLAYER_RADIUS;
      if (ddx * ddx + ddz * ddz < min * min) {
        // Allow moving away if already overlapping.
        const before = (p.x - e.x) ** 2 + (p.z - e.z) ** 2;
        if (ddx * ddx + ddz * ddz < before) return;
      }
    }
    p.x = nx;
    p.z = nz;
  }

  private solidRadius(e: Entity): number {
    if (e.kind in RESOURCES) {
      if (e.regrowOn !== undefined) return 0;
      return RESOURCES[e.kind as ResourceKind].solid ?? 0;
    }
    if (e.kind in STRUCTURES) return STRUCTURES[e.kind as StructureKind].solid;
    return 0;
  }

  radiusOf(e: Entity): number {
    if (e.kind === 'pond') return this.terrain.ponds.find((p) => p.x === e.x && p.z === e.z)?.r ?? 1.5;
    if (e.kind === 'boar') return 0.5;
    if (e.kind === 'raft') return 1.0;
    return Math.max(0.2, this.solidRadius(e));
  }

  /** Click on water with a rod: walk to the shore and cast. */
  fishAt(x: number, z: number) {
    if (this.player.hand?.item !== 'fishing_rod') return;
    if (this.nearWater()) return this.startFishing();
    this.task = { kind: 'fish', x, z };
  }

  /** Walks to a point (mouse click on the ground). */
  moveTo(x: number, z: number) {
    this.task = { kind: 'move', x, z };
  }

  /** Walks to an entity and does its main action. */
  actOn(id: number) {
    const e = this.entity(id);
    if (!e || !this.actionLabel(e)) return;
    this.task = { kind: 'act', id };
  }

  /** The entity the context action (E / Space) would use. */
  nearestInteractable(): Entity | null {
    const p = this.player;
    let best: Entity | null = null;
    let bestD = Infinity;
    for (const e of this.state.entities) {
      if (e.id === p.onRaft || !this.actionLabel(e)) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z) - this.radiusOf(e);
      const limit = e.kind === 'boar' ? (p.hand?.item === 'bow' && this.hasItem('arrow') ? BOW_RANGE : 2.5) : 2.2;
      if (d < limit && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Text for the context hint, or null when there is nothing to do with it. */
  actionLabel(e: Entity): string | null {
    if ((e.burn ?? 0) > 0) return this.flaskSips() > 0 ? 'Потушить водой из фляги' : 'Горит! Нужна вода во фляге';
    if (e.kind === 'boar') {
      if (this.player.hand?.item === 'bow') {
        const n = this.player.inv.reduce((k, s) => (s?.item === 'arrow' ? k + s.count : k), 0);
        return n > 0 ? `Выстрелить в кабана (стрел: ${n})` : 'Нет стрел: 2 ветки + кремень';
      }
      return 'Атаковать кабана';
    }
    if (e.kind === 'salt_pan') {
      const n = Math.floor(e.salt ?? 0);
      return n > 0 ? `Собрать соль (${n})` : this.season === 'dry' ? 'Солеварня: соль выпаривается' : 'Солеварня: в сезон дождей соли почти нет';
    }
    if (e.kind === 'drop' && e.item) return `Подобрать: ${ITEMS[e.item.item].name}`;
    if (e.kind === 'campfire') {
      const raw = this.player.inv.find((s) => s && ITEMS[s.item].cooksInto);
      if (raw && (e.fuel ?? 0) > 0) return `Приготовить: ${ITEMS[raw.item].name}`;
      const fuel = this.bestFuel();
      if (fuel) return `${(e.fuel ?? 0) > 0 ? 'Подбросить' : 'Разжечь'}: ${ITEMS[fuel.item].name} (или клик по топливу в слоте)`;
      return (e.fuel ?? 0) > 0 ? 'Костёр горит' : 'Костёр погас: нужно топливо';
    }
    if (e.kind === 'chest') return 'Открыть сундук';
    if (e.kind === 'cellar') return 'Открыть погреб';
    if (e.kind === 'hut') return 'Хижина: здесь вы появитесь';
    if (e.kind === 'raft') {
      if (this.player.onRaft === e.id) return 'Груз плота';
      return this.hasItem('paddle') ? 'Сесть на плот' : 'Плот: нужно весло, чтобы плыть';
    }
    if (e.kind === 'rain_catcher') {
      const w = Math.floor(e.water ?? 0);
      if (w <= 0) return 'Дождесборник пуст: вода наберётся в дождь';
      return this.hasItem('flask') ? `Наполнить флягу и попить (${w})` : `Попить из дождесборника (${w})`;
    }
    if (e.kind === 'shelter') return 'Шалаш: здесь вы появитесь';
    if (e.kind in RESOURCES) {
      const def = RESOURCES[e.kind as ResourceKind];
      if (e.regrowOn !== undefined) return null;
      if (e.kind === 'pond') return this.hasItem('flask') ? 'Попить и наполнить флягу' : 'Попить из пруда';
      return `${def.verb}: ${def.name}${def.tool && !this.hasTool(def.tool) ? ` (нужен ${def.tool === 'axe' ? 'топор' : 'кирка'})` : ''}`;
    }
    return null;
  }

  /** Context action without walking (E / Space). */
  actNearest() {
    // With a rod in hand by the water, E casts first: objects on the shore must not get in the way.
    if (this.player.hand?.item === 'fishing_rod' && this.extraAction() === 'fish') return this.startFishing();
    const e = this.nearestInteractable();
    if (e) return this.actOn(e.id);
    const extra = this.extraAction();
    if (extra === 'disembark') this.disembark();
    if (extra === 'fish') this.startFishing();
  }

  /** Actions that are not tied to an object: landing from a raft and fishing. */
  extraAction(): 'disembark' | 'fish' | null {
    if (this.player.onRaft !== undefined && this.landingSpot()) return 'disembark';
    if (this.player.hand?.item === 'fishing_rod' && this.nearWater() && this.fishing === null) return 'fish';
    return null;
  }

  extraLabel(): string | null {
    const a = this.extraAction();
    if (a === 'disembark') return 'Высадиться на берег';
    if (a === 'fish') return 'Закинуть удочку';
    if (this.fishing !== null) return 'Ждём поклёвку…';
    return null;
  }

  private hasItem(item: ItemId): boolean {
    const p = this.player;
    return p.hand?.item === item || p.inv.some((s) => s?.item === item);
  }

  private hasTool(tool: 'axe' | 'pickaxe'): boolean {
    const p = this.player;
    if (p.hand && ITEMS[p.hand.item].tool === tool) return true;
    return p.inv.some((s) => s && ITEMS[s.item].tool === tool);
  }

  /** Puts a tool of the given kind into the hand if one is in the inventory. */
  private equipTool(tool: 'axe' | 'pickaxe'): boolean {
    const p = this.player;
    if (p.hand && ITEMS[p.hand.item].tool === tool) return true;
    const i = p.inv.findIndex((s) => s && ITEMS[s.item].tool === tool);
    if (i < 0) return false;
    this.equip(i);
    return true;
  }

  /** Does one step of work. Returns true to keep going (more hits needed). */
  private perform(e: Entity): boolean {
    const p = this.player;
    if ((e.burn ?? 0) > 0) {
      if (!this.useFlaskSip()) {
        this.say('Нужна вода во фляге, чтобы потушить');
        return false;
      }
      e.burn = 0;
      this.actionPulse = 0.3;
      this.actCd = 0.5;
      this.say('Потушили');
      return false;
    }
    if (e.kind === 'boar') return this.attackBoar(e);
    if (e.kind === 'salt_pan') {
      const n = Math.floor(e.salt ?? 0);
      if (n > 0) {
        this.give('salt', n, e);
        e.salt = (e.salt ?? 0) - n;
        this.actionPulse = 0.3;
      }
      this.actCd = 0.5;
      return false;
    }
    if (e.kind === 'drop' && e.item) {
      const left = addItem(p.inv, e.item.item, e.item.count, e.item.durability);
      if (left === e.item.count) {
        this.say('Инвентарь полон');
      } else if (left > 0) {
        e.item.count = left;
      } else {
        this.removeEntity(e.id);
      }
      this.actCd = 0.25;
      return false;
    }
    if (e.kind === 'campfire') return this.useCampfire(e);
    if (e.kind === 'chest' || e.kind === 'cellar') {
      this.openChest?.(e);
      return false;
    }
    if (e.kind === 'hut') {
      p.spawnX = e.x;
      p.spawnZ = e.z + 1.8;
      this.say('Хижина — ваш дом. Здесь не страшен шторм, и после гибели в мягком режиме вы появитесь тут.');
      return false;
    }
    if (e.kind === 'raft') {
      if (p.onRaft === e.id) this.openChest?.(e);
      else this.board(e);
      return false;
    }
    if (e.kind === 'rain_catcher') {
      if ((e.water ?? 0) < 1) {
        this.say('Дождесборник пуст');
        return false;
      }
      p.thirst = Math.min(100, p.thirst + 25);
      e.water = (e.water ?? 0) - 1;
      e.water -= this.fillFlasks(Math.floor(e.water));
      this.actionPulse = 0.3;
      this.actCd = 0.6;
      return false;
    }
    if (e.kind === 'shelter') {
      p.spawnX = e.x;
      p.spawnZ = e.z + 1.2;
      this.say('Шалаш — ваш лагерь. После гибели в мягком режиме вы появитесь здесь.');
      return false;
    }
    if (!(e.kind in RESOURCES)) return false;
    const def = RESOURCES[e.kind as ResourceKind];
    if (e.regrowOn !== undefined) return false;

    if (e.kind === 'pond') {
      p.thirst = Math.min(100, p.thirst + 30);
      this.actionPulse = 0.3;
      this.actCd = 0.6;
      this.say(this.fillFlasks(99) > 0 ? 'Вы попили и наполнили флягу' : 'Вы попили пресной воды');
      return false;
    }
    if (def.tool && !this.equipTool(def.tool)) {
      this.say(def.tool === 'axe' ? 'Нужен топор: ветки + кремень' : 'Нужна кирка: 2 ветки + 2 кремня');
      return false;
    }
    this.actionPulse = 0.3;
    this.actCd = def.tool ? 0.5 : 0.45;
    this.emit({ type: 'hit', x: e.x, z: e.z });
    if (def.tool && p.hand) {
      p.hand.durability = (p.hand.durability ?? 1) - 1;
      if (p.hand.durability <= 0) {
        this.say(`${ITEMS[p.hand.item].name} сломался`);
        p.hand = null;
      }
    }
    e.work = (e.work ?? 0) + (def.tool && p.hand ? ITEMS[p.hand.item].power ?? 1 : 1);
    if (e.work < def.work) return true;

    e.work = 0;
    for (const [item, n] of Object.entries(def.yields)) this.give(item as ItemId, n ?? 0, e);
    if (def.bonus && this.rng() < def.bonus.chance) this.give(def.bonus.item, 1, e);
    if (def.regrowDays) {
      e.regrowOn = this.state.day + Math.max(1, Math.round(def.regrowDays * SEASONS[this.season].regrow));
    } else if (def.becomes) {
      e.kind = def.becomes;
    } else {
      this.removeEntity(e.id);
    }
    this.emit({ type: 'entities' });
    return false;
  }

  /** Puts items into the inventory; what does not fit falls on the ground. */
  private give(item: ItemId, count: number, at: { x: number; z: number }) {
    if (count <= 0) return;
    const left = addItem(this.player.inv, item, count);
    if (left > 0) {
      this.spawn({ kind: 'drop', x: at.x + (this.rng() - 0.5), z: at.z + 0.6, item: { item, count: left } });
      this.say('Инвентарь полон — часть упала на землю');
    }
  }

  private bestFuel(): Slot | null {
    const order: ItemId[] = ['grass', 'twigs', 'wood'];
    for (const id of order) {
      const s = this.player.inv.find((x) => x && x.item === id);
      if (s) return s;
    }
    return null;
  }

  private useCampfire(e: Entity): boolean {
    const p = this.player;
    const raw = p.inv.findIndex((s) => s && ITEMS[s.item].cooksInto);
    if (raw >= 0 && (e.fuel ?? 0) > 0) {
      const slot = p.inv[raw]!;
      const cooked = ITEMS[slot.item].cooksInto!;
      removeItem(p.inv, slot.item, 1);
      this.give(cooked, 1, e);
      this.actionPulse = 0.3;
      this.actCd = 0.8;
      this.say(`Готово: ${ITEMS[cooked].name}`);
      return false;
    }
    const fuel = this.bestFuel();
    if (!fuel) {
      this.say('Нужно топливо: трава, ветки или дерево');
      return false;
    }
    const amount = ITEMS[fuel.item].fuel ?? 0;
    removeItem(p.inv, fuel.item, 1);
    e.fuel = Math.min(CAMPFIRE_MAX_FUEL, (e.fuel ?? 0) + amount);
    this.actionPulse = 0.3;
    this.actCd = 0.4;
    return false;
  }

  /** Set by the UI to show the chest window. */
  openChest?: (e: Entity) => void;

  // ---------------- Inventory actions ----------------

  /** Removes one item from a specific slot. */
  private takeOne(index: number) {
    const s = this.player.inv[index];
    if (!s) return;
    s.count -= 1;
    if (s.count <= 0) this.player.inv[index] = null;
  }

  /** A campfire within arm's reach. */
  nearbyFire(): Entity | null {
    const p = this.player;
    return this.state.entities.find((e) => e.kind === 'campfire' && Math.hypot(e.x - p.x, e.z - p.z) < 2.6) ?? null;
  }

  /** Set by the UI to show the cooking pot window. */
  openPot?: () => void;

  /** Eat food, put fuel on a nearby fire, equip a tool, cook in the pot. */
  useSlot(index: number) {
    const p = this.player;
    const s = p.inv[index];
    if (!s) return;
    const def = ITEMS[s.item];
    const fire = this.nearbyFire();
    // Standing at a fire, a click on fuel throws exactly that fuel in.
    if (fire && def.fuel && !def.food) {
      fire.fuel = Math.min(CAMPFIRE_MAX_FUEL, (fire.fuel ?? 0) + def.fuel);
      this.takeOne(index);
      this.actionPulse = 0.3;
      this.say(`В костёр: ${def.name}`);
      return;
    }
    if (def.tool === 'pot') {
      if (!fire || (fire.fuel ?? 0) <= 0) {
        this.say('Котелок ставят на горящий костёр: подойдите к огню');
        return;
      }
      this.openPot?.();
      return;
    }
    if (def.tool === 'backpack') {
      if (p.backpack) return;
      p.backpack = true;
      p.inv[index] = null;
      for (let i = 0; i < BACKPACK_SLOTS; i++) p.inv.push(null);
      this.say(`Рюкзак надет: +${BACKPACK_SLOTS} мест`);
      return;
    }
    if (def.food) {
      const f = def.food;
      const band = def.spoilDays !== undefined ? freshness(s) : 'fresh';
      const k = band === 'fresh' ? 1 : band === 'stale' ? 0.6 : 0.4;
      const sick = band === 'spoiling' ? -4 : 0;
      p.hunger = Math.min(100, p.hunger + (f.hunger ?? 0) * k);
      p.thirst = Math.max(0, Math.min(100, p.thirst + (f.thirst ?? 0)));
      p.hp = Math.max(1, Math.min(100, p.hp + (f.health ?? 0) + sick));
      this.takeOne(index);
      this.actionPulse = 0.3;
      if (s.item === 'rot') this.say('Фу! Гниль есть нельзя');
      else if ((f.health ?? 0) < 0) this.say('Сырое вредно: живот болит');
      else if (band !== 'fresh') this.say('Еда несвежая: сытости меньше');
      return;
    }
    if (def.tool === 'flask') {
      if ((s.durability ?? 0) <= 0) {
        this.say('Фляга пуста: наполните у пруда или у дождесборника');
        return;
      }
      s.durability = (s.durability ?? 0) - 1;
      p.thirst = Math.min(100, p.thirst + 25);
      this.actionPulse = 0.3;
      return;
    }
    if (def.tool) this.equip(index);
  }

  private flaskSips(): number {
    return [this.player.hand, ...this.player.inv].reduce((n, s) => (s?.item === 'flask' ? n + (s.durability ?? 0) : n), 0);
  }

  private useFlaskSip(): boolean {
    const s = [this.player.hand, ...this.player.inv].find((x) => x?.item === 'flask' && (x.durability ?? 0) >= 1);
    if (!s) return false;
    s.durability = (s.durability ?? 0) - 1;
    return true;
  }

  /** Cooks three inventory items into one dish; the fire must be burning. */
  cook(indices: number[]): ItemId | null {
    const p = this.player;
    const fire = this.nearbyFire();
    if (!fire || (fire.fuel ?? 0) <= 0) {
      this.say('Костёр погас — варить не на чем');
      return null;
    }
    // Count how many items each slot gives, so a stack can be used several times.
    const use = new Map<number, number>();
    for (const i of indices) use.set(i, (use.get(i) ?? 0) + 1);
    if (indices.length !== 3) return null;
    for (const [i, n] of use) {
      const s = p.inv[i];
      if (!s || s.count < n || !isIngredient(s.item)) return null;
    }
    const dish = potDish(indices.map((i) => p.inv[i]!.item));
    for (const i of indices) this.takeOne(i);
    fire.fuel = Math.max(1, (fire.fuel ?? 0) - 10);
    this.give(dish, 1, p);
    this.actionPulse = 0.3;
    this.say(`Сварено: ${ITEMS[dish].name}`);
    return dish;
  }

  /** Tops up flasks in the inventory; returns how many sips were added. */
  private fillFlasks(available: number): number {
    let added = 0;
    for (const s of [this.player.hand, ...this.player.inv]) {
      if (s?.item !== 'flask' || added >= available) continue;
      const room = Math.min(3 - (s.durability ?? 0), available - added);
      s.durability = (s.durability ?? 0) + room;
      added += room;
    }
    return added;
  }

  equip(index: number) {
    const p = this.player;
    const s = p.inv[index];
    if (!s) return;
    p.inv[index] = p.hand;
    p.hand = s;
  }

  unequip() {
    const p = this.player;
    if (!p.hand) return;
    const i = p.inv.findIndex((s) => !s);
    if (i < 0) {
      this.say('Нет места в инвентаре');
      return;
    }
    p.inv[i] = p.hand;
    p.hand = null;
  }

  dropSlot(index: number) {
    const p = this.player;
    const s = p.inv[index];
    if (!s) return;
    p.inv[index] = null;
    this.spawn({ kind: 'drop', x: p.x + this.facing * 0.6, z: p.z + 0.3, item: s });
    this.emit({ type: 'entities' });
  }

  moveSlot(from: number, to: number) {
    const inv = this.player.inv;
    [inv[from], inv[to]] = [inv[to], inv[from]];
  }

  chestTake(chest: Entity, index: number) {
    const s = chest.slots?.[index];
    if (!s) return;
    const left = addItem(this.player.inv, s.item, s.count, s.durability);
    if (left === 0) chest.slots![index] = null;
    else s.count = left;
  }

  chestPut(chest: Entity, invIndex: number) {
    const s = this.player.inv[invIndex];
    if (!s || !chest.slots) return;
    const left = addItem(chest.slots, s.item, s.count, s.durability);
    if (left === 0) this.player.inv[invIndex] = null;
    else s.count = left;
  }

  // ---------------- Crafting ----------------

  canCraft(r: Recipe): boolean {
    return hasAll(this.player.inv, r.needs);
  }

  /** Crafts an item. Structures go through [canPlace]/[place]. */
  craft(r: Recipe): boolean {
    if (!('item' in r.makes) || !this.canCraft(r)) return false;
    for (const [id, n] of Object.entries(r.needs)) removeItem(this.player.inv, id as ItemId, n ?? 0);
    this.give(r.makes.item, r.makes.count ?? 1, this.player);
    this.say(`Сделано: ${r.name}`);
    return true;
  }

  canPlace(kind: StructureKind, x: number, z: number): boolean {
    if (this.player.onRaft !== undefined) return false;
    if (kind === 'raft') {
      // On water, right next to the shore, so you can step aboard.
      if (!this.terrain.sailable(x, z) || Math.hypot(x - this.player.x, z - this.player.z) > 4) return false;
      return this.state.entities.every((e) => e.kind !== 'raft' || Math.hypot(e.x - x, e.z - z) > 2.5);
    }
    if (!this.terrain.walkable(x, z)) return false;
    if (kind === 'salt_pan') {
      // Needs sea water at hand: on the beach, right by the sea.
      const nearSea = [0, 1, 2, 3, 4, 5, 6, 7].some((i) => this.terrain.sailable(x + Math.cos(i * 0.785) * 2.5, z + Math.sin(i * 0.785) * 2.5));
      if (!nearSea) return false;
    }
    const r = STRUCTURES[kind].solid;
    if (Math.hypot(x - this.player.x, z - this.player.z) > 6) return false;
    return this.state.entities.every((e) => {
      const er = e.kind === 'drop' || e.kind === 'boar' ? 0 : Math.max(this.solidRadius(e), e.kind === 'pond' ? this.radiusOf(e) : 0.3);
      return Math.hypot(e.x - x, e.z - z) > r + er;
    });
  }

  place(recipeId: string, x: number, z: number): boolean {
    const r = RECIPES.find((q) => q.id === recipeId);
    if (!r || !('structure' in r.makes)) return false;
    const kind = r.makes.structure;
    if (!this.canCraft(r) || !this.canPlace(kind, x, z)) return false;
    for (const [id, n] of Object.entries(r.needs)) removeItem(this.player.inv, id as ItemId, n ?? 0);
    const e = this.spawn({ kind, x, z });
    if (kind === 'campfire') e.fuel = 90;
    if (kind === 'chest') e.slots = new Array(CHEST_SIZE).fill(null);
    if (kind === 'raft') {
      e.slots = new Array(RAFT_CARGO).fill(null);
      e.hp = 100;
    }
    if (kind === 'rain_catcher') e.water = 0;
    if (kind === 'salt_pan') e.salt = 0;
    if (kind === 'cellar') e.slots = new Array(CELLAR_SIZE).fill(null);
    if (kind === 'hut') {
      this.player.spawnX = x;
      this.player.spawnZ = z + 1.8;
    }
    if (kind === 'shelter') {
      this.player.spawnX = x;
      this.player.spawnZ = z + 1.2;
    }
    this.emit({ type: 'entities' });
    this.say(`Построено: ${r.name}`);
    return true;
  }

  // ---------------- Fires and light ----------------

  private updateFires(dt: number) {
    for (const e of this.state.entities) {
      if (e.kind === 'campfire' && (e.fuel ?? 0) > 0) {
        const exposed = !this.nearShelter(e.x, e.z);
        const rate = this.storm > 0.3 && exposed ? 3 : this.rain > 0.3 && exposed ? 1.5 : 1;
        e.fuel = Math.max(0, e.fuel! - dt * rate);
      }
    }
  }

  /** Light sources for the renderer: x, z, radius. */
  lights(): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    for (const e of this.state.entities) {
      if (e.kind === 'campfire' && (e.fuel ?? 0) > 0) {
        out.push({ x: e.x, z: e.z, r: 4 + 5 * Math.min(1, e.fuel! / 120) });
      }
    }
    for (const e of this.state.entities) if ((e.burn ?? 0) > 0) out.push({ x: e.x, z: e.z, r: 3.5 });
    if (this.player.hand?.item === 'torch') out.push({ x: this.player.x, z: this.player.z, r: 6.5 });
    return out;
  }

  // ---------------- Animals ----------------

  brain(e: Entity): BoarBrain {
    let b = this.brains.get(e.id);
    if (!b) {
      b = { mode: 'wander', tx: e.x, tz: e.z, timer: 0, attackCd: 0, moving: false, facing: 1, hurt: 0 };
      this.brains.set(e.id, b);
    }
    return b;
  }

  private updateBoars(dt: number) {
    const p = this.player;
    for (const e of this.state.entities) {
      if (e.kind !== 'boar') continue;
      const b = this.brain(e);
      b.timer -= dt;
      b.attackCd = Math.max(0, b.attackCd - dt);
      b.hurt = Math.max(0, b.hurt - dt);
      const dPlayer = Math.hypot(p.x - e.x, p.z - e.z);

      if (b.mode === 'wander') {
        // Territorial: gets angry if you come too close.
        if (dPlayer < 1.8) {
          b.mode = 'chase';
          b.timer = 8;
          this.say('Кабан разозлился!');
        } else if (b.timer <= 0) {
          b.timer = 2 + this.rng() * 4;
          const a = this.rng() * Math.PI * 2;
          const r = 2 + this.rng() * 5;
          b.tx = e.x + Math.cos(a) * r;
          b.tz = e.z + Math.sin(a) * r;
          if (this.rng() < 0.35) {
            b.tx = e.x;
            b.tz = e.z;
          }
        }
      } else if (b.timer <= 0 || dPlayer > 16) {
        b.mode = 'wander';
        b.timer = 1;
      }

      if (b.mode === 'chase') {
        b.tx = p.x;
        b.tz = p.z;
        if (dPlayer < 1.0 && b.attackCd <= 0) {
          b.attackCd = 1.3;
          this.hurt(9 * this.diff.enemyDamage);
        }
      }
      if (b.mode === 'flee') {
        b.tx = e.x + (e.x - p.x);
        b.tz = e.z + (e.z - p.z);
      }

      const speed = b.mode === 'chase' ? 3.3 : b.mode === 'flee' ? 3.8 : 1.3;
      const dx = b.tx - e.x;
      const dz = b.tz - e.z;
      const d = Math.hypot(dx, dz);
      const stopAt = b.mode === 'chase' ? 0.8 : 0.1;
      b.moving = d > stopAt;
      if (b.moving) {
        const step = Math.min(d - stopAt, speed * dt);
        const nx = e.x + (dx / d) * step;
        const nz = e.z + (dz / d) * step;
        if (this.terrain.walkable(nx, nz)) {
          e.x = nx;
          e.z = nz;
        } else {
          b.timer = 0;
        }
        if (Math.abs(dx) > 0.05) b.facing = dx > 0 ? 1 : -1;
      }
    }
  }

  private attackBoar(e: Entity): boolean {
    const p = this.player;
    if (p.hand?.item === 'bow') return this.shoot(e);
    const dmg = p.hand ? ITEMS[p.hand.item].damage ?? 5 : 5;
    this.actionPulse = 0.3;
    this.actCd = 0.6;
    this.emit({ type: 'hit', x: e.x, z: e.z });
    if (p.hand && ITEMS[p.hand.item].tool === 'weapon') {
      p.hand.durability = (p.hand.durability ?? 1) - 1;
      if (p.hand.durability <= 0) {
        this.say('Копьё сломалось');
        p.hand = null;
      }
    }
    e.hp = (e.hp ?? 60) - dmg;
    const b = this.brain(e);
    b.hurt = 0.25;
    if (e.hp <= 0) {
      this.removeEntity(e.id);
      this.brains.delete(e.id);
      this.spawn({ kind: 'drop', x: e.x, z: e.z, item: { item: 'meat', count: 2 } });
      this.emit({ type: 'entities' });
      this.say('Кабан повержен. Мясо лучше пожарить на костре.');
      return false;
    }
    if (e.hp < 18) {
      b.mode = 'flee';
      b.timer = 5;
    } else {
      b.mode = 'chase';
      b.timer = 10;
    }
    return true;
  }

  /** Bow shot: an arrow flies to the target; the closer, the surer. */
  private shoot(e: Entity): boolean {
    const p = this.player;
    if (!removeItem(p.inv, 'arrow', 1)) {
      this.say('Нет стрел: 2 ветки + кремень');
      return false;
    }
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    this.facing = e.x >= p.x ? 1 : -1;
    this.actionPulse = 0.3;
    this.actCd = 1.0;
    this.projectiles.push({ x0: p.x, z0: p.z, x1: e.x, z1: e.z, t: 0, dur: Math.max(0.15, d / 22) });
    if (p.hand) {
      p.hand.durability = (p.hand.durability ?? 1) - 1;
      if (p.hand.durability <= 0) {
        this.say('Лук сломался');
        p.hand = null;
      }
    }
    const hit = this.rng() < 0.97 - d * 0.035;
    if (this.rng() < 0.5) {
      this.spawn({ kind: 'drop', x: e.x + (this.rng() - 0.5) * 2, z: e.z + (this.rng() - 0.5) * 2, item: { item: 'arrow', count: 1 } });
      this.emit({ type: 'entities' });
    }
    if (!hit) {
      this.say('Промах!');
      const b = this.brain(e);
      b.mode = 'chase';
      b.timer = 10;
      return false;
    }
    e.hp = (e.hp ?? 60) - (ITEMS.arrow.damage ?? 30);
    this.emit({ type: 'hit', x: e.x, z: e.z });
    const b = this.brain(e);
    b.hurt = 0.25;
    if (e.hp <= 0) {
      this.removeEntity(e.id);
      this.brains.delete(e.id);
      this.spawn({ kind: 'drop', x: e.x, z: e.z, item: { item: 'meat', count: 2 } });
      this.emit({ type: 'entities' });
      this.say('Меткий выстрел! Кабан повержен.');
      return false;
    }
    b.mode = e.hp < 18 ? 'flee' : 'chase';
    b.timer = 10;
    return false;
  }

  private hurt(amount: number) {
    this.player.hp -= amount;
    this.hurtPulse = 0.35;
    if (this.player.hp <= 0) this.die();
  }

  // ---------------- Death ----------------

  private die() {
    if (this.dead) return;
    const p = this.player;
    const classic = this.state.settings.deathMode === 'classic';
    this.state.deaths += 1;
    if (classic) {
      this.dead = true;
      this.emit({ type: 'death', classic: true });
      return;
    }
    // Soft: belongings stay where you fell, you wake up at camp.
    const items = [...p.inv, p.hand].filter((s): s is Slot => !!s);
    items.forEach((s, i) => {
      const a = (i / Math.max(1, items.length)) * Math.PI * 2;
      this.spawn({ kind: 'drop', x: p.x + Math.cos(a) * 0.8, z: p.z + Math.sin(a) * 0.8, item: s });
    });
    p.inv = p.inv.map(() => null);
    p.hand = null;
    delete p.onRaft;
    this.fishing = null;
    p.x = p.spawnX;
    p.z = p.spawnZ;
    p.hp = 50;
    p.hunger = Math.max(p.hunger, 40);
    p.thirst = Math.max(p.thirst, 40);
    this.task = null;
    for (const b of this.brains.values()) if (b.mode === 'chase') b.mode = 'wander';
    this.emit({ type: 'entities' });
    this.emit({ type: 'death', classic: false });
  }

  // ---------------- Raft ----------------

  private board(raft: Entity) {
    const p = this.player;
    if (!this.hasItem('paddle')) {
      this.say('Нужно весло: 2 дерева + верёвка');
      return;
    }
    p.onRaft = raft.id;
    p.x = raft.x;
    p.z = raft.z;
    this.task = null;
    this.say('Вы на плоту. WASD — грести, E у берега — высадиться, клик по плоту — груз.');
  }

  /** A dry spot within reach of the raft. */
  landingSpot(): { x: number; z: number } | null {
    const p = this.player;
    for (let r = 1; r <= 2.6; r += 0.4) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
        const x = p.x + Math.cos(a) * r;
        const z = p.z + Math.sin(a) * r;
        if (this.terrain.walkable(x, z) && this.terrain.height(x, z) > 0.02) return { x, z };
      }
    }
    return null;
  }

  disembark() {
    const spot = this.landingSpot();
    if (!spot) return;
    delete this.player.onRaft;
    this.player.x = spot.x;
    this.player.z = spot.z;
    this.task = null;
  }

  private updateRaft(dt: number) {
    const p = this.player;
    if (p.onRaft === undefined) return;
    const raft = this.entity(p.onRaft);
    if (!raft) {
      delete p.onRaft;
      return;
    }
    if (this.storm > 0.3) {
      // The wind pushes the raft and the waves batter it.
      const push = 1.4 * this.storm * dt;
      this.tryMove(p, this.wind.x * push, 0);
      this.tryMove(p, 0, this.wind.z * push);
      raft.hp = (raft.hp ?? 100) - 1.6 * this.storm * dt * this.diff.enemyDamage;
      if (raft.hp <= 0) return this.wreck(raft);
    }
    raft.x = p.x;
    raft.z = p.z;
  }

  /** The raft breaks: cargo is lost, the sea throws you onto the nearest shore. */
  private wreck(raft: Entity) {
    const p = this.player;
    delete p.onRaft;
    this.removeEntity(raft.id);
    const shore = this.nearestShore(p.x, p.z);
    p.x = shore.x;
    p.z = shore.z;
    this.emit({ type: 'entities' });
    this.say('Шторм разбил плот! Груз утонул, вас выбросило на берег.');
    this.hurt(20);
  }

  private nearestShore(x: number, z: number): { x: number; z: number } {
    for (let r = 1; r < MAP_SIZE; r += 1) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / Math.max(8, r)) {
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (this.terrain.walkable(px, pz) && this.terrain.height(px, pz) > 0.03) return { x: px, z: pz };
      }
    }
    return { x: this.player.spawnX, z: this.player.spawnZ };
  }

  // ---------------- Fishing ----------------

  nearWater(): boolean {
    const p = this.player;
    if (p.onRaft !== undefined) return true;
    return this.nearWaterAt(p.x, p.z);
  }

  nearWaterAt(x: number, z: number): boolean {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      if (this.terrain.sailable(x + Math.cos(a) * 1.6, z + Math.sin(a) * 1.6)) return true;
    }
    return false;
  }

  startFishing() {
    this.fishing = 3 + this.rng() * 5;
    this.task = null;
    this.bobber = this.castSpot();
    if (this.bobber) this.facing = this.bobber.x >= this.player.x ? 1 : -1;
    this.say('Удочка заброшена: стойте спокойно и ждите поклёвки');
  }

  /** The nearest bit of open water a couple of metres away. */
  private castSpot(): { x: number; z: number } | null {
    const p = this.player;
    // Prefer clearly open water, not the wet edge of the beach.
    for (const depth of [-0.06, -0.01]) {
      for (let r = 2.4; r <= 5; r += 0.4) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const x = p.x + Math.cos(a) * r;
          const z = p.z + Math.sin(a) * r;
          if (this.terrain.sailable(x, z) && this.terrain.height(x, z) < depth) return { x, z };
        }
      }
    }
    return null;
  }

  /** The float dips during the last second before the catch. */
  get biting(): boolean {
    return this.fishing !== null && this.fishing < 0.8;
  }

  private updateFishing(dt: number) {
    if (this.fishing === null) return;
    const p = this.player;
    if (p.hand?.item !== 'fishing_rod') {
      this.fishing = null;
      this.bobber = null;
      return;
    }
    const before = this.fishing;
    this.fishing -= dt;
    if (before >= 0.8 && this.fishing < 0.8) this.say('Клюёт!');
    if (this.fishing > 0) return;
    this.fishing = null;
    this.bobber = null;
    p.hand.durability = (p.hand.durability ?? 1) - 1;
    if (this.rng() < 0.7) {
      this.give('fish', 1, p);
      this.say('Клюёт! Поймана рыба');
    } else {
      this.say('Сорвалась…');
    }
    if (p.hand.durability <= 0) {
      this.say('Удочка сломалась');
      p.hand = null;
    }
    this.actionPulse = 0.3;
  }

  // ---------------- Weather ----------------

  private updateWeather(dt: number) {
    const w = this.state.weather;
    const s = this.state;
    const now = s.day + s.time;
    const start = w.stormDay + w.stormAt;
    const end = start + w.stormLength;
    if (!w.warned && now > start - 0.05 && now < start) {
      w.warned = true;
      this.say('Ветер крепчает, птицы летят к берегу — надвигается шторм!');
    }
    let target = 0;
    if (now >= start && now < end) {
      // Ramp up, hold, ramp down.
      const k = (now - start) / w.stormLength;
      target = Math.min(1, k / 0.15, (1 - k) / 0.15);
    }
    const was = this.storm > 0.5;
    this.storm += (target - this.storm) * Math.min(1, dt * 0.8);
    if (Math.abs(target - this.storm) < 0.002) this.storm = target;
    if (!was && this.storm > 0.5) {
      const a = this.rng() * Math.PI * 2;
      this.wind = { x: Math.cos(a), z: Math.sin(a) };
      this.emit({ type: 'storm', active: true });
    }
    if (was && this.storm <= 0.5) {
      this.coldWarned = false;
      this.emit({ type: 'storm', active: false });
      this.say('Шторм утих');
    }
    if (now >= end) {
      // Next storm: soon in the rainy season, rarely in the dry one.
      w.stormDay = s.day + (this.season === 'rainy' ? 2 + Math.floor(this.rng() * 2) : 4 + Math.floor(this.rng() * 3));
      w.stormAt = 0.1 + this.rng() * 0.5;
      w.stormLength = 0.14 + this.rng() * 0.06;
      w.warned = false;
    }
    // Showers in the rainy season.
    if (this.season === 'rainy') {
      if (w.rainTo === undefined || now >= w.rainTo) {
        const gap = 0.05 + this.rng() * 0.2;
        w.rainFrom = now + gap;
        w.rainTo = w.rainFrom + 0.06 + this.rng() * 0.12;
      }
    }
    const showering = this.season === 'rainy' && w.rainFrom !== undefined && now >= w.rainFrom && now < (w.rainTo ?? 0);
    const rainTarget = Math.max(this.storm, showering ? 0.7 : 0);
    this.rain += (rainTarget - this.rain) * Math.min(1, dt * 0.6);
    if (this.rain > 0.3) {
      for (const e of s.entities) {
        if (e.kind === 'rain_catcher') e.water = Math.min(RAIN_CATCHER_MAX, (e.water ?? 0) + (dt / 12) * this.rain);
      }
    }
  }

  private nearShelter(x: number, z: number): boolean {
    return this.state.entities.some(
      (e) => (e.kind === 'shelter' && Math.hypot(e.x - x, e.z - z) < 3) || (e.kind === 'hut' && Math.hypot(e.x - x, e.z - z) < 4),
    );
  }

  /** How well a spot is protected from storm cold: 1 = fully (hut, warm fire), 0.6 = a leaf shelter. */
  cover(x: number, z: number): number {
    const near = (kind: string, r: number) => this.state.entities.some((e) => e.kind === kind && Math.hypot(e.x - x, e.z - z) < r);
    if (near('hut', 4)) return 1;
    if (this.state.entities.some((e) => e.kind === 'campfire' && (e.fuel ?? 0) > 0 && Math.hypot(e.x - x, e.z - z) < 3)) return 1;
    if (near('shelter', 3)) return 0.6;
    return 0;
  }

  /** Under a shelter or in the warmth of a burning fire. */
  sheltered(x: number, z: number): boolean {
    return this.cover(x, z) > 0;
  }

  // ---------------- Food spoilage ----------------

  private updateSpoilage(dt: number) {
    const seasonK = SEASONS[this.season].spoil;
    let rotted = false;
    const tick = (slots: (Slot | null)[], k: number, mine: boolean) => {
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (!s) continue;
        const days = ITEMS[s.item].spoilDays;
        if (days === undefined) continue;
        s.fresh = (s.fresh ?? 1) - (dt * seasonK * k) / (days * DAY_LENGTH_SEC);
        if (s.fresh <= 0) {
          slots[i] = { item: 'rot', count: s.count };
          if (mine) rotted = true;
        }
      }
    };
    const p = this.player;
    tick(p.inv, 1, true);
    for (const e of this.state.entities) {
      // A closed chest keeps food in the shade: it spoils at half speed.
      if (e.slots) tick(e.slots, STORAGE_SPOIL[e.kind] ?? 1, false);
      if (e.item) {
        const box = [e.item as Slot | null];
        tick(box, 1, false);
        e.item = box[0]!;
      }
    }
    if (rotted) this.say('Часть еды испортилась и стала гнилью');
  }

  // ---------------- Wildfire ----------------

  private flammable(e: Entity): boolean {
    return FLAMMABLE.has(e.kind) && e.regrowOn === undefined;
  }

  private updateWildfire(dt: number) {
    const ents = this.state.entities;
    const dry = this.season === 'dry' && this.rain < 0.2;
    const burning = ents.filter((e) => (e.burn ?? 0) > 0);
    // Sparks from campfires set dry grass alight.
    if (dry) {
      for (const f of ents) {
        if (f.kind !== 'campfire' || (f.fuel ?? 0) <= 0) continue;
        for (const e of ents) {
          if (!this.flammable(e) || (e.burn ?? 0) > 0 || e.kind === 'tree' || e.kind === 'palm') continue;
          if (Math.hypot(e.x - f.x, e.z - f.z) < 2.2 && this.rng() < 0.006 * dt) {
            e.burn = 10;
            this.say('Искры подожгли сухую траву! Потушите водой из фляги или отойдите');
            this.emit({ type: 'entities' });
          }
        }
      }
    }
    if (!burning.length) return;
    const p = this.player;
    for (const b of burning) {
      // Rain puts fires out; in the dry season they spread.
      b.burn = (b.burn ?? 0) - dt * (this.rain > 0.3 ? 6 : 1);
      if (dry) {
        for (const e of ents) {
          if (e === b || !this.flammable(e) || (e.burn ?? 0) > 0) continue;
          if (Math.hypot(e.x - b.x, e.z - b.z) < 2.2 && this.rng() < 0.07 * dt) e.burn = 8 + this.rng() * 6;
        }
      }
      if (Math.hypot(p.x - b.x, p.z - b.z) < 1.1 && p.onRaft === undefined) this.hurt(5 * dt);
      if (b.burn <= 0) this.burnOut(b);
    }
  }

  /** What is left after a fire: stumps, scorched grass, a ruined shelter. */
  private burnOut(e: Entity) {
    delete e.burn;
    if (e.kind === 'palm' || e.kind === 'tree') e.kind = 'stump';
    else if (e.kind === 'shelter') {
      this.removeEntity(e.id);
      this.say('Шалаш сгорел');
    } else if (e.kind in RESOURCES) e.regrowOn = this.state.day + 3;
    this.emit({ type: 'entities' });
  }

  // ---------------- Salt ----------------

  private updateSaltPans(dt: number) {
    const sunny = this.season === 'dry' && this.rain < 0.2 ? 1 : this.rain < 0.2 ? 0.15 : 0;
    if (!sunny) return;
    const rate = (SALT_PER_DAY * sunny * dt) / DAY_LENGTH_SEC;
    for (const e of this.state.entities) {
      if (e.kind === 'salt_pan') e.salt = Math.min(SALT_PAN_MAX, (e.salt ?? 0) + rate);
    }
  }

  // ---------------- World bookkeeping ----------------

  private spawn(e: Omit<Entity, 'id'>): Entity {
    const ent = { id: this.state.nextId++, ...e } as Entity;
    this.state.entities.push(ent);
    return ent;
  }

  private removeEntity(id: number) {
    const i = this.state.entities.findIndex((e) => e.id === id);
    if (i >= 0) this.state.entities.splice(i, 1);
  }

  private markExplored() {
    const p = this.player;
    const r = 11;
    for (let z = Math.floor(p.z - r); z <= p.z + r; z++) {
      for (let x = Math.floor(p.x - r); x <= p.x + r; x++) {
        if (x < 0 || z < 0 || x >= MAP_SIZE || z >= MAP_SIZE) continue;
        if ((x - p.x) ** 2 + (z - p.z) ** 2 <= r * r) this.explored[z * MAP_SIZE + x] = 1;
      }
    }
  }
}
