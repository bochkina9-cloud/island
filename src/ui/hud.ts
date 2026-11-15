import { DUSK_START, ITEMS, type ItemId, NIGHT_START, RECIPES, type Recipe, SEASONS, TABS, seasonDaysLeft } from '../game/data';
import type { Game } from '../game/sim';
import { type Entity, type Slot, countItem, freshness } from '../game/state';
import { MAP_SIZE } from '../game/world';
import { iconUrl } from '../render/art';

const HOTKEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Inline SVG icons for the three bars. */
const STAT_ICONS = {
  hp: '<path d="M12 21s-7-4.6-9.3-9C1 8.5 3 5 6.4 5c2 0 3.6 1.2 4.6 2.7C12 6.2 13.6 5 15.6 5 19 5 21 8.5 21.3 12c-2.3 4.4-9.3 9-9.3 9z" fill="#d8484e"/>',
  hunger: '<path d="M6 4c4-2 10 0 12 4s0 10-4 11-9-1-10-5 0-8 2-10z" fill="#c98a4a"/><path d="M15 16l5 5" stroke="#f4ecd8" stroke-width="3" stroke-linecap="round"/>',
  thirst: '<path d="M12 3c3 4.5 6 8 6 11.5A6 6 0 0 1 6 14.5C6 11 9 7.5 12 3z" fill="#4aa3d8"/>',
};

export class Hud {
  readonly root: HTMLElement;
  private clockHand: SVGLineElement;
  private dayLabel: HTMLElement;
  private seasonLabel: HTMLElement;
  private bars: Record<'hp' | 'hunger' | 'thirst', { fill: SVGCircleElement; value: HTMLElement; box: HTMLElement }>;
  private hotbar: HTMLElement;
  private handSlot: HTMLElement;
  private context: HTMLElement;
  private toasts: HTMLElement;
  private craftTabs: HTMLElement;
  private craftPanel: HTMLElement;
  private openTab: Recipe['tab'] | null = null;
  private chestPanel: HTMLElement;
  private chest: Entity | null = null;
  private mapPanel: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private hint: HTMLElement;
  private tooltip: HTMLElement;
  private rain: HTMLCanvasElement;
  private drops: { x: number; y: number; s: number }[] = [];
  private lastInvKey = '';
  private dragFrom: number | null = null;
  /** Called when a building recipe is chosen; the main loop enters placement mode. */
  onPlace?: (r: Recipe) => void;

