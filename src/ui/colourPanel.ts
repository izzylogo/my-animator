type RGB = [number, number, number];

const toHex = (c: RGB) => `#${c.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;

function fromHex(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return [h, max ? d / max : 0, max / 255];
}

const HUES = [0, 24, 42, 56, 84, 130, 168, 190, 212, 240, 275, 325];
const SHADES: [number, number][] = [
  [0.25, 1],
  [0.5, 1],
  [0.85, 0.95],
  [0.85, 0.65],
  [0.85, 0.4],
];

/** A colour field, a hue strip, exact numbers, recent colours and a full grid of shades. */
export class ColourPanel {
  private h = 0;
  private s = 0;
  private v = 0;
  private recent: string[] = [];
  private sv = document.getElementById('cp-sv') as HTMLCanvasElement;
  private hue = document.getElementById('cp-hue') as HTMLCanvasElement;
  private hexBox = document.getElementById('cp-hex') as HTMLInputElement;
  private rgbBoxes = ['cp-r', 'cp-g', 'cp-b'].map((id) => document.getElementById(id) as HTMLInputElement);
  private recentRow = document.getElementById('cp-recent') as HTMLElement;

  constructor(
    private onPick: (hex: string, done: boolean) => void,
    private onBack: (hex: string) => void,
  ) {
    this.buildGrid();
    this.dragOn(this.sv, (x, y) => {
      this.s = x;
      this.v = 1 - y;
    });
    this.dragOn(this.hue, (x) => {
      this.h = Math.min(359.9, x * 360);
    });
    this.hexBox.onchange = () => this.typed(fromHex(this.hexBox.value));
    for (const box of this.rgbBoxes) {
      box.onchange = () => this.typed(this.rgbBoxes.map((b) => Math.max(0, Math.min(255, Number(b.value) || 0))) as RGB);
    }
    this.draw();
  }

  private hex(): string {
    return toHex(hsvToRgb(this.h, this.s, this.v));
  }

  /** Show a colour chosen somewhere else. */
  set(hex: string): void {
    const rgb = fromHex(hex);
    if (!rgb || hex.toLowerCase() === this.hex()) return;
    const [h, s, v] = rgbToHsv(rgb);
    if (s > 0) this.h = h; // greys have no hue, so keep the strip where it was
    this.s = s;
    this.v = v;
    this.draw();
  }

  private typed(rgb: RGB | null): void {
    if (!rgb) return this.draw();
    const hex = toHex(rgb);
    this.set(hex);
    this.finish(hex);
  }

  private finish(hex: string): void {
    this.recent = [hex, ...this.recent.filter((c) => c !== hex)].slice(0, 12);
    this.drawRecent();
    this.onPick(hex, true);
  }

  private swatch(c: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.style.background = c;
    b.title = `${c}. Click for the front colour, right-click for the back colour`;
    b.setAttribute('aria-label', `Colour ${c}`);
    b.onclick = () => {
      this.set(c);
      this.finish(c);
    };
    b.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onBack(c);
    };
    return b;
  }

  private buildGrid(): void {
    const grid = document.getElementById('swatches')!;
    for (let i = 0; i < HUES.length; i++) {
      const v = Math.round((255 * i) / (HUES.length - 1));
      grid.append(this.swatch(toHex([v, v, v])));
    }
    for (const [v, s] of SHADES) for (const h of HUES) grid.append(this.swatch(toHex(hsvToRgb(h, s, v))));
  }

  private dragOn(c: HTMLCanvasElement, move: (x: number, y: number) => void): void {
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      move(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
      this.draw();
      this.onPick(this.hex(), false);
    };
    c.addEventListener('pointerdown', (e) => {
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      at(e);
      const moved = (ev: PointerEvent) => at(ev);
      const up = () => {
        c.removeEventListener('pointermove', moved);
        c.removeEventListener('pointerup', up);
        c.removeEventListener('pointercancel', up);
        this.finish(this.hex());
      };
      c.addEventListener('pointermove', moved);
      c.addEventListener('pointerup', up);
      c.addEventListener('pointercancel', up);
    });
  }

  private drawRecent(): void {
    this.recentRow.replaceChildren(...this.recent.map((c) => this.swatch(c)));
  }

  private draw(): void {
    const sv = this.sv.getContext('2d')!;
    const { width: w, height: h } = this.sv;
    sv.fillStyle = toHex(hsvToRgb(this.h, 1, 1));
    sv.fillRect(0, 0, w, h);
    const white = sv.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, '#fff');
    white.addColorStop(1, 'rgba(255,255,255,0)');
    sv.fillStyle = white;
    sv.fillRect(0, 0, w, h);
    const black = sv.createLinearGradient(0, 0, 0, h);
    black.addColorStop(0, 'rgba(0,0,0,0)');
    black.addColorStop(1, '#000');
    sv.fillStyle = black;
    sv.fillRect(0, 0, w, h);
    const x = this.s * w;
    const y = (1 - this.v) * h;
    sv.lineWidth = 2;
    sv.strokeStyle = this.v > 0.6 && this.s < 0.5 ? '#000' : '#fff';
    sv.beginPath();
    sv.arc(x, y, 5, 0, Math.PI * 2);
    sv.stroke();

    const hue = this.hue.getContext('2d')!;
    const strip = hue.createLinearGradient(0, 0, this.hue.width, 0);
    for (let i = 0; i <= 6; i++) strip.addColorStop(i / 6, toHex(hsvToRgb(i * 60 === 360 ? 359.9 : i * 60, 1, 1)));
    hue.fillStyle = strip;
    hue.fillRect(0, 0, this.hue.width, this.hue.height);
    const hx = (this.h / 360) * this.hue.width;
    hue.fillStyle = '#000';
    hue.fillRect(hx - 2, 0, 4, this.hue.height);
    hue.fillStyle = '#fff';
    hue.fillRect(hx - 1, 0, 2, this.hue.height);

    const rgb = hsvToRgb(this.h, this.s, this.v);
    this.hexBox.value = toHex(rgb);
    this.rgbBoxes.forEach((b, i) => (b.value = String(Math.round(rgb[i]))));
  }
}
