/** Static game data: items, recipes, world objects. All texts are in Russian. */

export type ItemId =
  | 'wood' | 'twigs' | 'grass' | 'flint' | 'stone' | 'rope'
  | 'coconut' | 'berries' | 'berries_cooked' | 'meat' | 'meat_cooked'
  | 'fish' | 'fish_cooked' | 'egg' | 'egg_cooked'
  | 'salt' | 'jerky' | 'salted_fish' | 'rot'
  | 'stew' | 'fish_soup' | 'omelet' | 'kissel' | 'soup'
  | 'pot' | 'backpack' | 'bow' | 'arrow'
  | 'axe' | 'axe_stone' | 'pickaxe' | 'spear' | 'torch' | 'flask' | 'fishing_rod' | 'paddle';

export type ToolKind = 'axe' | 'pickaxe' | 'weapon' | 'light' | 'rod' | 'paddle' | 'flask' | 'bow' | 'pot' | 'backpack';

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
  /** Work done per hit (stronger tools finish faster). */
  power?: number;
  food?: FoodEffect;
  /** Fuel seconds when thrown into a campfire. */
  fuel?: number;
  /** What this turns into on a campfire. */
  cooksInto?: ItemId;
  /** Days until fresh food turns into rot; undefined = does not spoil. */
  spoilDays?: number;
  hint: string;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wood: { name: 'Дерево', stack: 20, fuel: 60, hint: 'Рубится топором с деревьев. Топливо и стройматериал.' },
  twigs: { name: 'Ветки', stack: 20, fuel: 20, hint: 'Собираются с молодых деревьев руками.' },
  grass: { name: 'Трава', stack: 20, fuel: 15, hint: 'Срывается с высокой травы руками.' },
  flint: { name: 'Кремень', stack: 20, hint: 'Лежит на земле, чаще у скал и на пляже.' },
  stone: { name: 'Камень', stack: 20, hint: 'Добывается киркой из валунов.' },
  rope: { name: 'Верёвка', stack: 20, hint: 'Скручивается из травы.' },
  coconut: { name: 'Кокос', stack: 10, food: { hunger: 8, thirst: 20 }, spoilDays: 10, hint: 'Утоляет жажду. Падает с пальм.' },
  berries: { name: 'Ягоды', stack: 20, food: { hunger: 8, thirst: 2 }, cooksInto: 'berries_cooked', spoilDays: 3, hint: 'Съедобны сырыми.' },
  berries_cooked: { name: 'Печёные ягоды', stack: 20, food: { hunger: 12 }, spoilDays: 4, hint: 'Сытнее сырых.' },
  meat: { name: 'Сырое мясо', stack: 10, food: { hunger: 15, health: -6 }, cooksInto: 'meat_cooked', spoilDays: 2, hint: 'Лучше пожарить или засолить: сырое вредит здоровью.' },
  meat_cooked: { name: 'Жареное мясо', stack: 10, food: { hunger: 32, health: 6 }, spoilDays: 3, hint: 'Сытно и полезно.' },
  fish: { name: 'Сырая рыба', stack: 10, food: { hunger: 10, health: -3 }, cooksInto: 'fish_cooked', spoilDays: 1.5, hint: 'Ловится удочкой с берега или с плота.' },
  fish_cooked: { name: 'Жареная рыба', stack: 10, food: { hunger: 25, health: 4 }, spoilDays: 2.5, hint: 'Хорошая еда в дорогу.' },
  egg: { name: 'Яйцо чайки', stack: 10, food: { hunger: 6, health: -2 }, cooksInto: 'egg_cooked', spoilDays: 5, hint: 'Из гнёзд на скалистом острове.' },
  egg_cooked: { name: 'Печёное яйцо', stack: 10, food: { hunger: 18, health: 2 }, spoilDays: 3, hint: 'Сытно.' },
  salt: { name: 'Соль', stack: 20, hint: 'Выпаривается из морской воды в солеварне — в сухой сезон.' },
  jerky: { name: 'Солонина', stack: 10, food: { hunger: 28, thirst: -8, health: 2 }, spoilDays: 25, hint: 'Почти не портится. Солёная — хочется пить.' },
  salted_fish: { name: 'Солёная рыба', stack: 10, food: { hunger: 22, thirst: -6, health: 2 }, spoilDays: 25, hint: 'Почти не портится. Солёная — хочется пить.' },
  stew: { name: 'Рагу', stack: 5, food: { hunger: 60, thirst: 5, health: 12 }, spoilDays: 4, hint: 'Сварено в котелке с мясом. Очень сытно.' },
  fish_soup: { name: 'Уха', stack: 5, food: { hunger: 45, thirst: 15, health: 10 }, spoilDays: 3, hint: 'Сварена в котелке с рыбой. Сытно и утоляет жажду.' },
  omelet: { name: 'Омлет', stack: 5, food: { hunger: 45, health: 8 }, spoilDays: 3, hint: 'Из двух яиц и чего-нибудь ещё.' },
  kissel: { name: 'Ягодный кисель', stack: 5, food: { hunger: 22, thirst: 35, health: 5 }, spoilDays: 4, hint: 'Из ягод и кокоса: хорошо утоляет жажду.' },
  soup: { name: 'Похлёбка', stack: 5, food: { hunger: 30, thirst: 10, health: 3 }, spoilDays: 3, hint: 'Сварено что было под рукой.' },
  pot: { name: 'Котелок', stack: 1, tool: 'pot', hint: 'Встаньте у горящего костра и кликните по котелку: из трёх продуктов получится блюдо.' },
  backpack: { name: 'Рюкзак', stack: 1, tool: 'backpack', hint: 'Клик — надеть: +6 слотов.' },
  bow: { name: 'Лук', stack: 1, tool: 'bow', durability: 60, damage: 4, hint: 'Возьмите в руку и кликните по зверю издалека. Нужны стрелы.' },
  arrow: { name: 'Стрела', stack: 20, damage: 30, hint: 'Для лука. После выстрела иногда можно подобрать.' },
  rot: { name: 'Гниль', stack: 20, food: { hunger: 2, health: -10 }, fuel: 8, hint: 'Испорченная еда. Есть нельзя, но горит.' },
  axe: { name: 'Топор', stack: 1, tool: 'axe', durability: 60, damage: 14, hint: 'Рубить деревья.' },
  axe_stone: { name: 'Каменный топор', stack: 1, tool: 'axe', durability: 160, damage: 18, power: 2, hint: 'Рубит вдвое быстрее и служит дольше.' },
  flask: { name: 'Кокосовая фляга', stack: 1, tool: 'flask', durability: 3, hint: 'Три глотка воды. Наполняется у пруда и у дождесборника.' },
  fishing_rod: { name: 'Удочка', stack: 1, tool: 'rod', durability: 30, hint: 'Возьмите в руку и подойдите к воде.' },
  paddle: { name: 'Весло', stack: 1, tool: 'paddle', hint: 'Без весла плотом не управлять.' },
  pickaxe: { name: 'Кирка', stack: 1, tool: 'pickaxe', durability: 40, damage: 12, hint: 'Добывать камень.' },
  spear: { name: 'Копьё', stack: 1, tool: 'weapon', durability: 80, damage: 26, hint: 'Оружие против зверей.' },
  torch: { name: 'Факел', stack: 1, tool: 'light', durability: 90, damage: 6, hint: 'Светит ночью, пока горит.' },
};

