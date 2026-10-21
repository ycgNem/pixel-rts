// Immediate-mode UI drawn on the canvas with the bitmap font. Coordinates are UI pixels; one UI
// pixel is `scale` device pixels (a whole number, so the pixel art stays crisp).
import type { Input } from '../engine/input';
import { audio } from '../engine/audio';
import { drawText, textWidth, wrapText, LINE_H, ICON } from './font';
import { drawSprite, type Sprite } from '../render/art';

export const COL = {
  bg: '#1d1622',
  panel: '#2e222f',
  panel2: '#3e3546',
  edge: '#625565',
  light: '#9babb2',
  text: '#c7dcd0',
  dim: '#7f708a',
  white: '#ffffff',
  gold: '#f9c22b',
  red: '#e83b3b',
  green: '#1ebc73',
  blue: '#4d9be6',
  shadow: '#1a1420',
  /** oil: its icon and prices */
  oil: '#b0a7b8',
};

export interface ButtonOpts {
  label?: string;
  icon?: Sprite | null;
  /** key code that also triggers it, and the letter shown in the corner */
  hotkey?: string;
  /** more key codes that trigger it (not shown) */
  altKeys?: string[];
  disabled?: boolean;
  active?: boolean;
  tip?: string;
  /** 0..1 fill shown along the bottom */
  progress?: number;
  /** small number in the corner */
  badge?: string;
  badgeColor?: string;
  /** put the badge in the top-right corner, so the label has the whole bottom line */
  badgeTop?: boolean;
  /** an oil price in the top-right corner (with the oil drop) */
  oil?: number;
  oilColor?: string;
  /** cooldown 0..1 overlay */
  cooldown?: number;
  color?: string;
}

export class UI {
  ctx!: CanvasRenderingContext2D;
  input!: Input;
  s = 1;
  /** screen size in UI px */
  w = 0;
  h = 0;
  /** mouse in UI px */
  mx = 0;
  my = 0;
  private blockers: [number, number, number, number][] = [];
  private lastBlockers: [number, number, number, number][] = [];
  private tip: { text: string; x: number; y: number } | null = null;
  /** hotkeys handled this frame (so the world input ignores them) */
  usedKeys = new Set<string>();
  /** a modal is open: only its widgets react */
  modal = false;
  /** the text field with keyboard focus */
  focus: string | null = null;
  private fieldsDrawn = new Set<string>();

  begin(ctx: CanvasRenderingContext2D, input: Input, scale: number) {
    this.ctx = ctx;
    this.input = input;
    this.s = scale;
    this.w = Math.floor(ctx.canvas.width / scale);
    this.h = Math.floor(ctx.canvas.height / scale);
    this.mx = input.mouse.x / scale;
    this.my = input.mouse.y / scale;
    this.lastBlockers = this.blockers;
    this.blockers = [];
    this.tip = null;
    this.usedKeys.clear();
    this.fieldsDrawn.clear();
  }

  end() {
    if (this.tip) this.drawTip(this.tip.text, this.tip.x, this.tip.y);
    // a focused field that wasn't drawn this frame loses focus
    if (this.focus && !this.fieldsDrawn.has(this.focus)) this.blur();
    this.input.textFocus = !!this.focus;
  }

  blur() {
    this.focus = null;
    this.input.textFocus = false;
  }