  constructor(private game: Game, private groundCanvas: HTMLCanvasElement) {
    this.root = el('div', 'hud');
    document.body.appendChild(this.root);
    this.rain = el('canvas', 'rain');
    this.root.appendChild(this.rain);
    for (let i = 0; i < 260; i++) this.drops.push({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 });

    // Top left: clock and day.
    const clock = el('div', 'clock panel');
    clock.innerHTML = `
      <svg viewBox="-50 -50 100 100" width="78" height="78">
        ${arc(0, DUSK_START, '#f2d27a')}${arc(DUSK_START, NIGHT_START, '#d98a52')}${arc(NIGHT_START, 1, '#3b4a7a')}
        <circle r="30" fill="#f4ecd8" stroke="#3d2b1f" stroke-width="2"/>
        <line class="hand" x1="0" y1="0" x2="0" y2="-40" stroke="#3d2b1f" stroke-width="4" stroke-linecap="round"/>
        <circle r="4" fill="#3d2b1f"/>
      </svg>
      <div class="day">День 1</div>
      <div class="season small"></div>`;
    this.clockHand = clock.querySelector('.hand')!;
    this.dayLabel = clock.querySelector('.day')!;
    this.seasonLabel = clock.querySelector('.season')!;
    this.root.appendChild(clock);

    // Top right: health, hunger, thirst.
    const stats = el('div', 'stats');
    const mk = (key: 'hp' | 'hunger' | 'thirst', title: string) => {
      const box = el('div', 'stat panel');
      box.title = title;
      box.innerHTML = `
        <svg viewBox="0 0 60 60" width="58" height="58">
          <circle cx="30" cy="30" r="24" fill="#f4ecd8" stroke="#d9cbb0" stroke-width="7"/>
          <circle class="fill" cx="30" cy="30" r="24" fill="none" stroke-width="7" stroke-linecap="round"
            transform="rotate(-90 30 30)" stroke-dasharray="150.8" stroke-dashoffset="0"/>
          <g transform="translate(18 17)">${STAT_ICONS[key]}</g>
        </svg>
        <div class="value">100</div>`;
      stats.appendChild(box);
      return { fill: box.querySelector('.fill') as SVGCircleElement, value: box.querySelector('.value') as HTMLElement, box };
    };
    this.bars = { hp: mk('hp', 'Здоровье'), hunger: mk('hunger', 'Сытость'), thirst: mk('thirst', 'Вода') };
    this.bars.hp.fill.setAttribute('stroke', '#d8484e');
    this.bars.hunger.fill.setAttribute('stroke', '#c98a4a');
    this.bars.thirst.fill.setAttribute('stroke', '#4aa3d8');
    this.root.appendChild(stats);

    // Left: crafting tabs and recipe panel.
    this.craftTabs = el('div', 'craft-tabs');
    for (const t of TABS) {
      const b = el('button', 'tab panel');
      b.dataset.tab = t.id;
      const iconKey = { tools: 'axe', survival: 'torch', food: 'meat_cooked', build: 'wood' }[t.id];
      b.innerHTML = `<img src="${iconUrl(iconKey)}" alt=""><span>${t.name}</span>`;
      b.onclick = () => this.toggleCraft(t.id);
      this.craftTabs.appendChild(b);
    }
    this.root.appendChild(this.craftTabs);
    this.craftPanel = el('div', 'craft-panel panel hidden');
    this.root.appendChild(this.craftPanel);

    // Bottom: context action, hand slot, inventory.
    this.toasts = el('div', 'toasts');
    this.context = el('div', 'context hidden');
    const bottom = el('div', 'bottom');
    this.handSlot = el('div', 'slot hand');
    this.handSlot.title = 'В руке (клик — убрать в инвентарь)';
    this.handSlot.onclick = () => game.unequip();
    this.hotbar = el('div', 'hotbar panel');
    this.hotbar.appendChild(this.handSlot);
    this.hotbar.appendChild(el('div', 'divider'));
    game.player.inv.forEach((_, i) => {
      const s = el('div', 'slot');
      s.dataset.i = String(i);
      s.draggable = true;
      s.onclick = () => {
        if (this.chest) game.chestPut(this.chest, i);
        else game.useSlot(i);
        this.refreshAll();
      };
      s.oncontextmenu = (e) => {
        e.preventDefault();
        game.dropSlot(i);
      };
      s.ondragstart = () => (this.dragFrom = i);
      s.ondragover = (e) => e.preventDefault();
      s.ondrop = (e) => {
        e.preventDefault();
        if (this.dragFrom !== null && this.dragFrom !== i) game.moveSlot(this.dragFrom, i);
        this.dragFrom = null;
      };
      s.onmouseenter = () => this.showTooltip(s, game.player.inv[i]);
      s.onmouseleave = () => this.hideTooltip();
      this.hotbar.appendChild(s);
    });
    bottom.append(this.toasts, this.context, this.hotbar);
    this.root.appendChild(bottom);

    this.hint = el('div', 'hint hidden');
    this.root.appendChild(this.hint);
    this.tooltip = el('div', 'tooltip hidden');
    this.root.appendChild(this.tooltip);

    // Chest window.
    this.chestPanel = el('div', 'chest-panel panel hidden');
    this.root.appendChild(this.chestPanel);
    game.openChest = (e) => this.openChest(e);

    // Map window.
    this.mapPanel = el('div', 'map-panel panel hidden');
    this.mapPanel.innerHTML = '<h2>Карта архипелага</h2><p class="muted">Открывается по мере исследования. M или Tab — закрыть.</p>';
    this.mapCanvas = el('canvas');
    this.mapCanvas.width = 512;
    this.mapCanvas.height = 512;
    this.mapPanel.appendChild(this.mapCanvas);
    this.root.appendChild(this.mapPanel);

    this.refreshAll();
  }

  destroy() {
    this.root.remove();
  }

  // ---------------- Per frame ----------------

