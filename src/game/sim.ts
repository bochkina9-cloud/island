import { makeRng } from '../core/rng';
import {
  CAMPFIRE_MAX_FUEL, DAY_LENGTH_SEC, DIFFICULTY, DUSK_START, ITEMS, type ItemId, NIGHT_START,
  RECIPES, RESOURCES, type Recipe, type ResourceKind, STRUCTURES, type StructureKind,
} from './data';
import {
  CHEST_SIZE, type Entity, type GameState, type Slot, addItem, decodeBytes, encodeBytes, hasAll, removeItem,
} from './state';
import { MAP_SIZE, Terrain, randomSpot } from './world';

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
  | { type: 'entities' };

type Task = { kind: 'move'; x: number; z: number } | { kind: 'act'; id: number };

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

  constructor(readonly state: GameState, terrain?: Terrain) {
    this.terrain = terrain ?? new Terrain(state.settings.seedText);
    this.explored = decodeBytes(state.explored, MAP_SIZE * MAP_SIZE);
    this.rng = makeRng((Date.now() ^ this.terrain.seed) >>> 0);
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
    this.updateStats(dt);
    this.updatePlayer(dt, input);
    this.updateFires(dt);
    this.updateBoars(dt);
    this.actionPulse = Math.max(0, this.actionPulse - dt);
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
    // Keep the boar population steady.
    const boars = s.entities.filter((e) => e.kind === 'boar').length;
    for (let i = boars; i < 4; i++) {
      const p = randomSpot(this.terrain, this.rng, ['forest', 'grass'], this.player, 25);
      if (p) this.spawn({ kind: 'boar', ...p, hp: 60 });
    }
    this.emit({ type: 'entities' });
    this.emit({ type: 'dawn', day: s.day });
    this.say(`Наступил день ${s.day}`);
  }

  private updateStats(dt: number) {
    const p = this.player;
    const decay = this.diff.decay;
    p.hunger = Math.max(0, p.hunger - dt * 0.13 * decay);
    p.thirst = Math.max(0, p.thirst - dt * 0.2 * decay);
    let dh = 0;
    if (p.hunger <= 0) dh -= 0.6;
    if (p.thirst <= 0) dh -= 0.6;
    if (p.hunger > 60 && p.thirst > 60) dh += 0.15;
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
    if (this.task) {
      const target = this.task.kind === 'move' ? this.task : this.entity(this.task.id);
      if (!target) {
        this.task = null;
      } else {
        const dx = target.x - p.x;
        const dz = target.z - p.z;
        const dist = Math.hypot(dx, dz);
        const reach = this.task.kind === 'move' ? 0.15 : REACH + this.radiusOf(target as Entity);
        if (dist > reach) {
          mx = dx / dist;
          mz = dz / dist;
        } else if (this.task.kind === 'move') {
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
      const step = PLAYER_SPEED * dt;
      this.tryMove(p, mx * step, 0);
      this.tryMove(p, 0, mz * step);
    }
  }

  private tryMove(p: { x: number; z: number }, dx: number, dz: number) {
    const nx = p.x + dx;
    const nz = p.z + dz;
    if (!this.terrain.walkable(nx, nz)) return;
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
    return Math.max(0.2, this.solidRadius(e));
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
      if (!this.actionLabel(e)) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z) - this.radiusOf(e);
      const limit = e.kind === 'boar' ? 2.5 : 2.2;
      if (d < limit && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** Text for the context hint, or null when there is nothing to do with it. */
  actionLabel(e: Entity): string | null {
    if (e.kind === 'boar') return 'Атаковать кабана';
    if (e.kind === 'drop' && e.item) return `Подобрать: ${ITEMS[e.item.item].name}`;
    if (e.kind === 'campfire') {
      const raw = this.player.inv.find((s) => s && ITEMS[s.item].cooksInto);
      if (raw && (e.fuel ?? 0) > 0) return `Приготовить: ${ITEMS[raw.item].name}`;
      const fuel = this.bestFuel();
      if (fuel) return (e.fuel ?? 0) > 0 ? `Подбросить: ${ITEMS[fuel.item].name}` : `Разжечь: ${ITEMS[fuel.item].name}`;
      return (e.fuel ?? 0) > 0 ? 'Костёр горит' : 'Костёр погас: нужно топливо';
    }
    if (e.kind === 'chest') return 'Открыть сундук';
    if (e.kind === 'shelter') return 'Шалаш: здесь вы появитесь';
    if (e.kind in RESOURCES) {
      const def = RESOURCES[e.kind as ResourceKind];
      if (e.regrowOn !== undefined) return null;
      if (e.kind === 'pond') return 'Попить из пруда';
      return `${def.verb}: ${def.name}${def.tool && !this.hasTool(def.tool) ? ` (нужен ${def.tool === 'axe' ? 'топор' : 'кирка'})` : ''}`;
    }
    return null;
  }

  /** Context action without walking (E / Space). */
  actNearest() {
    const e = this.nearestInteractable();
    if (e) this.actOn(e.id);
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
    if (e.kind === 'boar') return this.attackBoar(e);
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
    if (e.kind === 'chest') {
      this.openChest?.(e);
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
      this.say('Вы попили пресной воды');
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
    e.work = (e.work ?? 0) + 1;
    if (e.work < def.work) return true;

    e.work = 0;
    for (const [item, n] of Object.entries(def.yields)) this.give(item as ItemId, n ?? 0, e);
    if (def.bonus && this.rng() < def.bonus.chance) this.give(def.bonus.item, 1, e);
    if (def.regrowDays) {
      e.regrowOn = this.state.day + def.regrowDays;
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

  /** Eat food, equip a tool, or do nothing. */
  useSlot(index: number) {
    const p = this.player;
    const s = p.inv[index];
    if (!s) return;
    const def = ITEMS[s.item];
    if (def.food) {
      const f = def.food;
      p.hunger = Math.min(100, p.hunger + (f.hunger ?? 0));
      p.thirst = Math.min(100, p.thirst + (f.thirst ?? 0));
      p.hp = Math.max(1, Math.min(100, p.hp + (f.health ?? 0)));
      removeItem(p.inv, s.item, 1);
      this.actionPulse = 0.3;
      if ((f.health ?? 0) < 0) this.say('Сырое мясо вредно: живот болит');
      return;
    }
    if (def.tool) this.equip(index);
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
    if (!this.terrain.walkable(x, z)) return false;
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
      if (e.kind === 'campfire' && (e.fuel ?? 0) > 0) e.fuel = Math.max(0, e.fuel! - dt);
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
