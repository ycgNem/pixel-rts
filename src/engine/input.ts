// Keyboard and mouse input with rebindable global actions (ported from Sprocket & Sprout, reworked
// for an RTS). Letter keys belong to the command card (context-sensitive buttons); the global
// actions here use keys the card never uses.

export const ACTIONS = [
  'panUp', 'panDown', 'panLeft', 'panRight', 'zoomIn', 'zoomOut',
  'powers', 'research', 'help', 'stats', 'menu', 'alert', 'home', 'idleBuilder', 'army', 'chat', 'debug', 'pause',
] as const;
export type Action = (typeof ACTIONS)[number];

export const DEBUG_KEYS = !!import.meta.env?.DEV || (typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug'));

export const ACTION_LABELS: Record<Action, string> = {
  panUp: 'Scroll up', panDown: 'Scroll down', panLeft: 'Scroll left', panRight: 'Scroll right',
  zoomIn: 'Zoom in', zoomOut: 'Zoom out', powers: 'Command Powers', research: 'Research',
  help: 'How to play', stats: 'Match stats', menu: 'Menu / cancel', alert: 'Jump to last alert',
  home: 'Jump to HQ', idleBuilder: 'Select idle Builder', army: 'Select whole army', chat: 'Chat',
  debug: 'Debug panel', pause: 'Pause',
};

export const DEFAULT_BINDS: Record<Action, string[]> = {
  panUp: ['ArrowUp'], panDown: ['ArrowDown'], panLeft: ['ArrowLeft'], panRight: ['ArrowRight'],
  zoomIn: ['Equal', 'NumpadAdd', 'PageUp'], zoomOut: ['Minus', 'NumpadSubtract', 'PageDown'],
  powers: ['Tab'], research: ['F2'], help: ['F1'], stats: ['F3'], menu: ['Escape', 'F10'],
  alert: ['Space'], home: ['Home'], idleBuilder: ['Period'], army: ['Comma'], chat: ['Enter'],
  debug: ['Backquote'], pause: ['Pause', 'F9'],
};

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Backquote: '`',
    Equal: '=', Minus: '-', Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadAdd: 'Num+', NumpadSubtract: 'Num-',
    Period: '.', Comma: ',', PageUp: 'PgUp', PageDown: 'PgDn',
  };
  return map[code] ?? code;
}

const BLOCK_DEFAULT = new Set(['Tab', 'Space', 'F1', 'F2', 'F3', 'F9', 'F10', 'Backquote', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home']);

export class Input {
  down = new Set<string>();
  pressed = new Set<string>();
  binds: Record<Action, string[]> = structuredClone(DEFAULT_BINDS);
  mouse = {
    x: 0, y: 0, inside: false,
    down: [false, false, false], pressed: [false, false, false], released: [false, false, false],
    wheel: 0, moved: false,
    /** where each button went down (canvas px) */
    from: [[0, 0], [0, 0], [0, 0]] as [number, number][],
    dblclick: false,
  };
  ctrl = false;
  shift = false;
  alt = false;
  /** typed characters this frame (text fields) */
  text = '';
  /** a text field has focus: no actions or card hotkeys */
  textFocus = false;
  captureKey: ((code: string) => void) | null = null;
  /** canvas px per CSS px */
  scale = 1;
  private lastClick = 0;
  private lastClickPos: [number, number] = [0, 0];

  attach(el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (this.captureKey) {
        e.preventDefault();
        const cb = this.captureKey;
        this.captureKey = null;
        cb(e.code);
        return;
      }
      this.ctrl = e.ctrlKey || e.metaKey;
      this.shift = e.shiftKey;
      this.alt = e.altKey;
      if (this.textFocus) {
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) this.text += e.key;
        if (e.key === 'Backspace') this.text += '\b';
        if (e.key === 'Enter') this.pressed.add('Enter');
        if (e.key === 'Escape') this.pressed.add('Escape');
        if (e.key === 'v' && (e.ctrlKey || e.metaKey)) return; // let paste through
        e.preventDefault();
        return;
      }
      if (!e.repeat) this.pressed.add(e.code);
      this.down.add(e.code);
      if (BLOCK_DEFAULT.has(e.code) || (e.ctrlKey && /^Digit|^Key[ASDFWE]$/.test(e.code)) || e.altKey) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.ctrl = e.ctrlKey || e.metaKey;
      this.shift = e.shiftKey;
      this.alt = e.altKey;
    });
    window.addEventListener('paste', (e) => {
      if (this.textFocus) this.text += e.clipboardData?.getData('text') ?? '';
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.shift = this.ctrl = this.alt = false;
      this.mouse.down = [false, false, false];
    });
    const pos = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) * this.scale;
      this.mouse.y = (e.clientY - r.top) * this.scale;
    };
    el.addEventListener('mousemove', (e) => { pos(e); this.mouse.moved = true; this.mouse.inside = true; });
    el.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    el.addEventListener('mouseenter', () => { this.mouse.inside = true; });
    el.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      pos(e);
      this.mouse.down[e.button] = true;
      this.mouse.pressed[e.button] = true;
      this.mouse.from[e.button] = [this.mouse.x, this.mouse.y];
      this.shift = e.shiftKey;
      this.ctrl = e.ctrlKey || e.metaKey;
      this.alt = e.altKey;
      if (e.button === 0) {
        const now = performance.now();
        this.mouse.dblclick = now - this.lastClick < 350 && Math.hypot(this.mouse.x - this.lastClickPos[0], this.mouse.y - this.lastClickPos[1]) < 12 * this.scale;
        this.lastClick = this.mouse.dblclick ? 0 : now;
        this.lastClickPos = [this.mouse.x, this.mouse.y];
      }
      e.preventDefault();
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button > 2) return;
      this.mouse.down[e.button] = false;
      this.mouse.released[e.button] = true;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      pos(e);
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
  }

  isDown(a: Action): boolean {
    if (this.textFocus) return false;
    for (const k of this.binds[a]) if (this.down.has(k)) return true;
    return false;
  }

  wasPressed(a: Action): boolean {
    for (const k of this.binds[a]) if (this.pressed.has(k)) return !this.textFocus || a === 'menu' || a === 'chat';
    return false;
  }

  keyPressed(code: string) {
    return !this.textFocus && this.pressed.has(code);
  }

  consumeKey(code: string) {
    this.pressed.delete(code);
  }

  consume(a: Action) {
    for (const k of this.binds[a]) this.pressed.delete(k);
  }

  consumeMouse(button = 0) {
    this.mouse.pressed[button] = false;
    this.mouse.released[button] = false;
  }

  endFrame() {
    this.pressed.clear();
    this.mouse.pressed = [false, false, false];
    this.mouse.released = [false, false, false];
    this.mouse.wheel = 0;
    this.mouse.moved = false;
    this.mouse.dblclick = false;
    this.text = '';
  }
}
