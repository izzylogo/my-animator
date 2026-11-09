import type { Shape } from '../tools/shapes';

/** [a, b, c, d, e, f] — the same 2D transform numbers the canvas uses. */
export type Matrix = [number, number, number, number, number, number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** a after b: apply b first, then a. */
export function mul(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export const apply = (m: Matrix, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

export interface StrokePt {
  x: number;
  y: number;
  w: number; // width at this point
  ctrl?: boolean; // a bend point
  corner?: boolean; // a bend point that makes a sharp peak
}

export interface Anchor {
  x: number;
  y: number;
  ix: number; // handle coming in
  iy: number;
  ox: number; // handle going out
  oy: number;
  ctrl?: boolean; // shown as a bend point
  corner?: boolean; // sharp, no curve through it
  manual?: boolean; // its handles were set by hand, so leave them alone
}

export type LineStyle = 'solid' | 'dashed' | 'dotted' | 'dashdot';

/** One thing in a vector drawing. Everything stays as shapes and maths, so it's sharp at any zoom. */
export type VItem = { m: Matrix; uid?: number } & (
  | { t: 'stroke'; pts: StrokePt[]; color: string; erase: boolean; style?: LineStyle }
  | { t: 'shape'; shape: Shape; width: number; color: string; fill: boolean; fillColor: string; style?: LineStyle }
  | { t: 'bez'; anchors: Anchor[]; closed: boolean; width: number; color: string; fill: boolean; fillColor: string; style?: LineStyle }
  | { t: 'text'; x: number; y: number; lines: string[]; font: string; size: number; color: string; w: number }
  | { t: 'fill'; loops: number[][]; color: string }
  | { t: 'image'; canvas: HTMLCanvasElement; x: number; y: number }
);

const cache = new WeakMap<object, Path2D>();
const runCache = new WeakMap<object, { style?: LineStyle; runs: StrokeRun[] }>();

/** Forget the cached outline after an item's points change. */
export function touch(item: VItem): void {
  const k = geometryOf(item);
  if (k) {
    cache.delete(k);
    runCache.delete(k);
  }
}

/** Outlines are remembered per set of points, so a moved-only object needn't be rebuilt. */
function geometryOf(item: VItem): object | null {
  if (item.t === 'stroke') return item.pts;
  if (item.t === 'shape') return item.shape;
  if (item.t === 'bez') return item.anchors;
  if (item.t === 'fill') return item.loops;
  return null;
}

/** Turn a line, rectangle, ellipse or polygon into a curve with enough points to bend. */
export function toBezItem(item: VItem & { t: 'shape' }): VItem & { t: 'bez' } {
  const s = item.shape;
  const straight = (pts: { x: number; y: number }[]): Anchor[] => pts.map((p) => ({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y }));
  const subdivide = (corners: { x: number; y: number }[], closed: boolean, n: number) => {
    const out: { x: number; y: number }[] = [];
    const count = closed ? corners.length : corners.length - 1;
    for (let i = 0; i < count; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      for (let j = 0; j < n; j++) out.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
    }
    if (!closed) out.push(corners[corners.length - 1]);
    return out;
  };
  let anchors: Anchor[];
  let closed = true;
  if (s.kind === 'ellipse') {
    const n = 16;
    const k = (4 / 3) * Math.tan(Math.PI / (2 * n));
    anchors = Array.from({ length: n }, (_, i) => {
      const a = (i * Math.PI * 2) / n;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const x = s.cx + cos * s.rx;
      const y = s.cy + sin * s.ry;
      return { x, y, ix: x + sin * k * s.rx, iy: y - cos * k * s.ry, ox: x - sin * k * s.rx, oy: y + cos * k * s.ry };
    });
  } else if (s.kind === 'rect') {
    anchors = straight(subdivide([{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }], true, 8));
  } else if (s.kind === 'poly') {
    anchors = straight(subdivide(s.points, true, 6));
  } else {
    closed = false;
    anchors = straight(subdivide([{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }], false, 12));
  }
  // Where the bend points start: shape corners, four around an ellipse, the two ends of a line.
  const every = s.kind === 'poly' ? 6 : s.kind === 'rect' ? 8 : 4;
  anchors.forEach((q, i) => {
    if (s.kind === 'line') q.ctrl = i === 0 || i === anchors.length - 1;
    else {
      q.ctrl = i % every === 0;
      q.corner = s.kind !== 'ellipse' && q.ctrl;
    }
  });
  return { t: 'bez', anchors, closed, width: item.width, color: item.color, fill: item.fill, fillColor: item.fillColor, style: item.style, m: item.m, uid: item.uid };
}

/** Catmull-Rom curve through the pen samples, so lines stay smooth when zoomed in. Short gaps need few extra points. */
function densify(p: StrokePt[]): StrokePt[] {
  if (p.length < 3) return p;
  const out: StrokePt[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)];
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[Math.min(p.length - 1, i + 2)];
    const steps = Math.min(4, Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.y - p1.y) / 2.5)));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), w: p1.w + (p2.w - p1.w) * t });
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

