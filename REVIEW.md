# Журнал решений

Каждая запись: дата — решение — почему. Помогает откатиться и не спорить с собой.

## 2026-11-16
- **Цель этапа — «оживить» эталонную картинку** `docs/reference/camp_target.webp`: стартовая бухта с лагерем в игре должна совпадать с ней по дизайну — цвета, формы, атмосфера. Биомы и новые механики — после того, как качество устроит.
- **Острова остаются случайными (по зерну), стартовая бухта — заранее раскладываемая сцена** «как на картине»: берег, плот у столба, костёр с котелком, палатка, сундук, кувшин, валуны, деревья.
- **Картинки генерирует пользователь** по списку и запросам из `docs/ART_GUIDE.md`; фон — сплошной #FF00FF, вырезается программой; файлы кладутся в `art/incoming/`.
- **Герой — юноша**, как на эталоне (хвостик, шарф). Один утверждённый эталонный рисунок — все позы только от него; анимация — из частей в коде.
- **Из методики берём**: журнал решений, сравнение скриншота с эталоном после каждого шага, «гимы» (тестовые сцены для воды, земли, героя), бот-проходчик. **Не берём**: Phaser/Canvas 2D (остаёмся на Three.js), «одну картину на уровень» для случайных островов.
- **Порядок**: сначала 4 пробные картинки для настройки стиля и ракурса, затем остальной список.
- **Эталон героя утверждён**: `art/incoming/hero_ref.webp` (юноша, хвостик, красный шарф). Совпадает с героем на эталонной картине по одежде, пропорциям и манере. Фон у генерации не #FF00FF, а ровный сиреневый (138,53,96) — `tools/cut.py` берёт цвет фона с краёв картинки, так что подходит любой ровный фон; кромка без розового ореола.
- **Свет на эталонной картине падает справа**: тени (герой, тренога, деревья) лежат влево. В запросах для следующих картинок — «light from the right», а тени в игре кладём влево.
- **Виды героя**: спереди `hero_ref`, профиль вправо `hero_side`, со спины `hero_back` — утверждены (одно лицо, одежда, ракурс). `hero_back_steep` отклонён: камера заметно выше, чем у остальных видов, — герой «прыгал» бы между ракурсами. Влево — зеркальное отражение профиля.
- **Палатка `tent` утверждена**: совпадает с эталоном (заплатки, циновка, скатка).
- **Анимация героя**: ходьба, дыхание, покачивание — программная деформация рисунка («кости» внутри картинки: бёдра, колени, плечи), плавно на любой частоте кадров и без новых картинок. Для действий (рубить, бить, поднимать, рыбачить, грести) — по одной-две ключевые позы от генератора в профиль, между ними — та же деформация.
- **Время суток**: весь день слегка тёплый, к вечеру — полностью «как на картине». **Камера ближе**: герой ~¼ высоты экрана, колесо — отдалить.
- **Партия 1 поз (16.11)**: `pose_pickup_a` — подходит (присел, тянется к земле, голова опущена). `pose_kneel_fists_a` — подходит для гребли (на колене, кулаки друг над другом — как на вертикальном весле). `pose_kneel_stick_b` — отклонён: в руках нарисована палка, а инструменты вкладывает игра. Одна картинка партии — повтор эталона героя.
- **Валун `boulder_round_a` отклонён**: гладкий купол, золотой «фотореалистичный» свет, тонкий контур — не похож на камни эталона (угловатые, тёмно-серо-коричневые, плоские грани, жирный тёмный контур, ракушки и мох). Запрос переписан. По кромке виден розовый ореол на ярко-пурпурном фоне — порог вырезания подправить.
- **Общий разбор партий 1–7 (16.11)**, выбрано:
  - позы: `pose_swing_up` ← swing_up_a (замах, руки над головой, корпус отклонён назад); `pose_swing_down` ← strike_a (удар вперёд-вниз, широкая стойка); `pose_thrust` ← strike_c (выпад, руки прямо вперёд — для копья); `pose_hold_forward` ← hold_forward_a (руки ровно вперёд — удочка, лук, котелок); `pose_pickup` ← pickup_a; `pose_paddle` ← kneel_fists_a. Отклонены: hold_forward_b (руки на разной высоте), pickup_b (поплыли лицо и цвет волос), swing_up_b (больше похоже на потягивание), kneel_stick_b (нарисована палка).
  - камни: `boulder_1` ← round_c (гранёный, ближе всех к эталону по форме), `boulder_2` ← slab_b (глыба за лагерем), `boulder_3` ← stones_small_c (кучка, жирный контур как на эталоне). Все камни светлее и «золотее» эталона — при вставке подгонять цвет (темнее, серо-коричневее); ждём ещё валун по последнему запросу.
  - трава: `ground_grass` ← grass_e (тёплый оливково-жёлтый, ближе всех к эталону). У всех вариантов тёмные края — при повторе видна сетка; убираем программно (выравнивание яркости + бесшовная склейка).
