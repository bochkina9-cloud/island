/** Static game data: items, recipes, world objects. All texts are in Russian. */

export type ItemId =
  | 'wood' | 'twigs' | 'grass' | 'flint' | 'stone' | 'rope'
  | 'coconut' | 'berries' | 'berries_cooked' | 'meat' | 'meat_cooked'
  | 'axe' | 'pickaxe' | 'spear' | 'torch';

export type ToolKind = 'axe' | 'pickaxe' | 'weapon' | 'light';

export interface FoodEffect {
  hunger?: number;
  thirst?: number;
  health?: number;
}

export interface ItemDef {
  name: string;
  /** Max per slot; tools are 1. */
  stack: number;
  tool?: ToolKind;
  /** Uses (tools) or seconds of burning (torch). */
  durability?: number;
  damage?: number;
  food?: FoodEffect;
  /** Fuel seconds when thrown into a campfire. */
  fuel?: number;
  /** What this turns into on a campfire. */
  cooksInto?: ItemId;
  hint: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { name: 'Дерево', stack: 20, fuel: 60, hint: 'Рубится топором с деревьев. Топливо и стройматериал.' },
  twigs: { name: 'Ветки', stack: 20, fuel: 20, hint: 'Собираются с молодых деревьев руками.' },
  grass: { name: 'Трава', stack: 20, fuel: 15, hint: 'Срывается с высокой травы руками.' },
  flint: { name: 'Кремень', stack: 20, hint: 'Лежит на земле, чаще у скал и на пляже.' },
  stone: { name: 'Камень', stack: 20, hint: 'Добывается киркой из валунов.' },
  rope: { name: 'Верёвка', stack: 20, hint: 'Скручивается из травы.' },
  coconut: { name: 'Кокос', stack: 10, food: { hunger: 8, thirst: 20 }, hint: 'Утоляет жажду. Падает с пальм.' },
  berries: { name: 'Ягоды', stack: 20, food: { hunger: 8, thirst: 2 }, cooksInto: 'berries_cooked', hint: 'Съедобны сырыми.' },
  berries_cooked: { name: 'Печёные ягоды', stack: 20, food: { hunger: 12 }, hint: 'Сытнее сырых.' },
  meat: { name: 'Сырое мясо', stack: 10, food: { hunger: 15, health: -6 }, cooksInto: 'meat_cooked', hint: 'Лучше пожарить: сырое вредит здоровью.' },
  meat_cooked: { name: 'Жареное мясо', stack: 10, food: { hunger: 32, health: 6 }, hint: 'Сытно и полезно.' },
  axe: { name: 'Топор', stack: 1, tool: 'axe', durability: 60, damage: 14, hint: 'Рубить деревья.' },
  pickaxe: { name: 'Кирка', stack: 1, tool: 'pickaxe', durability: 40, damage: 12, hint: 'Добывать камень.' },
  spear: { name: 'Копьё', stack: 1, tool: 'weapon', durability: 80, damage: 26, hint: 'Оружие против зверей.' },
  torch: { name: 'Факел', stack: 1, tool: 'light', durability: 90, damage: 6, hint: 'Светит ночью, пока горит.' },
};

export interface Recipe {
  id: string;
  name: string;
  tab: 'tools' | 'survival' | 'build';
  needs: Partial<Record<ItemId, number>>;
  /** Either an item or a structure to place. */
  makes: { item: ItemId; count?: number } | { structure: StructureKind };
}

export const RECIPES: Recipe[] = [
  { id: 'axe', name: 'Топор', tab: 'tools', needs: { twigs: 1, flint: 1 }, makes: { item: 'axe' } },
  { id: 'pickaxe', name: 'Кирка', tab: 'tools', needs: { twigs: 2, flint: 2 }, makes: { item: 'pickaxe' } },
  { id: 'spear', name: 'Копьё', tab: 'tools', needs: { twigs: 2, flint: 1, rope: 1 }, makes: { item: 'spear' } },
  { id: 'torch', name: 'Факел', tab: 'survival', needs: { twigs: 2, grass: 2 }, makes: { item: 'torch' } },
  { id: 'rope', name: 'Верёвка', tab: 'survival', needs: { grass: 3 }, makes: { item: 'rope' } },
  { id: 'campfire', name: 'Костёр', tab: 'build', needs: { wood: 2, grass: 3 }, makes: { structure: 'campfire' } },
  { id: 'chest', name: 'Сундук', tab: 'build', needs: { wood: 4, rope: 1 }, makes: { structure: 'chest' } },
  { id: 'shelter', name: 'Шалаш', tab: 'build', needs: { wood: 4, rope: 2, grass: 6 }, makes: { structure: 'shelter' } },
];