  update(contextText: string | null, dt = 0) {
    const g = this.game;
    const p = g.player;
    this.drawRain(dt);
    this.clockHand.setAttribute('transform', `rotate(${g.state.time * 360})`);
    this.dayLabel.textContent = `День ${g.state.day}`;
    const left = seasonDaysLeft(g.state.day);
    this.seasonLabel.textContent = `${SEASONS[g.season].name} · ${left === 1 ? 'последний день' : `ещё ${left} дн.`}`;
    this.seasonLabel.classList.toggle('dry', g.season === 'dry');
    for (const key of ['hp', 'hunger', 'thirst'] as const) {
      const v = p[key];
      const b = this.bars[key];
      b.fill.setAttribute('stroke-dashoffset', String(150.8 * (1 - v / 100)));
      b.value.textContent = String(Math.ceil(v));
      b.box.classList.toggle('low', v < 25);
    }
    if (contextText) {
      this.context.textContent = contextText;
      this.context.classList.remove('hidden');
    } else {
      this.context.classList.add('hidden');
    }
    // Rebuild slots only when the inventory changed.
    const key = JSON.stringify([p.inv, p.hand, this.chest?.slots], (_, v) => (typeof v === 'number' ? Math.ceil(v) : v));
    if (key !== this.lastInvKey) {
      this.lastInvKey = key;
      this.refreshAll();
    }
  }

  refreshAll() {
    const p = this.game.player;
    renderSlot(this.handSlot, p.hand);
    this.hotbar.querySelectorAll<HTMLElement>('.slot[data-i]').forEach((s) => {
      const i = Number(s.dataset.i);
      renderSlot(s, p.inv[i], HOTKEYS[i]);
    });
    this.craftTabs.querySelectorAll<HTMLElement>('.tab').forEach((t) => {
      const can = RECIPES.some((r) => r.tab === t.dataset.tab && this.game.canCraft(r));
      t.classList.toggle('can', can);
      t.classList.toggle('active', t.dataset.tab === this.openTab);
    });
    if (this.openTab) this.renderCraft();
    if (this.chest) this.renderChest();
  }

  // ---------------- Crafting ----------------

  toggleCraft(tab?: Recipe['tab']) {
    const next = tab ?? (this.openTab ? null : 'tools');
    this.openTab = this.openTab === next ? null : next;
    this.craftPanel.classList.toggle('hidden', !this.openTab);
    this.refreshAll();
  }

  private renderCraft() {
    const tab = TABS.find((t) => t.id === this.openTab)!;
    this.craftPanel.innerHTML = `<h3>${tab.name}</h3>`;
    for (const r of RECIPES.filter((q) => q.tab === this.openTab)) {
      const can = this.game.canCraft(r);
      const icon = 'item' in r.makes ? r.makes.item : { campfire: 'wood', chest: 'rope', shelter: 'grass', rain_catcher: 'flask', raft: 'paddle', salt_pan: 'salt' }[r.makes.structure];
      const row = el('div', `recipe ${can ? 'can' : ''}`);
      const needs = Object.entries(r.needs).map(([id, n]) => {
        const have = countItem(this.game.player.inv, id as ItemId);
        return `<span class="need ${have >= (n ?? 0) ? 'ok' : ''}" title="${ITEMS[id as ItemId].name}">
          <img src="${iconUrl(id)}" alt="">${have}/${n}</span>`;
      }).join('');
      const what = 'item' in r.makes ? ITEMS[r.makes.item].hint : 'Постройка: выберите место рядом с собой.';
      row.innerHTML = `<img class="big" src="${iconUrl(icon)}" alt="">
        <div class="info"><b>${r.name}</b><div class="muted small">${what}</div><div class="needs">${needs}</div></div>`;
      const btn = el('button', 'btn', 'item' in r.makes ? 'Сделать' : 'Построить');
      btn.disabled = !can;
      btn.onclick = () => {
        if ('item' in r.makes) this.game.craft(r);
        else this.onPlace?.(r);
        this.refreshAll();
      };
      row.appendChild(btn);
      this.craftPanel.appendChild(row);
    }
  }

  // ---------------- Chest ----------------

  openChest(e: Entity) {
    this.chest = e;
    this.chestPanel.classList.remove('hidden');
    this.renderChest();
  }

  closeChest() {
    this.chest = null;
    this.chestPanel.classList.add('hidden');
  }

  get chestOpen() {
    return !!this.chest;
  }

