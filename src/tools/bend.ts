import { apply, invert, toBezItem, touch, type Anchor, type Matrix, type StrokePt, type VItem } from '../model/vector';

/**
 * Bend points: click a line to pin a point on it, then drag the point and the line follows.
 * The idea comes from how point-based animation apps behave for their users; this code is our own.
 *
 * A hand-drawn line keeps all its pen samples and pressure. A "point" is only a marked sample,
 * and dragging it moves the samples between it and the neighbouring points, fading out with
 * distance. Because the number of samples doesn't change, keyframes can still blend the line.
 */
export type Bendable = (VItem & { t: 'stroke' }) | (VItem & { t: 'bez' });
type Node = StrokePt | Anchor;

/** A private, bendable copy of an item (shapes become curves). Null if it can't be bent. */
export function toBendable(it: VItem): Bendable | null {
  if (it.t === 'stroke') {
    if (it.erase || it.pts.length < 2) return null;
    const pts = it.pts.map((q) => ({ ...q }));
    pts[0].ctrl = pts[pts.length - 1].ctrl = true;
    return { ...it, pts };
  }
  if (it.t !== 'shape' && it.t !== 'bez') return null;
  const b = it.t === 'shape' ? toBezItem(it) : it;
  const anchors = b.anchors.map((q) => ({ ...q }));
  if (!anchors.some((q) => q.ctrl)) {
    // A curve drawn with the Pen: every anchor is a point.
    for (const q of anchors) {
      const flat = q.ix === q.x && q.iy === q.y && q.ox === q.x && q.oy === q.y;
      q.ctrl = true;
      q.corner = flat;
      q.manual = !flat;
    }
  }
  return { ...b, anchors };
}

export const nodesOf = (it: Bendable): Node[] => (it.t === 'stroke' ? it.pts : it.anchors);
const isClosed = (it: Bendable) => it.t === 'bez' && it.closed;

/** The indexes of the points shown on this item. */
export function controlsOf(it: Bendable): number[] {
  const out: number[] = [];
  nodesOf(it).forEach((q, i) => {
    if (q.ctrl) out.push(i);
  });
  return out;
}

export interface LineHit {
  seg: number; // sample index (hand-drawn) or curve segment (shapes and curves)
  t: number; // how far along that curve segment, 0..1
  x: number;
  y: number;
  dist: number; // distance from the line's edge, in drawing pixels
}

function bezAt(a: Anchor, b: Anchor, t: number): { x: number; y: number } {
  const s = 1 - t;
  const c0 = s * s * s;
  const c1 = 3 * s * s * t;
  const c2 = 3 * s * t * t;
  const c3 = t * t * t;
  return { x: c0 * a.x + c1 * a.ox + c2 * b.ix + c3 * b.x, y: c0 * a.y + c1 * a.oy + c2 * b.iy + c3 * b.y };
}

/** The place on this line nearest to a drawing-space point. */
export function nearestOn(it: Bendable, x: number, y: number): LineHit | null {
  let best: LineHit | null = null;
  const test = (p: { x: number; y: number }, seg: number, t: number, half: number) => {
    const w = apply(it.m, p.x, p.y);
    const dist = Math.max(0, Math.hypot(w.x - x, w.y - y) - half);
    if (!best || dist < best.dist) best = { seg, t, x: w.x, y: w.y, dist };
  };
  if (it.t === 'stroke') {
    it.pts.forEach((q, i) => test(q, i, 0, q.w / 2));
    return best;
  }
  const n = it.anchors.length;
  const segs = it.closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    for (let s = 0; s <= 16; s++) test(bezAt(it.anchors[i], it.anchors[(i + 1) % n], s / 16), i, s / 16, it.width / 2);
  }
  return best;
}

/** Pin a point at a place on the line; returns its index. */
export function addPoint(it: Bendable, seg: number, t: number): number {
  if (it.t === 'stroke') {
    for (let d = 0; d <= 2; d++) {
      for (const i of [seg - d, seg + d]) if (it.pts[i]?.ctrl) return i;
    }
    it.pts[seg].ctrl = true;
    return seg;
  }
  const n = it.anchors.length;
  // right on an existing anchor: just show it as a point
  if (t < 0.03 || t > 0.97) {
    const i = (t < 0.5 ? seg : seg + 1) % n;
    it.anchors[i].ctrl = true;
    return i;
  }
  const a = it.anchors[seg];
  const b = it.anchors[(seg + 1) % n];
  const mid = (p: number, q: number) => p + (q - p) * t;
  const ax = mid(a.x, a.ox);
  const ay = mid(a.y, a.oy);
  const hx = mid(a.ox, b.ix);
  const hy = mid(a.oy, b.iy);
  const bx = mid(b.ix, b.x);
  const by = mid(b.iy, b.y);
  const ix = mid(ax, hx);
  const iy = mid(ay, hy);
  const ox = mid(hx, bx);
  const oy = mid(hy, by);
  a.ox = ax;
  a.oy = ay;
  b.ix = bx;
  b.iy = by;
  it.anchors.splice(seg + 1, 0, { x: mid(ix, ox), y: mid(iy, oy), ix, iy, ox, oy, ctrl: true });
  return seg + 1;
}

