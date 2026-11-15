import { randomSeedText } from '../core/rng';
import { DIFFICULTY, type Difficulty } from '../game/data';
import { SLOTS, type SaveRecord, importSaveFile, listSaves } from '../game/save';
import type { DeathMode, GameState, GoalMode, WorldSettings } from '../game/state';

export type MenuResult =
  | { kind: 'new'; slot: number; settings: WorldSettings }
  | { kind: 'load'; slot: number; state: GameState };

const DEATH_TEXT: Record<DeathMode, string> = {
  soft: 'Мягко — очнётесь в лагере, вещи останутся на месте гибели',
  classic: 'Классика — смерть означает конец, мир начинается заново',
};
const GOAL_TEXT: Record<GoalMode, string> = {
  escape: 'Побег — построить воздушный шар и покинуть архипелаг (цель появится в следующих версиях)',
  free: 'Свободное выживание — без конечной цели',
};

/** Title screen: continue a save, start a new world or import a file. */
export function showMenu(error?: string): Promise<MenuResult> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'menu';
    document.body.appendChild(root);
    const done = (r: MenuResult) => {
      root.remove();
      resolve(r);
    };

    async function home() {
      const saves = await listSaves().catch(() => new Map<number, SaveRecord>());
      root.innerHTML = `
        <div class="menu-card panel">
          <h1>Остров</h1>
          <p class="subtitle">Выживание на архипелаге</p>
          ${error ? `<p class="error">${error}</p>` : ''}
          <div class="saves"></div>
          <div class="row">
            <button class="btn import">Загрузить из файла</button>
          </div>
          <p class="muted small">Управление: WASD — идти, клик — идти/действовать, E или пробел — действие рядом,
          1–0 — предметы, C — крафт, M — карта, Esc — пауза, H — помощь.</p>
        </div>`;
      const list = root.querySelector('.saves')!;
      for (const slot of SLOTS) {
        const rec = saves.get(slot);
        const row = document.createElement('div');
        row.className = 'save-row';
        if (rec) {
          const s = rec.state;
          row.innerHTML = `<div><b>Слот ${slot}</b> · день ${s.day} · «${escapeHtml(s.settings.seedText)}»
            <div class="muted small">${DIFFICULTY[s.settings.difficulty].name}, ${s.settings.deathMode === 'soft' ? 'мягко' : 'классика'} ·
            ${new Date(rec.savedAt).toLocaleString('ru-RU')}</div></div>`;
          const play = button('Продолжить', 'btn primary', () => done({ kind: 'load', slot, state: rec.state }));
          const fresh = button('Новый мир', 'btn', () => setup(slot, true));
          row.append(play, fresh);
        } else {
          row.innerHTML = `<div><b>Слот ${slot}</b> · <span class="muted">пусто</span></div>`;
          row.append(button('Новая игра', 'btn primary', () => setup(slot, false)));
        }
        list.appendChild(row);
      }
      root.querySelector<HTMLButtonElement>('.import')!.onclick = async () => {
        try {
          const state = await importSaveFile();
          const free = SLOTS.find((s) => !saves.has(s)) ?? 1;
          done({ kind: 'load', slot: free, state });
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
          home();
        }
      };
    }

    function setup(slot: number, overwrite: boolean) {
      let seed = randomSeedText();
      root.innerHTML = `
        <div class="menu-card panel">
          <h2>Новый мир · слот ${slot}</h2>
          ${overwrite ? '<p class="error">Старое сохранение в этом слоте будет заменено.</p>' : ''}
          <label class="field">Зерно мира <span class="muted small">(одно зерно — один и тот же остров)</span>
            <div class="row"><input class="seed" value="${seed}"><button class="btn dice" title="Случайное">🎲</button></div>
          </label>
          <fieldset><legend>Сложность</legend>
            ${(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => radio('diff', d, DIFFICULTY[d].name, d === 'normal')).join('')}
          </fieldset>
          <fieldset><legend>Смерть</legend>
            ${(['soft', 'classic'] as DeathMode[]).map((d) => radio('death', d, DEATH_TEXT[d], d === 'soft')).join('')}
          </fieldset>
          <fieldset><legend>Цель</legend>
            ${(['free', 'escape'] as GoalMode[]).map((d) => radio('goal', d, GOAL_TEXT[d], d === 'free')).join('')}
          </fieldset>
          <div class="row">
            <button class="btn back">Назад</button>
            <button class="btn primary start">Начать</button>
          </div>
        </div>`;
      const input = root.querySelector<HTMLInputElement>('.seed')!;
      root.querySelector<HTMLButtonElement>('.dice')!.onclick = () => {
        seed = randomSeedText();
        input.value = seed;
      };
      root.querySelector<HTMLButtonElement>('.back')!.onclick = () => home();
      root.querySelector<HTMLButtonElement>('.start')!.onclick = () => {
        const pick = (name: string) => root.querySelector<HTMLInputElement>(`input[name=${name}]:checked`)!.value;
        done({
          kind: 'new',
          slot,
          settings: {
            seedText: input.value.trim() || randomSeedText(),
            difficulty: pick('diff') as Difficulty,
            deathMode: pick('death') as DeathMode,
            goal: pick('goal') as GoalMode,
          },
        });
      };
    }

    home();
  });
}

function radio(name: string, value: string, label: string, checked: boolean) {
  return `<label class="radio"><input type="radio" name="${name}" value="${value}" ${checked ? 'checked' : ''}> ${label}</label>`;
}

function button(text: string, cls: string, onClick: () => void) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
