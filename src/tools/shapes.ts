import type { Pt, Rect } from './brush';
import { shapePath } from '../model/vector';

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'poly';

/** Options for the Polygon / Star tool. */
export const polyOptions = { sides: 5, star: false };

export type Shape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'poly'; points: { x: number; y: number }[] };

export interface ShapeStyle {
  width: number;
  color: string;
  fill: boolean;
  eraser: boolean;
  fillColor?: string; // inside colour for filled shapes (defaults to `color`)
}

/**
 * Turn a drag (from a to b) into a shape.
 * Shift: straight angles for lines (every 45°), perfect squares and circles.
 * Alt: draw from the centre outwards.
 */
export function shapeFromDrag(kind: ShapeKind, a: Pt, b: Pt, shift: boolean, alt: boolean): Shape {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (kind === 'line') {
    if (shift) {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      dx = Math.cos(angle) * len;
      dy = Math.sin(angle) * len;
    }
    return { kind, x1: a.x, y1: a.y, x2: a.x + dx, y2: a.y + dy };
  }
  if (kind === 'poly') {
    const r = Math.hypot(dx, dy);
    let start = Math.atan2(dy, dx);
    if (shift) start = Math.round(start / (Math.PI / 12)) * (Math.PI / 12);
    const n = polyOptions.star ? polyOptions.sides * 2 : polyOptions.sides;
    const points = Array.from({ length: n }, (_, i) => {
      const rad = polyOptions.star && i % 2 ? r * 0.45 : r;
      const ang = start + (i * Math.PI * 2) / n;
      return { x: a.x + Math.cos(ang) * rad, y: a.y + Math.sin(ang) * rad };
    });
    return { kind, points };
  }
  if (shift) {
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * m;
    dy = Math.sign(dy || 1) * m;
  }
  let x0 = a.x;
  let y0 = a.y;
  const x1 = a.x + dx;
  const y1 = a.y + dy;
  if (alt) {
    x0 = a.x - dx;
    y0 = a.y - dy;
  }
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (kind === 'rect') return { kind, x, y, w, h };
  return { kind, cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2 };
}

export function drawShape(ctx: CanvasRenderingContext2D, shape: Shape, style: ShapeStyle): void {
  ctx.save();
  ctx.globalCompositeOperation = style.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = ctx.fillStyle = style.eraser ? '#000' : style.color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = shapePath(shape);
  if (style.fill && shape.kind !== 'line') {
    if (!style.eraser && style.fillColor) ctx.fillStyle = style.fillColor;
    ctx.fill(path);
  }
  ctx.stroke(path);
  ctx.restore();
}

/** The area a shape covers (with its outline), clipped to the canvas size. */
export function shapeBounds(shape: Shape, width: number, cw: number, ch: number): Rect | null {
  const pad = width / 2 + 2;
  let x0: number, y0: number, x1: number, y1: number;
  if (shape.kind === 'line') {
    x0 = Math.min(shape.x1, shape.x2);
    y0 = Math.min(shape.y1, shape.y2);
    x1 = Math.max(shape.x1, shape.x2);
    y1 = Math.max(shape.y1, shape.y2);
  } else if (shape.kind === 'poly') {
    x0 = Math.min(...shape.points.map((p) => p.x));
    y0 = Math.min(...shape.points.map((p) => p.y));
    x1 = Math.max(...shape.points.map((p) => p.x));
    y1 = Math.max(...shape.points.map((p) => p.y));
  } else if (shape.kind === 'rect') {
    x0 = shape.x;
    y0 = shape.y;
    x1 = shape.x + shape.w;
    y1 = shape.y + shape.h;
  } else {
    x0 = shape.cx - shape.rx;
    y0 = shape.cy - shape.ry;
    x1 = shape.cx + shape.rx;
    y1 = shape.cy + shape.ry;
  }
  const x = Math.max(0, Math.floor(x0 - pad));
  const y = Math.max(0, Math.floor(y0 - pad));
  const r = Math.min(cw, Math.ceil(x1 + pad));
  const b = Math.min(ch, Math.ceil(y1 + pad));
  return r > x && b > y ? { x, y, w: r - x, h: b - y } : null;
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * "Hold to straighten": look at a hand-drawn stroke and decide whether it was meant to be
 * a straight line or a closed loop (ellipse). Returns null when it's neither.
 */
export function recognizeStroke(points: Pt[]): Shape | null {
  if (points.length < 3) return null;
  let length = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i) length += Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y);
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (length < 25) return null;
  const a = points[0];
  const b = points[points.length - 1];
  const chord = Math.hypot(b.x - a.x, b.y - a.y);

  if (chord / length > 0.9) return { kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  if (chord < 0.2 * length && length > 60) {
    return { kind: 'ellipse', cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, rx: (maxX - minX) / 2, ry: (maxY - minY) / 2 };
  }
  return null;
}