/** Dash lengths, in line widths: on, off, on, off... */
const DASHES: Record<Exclude<LineStyle, 'solid'>, number[]> = {
  dashed: [2.5, 3],
  dotted: [0.01, 2],
  dashdot: [3, 3, 0.01, 3],
};

export const dashFor = (style: LineStyle | undefined, width: number): number[] =>
  !style || style === 'solid' ? [] : DASHES[style].map((n) => n * Math.max(1, width));

/** Cut a line into the pieces a dashed style keeps. */
function dashPieces(pts: StrokePt[], pattern: number[]): StrokePt[][] {
  const out: StrokePt[][] = [];
  let index = 0;
  let left = pattern[0];
  let on = true;
  let cur: StrokePt[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let done = 0;
    while (len - done > left) {
      done += left;
      const t = done / len;
      const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t };
      if (on) {
        cur.push(q);
        out.push(cur);
        cur = [];
      } else cur = [q];
      on = !on;
      index = (index + 1) % pattern.length;
      left = pattern[index];
    }
    left -= len - done;
    if (on) cur.push(b);
  }
  if (on && cur.length > 1) out.push(cur);
  return out;
}

interface StrokeRun {
  w: number;
  path: Path2D;
}

/** A variable-width line as stretches of one width each, which is far quicker to draw than one big outline. */
function strokeRuns(raw: StrokePt[], style?: LineStyle): StrokeRun[] {
  const pts = densify(raw);
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const path = new Path2D();
    path.moveTo(pts[0].x, pts[0].y);
    path.lineTo(pts[0].x + 0.01, pts[0].y);
    return [{ w: pts[0].w, path }];
  }
  const dash = dashFor(style, pts.reduce((sum, p) => sum + p.w, 0) / pts.length);
  const pieces = dash.length ? dashPieces(pts, dash) : [pts];
  const runs: StrokeRun[] = [];
  let cur: StrokeRun | null = null;
  for (const piece of pieces) {
    let joined = false; // does the current stretch already end where this piece continues?
    for (let i = 0; i < piece.length - 1; i++) {
      const a = piece[i];
      const b = piece[i + 1];
      const w: number = Math.max(0.5, Math.round((a.w + b.w) * 2) / 4);
      if (!cur || cur.w !== w) {
        cur = { w, path: new Path2D() };
        runs.push(cur);
        joined = false;
      }
      if (!joined) cur.path.moveTo(a.x, a.y);
      cur.path.lineTo(b.x, b.y);
      joined = true;
    }
  }
  return runs;
}

export function shapePath(s: Shape): Path2D {
  const p = new Path2D();
  if (s.kind === 'line') {
    p.moveTo(s.x1, s.y1);
    p.lineTo(s.x2, s.y2);
  } else if (s.kind === 'rect') {
    p.rect(s.x, s.y, s.w, s.h);
  } else if (s.kind === 'ellipse') {
    p.ellipse(s.cx, s.cy, Math.max(0.5, s.rx), Math.max(0.5, s.ry), 0, 0, Math.PI * 2);
  } else {
    s.points.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
    p.closePath();
  }
  return p;
}