  private renderChest() {
    const c = this.chest!;
    const p = this.game.player;
    if (Math.hypot(c.x - p.x, c.z - p.z) > 3 || !this.game.state.entities.includes(c)) {
      this.closeChest();
      return;
    }
    const raft = c.kind === 'raft';
    this.chestPanel.innerHTML = `<h3>${raft ? 'Груз плота' : 'Сундук'}</h3><p class="muted small">Клик по предмету здесь — забрать. Клик по слоту внизу — положить.${raft ? ' Если шторм разобьёт плот, груз утонет.' : ''}</p>`;
    const grid = el('div', 'chest-grid');
    const size = c.slots?.length ?? 0;
    grid.style.gridTemplateColumns = `repeat(${size}, 54px)`;
    for (let i = 0; i < size; i++) {
      const s = el('div', 'slot');
      renderSlot(s, c.slots?.[i] ?? null);
      s.onclick = () => {
        this.game.chestTake(c, i);
        this.refreshAll();
      };
      grid.appendChild(s);
    }
    const close = el('button', 'btn', 'Закрыть');
    close.onclick = () => this.closeChest();
    this.chestPanel.append(grid, close);
  }

  // ---------------- Map ----------------

  get mapOpen() {
    return !this.mapPanel.classList.contains('hidden');
  }

  toggleMap() {
    this.mapPanel.classList.toggle('hidden');
    if (this.mapOpen) this.drawMap();
  }