  /**
   * A one-line text field. Click to type; Enter or a click elsewhere finishes. Returns the new
   * value; `submitted` is set for the frame Enter was pressed.
   */
  textField(id: string, x: number, y: number, w: number, h: number, value: string, opts: { placeholder?: string; max?: number; upper?: boolean } = {}): { value: string; submitted: boolean } {
    this.fieldsDrawn.add(id);
    const inp = this.input;
    const focused = this.focus === id;
    const hov = this.hover(x, y, w, h);
    this.frame(x, y, w, h, COL.shadow, focused ? COL.gold : hov ? COL.light : COL.edge);
    this.block(x, y, w, h);
    if (inp.mouse.pressed[0]) {
      if (hov) { this.focus = id; inp.textFocus = true; inp.consumeMouse(0); }
      else if (focused) this.blur();
    }
    let submitted = false;
    if (this.focus === id) {
      for (const ch of inp.text) {
        if (ch === BACKSPACE) value = value.slice(0, -1);
        else if (value.length < (opts.max ?? 24)) value += opts.upper ? ch.toUpperCase() : ch;
      }
      inp.text = '';
      if (inp.pressed.has('Enter')) { submitted = true; inp.pressed.delete('Enter'); }
      if (inp.pressed.has('Escape')) { this.blur(); inp.pressed.delete('Escape'); }
    }
    const shown = value || (this.focus === id ? '' : opts.placeholder ?? '');
    const tw = this.text(shown, x + 4, y + Math.round((h - 7) / 2), value ? COL.white : COL.dim);
    if (this.focus === id && Math.floor(performance.now() / 500) % 2 === 0) this.rect(x + 5 + (value ? tw : 0), y + 3, 1, h - 6, COL.gold);
    return { value, submitted };
  }

  /** Is the mouse over any UI drawn last frame (so clicks there don't reach the world)? */
  get mouseOverUI(): boolean {
    return this.lastBlockers.some(([x, y, w, h]) => this.mx >= x && this.my >= y && this.mx < x + w && this.my < y + h);
  }

  block(x: number, y: number, w: number, h: number) {
    this.blockers.push([x, y, w, h]);
  }

  hover(x: number, y: number, w: number, h: number): boolean {
    return this.mx >= x && this.my >= y && this.mx < x + w && this.my < y + h;
  }

