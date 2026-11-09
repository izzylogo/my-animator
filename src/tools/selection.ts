import type { Rect } from './brush';
import { drawItems, mul, pointInPolygon, type Matrix, type VItem } from '../model/vector';

export interface P {
  x: number;
  y: number;
}

/** A selection outline (rectangle or free lasso shape), in drawing pixels. */
export interface Selection {
  points: P[];
  bounds: Rect;
}

/**
 * Pixels lifted out of a drawing so they can be moved, resized, rotated or flipped.
 * The original placement is (x, y, w, h); tx/ty/sx/sy/rot describe the change.
 */
export interface Floating {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  w: number;
  h: number;
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  rot: number;
  outline: P[]; // the selection outline, in original coordinates
  items?: VItem[]; // set on vector layers: the shapes being moved (no pixels)
}

export type Handle = 'move' | 'rotate' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

export function boundsOf(points: P[]): Rect {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const x = Math.floor(minX);
  const y = Math.floor(minY);
  return { x, y, w: Math.ceil(maxX) - x, h: Math.ceil(maxY) - y };
}

export function rectSelection(a: P, b: P, shift: boolean): Selection {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  const x0 = Math.min(a.x, a.x + dx);
  const y0 = Math.min(a.y, a.y + dy);
  const x1 = Math.max(a.x, a.x + dx);
  const y1 = Math.max(a.y, a.y + dy);
  const points = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  return { points, bounds: boundsOf(points) };
}

export function polySelection(points: P[]): Selection {
  return { points, bounds: boundsOf(points) };
}

function tracePath(ctx: CanvasRenderingContext2D, points: P[]): void {
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

/** A canvas the size of the drawing, solid where the selection is. */
export function selectionMask(sel: Selection, w: number, h: number): HTMLCanvasElement {
  const m = document.createElement('canvas');
  m.width = w;
  m.height = h;
  const ctx = m.getContext('2d')!;
  tracePath(ctx, sel.points);
  ctx.fillStyle = '#000';
  ctx.fill();
  return m;
}

/** Copy the selected pixels of a drawing into a new full-size canvas (nothing else). */
export function copySelected(src: HTMLCanvasElement, sel: Selection): HTMLCanvasElement {
  const out = selectionMask(sel, src.width, src.height);
  const ctx = out.getContext('2d')!;
  ctx.globalCompositeOperation = 'source-in';
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Remove the selected pixels from a drawing. */
export function clearSelected(target: HTMLCanvasElement, sel: Selection): void {
  const ctx = target.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  tracePath(ctx, sel.points);
  ctx.fill();
  ctx.restore();
}

/** Lift the selected pixels out of the drawing into a Floating piece. */
export function lift(target: HTMLCanvasElement, sel: Selection): Floating {
  return makeFloating(copySelected(target, sel), sel, () => clearSelected(target, sel));
}

/** Make a Floating piece from a full-size picture that is only visible inside `sel`. */
export function makeFloating(full: HTMLCanvasElement, sel: Selection, afterCopy?: () => void): Floating {
  const b = clampRect(sel.bounds, full.width, full.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, b.w);
  c.height = Math.max(1, b.h);
  c.getContext('2d')!.drawImage(full, -b.x, -b.y);
  afterCopy?.();
  return { canvas: c, x: b.x, y: b.y, w: c.width, h: c.height, tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, outline: sel.points };
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.max(1, Math.min(w, r.x + r.w) - x), h: Math.max(1, Math.min(h, r.y + r.h) - y) };
}

const centre = (f: Floating): P => ({ x: f.x + f.w / 2 + f.tx, y: f.y + f.h / 2 + f.ty });

/** Where an original-space point ends up after the move/resize/rotate. */
export function mapPoint(f: Floating, p: P): P {
  const lx = (p.x - (f.x + f.w / 2)) * f.sx;
  const ly = (p.y - (f.y + f.h / 2)) * f.sy;
  const c = centre(f);
  const cos = Math.cos(f.rot);
  const sin = Math.sin(f.rot);
  return { x: c.x + lx * cos - ly * sin, y: c.y + lx * sin + ly * cos };
}

/** The transform as canvas numbers: original position to current position. */
export function floatMatrix(f: Floating): Matrix {
  const c = centre(f);
  const ox = f.x + f.w / 2;
  const oy = f.y + f.h / 2;
  const cos = Math.cos(f.rot);
  const sin = Math.sin(f.rot);
  const a = cos * f.sx;
  const b = sin * f.sx;
  const cc = -sin * f.sy;
  const d = cos * f.sy;
  return [a, b, cc, d, c.x - a * ox - cc * oy, c.y - b * ox - d * oy];
}

export function drawFloating(ctx: CanvasRenderingContext2D, f: Floating): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  if (f.items) {
    const m = floatMatrix(f);
    drawItems(ctx, f.items.map((it) => ({ ...it, m: mul(m, it.m) })));
  } else {
    ctx.transform(...floatMatrix(f));
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.canvas, f.x, f.y);
  }
  ctx.restore();
}

/** The outline after transforming (for the dashed line and the new selection). */
export function transformedOutline(f: Floating): P[] {
  return f.outline.map((p) => mapPoint(f, p));
}

