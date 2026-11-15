# Как делать спрайты для Island

## Главные правила
1. Один предмет — одна картинка. Предмет целиком, по центру, с небольшим отступом.
2. Фон однотонный: прозрачный PNG, либо ровный белый / ярко-розовый (вырежем сами).
3. Без земли и без тени под предметом — их добавляет игра.
4. Один ракурс: вид сверху-сбоку ~45°, свет слева сверху (как концепт A).
5. Один стиль: прикладывать концепт A как образец стиля, начинать запрос одинаково.
6. Генерировать 1024×1024 или больше.
7. Для деревьев, камней, кустов — 2–3 варианта.

## Начало запроса
```
Hand-drawn 2.5D game sprite of [ПРЕДМЕТ], watercolor and ink linework,
warm cozy palette, 3/4 top-down view at about 45 degrees, soft light from
upper left, single isolated object, fully visible, centered,
plain flat white background, no ground, no shadow, no text
```
Иконки: добавить `game inventory icon, simple, readable at small size`.

Текстуры земли (строго сверху, бесшовно):
```
Seamless tileable top-down texture of [tropical grass / beach sand / forest floor],
hand-drawn watercolor style, warm cozy palette, flat lighting, no objects
```

## Персонаж и звери
Пока рисуются в коде (анимация из частей, как в Don't Starve). Переход на рисованные — позже.

## Первая партия
| Группа | Что | Варианты | Файл |
|---|---|---|---|
| Деревья | кокосовая пальма | 3 | `palm_1.png` … |
| | лиственное тропическое дерево | 2 | `tree_1.png` … |
| | пень | 1 | `stump.png` |
| | молодое деревце (ветки) | 1 | `sapling.png` |
| Кусты | куст с ягодами / без ягод | 2 / 2 | `berry_bush_1.png`, `berry_bush_empty_1.png` |
| Камни | большой валун | 2 | `boulder_1.png` |
| | кремень на земле | 1 | `flint_ground.png` |
| Мелочь | пучок высокой травы | 2 | `grass_1.png` |
| | коряга на песке | 1 | `driftwood.png` |
| | кокос на земле | 1 | `coconut_ground.png` |
| Лагерь | костровище без огня | 1 | `campfire.png` |
| | шалаш из листьев | 1 | `shelter.png` |
| | сундук | 1 | `chest.png` |
| Иконки | дерево, ветки, трава, кремень, камень, верёвка, кокос, ягоды, печёные ягоды, сырое мясо, жареное мясо, топор, кирка, копьё, факел | по 1 | `icon_wood.png` … |
| Текстуры | трава, песок, лесная подстилка, камень | по 1 | `ground_grass.png` … |

Имена файлов — латиницей. Загружать в папку `art/incoming/` (Add file → Upload files) или присылать в чат. Начинать с 3–4 предметов для проверки.
