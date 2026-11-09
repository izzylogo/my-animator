export interface BrushSettings {
  size: number; // diameter in pixels at full pressure
  color: string;
  eraser: boolean;
  pressure: boolean; // let pen pressure change the width
  minPressureSize: number; // 0..1, width at the lightest touch (fraction of size)
  smoothing: number; // 0..1, how much the line is steadied
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
  p: number; // pressure 0..1
}

/**
 * Paints one stroke onto a drawing.
 *
 * Smoothness: the pen's path goes through two soft filters in a row before it is painted.
 * Each filter eases towards the pen by an amount based on how far the pen has moved, so
 * holding still never makes the line creep. Higher smoothness irons out more shake, but the
 * line trails further behind the pen. When the pen lifts, the line curves in to where the
 * pen ended. Points are joined with curves (not straight segments), so lines look smooth.
 */
export class BrushStroke {
  /** The painted path (after smoothing). Used by "hold to straighten". */
  readonly points: Pt[] = [];
  private ctx: CanvasRenderingContext2D;
  private pos: Pt; // where the brush is (trails the pen)
  private soft: { x: number; y: number }; // the first filter's position
  private prevRaw: Pt;
  private speed = 0; // how far the pen travels between samples, evened out
  private lastRaw: Pt;
  private lastPt: Pt;
  private lastMid: { x: number; y: number; w: number };
  private minX = Infinity;
  private minY = Infinity;
  private maxX = -Infinity;
  private maxY = -Infinity;

  constructor(private canvas: HTMLCanvasElement, private s: BrushSettings, first: Pt) {
    this.ctx = canvas.getContext('2d')!;
    this.pos = { ...first };
    this.soft = { x: first.x, y: first.y };
    this.prevRaw = { ...first };
    this.lastRaw = { ...first };
    this.lastPt = { ...first };
    const w = this.width(first.p);
    this.lastMid = { x: first.x, y: first.y, w };
    this.points.push({ ...first });
    this.dab(first.x, first.y, w);
  }

  /** A new pen sample. */
  add(raw: Pt): void {
    this.lastRaw = raw;
    const s = this.s.smoothing;
    if (s <= 0) {
      this.paintTo({ ...raw });
      return;
    }
    const moved = Math.hypot(raw.x - this.prevRaw.x, raw.y - this.prevRaw.y);
    this.prevRaw = raw;
    this.pos.p += (raw.p - this.pos.p) * 0.35;
    if (moved <= 0) return;
    this.speed += (moved - this.speed) * 0.2;
    this.follow(raw, moved);
    this.paintTo({ ...this.pos });
  }

  /** Ease both filters towards the target, by an amount based on the distance travelled. */
  private follow(target: { x: number; y: number }, moved: number): void {
    const s = this.s.smoothing;
    // Shake shows on slow lines. A quick pen doesn't need as much, so the line can stay closer.
    const k = 1 - Math.exp(-moved / (1 + (40 * s * s) / (1 + this.speed / 5)));
    this.soft.x += (target.x - this.soft.x) * k;
    this.soft.y += (target.y - this.soft.y) * k;
    this.pos.x += (this.soft.x - this.pos.x) * k;
    this.pos.y += (this.soft.y - this.pos.y) * k;
  }

  /** The pen has paused: glide the line up to it. Returns true if the line moved. */
  catchUp(): boolean {
    const end = this.lastRaw;
    if (this.s.smoothing <= 0 || Math.hypot(end.x - this.pos.x, end.y - this.pos.y) <= 0.5) return false;
    this.follow(end, 8);
    this.paintTo({ ...this.pos });
    return true;
  }

  /** Pen lifted: catch up to where the pen actually ended, then finish the curve. */
  finish(): void {
    if (this.s.smoothing > 0) {
      const end = this.lastRaw;
      for (let i = 0; i < 800 && Math.hypot(end.x - this.pos.x, end.y - this.pos.y) > 0.5; i++) {
        this.follow(end, 3);
        this.paintTo({ ...this.pos });
      }
      this.paintTo({ x: end.x, y: end.y, p: this.pos.p });
    }
    const w = this.width(this.lastPt.p);
    this.segment(this.lastMid.x, this.lastMid.y, this.lastPt.x, this.lastPt.y, this.lastPt.x, this.lastPt.y, (w + this.lastMid.w) / 2);
  }

  /** The area the stroke touched, clipped to the canvas. */
  bounds(): Rect | null {
    if (this.minX > this.maxX) return null;
    const x = Math.max(0, Math.floor(this.minX));
    const y = Math.max(0, Math.floor(this.minY));
    const r = Math.min(this.canvas.width, Math.ceil(this.maxX));
    const b = Math.min(this.canvas.height, Math.ceil(this.maxY));
    return r > x && b > y ? { x, y, w: r - x, h: b - y } : null;
  }

  /** Average width of the stroke so far (used when a stroke is straightened into a shape). */
  averageWidth(): number {
    const sum = this.points.reduce((a, p) => a + this.width(p.p), 0);
    return sum / Math.max(1, this.points.length);
  }

  private paintTo(pt: Pt): void {
    if (Math.hypot(pt.x - this.lastPt.x, pt.y - this.lastPt.y) < 0.75) return;
    const w = this.width(pt.p);
    // Curve from the previous midpoint to the new midpoint, bending through the last point.
    const mid = { x: (this.lastPt.x + pt.x) / 2, y: (this.lastPt.y + pt.y) / 2, w: (this.width(this.lastPt.p) + w) / 2 };
    this.segment(this.lastMid.x, this.lastMid.y, this.lastPt.x, this.lastPt.y, mid.x, mid.y, (this.lastMid.w + mid.w) / 2);
    this.lastMid = mid;
    this.lastPt = pt;
    this.points.push(pt);
  }

  private segment(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number): void {
    const ctx = this.prep();
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, cy, x1, y1);
    ctx.stroke();
    this.grow(x0, y0, w);
    this.grow(cx, cy, w);
    this.grow(x1, y1, w);
  }

  /** The line width this pressure gives. */
  width(pressure: number): number {
    if (!this.s.pressure) return this.s.size;
    const p = Math.min(1, Math.max(0, pressure));
    const min = this.s.minPressureSize;
    return Math.max(0.5, this.s.size * (min + (1 - min) * p));
  }

  private dab(x: number, y: number, w: number): void {
    const ctx = this.prep();
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    this.grow(x, y, w);
  }

  private prep(): CanvasRenderingContext2D {
    const ctx = this.ctx;
    ctx.globalCompositeOperation = this.s.eraser ? 'destination-out' : 'source-over';
    ctx.strokeStyle = ctx.fillStyle = this.s.eraser ? '#000' : this.s.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    return ctx;
  }

  private grow(x: number, y: number, w: number): void {
    const pad = w / 2 + 2;
    this.minX = Math.min(this.minX, x - pad);
    this.minY = Math.min(this.minY, y - pad);
    this.maxX = Math.max(this.maxX, x + pad);
    this.maxY = Math.max(this.maxY, y + pad);
  }
}