  /** a click on this rect this frame (consumes it) */
  clicked(x: number, y: number, w: number, h: number, button = 0): boolean {
    if (this.input.mouse.pressed[button] && this.hover(x, y, w, h)) {
      this.input.consumeMouse(button);
      return true;
    }
    return false;
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    const s = this.s;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s));
  }

  frame(x: number, y: number, w: number, h: number, fill = COL.panel, edge = COL.edge) {
    this.rect(x, y, w, h, COL.shadow);
    this.rect(x + 1, y + 1, w - 2, h - 2, edge);
    this.rect(x + 2, y + 2, w - 4, h - 4, fill);
    this.rect(x + 2, y + 2, w - 4, 1, COL.panel2);
  }

  panel(x: number, y: number, w: number, h: number, fill = COL.panel) {
    this.frame(x, y, w, h, fill);
    this.block(x, y, w, h);
  }

  text(str: string, x: number, y: number, color = COL.text, shadow: string | null = COL.shadow): number {
    return drawText(this.ctx, str, Math.round(x * this.s), Math.round(y * this.s), color, this.s, shadow) / this.s;
  }

  textCenter(str: string, cx: number, y: number, color = COL.text) {
    this.text(str, cx - textWidth(str) / 2, y, color);
  }

  textRight(str: string, rx: number, y: number, color = COL.text) {
    this.text(str, rx - textWidth(str), y, color);
  }

  /** Word-wrapped text; returns the height used. */
  para(str: string, x: number, y: number, w: number, color = COL.text): number {
    const lines = wrapText(str, w);
    lines.forEach((l, i) => this.text(l, x, y + i * LINE_H, color));
    return lines.length * LINE_H;
  }

  bar(x: number, y: number, w: number, h: number, frac: number, color: string, back = COL.shadow) {
    this.rect(x, y, w, h, back);
    this.rect(x, y, Math.max(0, Math.min(w, Math.round(w * frac))), h, color);
  }

  icon(sp: Sprite | null, cx: number, cy: number, maxSize: number) {
    if (!sp) return;
    // largest whole scale that fits; big sprites shrink by a whole divisor (icons only)
    const fit = (maxSize * this.s) / Math.max(sp.w, sp.h);
    const k = fit >= 1 ? Math.floor(fit) : 1 / Math.ceil(1 / fit);
    const ctx = this.ctx;
    ctx.drawImage(sp.img, sp.x, sp.y, sp.w, sp.h, Math.round(cx * this.s - (sp.w * k) / 2), Math.round(cy * this.s - (sp.h * k) / 2), Math.round(sp.w * k), Math.round(sp.h * k));
  }

  button(x: number, y: number, w: number, h: number, o: ButtonOpts): boolean {
    const hov = !this.modalBlocked() && this.hover(x, y, w, h);
    const fill = o.disabled ? COL.panel : o.active ? '#45293f' : hov ? COL.panel2 : COL.panel;
    this.frame(x, y, w, h, fill, o.active ? COL.gold : hov && !o.disabled ? COL.light : COL.edge);
    this.block(x, y, w, h);
    if (o.icon) {
      this.ctx.globalAlpha = o.disabled ? 0.4 : 1;
      this.icon(o.icon, x + w / 2, y + h / 2, Math.min(w, h) - 6);
      this.ctx.globalAlpha = 1;
    }
    if (o.label) {
      const tw = textWidth(o.label);
      const ly = o.hotkey && h >= 20 && w < 60 ? y + h - 10 : y + Math.round((h - 7) / 2);
      // with a badge in the corner, center the label in the room left of it
      const room = o.badge && !o.badgeTop ? w - textWidth(o.badge) - 4 : w;
      const lx = o.hotkey && w >= 60 ? x + Math.max(12, Math.round((room - tw) / 2)) : x + Math.max(2, Math.round((room - tw) / 2));
      this.text(o.label, lx, ly, o.disabled ? COL.dim : o.color ?? COL.text);
    }
    if (o.progress !== undefined && o.progress > 0) this.bar(x + 3, y + h - 5, w - 6, 2, o.progress, COL.green);
    if (o.cooldown !== undefined && o.cooldown > 0) {
      this.ctx.globalAlpha = 0.6;
      this.rect(x + 2, y + 2 + (h - 4) * (1 - o.cooldown), w - 4, (h - 4) * o.cooldown, COL.shadow);
      this.ctx.globalAlpha = 1;
    }
    if (o.hotkey && w >= 16 && keyLetter(o.hotkey).length <= 2) this.text(keyLetter(o.hotkey), x + 3, y + 2, o.disabled ? COL.dim : COL.gold);
    if (o.badge) this.textRight(o.badge, x + w - 3, o.badgeTop ? y + 2 : y + h - 10, o.badgeColor ?? COL.white);
    if (o.oil) this.textRight(`${ICON.oil}${o.oil}`, x + w - 3, y + 2, o.oilColor ?? COL.oil);
    if (hov && o.tip) this.tip = { text: o.tip, x: x + w / 2, y };
    if (o.disabled) {
      if (hov && this.input.mouse.pressed[0]) this.input.consumeMouse(0);
      return false;
    }
    let hit = hov && this.input.mouse.pressed[0];
    if (hit) { this.input.consumeMouse(0); audio.sfx('click'); }
    if (!hit && !this.modalBlocked()) for (const k of o.hotkey ? [o.hotkey, ...(o.altKeys ?? [])] : []) {
      if (!this.input.keyPressed(k) || this.usedKeys.has(k)) continue;
      hit = true;
      this.usedKeys.add(k);
      this.input.consumeKey(k);
      break;
    }
    return hit;
  }

  setTip(text: string, x: number, y: number) {
    this.tip = { text, x, y };
  }

  private modalBlocked() {
    return false;
  }

  private drawTip(text: string, cx: number, y: number) {
    const lines = text.split('\n').flatMap((l) => wrapText(l, 150));
    const w = Math.max(...lines.map((l) => textWidth(l))) + 10;
    const h = lines.length * LINE_H + 8;
    let x = Math.round(cx - w / 2);
    let ty = Math.round(y - h - 3);
    x = Math.max(2, Math.min(this.w - w - 2, x));
    if (ty < 2) ty = y + 26;
    this.frame(x, ty, w, h, '#1a1420', COL.light);
    lines.forEach((l, i) => {
      const isTitle = i === 0;
      this.text(l, x + 5, ty + 4 + i * LINE_H, isTitle ? COL.white : COL.text);
    });
  }
}

export function keyLetter(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}

export { drawSprite };

/** what Input puts in `text` for the Backspace key */
const BACKSPACE = String.fromCharCode(8);
