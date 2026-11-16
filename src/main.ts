import './style.css';
import type { Recipe } from './game/data';
import { deleteSave, exportSave, writeSave } from './game/save';
import { Game } from './game/sim';
import { createWorld } from './game/world';
import { type Art, loadArt } from './render/art';
import { WorldView } from './render/scene';
import { Hud } from './ui/hud';
import { Controls } from './ui/input';
import { type MenuResult, showMenu } from './ui/menu';

const HELP = `
  <h2>Как играть</h2>
  <ul>
    <li><b>WASD / стрелки</b> — идти. <b>Клик по земле</b> — идти туда.</li>
    <li><b>Клик по объекту</b> или <b>E / пробел</b> рядом — главное действие: сорвать, срубить, подобрать, атаковать.</li>
    <li><b>1–0, −, =</b> или клик по слоту — съесть / взять в руку. <b>ПКМ</b> по слоту — выбросить. Слоты можно перетаскивать.</li>
    <li><b>C</b> или вкладки слева — крафт. <b>M</b> — карта. <b>Колесо мыши</b> — приблизить. <b>Esc</b> — пауза.</li>
  </ul>
  <h3>С чего начать</h3>
  <ol>
    <li>Подберите кремень, наломайте веток с молодых деревьев, сорвите траву.</li>
    <li>Сделайте топор: ветки + кремень. Срубите пальму — будет дерево и, может быть, кокос.</li>
    <li>До темноты постройте костёр: ночью без света ничего не видно.</li>
    <li>Пейте из пресного пруда, ешьте ягоды; мясо кабана жарьте на костре.</li>
  </ol>
  <h3>Архипелаг</h3>
  <ul>
    <li>За морем ещё два острова: <b>лесной</b> (лианы для верёвок, ягоды, кабаны) и <b>скалистый</b> (камень, кремень, яйца чаек — но пресной воды там нет, берите флягу).</li>
    <li>Постройте <b>плот</b> на воде у берега, сделайте <b>весло</b> — и в путь. У плота есть трюм для груза.</li>
    <li>Раз в несколько дней приходит <b>шторм</b>: заранее крепчает ветер. Переждите его в шалаше или у костра. Плот в море шторм может разбить.</li>
    <li><b>Рыбалка:</b> возьмите удочку в руку (клик по слоту), подойдите к воде и нажмите E — или просто кликните по воде. Ждите, пока поплавок не дёрнется. <b>Дождесборник</b> копит воду во время дождя.</li>
  </ul>
  <h3>Сезоны</h3>
  <ul>
    <li><b>Сухой сезон</b> (7 дней): дождей нет, пить хочется чаще, трава желтеет и <b>может загореться от костра</b> — разводите огонь на песке или потушите пожар водой из фляги. Солеварня на берегу даёт соль.</li>
    <li><b>Сезон дождей</b> (7 дней): частые ливни и штормы, костры гаснут быстрее, еда портится быстрее, дождесборники полны.</li>
    <li>Еда <b>портится</b>: полоска под предметом — свежесть. В сундуке медленнее. <b>Соль + мясо или рыба</b> — солонина, она почти не портится.</li>
  </ul>
  <h3>Лагерь</h3>
  <ul>
    <li><b>Топливо:</b> стоя у костра, кликните по дереву, веткам или траве в слоте — в огонь пойдёт именно это.</li>
    <li><b>Котелок:</b> у горящего костра кликните по котелку и выберите 3 продукта: мясо → рагу, рыба → уха, 2 яйца → омлет, 3 фрукта → кисель.</li>
    <li><b>Рюкзак</b> даёт ещё 6 мест. <b>Погреб</b> хранит еду почти в 7 раз дольше. <b>Хижина</b> полностью укрывает от шторма и не горит.</li>
    <li><b>Лук:</b> возьмите в руку и кликните по кабану издалека; стрелы иногда можно подобрать.</li>
  </ul>`;

let art: Art;