- **Валуны по новому запросу (тёмные, гранёные, жирный контур, ракушки) утверждены** как `boulder_1..3`: на пляже эталона стоят как родные (сверка: `boulder_ink_check`). Вывод для всех следующих запросов: фразы «hand-painted illustration, NOT photorealistic, NOT 3D render, bold dark-brown ink outlines, flat painted shading in 2-3 tones» убирают «золотой фотореализм». Высокая глыба `slab_b` → `cliff_1`, кучка `stones_small_c` → `stones_1` (их цвет подгоняем программно).

## 2026-11-16 — Bay scene assembled with painted art
- Start bay is now sculpted into the terrain (every seed): sea along the left, beach ~2 m, meadow rising to the right; the rest of the island stays random.
- Hero: front/side/back by walking direction, legs animated in the shader (one painted frame per view), action poses for chop/mine/strike/thrust/shoot/pick, paddle pose on the raft, tool held at the painted hand.
- Silhouette shadows: each sprite laid on the ground to the lower left (sun from the right), soft at the far end, longer towards evening, gone at night and in storms.
- Camera 46°, closer (hero ≈ ¼ of the screen height). Light warm all day, golden in the afternoon. Vignette.
- Grass texture applied on grassy ground; wind sway for trees, bushes, grass (stronger in storms).
- Compared with docs/reference/camp_target.webp: layout and scale match; missing are painted trees, bushes, tufts, campfire, chest, raft, sand texture.

## 2026-11-16 — Painted bay backdrop
- Top-down bay painted with the reference as a style image (the variants with the reference matched the style; the ones without came out flat and vector-like). Chosen: bay_topdown (59); rejected: 58 (paper frame at the edges), 60 (flatter grass edge), 52–56 (small details painted at map scale).
- Lesson: a backdrop carries only large shapes; shells, pebbles, tufts and flowers are separate sprites at true size (a shell painted into a map would be over 1 m long).
- The terrain of the bay is read from the painting (tools/bay_shape.py → src/game/bay_shape.ts): where it is water, the game has water.
- Picture covers 18 × 18 m (≈ one screen pixel per picture pixel at the default zoom). Painted foam pulses towards the shore, water shimmers, storm darkens it.
- Shells: sheet "shells" (61), split into shell_1..6, scattered on every beach. Rejected: 57 (watermark).
- Open: the seam where the painting fades into the generated shore; to be solved with painted materials for the whole island.

## 2026-11-16 — "Everything floats" (user feedback)
- Cause 1: shadows fell towards the camera, so the ground showed between an object and its shadow. Now they fall left and away from the camera, as in the reference.
- Cause 2: the silhouette started at the sprite's bottom edge, but a picture drawn from above stands on a footprint that lies behind that edge. The shadow now starts from the middle of the footprint; the contact shadow moved behind the base line too, leaving a dark rim at the ground.
- Cause 3: scale. Boulders 1.5 → ~1.0 m, cliff 3.2 → 2.6 m, tent 2.3 → 2.0 m, stones 0.55 → 0.45 m; the hero stays 1.75 m (reference proportions).
- Pebbles: sheet 64 chosen (12 pebbles, varied sizes); 62, 63 kept as candidates. Pebbles keep their relative sizes; scattered on beaches and sparsely in grass.
- Still to come for grounding: grass tufts around the bases of rocks and trees (as in the reference), once the tuft art arrives.