export interface Recipe {
  id: string;
  name: string;
  tab: 'tools' | 'survival' | 'food' | 'build';
  needs: Partial<Record<ItemId, number>>;
  /** Either an item or a structure to place. */
  makes: { item: ItemId; count?: number } | { structure: StructureKind };
}

export const RECIPES: Recipe[] = [
  { id: 'axe', name: 'Топор', tab: 'tools', needs: { twigs: 1, flint: 1 }, makes: { item: 'axe' } },
  { id: 'axe_stone', name: 'Каменный топор', tab: 'tools', needs: { wood: 1, stone: 2, rope: 1 }, makes: { item: 'axe_stone' } },
  { id: 'pickaxe', name: 'Кирка', tab: 'tools', needs: { twigs: 2, flint: 2 }, makes: { item: 'pickaxe' } },
  { id: 'spear', name: 'Копьё', tab: 'tools', needs: { twigs: 2, flint: 1, rope: 1 }, makes: { item: 'spear' } },
  { id: 'bow', name: 'Лук', tab: 'tools', needs: { wood: 1, twigs: 2, rope: 2 }, makes: { item: 'bow' } },
  { id: 'arrow', name: 'Стрелы ×4', tab: 'tools', needs: { twigs: 2, flint: 1 }, makes: { item: 'arrow', count: 4 } },
  { id: 'fishing_rod', name: 'Удочка', tab: 'tools', needs: { twigs: 2, rope: 1 }, makes: { item: 'fishing_rod' } },
  { id: 'paddle', name: 'Весло', tab: 'tools', needs: { wood: 2, rope: 1 }, makes: { item: 'paddle' } },
  { id: 'torch', name: 'Факел', tab: 'survival', needs: { twigs: 2, grass: 2 }, makes: { item: 'torch' } },
  { id: 'backpack', name: 'Рюкзак', tab: 'survival', needs: { grass: 10, rope: 4 }, makes: { item: 'backpack' } },
  { id: 'flask', name: 'Кокосовая фляга', tab: 'survival', needs: { coconut: 1, rope: 1 }, makes: { item: 'flask' } },
  { id: 'rope', name: 'Верёвка', tab: 'survival', needs: { grass: 3 }, makes: { item: 'rope' } },
  { id: 'pot', name: 'Котелок', tab: 'food', needs: { stone: 3, rope: 1 }, makes: { item: 'pot' } },
  { id: 'jerky', name: 'Солонина', tab: 'food', needs: { meat: 1, salt: 1 }, makes: { item: 'jerky' } },
  { id: 'salted_fish', name: 'Солёная рыба', tab: 'food', needs: { fish: 1, salt: 1 }, makes: { item: 'salted_fish' } },
  { id: 'campfire', name: 'Костёр', tab: 'build', needs: { wood: 2, grass: 3 }, makes: { structure: 'campfire' } },
  { id: 'chest', name: 'Сундук', tab: 'build', needs: { wood: 4, rope: 1 }, makes: { structure: 'chest' } },
  { id: 'shelter', name: 'Шалаш', tab: 'build', needs: { wood: 4, rope: 2, grass: 6 }, makes: { structure: 'shelter' } },
  { id: 'rain_catcher', name: 'Дождесборник', tab: 'build', needs: { wood: 3, grass: 4, rope: 1 }, makes: { structure: 'rain_catcher' } },
  { id: 'raft', name: 'Плот', tab: 'build', needs: { wood: 8, rope: 4 }, makes: { structure: 'raft' } },
  { id: 'cellar', name: 'Погреб', tab: 'build', needs: { stone: 6, wood: 4, rope: 2 }, makes: { structure: 'cellar' } },
  { id: 'hut', name: 'Хижина', tab: 'build', needs: { wood: 12, stone: 6, rope: 4 }, makes: { structure: 'hut' } },
  { id: 'salt_pan', name: 'Солеварня', tab: 'build', needs: { stone: 4, wood: 2 }, makes: { structure: 'salt_pan' } },
];