/** How much each sample follows point `index`: 1 at the point, fading to 0 at the next points. */
export function bendWeights(it: Bendable, index: number): Float32Array {
  const nodes = nodesOf(it);
  const n = nodes.length;
  const closed = isClosed(it);
  const weights = new Float32Array(n);
  weights[index] = 1;
  const sharp = !!nodes[index].corner;

  const side = (step: 1 | -1) => {
    const walk: number[] = [index];
    let i = index;
    for (let c = 0; c < n; c++) {
      const next = closed ? (i + step + n) % n : i + step;
      if (next < 0 || next >= n) break;
      i = next;
      if (i === index) break;
      walk.push(i);
      if (nodes[i].ctrl) break;
    }
    if (walk.length < 2) return;
    const lastNode = walk[walk.length - 1];
    const pinnedAtEnd = !closed && (lastNode === 0 || lastNode === n - 1);
    const lengths = [0];
    for (let k = 1; k < walk.length; k++) {
      lengths.push(lengths[k - 1] + Math.hypot(nodes[walk[k]].x - nodes[walk[k - 1]].x, nodes[walk[k]].y - nodes[walk[k - 1]].y));
    }
    const total = lengths[lengths.length - 1] || 1;
    for (let k = 1; k < walk.length - 1; k++) {
      const u = 1 - lengths[k] / total; // 0 at the neighbouring point, 1 at the dragged one
      let w: number;
      if (sharp) w = u;
      else if (pinnedAtEnd) w = Math.sin((u * Math.PI) / 2);
      else w = u * u * (3 - 2 * u);
      weights[walk[k]] = Math.max(weights[walk[k]], w);
    }
  };
  side(1);
  side(-1);
  return weights;
}

/** Give every automatic anchor a handle that follows its neighbours, so bends stay curved. */
export function autoHandles(anchors: Anchor[], closed: boolean): void {
  const n = anchors.length;
  for (let i = 0; i < n; i++) {
    const q = anchors[i];
    if (q.corner || q.manual) continue;
    const prev = closed ? anchors[(i - 1 + n) % n] : anchors[Math.max(0, i - 1)];
    const next = closed ? anchors[(i + 1) % n] : anchors[Math.min(n - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const before = Math.hypot(q.x - prev.x, q.y - prev.y) / 3;
    const after = Math.hypot(next.x - q.x, next.y - q.y) / 3;
    q.ix = q.x - (dx / len) * before;
    q.iy = q.y - (dy / len) * before;
    q.ox = q.x + (dx / len) * after;
    q.oy = q.y + (dy / len) * after;
  }
}

export type NodeCopy = Node[];
export const copyNodes = (it: Bendable): NodeCopy => nodesOf(it).map((q) => ({ ...q }));

/** The linear part of the inverse matrix turns a drag on the page into a drag inside the item. */
export function localDelta(m: Matrix, dx: number, dy: number): { x: number; y: number } {
  const inv = invert(m);
  return { x: inv[0] * dx + inv[2] * dy, y: inv[1] * dx + inv[3] * dy };
}

/** Set the bend from the positions at the start of the drag, so it can't drift. */
export function applyBend(it: Bendable, orig: NodeCopy, weights: Float32Array, dx: number, dy: number): void {
  const nodes = nodesOf(it);
  for (let i = 0; i < nodes.length; i++) {
    const k = weights[i];
    const q = nodes[i] as Anchor;
    const o = orig[i] as Anchor;
    q.x = o.x + dx * k;
    q.y = o.y + dy * k;
    if (it.t === 'bez') {
      q.ix = o.ix + dx * k;
      q.iy = o.iy + dy * k;
      q.ox = o.ox + dx * k;
      q.oy = o.oy + dy * k;
    }
  }
  if (it.t === 'bez') autoHandles(it.anchors, it.closed);
  touch(it);
}

/** A colour fill that hugs a bent line, remembered so its edge can travel with the line. */
export interface Glue {
  fill: VItem & { t: 'fill' };
  orig: number[][];
  amount: Float32Array[]; // how far each fill corner follows the drag
}

/** Find the edges of colour fills lying under this line. */
export function glueFills(it: Bendable, fills: (VItem & { t: 'fill' })[], weights: Float32Array): Glue[] {
  const samples: { x: number; y: number; w: number; reach: number }[] = [];
  if (it.t === 'stroke') {
    it.pts.forEach((q, i) => {
      const p = apply(it.m, q.x, q.y);
      samples.push({ x: p.x, y: p.y, w: weights[i], reach: q.w / 2 + 10 });
    });
  } else {
    const n = it.anchors.length;
    const segs = it.closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      for (let s = 0; s < 10; s++) {
        const u = s / 10;
        const b = bezAt(it.anchors[i], it.anchors[j], u);
        const p = apply(it.m, b.x, b.y);
        samples.push({ x: p.x, y: p.y, w: weights[i] + (weights[j] - weights[i]) * u, reach: it.width / 2 + 10 });
      }
    }
  }
  const glued: Glue[] = [];
  for (const fill of fills) {
    let any = false;
    const amount = fill.loops.map((loop) => {
      const out = new Float32Array(loop.length / 2);
      for (let v = 0; v < out.length; v++) {
        const p = apply(fill.m, loop[v * 2], loop[v * 2 + 1]);
        let best = Infinity;
        let w = 0;
        for (const s of samples) {
          const d = (s.x - p.x) * (s.x - p.x) + (s.y - p.y) * (s.y - p.y);
          if (d < best && d <= s.reach * s.reach) {
            best = d;
            w = s.w;
          }
        }
        out[v] = w;
        if (w > 0) any = true;
      }
      return out;
    });
    if (any) glued.push({ fill, orig: fill.loops.map((l) => [...l]), amount });
  }
  return glued;
}

export function applyGlue(glued: Glue[], worldDx: number, worldDy: number): void {
  for (const g of glued) {
    const d = localDelta(g.fill.m, worldDx, worldDy);
    g.fill.loops.forEach((loop, l) => {
      const orig = g.orig[l];
      const amount = g.amount[l];
      for (let v = 0; v < amount.length; v++) {
        loop[v * 2] = orig[v * 2] + d.x * amount[v];
        loop[v * 2 + 1] = orig[v * 2 + 1] + d.y * amount[v];
      }
    });
    touch(g.fill);
  }
}