/** Handle positions in drawing pixels; `pad` keeps the rotate handle a fixed screen distance away. */
export function handlePositions(f: Floating, pad: number): Record<Exclude<Handle, 'move'>, P> {
  const l = f.x;
  const t = f.y;
  const r = f.x + f.w;
  const b = f.y + f.h;
  const mx = f.x + f.w / 2;
  const my = f.y + f.h / 2;
  const top = mapPoint(f, { x: mx, y: t });
  const c = centre(f);
  const len = Math.hypot(top.x - c.x, top.y - c.y) || 1;
  const dir = { x: (top.x - c.x) / len, y: (top.y - c.y) / len };
  return {
    nw: mapPoint(f, { x: l, y: t }),
    n: top,
    ne: mapPoint(f, { x: r, y: t }),
    e: mapPoint(f, { x: r, y: my }),
    se: mapPoint(f, { x: r, y: b }),
    s: mapPoint(f, { x: mx, y: b }),
    sw: mapPoint(f, { x: l, y: b }),
    w: mapPoint(f, { x: l, y: my }),
    rotate: { x: top.x + dir.x * pad * Math.sign(f.sy || 1), y: top.y + dir.y * pad * Math.sign(f.sy || 1) },
  };
}

/** Which handle (or the inside) is under point p? `tol` is the grab distance in drawing pixels. */
export function hitHandle(f: Floating, p: P, tol: number, pad: number): Handle | null {
  const hs = handlePositions(f, pad);
  for (const k of Object.keys(hs) as (keyof typeof hs)[]) {
    if (Math.hypot(hs[k].x - p.x, hs[k].y - p.y) <= tol) return k;
  }
  // inside the actual outline (for a lasso shape, not just its box)?
  return pointInPolygon(p, transformedOutline(f)) ? 'move' : null;
}

/**
 * Apply a drag to the transform. `start` is the transform when the drag began, `a` the
 * pointer then, `b` the pointer now.
 * volume (Shift): squash and stretch - the area stays the same, like a rubber ball.
 * free (Alt): corners stretch without keeping proportions.
 * snap (Shift, rotating): turn in 15 degree steps.
 */
export function dragHandle(f: Floating, start: Floating, handle: Handle, a: P, b: P, opts: { volume: boolean; free: boolean; snap: boolean }): void {
  if (handle === 'move') {
    f.tx = start.tx + (b.x - a.x);
    f.ty = start.ty + (b.y - a.y);
    return;
  }
  const c0 = centre(start);
  if (handle === 'rotate') {
    let rot = start.rot + Math.atan2(b.y - c0.y, b.x - c0.x) - Math.atan2(a.y - c0.y, a.x - c0.x);
    if (opts.snap) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12); // 15° steps
    f.rot = rot;
    return;
  }
  const hx = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
  const hy = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;
  // anchor = the opposite handle, which stays put
  const anchorLocal = { x: start.x + start.w / 2 - (hx * start.w) / 2, y: start.y + start.h / 2 - (hy * start.h) / 2 };
  const A = mapPoint(start, anchorLocal);
  const cos = Math.cos(-start.rot);
  const sin = Math.sin(-start.rot);
  const vx = b.x - A.x;
  const vy = b.y - A.y;
  const ux = vx * cos - vy * sin;
  const uy = vx * sin + vy * cos;
  let sx = hx ? ux / (hx * start.w) : start.sx;
  let sy = hy ? uy / (hy * start.h) : start.sy;
  if (Math.abs(sx) < 0.02) sx = 0.02 * Math.sign(sx || 1);
  if (Math.abs(sy) < 0.02) sy = 0.02 * Math.sign(sy || 1);
  if (opts.volume) {
    // squash and stretch: whatever you gain one way, you lose the other way
    const area = Math.abs(start.sx * start.sy);
    const xLeads = hx !== 0 && (hy === 0 || Math.abs(sx / start.sx - 1) >= Math.abs(sy / start.sy - 1));
    if (xLeads) sy = Math.sign(start.sy || 1) * (area / Math.abs(sx));
    else sx = Math.sign(start.sx || 1) * (area / Math.abs(sy));
  } else if (hx && hy && !opts.free) {
    // keep proportions: same factor on both axes, measured against the starting scale
    const k = (sx / start.sx + sy / start.sy) / 2;
    sx = start.sx * k;
    sy = start.sy * k;
  }
  f.sx = sx;
  f.sy = sy;
  // move the centre so the anchor stays where it was
  const half = { x: (hx * start.w * sx) / 2, y: (hy * start.h * sy) / 2 };
  const rc = Math.cos(start.rot);
  const rs = Math.sin(start.rot);
  const cx = A.x + half.x * rc - half.y * rs;
  const cy = A.y + half.x * rs + half.y * rc;
  f.tx = cx - (start.x + start.w / 2);
  f.ty = cy - (start.y + start.h / 2);
  f.rot = start.rot;
}

/** Bounding box of the non-transparent pixels of a drawing (null if empty). */
export function contentBounds(canvas: HTMLCanvasElement): Rect | null {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d')!.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** Draw the dashed "marching ants" outline and, if given, the transform handles. */
export function drawSelectionUI(ctx: CanvasRenderingContext2D, outline: P[], scale: number, f: Floating | null): void {
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineWidth = 1 / scale;
  tracePath(ctx, outline);
  ctx.setLineDash([]);
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.setLineDash([5 / scale, 4 / scale]);
  ctx.strokeStyle = '#000';
  ctx.stroke();
  if (f) {
    const pad = 26 / scale;
    const hs = handlePositions(f, pad);
    const box = [hs.nw, hs.ne, hs.se, hs.sw];
    ctx.setLineDash([]);
    ctx.strokeStyle = '#1f7ae0';
    tracePath(ctx, box);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hs.n.x, hs.n.y);
    ctx.lineTo(hs.rotate.x, hs.rotate.y);
    ctx.stroke();
    const s = 7 / scale;
    for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(hs[k].x - s / 2, hs[k].y - s / 2, s, s);
      ctx.strokeRect(hs[k].x - s / 2, hs[k].y - s / 2, s, s);
    }
    ctx.beginPath();
    ctx.arc(hs.rotate.x, hs.rotate.y, s * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