export const TABS: { id: Recipe['tab']; name: string }[] = [
  { id: 'tools', name: 'Инструменты' },
  { id: 'survival', name: 'Выживание' },
  { id: 'food', name: 'Еда' },
  { id: 'build', name: 'Постройки' },
];

export type StructureKind = 'campfire' | 'chest' | 'shelter' | 'rain_catcher' | 'raft' | 'salt_pan' | 'cellar' | 'hut';

export type ResourceKind =
  | 'palm' | 'tree' | 'stump' | 'sapling' | 'grass_tuft' | 'berry_bush'
  | 'boulder' | 'flint_ground' | 'driftwood' | 'coconut_ground' | 'pond' | 'vines' | 'nest';

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
  vines: { name: 'Лианы', verb: 'Нарезать лиан', work: 2, yields: { rope: 1 }, regrowDays: 2 },
  nest: { name: 'Гнездо чайки', verb: 'Взять яйца', work: 1, yields: { egg: 2 }, regrowDays: 2 },
};

export const STRUCTURES: Record<StructureKind, { name: string; solid: number }> = {
  campfire: { name: 'Костёр', solid: 0.4 },
  chest: { name: 'Сундук', solid: 0.4 },
  shelter: { name: 'Шалаш', solid: 0.9 },
  rain_catcher: { name: 'Дождесборник', solid: 0.4 },
  raft: { name: 'Плот', solid: 0 },
  salt_pan: { name: 'Солеварня', solid: 0.5 },
  cellar: { name: 'Погреб', solid: 0.6 },
  hut: { name: 'Хижина', solid: 1.4 },
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

export const RAFT_CARGO = 6;
export const RAFT_SPEED = 3.6;
export const RAIN_CATCHER_MAX = 6;

// ---------- Seasons ----------

export type Season = 'dry' | 'rainy';
export const SEASON_DAYS = 7;
export const SEASONS: Record<Season, { name: string; thirst: number; spoil: number; regrow: number }> = {
  dry: { name: 'Сухой сезон', thirst: 1.3, spoil: 1, regrow: 1.5 },
  rainy: { name: 'Сезон дождей', thirst: 0.8, spoil: 1.5, regrow: 0.75 },
};

/** The game starts in the dry season; seasons alternate every [SEASON_DAYS] days. */
export function seasonOf(day: number): Season {
  return Math.floor((day - 1) / SEASON_DAYS) % 2 === 0 ? 'dry' : 'rainy';
}

/** Days left in the current season, counting the current day. */
export function seasonDaysLeft(day: number): number {
  return SEASON_DAYS - ((day - 1) % SEASON_DAYS);
}

/** Things that catch fire in the dry season. */
export const FLAMMABLE = new Set(['grass_tuft', 'sapling', 'berry_bush', 'vines', 'palm', 'tree', 'shelter']);
/** Salt pan: salt per day of dry sunshine. */
export const SALT_PER_DAY = 3;
export const SALT_PAN_MAX = 6;

export const CELLAR_SIZE = 12;
/** Spoilage speed in storage, relative to carrying food around. */
export const STORAGE_SPOIL: Partial<Record<string, number>> = { chest: 0.5, cellar: 0.15 };
export const BACKPACK_SLOTS = 6;
export const BOW_RANGE = 9;

type FoodGroup = 'meat' | 'fish' | 'egg' | 'fruit' | 'rot' | 'other';
const GROUPS: Partial<Record<ItemId, FoodGroup>> = {
  meat: 'meat', meat_cooked: 'meat', jerky: 'meat',
  fish: 'fish', fish_cooked: 'fish', salted_fish: 'fish',
  egg: 'egg', egg_cooked: 'egg',
  berries: 'fruit', berries_cooked: 'fruit', coconut: 'fruit',
  rot: 'rot',
};

/** What three ingredients make in the cooking pot. */
export function potDish(ingredients: ItemId[]): ItemId {
  const n = (g: FoodGroup) => ingredients.filter((i) => (GROUPS[i] ?? 'other') === g).length;
  if (n('rot') > 0) return 'rot';
  if (n('meat') >= 1) return 'stew';
  if (n('fish') >= 1) return 'fish_soup';
  if (n('egg') >= 2) return 'omelet';
  if (n('fruit') >= 3) return 'kissel';
  return 'soup';
}

/** Food that can go into the pot. */
export function isIngredient(item: ItemId): boolean {
  return !!ITEMS[item].food && !['stew', 'fish_soup', 'omelet', 'kissel', 'soup'].includes(item);
}