export function bezPath(anchors: Anchor[], closed: boolean): Path2D {
  const p = new Path2D();
  if (!anchors.length) return p;
  p.moveTo(anchors[0].x, anchors[0].y);
  const seg = (a: Anchor, b: Anchor) => p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y);
  for (let i = 1; i < anchors.length; i++) seg(anchors[i - 1], anchors[i]);
  if (closed && anchors.length > 1) {
    seg(anchors[anchors.length - 1], anchors[0]);
    p.closePath();
  }
  return p;
}

function runsOf(item: VItem & { t: 'stroke' }): StrokeRun[] {
  const hit = runCache.get(item.pts);
  if (hit && hit.style === item.style) return hit.runs;
  const runs = strokeRuns(item.pts, item.style);
  runCache.set(item.pts, { style: item.style, runs });
  return runs;
}

function pathOf(item: VItem): Path2D | null {
  const geometry = geometryOf(item);
  let p = geometry ? cache.get(geometry) : undefined;
  if (p) return p;
  if (item.t === 'stroke') return null;
  if (item.t === 'shape') p = shapePath(item.shape);
  else if (item.t === 'bez') p = bezPath(item.anchors, item.closed);
  else if (item.t === 'fill') {
    p = new Path2D();
    for (const loop of item.loops) {
      for (let i = 0; i < loop.length; i += 2) (i ? p.lineTo.bind(p) : p.moveTo.bind(p))(loop[i], loop[i + 1]);
      p.closePath();
    }
  } else return null;
  cache.set(geometry!, p);
  return p;
}

export function drawItem(ctx: CanvasRenderingContext2D, item: VItem): void {
  ctx.save();
  ctx.transform(...item.m);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = pathOf(item);
  if (item.t === 'stroke') {
    if (item.erase) ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = item.erase ? '#000' : item.color;
    for (const run of runsOf(item)) {
      ctx.lineWidth = run.w;
      ctx.stroke(run.path);
    }
  } else if (item.t === 'shape' || item.t === 'bez') {
    if (item.fill) {
      ctx.fillStyle = item.fillColor;
      ctx.fill(path!);
    }
    // Draw the outline after undoing the stretch, so squashing a shape keeps an even line.
    ctx.transform(...invert(item.m));
    const placed = new Path2D();
    placed.addPath(path!, new DOMMatrix(item.m));
    ctx.strokeStyle = item.color;
    ctx.lineWidth = item.width * Math.sqrt(Math.abs(item.m[0] * item.m[3] - item.m[1] * item.m[2]));
    ctx.setLineDash(dashFor(item.style, ctx.lineWidth));
    ctx.stroke(placed);
  } else if (item.t === 'fill') {
    ctx.fillStyle = item.color;
    ctx.fill(path!, 'evenodd');
  } else if (item.t === 'text') {
    ctx.font = item.font;
    ctx.fillStyle = item.color;
    ctx.textBaseline = 'top';
    item.lines.forEach((l, i) => ctx.fillText(l, item.x, item.y + i * item.size * 1.2));
  } else {
    ctx.drawImage(item.canvas, item.x, item.y);
  }
  ctx.restore();
}

/** Thin lines in one colour, for a layer shown as outlines. `hair` is the line width in drawing units. */
export function drawOutlines(ctx: CanvasRenderingContext2D, items: VItem[], color: string, hair: number): void {
  for (const it of items) {
    if (it.t === 'stroke' && it.erase) continue;
    ctx.save();
    ctx.transform(...it.m);
    ctx.strokeStyle = color;
    ctx.lineWidth = hair / (Math.sqrt(Math.abs(it.m[0] * it.m[3] - it.m[1] * it.m[2])) || 1);
    ctx.lineCap = ctx.lineJoin = 'round';
    if (it.t === 'stroke') {
      for (const run of runsOf(it)) ctx.stroke(run.path);
    } else if (it.t === 'text') {
      ctx.font = it.font;
      ctx.textBaseline = 'top';
      it.lines.forEach((l, i) => ctx.strokeText(l, it.x, it.y + i * it.size * 1.2));
    } else if (it.t === 'image') {
      ctx.strokeRect(it.x, it.y, it.canvas.width, it.canvas.height);
    } else {
      ctx.stroke(pathOf(it)!);
    }
    ctx.restore();
  }
}