async function boot() {
  const loading = document.getElementById('loading')!;
  art = await loadArt();
  loading.remove();
  let error: string | undefined;
  for (;;) {
    const choice = await showMenu(error);
    error = undefined;
    try {
      await play(choice);
    } catch (e) {
      console.error(e);
      error = `Ошибка: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
}

/** Runs one game session; resolves when the player returns to the menu. */
function play(choice: MenuResult): Promise<void> {
  return new Promise((resolveSession) => {
    const veil = overlay('<div class="panel loading-card">Создаём остров…</div>');
    // Let the "creating" screen paint before the heavy generation work.
    setTimeout(() => {
      let game: Game;
      if (choice.kind === 'new') {
        const { state, terrain } = createWorld(choice.settings);
        game = new Game(state, terrain);
      } else {
        game = new Game(choice.state);
      }
      const slot = choice.slot;
      const container = document.createElement('div');
      container.className = 'game';
      document.body.appendChild(container);
      const view = new WorldView(container, game, art);
      const hud = new Hud(game, view.groundCanvas);
      veil.remove();

      let paused = false;
      let placing: Recipe | null = null;
      let mouse = { x: 0, y: 0 };
      let hovered: number | null = null;
      let pauseEl: HTMLElement | null = null;
      let ended = false;
      let currentIsland: ReturnType<typeof game.terrain.islandAt> | null = null;

      const save = async (silent = false) => {
        if (game.dead) return;
        await writeSave(slot, game.snapshot());
        if (!silent) hud.toast('Игра сохранена');
      };

      const stopPlacing = () => {
        placing = null;
        view.setGhost(null);
        hud.setHint(null);
      };

      const end = () => {
        if (ended) return;
        ended = true;
        controls.enabled = false;
        window.removeEventListener('visibilitychange', onHide);
        window.removeEventListener('blur', onBlur);
        hud.destroy();
        container.remove();
        pauseEl?.remove();
        view.renderer.dispose();
        resolveSession();
      };

      const setPaused = (v: boolean) => {
        paused = v;
        pauseEl?.remove();
        pauseEl = null;
        if (!v) return;
        pauseEl = overlay(`
          <div class="panel menu-card">
            <h2>Пауза</h2>
            <p class="muted">День ${game.state.day} · зерно «${game.state.settings.seedText}»</p>
            <div class="col">
              <button class="btn primary resume">Продолжить</button>
              <button class="btn save">Сохранить</button>
              <button class="btn export">Сохранить в файл</button>
              <button class="btn help">Как играть</button>
              <button class="btn quit">Сохранить и выйти в меню</button>
            </div>
          </div>`);
        pauseEl.querySelector<HTMLButtonElement>('.resume')!.onclick = () => setPaused(false);
        pauseEl.querySelector<HTMLButtonElement>('.save')!.onclick = () => save().then(() => setPaused(false));
        pauseEl.querySelector<HTMLButtonElement>('.export')!.onclick = () => exportSave(game.snapshot());
        pauseEl.querySelector<HTMLButtonElement>('.help')!.onclick = () => showHelp();
        pauseEl.querySelector<HTMLButtonElement>('.quit')!.onclick = () => save(true).then(end);
      };

      const showHelp = () => {
        const h = overlay(`<div class="panel menu-card help">${HELP}<button class="btn primary">Понятно</button></div>`);
        h.querySelector<HTMLButtonElement>('button')!.onclick = () => h.remove();
      };

      const controls = new Controls({
        action: () => game.actNearest(),
        hotkey: (i) => game.useSlot(i),
        toggleMap: () => hud.toggleMap(),
        toggleCraft: () => hud.toggleCraft(),
        help: () => showHelp(),
        escape: () => {
          if (placing) return stopPlacing();
          if (hud.mapOpen) return hud.toggleMap();
          if (hud.potOpen) return hud.closePot();
          if (hud.chestOpen) return hud.closeChest();
          setPaused(!paused);
        },
      });

      hud.onPlace = (r) => {
        placing = r;
        const where = r.id === 'raft' ? ' Плот ставится на воду у самого берега.' : r.id === 'salt_pan' ? ' Солеварня ставится на пляже у самой воды.' : '';
        hud.setHint(`Строим: ${r.name}.${where} Клик — поставить, Esc или правый клик — отмена.`);
      };

      game.on((e) => {
        if (e.type === 'message') hud.toast(e.text);
        if (e.type === 'entities') view.syncEntities();
        if (e.type === 'dawn') save(true);
        if (e.type === 'storm' && e.active) hud.toast('Шторм! Укройтесь в шалаше или у костра. В море плот может разбить.');
        if (e.type === 'death') {
          if (e.classic) {
            deleteSave(slot);
            const d = overlay(`<div class="panel menu-card"><h2>Вы погибли</h2>
              <p>Вы продержались ${game.state.day} ${days(game.state.day)} на острове «${game.state.settings.seedText}».</p>
              <p class="muted">В классическом режиме мир начинается заново.</p>
              <button class="btn primary">В главное меню</button></div>`);
            d.querySelector('button')!.addEventListener('click', () => {
              d.remove();
              end();
            });
          } else {
            view.syncEntities();
            hud.toast('Вы очнулись в лагере. Вещи остались там, где вы упали.');
          }
        }
      });

      // Mouse: hover shows the action, click walks and acts.
      const canvas = view.renderer.domElement;
      canvas.addEventListener('mousemove', (ev) => (mouse = { x: ev.clientX, y: ev.clientY }));
      canvas.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        if (placing) stopPlacing();
      });
      canvas.addEventListener('mousedown', (ev) => {
        if (paused || game.dead || ev.button !== 0) return;
        if (placing) {
          const p = view.groundAt(ev.clientX, ev.clientY);
          if (p && game.place(placing.id, p.x, p.z)) stopPlacing();
          else hud.toast('Здесь строить нельзя: нужно ровное место рядом с вами');
          return;
        }
        const e = view.entityAt(ev.clientX, ev.clientY);
        if (e) game.actOn(e.id);
        else {
          const p = view.groundAt(ev.clientX, ev.clientY);
          // With a rod in hand, a click on water means "go and fish there".
          if (p && game.player.hand?.item === 'fishing_rod' && game.terrain.sailable(p.x, p.z) && game.player.onRaft === undefined) game.fishAt(p.x, p.z);
          else if (p) game.moveTo(p.x, p.z);
        }
      });
      canvas.addEventListener('wheel', (ev) => {
        view.zoom = Math.max(9, Math.min(40, view.zoom * (ev.deltaY > 0 ? 1.12 : 1 / 1.12)));
      }, { passive: true });

      // Leaving the tab pauses and saves.
      const onHide = () => {
        if (document.hidden && !game.dead) {
          save(true);
          if (!paused) setPaused(true);
        }
      };
      const onBlur = () => {
        if (!paused && !game.dead) setPaused(true);
      };
      window.addEventListener('visibilitychange', onHide);
      window.addEventListener('blur', onBlur);

      if (choice.kind === 'new') {
        save(true);
        showHelp();
      }

      let last = performance.now();
      let autosave = 0;
      const frame = (now: number) => {
        if (ended) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const helpOpen = !!document.querySelector('.menu-card.help');
        if (!paused && !helpOpen) {
          game.update(dt, controls.move());
          autosave += dt;
          if (autosave > 120) {
            autosave = 0;
            save(true);
          }
        }
        // Context hint: what is under the mouse, otherwise what is nearby.
        let text: string | null = null;
        if (placing) {
          const p = view.groundAt(mouse.x, mouse.y);
          const kind = 'structure' in placing.makes ? placing.makes.structure : null;
          if (p && kind) view.setGhost(kind, p.x, p.z, game.canPlace(kind, p.x, p.z));
        } else {
          const under = view.entityAt(mouse.x, mouse.y);
          hovered = under?.id ?? null;
          const fishFirst = game.player.hand?.item === 'fishing_rod' && (game.extraAction() === 'fish' || game.fishing !== null);
          const target = under ?? (fishFirst ? null : game.nearestInteractable());
          const label = target ? game.actionLabel(target) : null;
          if (label) text = under ? `Клик — ${label}` : `E — ${label}`;
          else {
            const extra = game.extraLabel();
            if (extra) text = game.fishing !== null ? extra : `E — ${extra}`;
            else if (game.player.hand?.item === 'fishing_rod') text = 'Удочка в руке: кликните по воде или подойдите к берегу';
          }
        }
        canvas.style.cursor = hovered ? 'pointer' : 'default';
        hud.update(text, paused ? 0 : dt);
        // Greet the player on arrival at another island.
        if (game.player.onRaft === undefined) {
          const is = game.terrain.islandAt(game.player.x, game.player.z);
          if (is !== currentIsland) {
            if (currentIsland) hud.toast(`Вы на острове: ${is.name}`);
            currentIsland = is;
          }
        }
        view.render(paused ? 0 : dt);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      // Exposed for automated checks.
      (window as unknown as { __island: unknown }).__island = { game, view, hud, save };
    }, 30);
  });
}

function overlay(html: string): HTMLElement {
  const o = document.createElement('div');
  o.className = 'overlay';
  o.innerHTML = html;
  document.body.appendChild(o);
  return o;
}

function days(n: number) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'дня';
  return 'дней';
}

boot();