export const TABS: { id: Recipe['tab']; name: string }[] = [
  { id: 'tools', name: 'Инструменты' },
  { id: 'survival', name: 'Выживание' },
  { id: 'build', name: 'Постройки' },
];

export type StructureKind = 'campfire' | 'chest' | 'shelter';

export type ResourceKind =
  | 'palm' | 'tree' | 'stump' | 'sapling' | 'grass_tuft' | 'berry_bush'
  | 'boulder' | 'flint_ground' | 'driftwood' | 'coconut_ground' | 'pond';

export type EntityKind = ResourceKind | StructureKind | 'boar' | 'drop';

export interface ResourceDef {
  name: string;
  /** Tool needed to harvest; undefined = by hand. */
  tool?: 'axe' | 'pickaxe';
  verb: string;
  /** Hits (actions) needed. */
  work: number;
  yields: Partial<Record<ItemId, number>>;
  /** Blocks walking. */
  solid?: number;
  /** Days until it can be harvested again; undefined = removed or turned into something else. */
  regrowDays?: number;
  becomes?: ResourceKind;
  /** Extra random yield. */
  bonus?: { item: ItemId; chance: number };
}

export const RESOURCES: Record<ResourceKind, ResourceDef> = {
  palm: { name: 'Пальма', tool: 'axe', verb: 'Срубить', work: 5, yields: { wood: 3 }, solid: 0.35, becomes: 'stump', bonus: { item: 'coconut', chance: 0.6 } },
  tree: { name: 'Дерево', tool: 'axe', verb: 'Срубить', work: 6, yields: { wood: 4 }, solid: 0.45, becomes: 'stump' },
  stump: { name: 'Пень', tool: 'axe', verb: 'Выкорчевать', work: 3, yields: { wood: 1 } },
  sapling: { name: 'Молодое деревце', verb: 'Наломать веток', work: 1, yields: { twigs: 2 }, regrowDays: 2 },
  grass_tuft: { name: 'Высокая трава', verb: 'Сорвать траву', work: 1, yields: { grass: 2 }, regrowDays: 2 },
  berry_bush: { name: 'Ягодный куст', verb: 'Собрать ягоды', work: 1, yields: { berries: 3 }, regrowDays: 3 },
  boulder: { name: 'Валун', tool: 'pickaxe', verb: 'Разбить', work: 6, yields: { stone: 3, flint: 1 }, solid: 0.6 },
  flint_ground: { name: 'Кремень', verb: 'Подобрать', work: 1, yields: { flint: 1 } },
  driftwood: { name: 'Коряга', verb: 'Подобрать', work: 1, yields: { twigs: 2, wood: 1 } },
  coconut_ground: { name: 'Кокос', verb: 'Подобрать', work: 1, yields: { coconut: 1 } },
  pond: { name: 'Пресный пруд', verb: 'Попить', work: 1, yields: {} },
};

export const STRUCTURES: Record<StructureKind, { name: string; solid: number }> = {
  campfire: { name: 'Костёр', solid: 0.4 },
  chest: { name: 'Сундук', solid: 0.4 },
  shelter: { name: 'Шалаш', solid: 0.9 },
};

export const CAMPFIRE_MAX_FUEL = 240;
export const DAY_LENGTH_SEC = 480;
/** Fractions of the day: day → dusk → night. */
export const DUSK_START = 0.58;
export const NIGHT_START = 0.74;

export const DIFFICULTY = {
  easy: { name: 'Лёгкая', decay: 0.7, enemyDamage: 0.6 },
  normal: { name: 'Обычная', decay: 1, enemyDamage: 1 },
  hard: { name: 'Суровая', decay: 1.4, enemyDamage: 1.5 },
} as const;
export type Difficulty = keyof typeof DIFFICULTY;