  private drawMap() {
    const ctx = this.mapCanvas.getContext('2d')!;
    const s = this.mapCanvas.width;
    ctx.fillStyle = '#d9c9a3';
    ctx.fillRect(0, 0, s, s);
    // Fog of war: draw the island only where it was explored.
    const fog = document.createElement('canvas');
    fog.width = MAP_SIZE;
    fog.height = MAP_SIZE;
    const f = fog.getContext('2d')!;
    const img = f.createImageData(MAP_SIZE, MAP_SIZE);
    for (let i = 0; i < this.game.explored.length; i++) img.data[i * 4 + 3] = this.game.explored[i] ? 255 : 0;
    f.putImageData(img, 0, 0);
    const layer = document.createElement('canvas');
    layer.width = s;
    layer.height = s;
    const l = layer.getContext('2d')!;
    l.fillStyle = '#6fb7c4';
    l.fillRect(0, 0, s, s);
    l.drawImage(this.groundCanvas, 0, 0, s, s);
    l.globalCompositeOperation = 'destination-in';
    l.imageSmoothingEnabled = true;
    l.filter = 'blur(3px)';
    l.drawImage(fog, 0, 0, s, s);
    ctx.drawImage(layer, 0, 0);
    // Camp and player markers.
    const k = s / MAP_SIZE;
    for (const e of this.game.state.entities) {
      if (e.kind === 'campfire' || e.kind === 'shelter' || e.kind === 'chest') {
        ctx.fillStyle = '#b5482e';
        ctx.fillRect(e.x * k - 3, e.z * k - 3, 6, 6);
      }
    }
    // Names of islands you have set foot near.
    ctx.font = '22px Neucha, sans-serif';
    ctx.textAlign = 'center';
    for (const is of this.game.terrain.islands) {
      let seen = false;
      for (let a = 0; a < Math.PI * 2 && !seen; a += 0.5) {
        for (const r of [0, is.r * 0.4, is.r * 0.7]) {
          const x = Math.round(is.x + Math.cos(a) * r);
          const z = Math.round(is.z + Math.sin(a) * r);
          if (this.game.explored[z * MAP_SIZE + x]) seen = true;
        }
      }
      if (!seen) continue;
      ctx.fillStyle = 'rgba(244,236,216,0.85)';
      const w = ctx.measureText(is.name).width + 12;
      ctx.fillRect(is.x * k - w / 2, (is.z - is.r * 0.95) * k - 18, w, 24);
      ctx.fillStyle = '#3d2b1f';
      ctx.fillText(is.name, is.x * k, (is.z - is.r * 0.95) * k);
    }
    const p = this.game.player;
    ctx.fillStyle = '#3d2b1f';
    ctx.beginPath();
    ctx.arc(p.x * k, p.z * k, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f4ecd8';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // ---------------- Rain ----------------

  private drawRain(dt: number) {
    const storm = Math.max(this.game.storm, this.game.rain * 0.6);
    const c = this.rain;
    if (storm < 0.02) {
      if (c.width) c.width = 0;
      return;
    }
    if (c.width !== window.innerWidth || c.height !== window.innerHeight) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = `rgba(210,225,240,${0.45 * storm})`;
    ctx.lineWidth = 1.5;
    const wind = this.game.wind.x;
    ctx.beginPath();
    const count = Math.floor(this.drops.length * storm);
    for (let i = 0; i < count; i++) {
      const d = this.drops[i];
      d.y += dt * 1.4 * d.s;
      d.x += dt * 0.25 * wind * d.s;
      if (d.y > 1) {
        d.y -= 1;
        d.x = Math.random();
      }
      d.x = (d.x + 1) % 1;
      const x = d.x * c.width;
      const y = d.y * c.height;
      ctx.moveTo(x, y);
      ctx.lineTo(x + wind * 8 * d.s, y + 22 * d.s);
    }
    ctx.stroke();
  }

  // ---------------- Messages ----------------

  toast(text: string) {
    if (!text) return;
    const t = el('div', 'toast', text);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstChild!.remove();
    setTimeout(() => t.classList.add('fade'), 2600);
    setTimeout(() => t.remove(), 3200);
  }

  setHint(text: string | null) {
    this.hint.classList.toggle('hidden', !text);
    if (text) this.hint.textContent = text;
  }

  private showTooltip(anchor: HTMLElement, slot: Slot | null) {
    if (!slot) return;
    const def = ITEMS[slot.item];
    const parts = [`<b>${def.name}</b>`, `<span class="muted">${def.hint}</span>`];
    if (def.spoilDays !== undefined) {
      const f = Math.round((slot.fresh ?? 1) * 100);
      const band = freshness(slot);
      parts.push(`<span class="${band}">Свежесть ${f}%${band === 'stale' ? ' — черствеет' : band === 'spoiling' ? ' — вот-вот испортится' : ''}</span>`);
    }
    if (def.food) {
      const f = def.food;
      parts.push(`<span>${[f.hunger ? `сытость +${f.hunger}` : '', f.thirst ? `вода +${f.thirst}` : '', f.health ? `здоровье ${f.health > 0 ? '+' : ''}${f.health}` : ''].filter(Boolean).join(', ')}</span>`);
    }
    parts.push(`<span class="muted small">${def.food ? 'Клик — съесть' : def.tool ? 'Клик — взять в руку' : ''}${def.food || def.tool ? ' · ' : ''}ПКМ — выбросить</span>`);
    this.tooltip.innerHTML = parts.join('<br>');
    this.tooltip.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    this.tooltip.style.left = `${r.left + r.width / 2}px`;
    this.tooltip.style.top = `${r.top - 8}px`;
  }

  private hideTooltip() {
    this.tooltip.classList.add('hidden');
  }
}

function renderSlot(s: HTMLElement, slot: Slot | null, hotkey?: string) {
  const parts: string[] = [];
  if (hotkey) parts.push(`<span class="key">${hotkey}</span>`);
  if (slot) {
    parts.push(`<img src="${iconUrl(slot.item)}" alt="${ITEMS[slot.item].name}">`);
    if (slot.count > 1) parts.push(`<span class="count">${slot.count}</span>`);
    const max = ITEMS[slot.item].durability;
    if (max && slot.durability !== undefined) {
      parts.push(`<span class="dur"><i style="width:${Math.max(0, (slot.durability / max) * 100)}%"></i></span>`);
    }
    if (ITEMS[slot.item].spoilDays !== undefined) {
      const f = Math.max(0, Math.min(1, slot.fresh ?? 1));
      // Green → yellow → red as food goes off.
      const hue = Math.round(f * 110);
      parts.push(`<span class="dur fresh"><i style="width:${Math.ceil(f * 10) * 10}%;background:hsl(${hue},55%,42%)"></i></span>`);
    }
  }
  const html = parts.join('');
  if (s.innerHTML !== html) s.innerHTML = html;
}

function arc(from: number, to: number, color: string): string {
  const r = 40;
  const a0 = from * Math.PI * 2 - Math.PI / 2;
  const a1 = to * Math.PI * 2 - Math.PI / 2;
  const large = to - from > 0.5 ? 1 : 0;
  return `<path d="M0,0 L${r * Math.cos(a0)},${r * Math.sin(a0)} A${r},${r} 0 ${large} 1 ${r * Math.cos(a1)},${r * Math.sin(a1)} Z" fill="${color}" stroke="#3d2b1f" stroke-width="2"/>`;
}