export function drawItems(ctx: CanvasRenderingContext2D, items: VItem[]): void {
  for (const it of items) drawItem(ctx, it);
}

/** Sample points on an item in drawing coordinates (for selection and bounds). */
export function itemPoints(item: VItem): { x: number; y: number }[] {
  let local: { x: number; y: number }[] = [];
  if (item.t === 'stroke') local = item.pts;
  else if (item.t === 'bez') local = item.anchors;
  else if (item.t === 'text') local = [{ x: item.x, y: item.y }, { x: item.x + item.w, y: item.y }, { x: item.x, y: item.y + item.lines.length * item.size * 1.2 }, { x: item.x + item.w, y: item.y + item.lines.length * item.size * 1.2 }];
  else if (item.t === 'image') local = [{ x: item.x, y: item.y }, { x: item.x + item.canvas.width, y: item.y }, { x: item.x + item.canvas.width, y: item.y + item.canvas.height }, { x: item.x, y: item.y + item.canvas.height }];
  else if (item.t === 'fill') {
    for (const l of item.loops) for (let i = 0; i < l.length; i += 8) local.push({ x: l[i], y: l[i + 1] });
  } else {
    const s = item.shape;
    if (s.kind === 'line') local = [{ x: s.x1, y: s.y1 }, { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }, { x: s.x2, y: s.y2 }];
    else if (s.kind === 'rect') local = [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y }, { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h }];
    else if (s.kind === 'poly') local = s.points;
    else for (let a = 0; a < 16; a++) local.push({ x: s.cx + Math.cos((a * Math.PI) / 8) * s.rx, y: s.cy + Math.sin((a * Math.PI) / 8) * s.ry });
  }
  return local.map((p) => apply(item.m, p.x, p.y));
}

/** Is this drawing-space point on the item? */
export function hitItem(ctx: CanvasRenderingContext2D, item: VItem, x: number, y: number, reach = 6): boolean {
  const p = apply(invert(item.m), x, y);
  if (item.t === 'stroke') {
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    const hit = strokeRuns(item.pts).some((run) => {
      ctx.lineWidth = Math.max(run.w, reach);
      return ctx.isPointInStroke(run.path, p.x, p.y);
    });
    ctx.restore();
    return hit;
  }
  const path = pathOf(item);
  if (!path) return false;
  if (item.t === 'fill') return ctx.isPointInPath(path, p.x, p.y, 'evenodd');
  if (item.t === 'shape' || item.t === 'bez') {
    ctx.save();
    ctx.lineWidth = Math.max(item.width, reach);
    const hit = ctx.isPointInStroke(path, p.x, p.y) || (item.fill && ctx.isPointInPath(path, p.x, p.y));
    ctx.restore();
    return hit;
  }
  return false;
}

/** Is the point inside a closed outline, even an unfilled one? */
export function insideItem(ctx: CanvasRenderingContext2D, item: VItem, x: number, y: number): boolean {
  if (item.t !== 'shape' && item.t !== 'bez') return false;
  if (item.t === 'bez' ? !item.closed : item.shape.kind === 'line') return false;
  const p = apply(invert(item.m), x, y);
  return ctx.isPointInPath(pathOf(item)!, p.x, p.y);
}

/** Is the point on the outline of a shape or curve (rather than inside it)? */
export function hitOutline(ctx: CanvasRenderingContext2D, item: VItem, x: number, y: number): boolean {
  if (item.t !== 'shape' && item.t !== 'bez') return false;
  const p = apply(invert(item.m), x, y);
  ctx.save();
  ctx.lineWidth = Math.max(item.width, 6);
  const hit = ctx.isPointInStroke(pathOf(item)!, p.x, p.y);
  ctx.restore();
  return hit;
}

export function pointInPolygon(p: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
