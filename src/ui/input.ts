import type { MoveInput } from '../game/sim';

/**
 * Turns devices into game intentions. Keyboard and mouse now; a touch source
 * (virtual stick + tap to act) can feed the same [move] and callbacks later.
 */
export class Controls {
  private keys = new Set<string>();
  enabled = true;

  constructor(private handlers: {
    action: () => void;
    hotkey: (index: number) => void;
    toggleMap: () => void;
    toggleCraft: () => void;
    escape: () => void;
    help: () => void;
  }) {
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    if (down) this.keys.add(code);
    else this.keys.delete(code);
    if (!down || e.repeat) return;
    if (code === 'Escape') return this.handlers.escape();
    if (!this.enabled) return;
    if (code === 'KeyE' || code === 'Space') {
      e.preventDefault();
      this.handlers.action();
    } else if (code === 'KeyM' || code === 'Tab') {
      e.preventDefault();
      this.handlers.toggleMap();
    } else if (code === 'KeyC') {
      this.handlers.toggleCraft();
    } else if (code === 'KeyH' || code === 'F1') {
      e.preventDefault();
      this.handlers.help();
    } else {
      const m = /^Digit(\d)$/.exec(code);
      if (m) this.handlers.hotkey(m[1] === '0' ? 9 : Number(m[1]) - 1);
      if (code === 'Minus') this.handlers.hotkey(10);
      if (code === 'Equal') this.handlers.hotkey(11);
    }
  }

  /** Movement from WASD / arrows, in world axes. */
  move(): MoveInput {
    if (!this.enabled) return { x: 0, z: 0 };
    const k = this.keys;
    const x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const z = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
    return { x, z };
  }

  /** Holding the action key keeps working on the same target. */
  get actionHeld(): boolean {
    return this.enabled && (this.keys.has('KeyE') || this.keys.has('Space'));
  }
}
