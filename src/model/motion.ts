import type { DrawingStore, Layer } from './project';
import { IDENTITY, apply, hitItem, invert, itemPoints, mul, toBezItem, type Anchor, type Matrix, type StrokePt, type VItem } from './vector';

/**
 * Keyframe motion (like CapCut keyframes). A layer in keyframe mode stores full poses at its
 * keyframes; every frame between two keyframes is worked out here, on the fly.
 * Each line or shape carries a `uid`, so the same object can be found in both poses.
 *
 * "Smooth" motion runs a curve through all the keyframes: the object eases out of the first
 * keyframe, keeps a continuous speed through the middle ones, and eases into the last.
 * "Steady" moves in a straight line at constant speed between each pair.
 */
let nextUid = 1;

export function ensureUids(items: VItem[]): void {
  for (const it of items) if (!it.uid) it.uid = nextUid++;
}

/** After opening a file: new objects must not reuse the ids already in it. */
export function reserveUids(highest: number): void {
  nextUid = Math.max(nextUid, highest + 1);
}

type Fill = VItem & { t: 'fill' };

const probe = document.createElement('canvas').getContext('2d')!;
const outlines = new WeakMap<number[][], { uid: number; seen: number }>();

function loopArea(l: number[]): number {
  let a = 0;
  for (let i = 0; i < l.length; i += 2) {
    const j = (i + 2) % l.length;
    a += l[i] * l[j + 1] - l[j] * l[i + 1];
  }
  return Math.abs(a / 2);
}

/** The one line that runs all the way around a colour fill, if there is one. */
export function outlineOf(fill: Fill, items: VItem[]): VItem | undefined {
  const seen = items.reduce((n, it) => n + (it.uid ? 1 : 0), 0);
  const known = outlines.get(fill.loops);
  if (known?.seen === seen) return known.uid ? items.find((it) => it.uid === known.uid) : undefined;

  const outer = fill.loops.reduce((best, l) => (loopArea(l) > loopArea(best) ? l : best), fill.loops[0] ?? []);
  const step = Math.max(2, Math.floor(outer.length / 96) * 2);
  const edge: { x: number; y: number }[] = [];
  for (let i = 0; i + 1 < outer.length; i += step) edge.push(apply(fill.m, outer[i], outer[i + 1]));
  const left = Math.min(...edge.map((p) => p.x));
  const right = Math.max(...edge.map((p) => p.x));
  const top = Math.min(...edge.map((p) => p.y));
  const bottom = Math.max(...edge.map((p) => p.y));

  let best: VItem | undefined;
  let bestShare = 0.8; // most of the colour's edge has to lie on the line
  for (const it of items) {
    if (!it.uid || !(it.t === 'shape' || it.t === 'bez' || (it.t === 'stroke' && !it.erase))) continue;
    const pts = itemPoints(it);
    const margin = 24;
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    if (Math.min(...xs) > left + margin || Math.max(...xs) < right - margin || Math.min(...ys) > top + margin || Math.max(...ys) < bottom - margin) continue;
    const reach = 14 / (Math.sqrt(Math.abs(it.m[0] * it.m[3] - it.m[1] * it.m[2])) || 1);
    const share = edge.filter((p) => hitItem(probe, it, p.x, p.y, reach)).length / (edge.length || 1);
    if (share >= bestShare) {
      bestShare = share;
      best = it;
    }
  }
  outlines.set(fill.loops, { uid: best?.uid ?? 0, seen });
  return best;
}

const mix = (a: number, b: number, u: number) => a + (b - a) * u;

function shortestTurn(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Position, turn, sizes and slant, kept separate so a rotating object doesn't shrink midway. */
type Pose = [x: number, y: number, rot: number, sx: number, sy: number, shear: number];

function poseOf(m: Matrix, cx: number, cy: number): Pose {
  const rot = Math.atan2(m[1], m[0]);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const p = apply(m, cx, cy);
  return [p.x, p.y, rot, Math.hypot(m[0], m[1]), -sin * m[2] + cos * m[3], cos * m[2] + sin * m[3]];
}

function matrixOf(p: Pose, cx: number, cy: number): Matrix {
  const [x, y, rot, sx, sy, shear] = p;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const m0 = cos * sx;
  const m1 = sin * sx;
  const m2 = cos * shear - sin * sy;
  const m3 = sin * shear + cos * sy;
  return [m0, m1, m2, m3, x - m0 * cx - m2 * cy, y - m1 * cx - m3 * cy];
}

function hermite(p0: number, p1: number, m0: number, m1: number, u: number): number {
  const u2 = u * u;
  const u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
}

/**
 * The speed at a keyframe, from the keyframes either side. It's 0 at the first and last
 * keyframes (a gentle start and stop) and where the direction reverses, so the curve never
 * overshoots past a pose you set.
 */
function speedAt(left: number | undefined, tLeft: number, v: number, t: number, right: number | undefined, tRight: number): number {
  if (left === undefined || right === undefined) return 0;
  const d0 = (v - left) / (t - tLeft);
  const d1 = (right - v) / (tRight - t);
  if (d0 * d1 <= 0) return 0;
  const h0 = t - tLeft;
  const h1 = tRight - t;
  const w0 = 2 * h1 + h0;
  const w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

interface Span {
  u: number; // 0..1 through this pair of keyframes
  smooth: boolean;
  t0: number;
  t1: number;
  tPrev: number | null; // the keyframe before this pair
  tNext: number | null; // the keyframe after this pair
  prev?: VItem; // the same object at those keyframes
  next?: VItem;
}

function mixMatrix(a: Matrix, b: Matrix, cx: number, cy: number, s: Span): Matrix {
  const pa = poseOf(a, cx, cy);
  const pb = poseOf(b, cx, cy);
  pb[2] = pa[2] + shortestTurn(pb[2] - pa[2]);
  if (!s.smooth) return matrixOf(pa.map((v, i) => mix(v, pb[i], s.u)) as Pose, cx, cy);
  const before = s.prev && s.tPrev !== null ? poseOf(s.prev.m, cx, cy) : undefined;
  const after = s.next && s.tNext !== null ? poseOf(s.next.m, cx, cy) : undefined;
  if (before) before[2] = pa[2] + shortestTurn(before[2] - pa[2]);
  if (after) after[2] = pb[2] + shortestTurn(after[2] - pb[2]);
  const d = s.t1 - s.t0;
  const out = pa.map((v0, i) => {
    const m0 = speedAt(before?.[i], s.tPrev ?? 0, v0, s.t0, pb[i], s.t1) * d;
    const m1 = speedAt(v0, s.t0, pb[i], s.t1, after?.[i], s.tNext ?? 0) * d;
    return hermite(v0, pb[i], m0, m1, s.u);
  }) as Pose;
  return matrixOf(out, cx, cy);
}

/** One number's journey between keyframes, on the same curve the object's position uses. */
function curve(v0: number, v1: number, before: number | undefined, after: number | undefined, s: Span): number {
  if (!s.smooth) return mix(v0, v1, s.u);
  const d = s.t1 - s.t0;
  const m0 = speedAt(before, s.tPrev ?? 0, v0, s.t0, v1, s.t1) * d;
  const m1 = speedAt(v0, s.t0, v1, s.t1, after, s.tNext ?? 0) * d;
  return hermite(v0, v1, m0, m1, s.u);
}

function mixStroke(a: StrokePt[], b: StrokePt[], p: StrokePt[] | undefined, n: StrokePt[] | undefined, s: Span, u: number): StrokePt[] | null {
  if (a === b) return a; // untouched line: reuse it, which also keeps playback fast
  if (a.length !== b.length) return null;
  const pv = p?.length === a.length ? p : undefined;
  const nx = n?.length === a.length ? n : undefined;
  return a.map((q, i) => ({ ...q, x: curve(q.x, b[i].x, pv?.[i].x, nx?.[i].x, s), y: curve(q.y, b[i].y, pv?.[i].y, nx?.[i].y, s), w: mix(q.w, b[i].w, u) }));
}

function mixAnchors(a: Anchor[], b: Anchor[], p: Anchor[] | undefined, n: Anchor[] | undefined, s: Span): Anchor[] | null {
  if (a === b) return a;
  if (a.length !== b.length) return null;
  const pv = p?.length === a.length ? p : undefined;
  const nx = n?.length === a.length ? n : undefined;
  return a.map((q, i) => {
    const r = b[i];
    const c = pv?.[i];
    const e = nx?.[i];
    return {
      ...q,
      x: curve(q.x, r.x, c?.x, e?.x, s),
      y: curve(q.y, r.y, c?.y, e?.y, s),
      ix: curve(q.ix, r.ix, c?.ix, e?.ix, s),
      iy: curve(q.iy, r.iy, c?.iy, e?.iy, s),
      ox: curve(q.ox, r.ox, c?.ox, e?.ox, s),
      oy: curve(q.oy, r.oy, c?.oy, e?.oy, s),
    };
  });
}

function sameShape(a: number[][], b: number[][] | undefined): number[][] | undefined {
  return b && b.length === a.length && a.every((l, i) => l.length === b[i].length) ? b : undefined;
}

function mixLoops(a: number[][], b: number[][], p: number[][] | undefined, n: number[][] | undefined, s: Span): number[][] | null {
  if (a === b) return a;
  if (!sameShape(a, b)) return null;
  const pv = sameShape(a, p);
  const nx = sameShape(a, n);
  // Travel and change of shape run as two separate curves, the same way a line's position
  // and its bends do, so a colour stays exactly inside its moving, bending outline.
  const ca = loopsCentre(a);
  const cb = loopsCentre(b);
  const cp = pv && loopsCentre(pv);
  const cn = nx && loopsCentre(nx);
  const centre = [0, 1].map((c) => curve(ca[c], cb[c], cp?.[c], cn?.[c], s));
  return a.map((l, i) =>
    l.map((v, j) => {
      const c = j % 2;
      const before = pv && cp ? pv[i][j] - cp[c] : undefined;
      const after = nx && cn ? nx[i][j] - cn[c] : undefined;
      return centre[c] + curve(v - ca[c], b[i][j] - cb[c], before, after, s);
    }),
  );
}

function loopsCentre(loops: number[][]): [number, number] {
  let x = 0;
  let y = 0;
  let count = 0;
  for (const l of loops) {
    for (let i = 0; i < l.length; i += 2) {
      x += l[i];
      y += l[i + 1];
      count++;
    }
  }
  return count ? [x / count, y / count] : [0, 0];
}

/** A neighbouring pose in the same form as this one, if it has one. */
function likeItem<T extends VItem['t']>(x: VItem | undefined, t: T): (VItem & { t: T }) | undefined {
  const y = x?.t === 'shape' && t === 'bez' ? toBezItem(x) : x;
  return y?.t === t ? (y as VItem & { t: T }) : undefined;
}

/** How an object is placed part-way between two keyframes. */
function travel(a: VItem, b: VItem, s: Span): Matrix | null {
  const pts = itemPoints(a);
  if (!pts.length) return null;
  const world = pts.reduce((sum, p) => ({ x: sum.x + p.x / pts.length, y: sum.y + p.y / pts.length }), { x: 0, y: 0 });
  const centre = apply(invert(a.m), world.x, world.y);
  return mixMatrix(a.m, b.m, centre.x, centre.y, s);
}

function movedLoops(loops: number[][], m: Matrix): number[][] {
  return loops.map((l) => {
    const out = new Array<number>(l.length);
    for (let i = 0; i + 1 < l.length; i += 2) {
      out[i] = m[0] * l[i] + m[2] * l[i + 1] + m[4];
      out[i + 1] = m[1] * l[i] + m[3] * l[i + 1] + m[5];
    }
    return out;
  });
}

/** A fill's corners where they really sit on the paper, once it has been moved or resized. */
const placedLoops = (f: Fill): number[][] => (f.m.every((v, i) => v === IDENTITY[i]) ? f.loops : movedLoops(f.loops, f.m));

/** Have these two poses of a line kept the same form, however they've been moved or turned? */
function sameForm(a0: VItem, b0: VItem): boolean {
  const a = a0.t === 'shape' && b0.t === 'bez' ? toBezItem(a0) : a0;
  const b = b0.t === 'shape' && a0.t === 'bez' ? toBezItem(b0) : b0;
  if (a.t !== b.t) return false;
  const pa = itemPoints({ ...a, m: IDENTITY });
  const pb = itemPoints({ ...b, m: IDENTITY });
  return pa.length === pb.length && pa.every((p, i) => Math.abs(p.x - pb[i].x) < 0.01 && Math.abs(p.y - pb[i].y) < 0.01);
}

/**
 * A colour inside an outline is placed by that outline, using the very same numbers, so
 * the two can't separate however the keyframes have been moved.
 */
function fillOnOutline(a: Fill, b: VItem | undefined, items0: VItem[], map1: Map<number, VItem>, spanOf: (it: VItem) => Span): VItem | null {
  const line = outlineOf(a, items0);
  const lineB = line?.uid ? map1.get(line.uid) : undefined;
  if (!line || !lineB) return null;
  const s = spanOf(line);
  const asCurve = line.t === 'shape' && lineB.t === 'bez' ? toBezItem(line) : line;
  const m = travel(asCurve, lineB, s);
  if (!m) return null;
  const fillB = b?.t === 'fill' ? b : undefined;
  if (!fillB || sameForm(line, lineB) || !sameShape(a.loops, fillB.loops)) return { ...a, m: mul(m, mul(invert(line.m), a.m)) };

  // The outline was bent between these keyframes: the colour changes shape along with its points.
  const local = (f: Fill, l: VItem) => movedLoops(f.loops, mul(invert(l.m), f.m));
  const own = spanOf(a);
  const prev = own.prev?.t === 'fill' && s.prev ? sameShape(a.loops, own.prev.loops) && local(own.prev, s.prev) : undefined;
  const next = own.next?.t === 'fill' && s.next ? sameShape(a.loops, own.next.loops) && local(own.next, s.next) : undefined;
  const from = local(a, line);
  const to = local(fillB, lineB);
  return {
    ...a,
    m,
    loops: from.map((l, i) => l.map((v, j) => curve(v, to[i][j], prev ? prev[i][j] : undefined, next ? next[i][j] : undefined, s))),
  };
}

/** The in-between of one object; null if the two poses can't be blended. */
function mixItem(a0: VItem, b0: VItem, s: Span): VItem | null {
  // a shape that was bent in one pose has become a curve: treat both as curves
  const a = a0.t === 'shape' && b0.t === 'bez' ? toBezItem(a0) : a0;
  const b = b0.t === 'shape' && a0.t === 'bez' ? toBezItem(b0) : b0;
  const m = travel(a, b, s);
  if (!m) return null;
  // line widths follow a gentle start and stop
  const u = s.smooth ? hermite(0, 1, s.tPrev !== null ? 1 : 0, s.tNext !== null ? 1 : 0, s.u) : s.u;
  if (a.t === 'stroke' && b.t === 'stroke') {
    const mixed = mixStroke(a.pts, b.pts, likeItem(s.prev, 'stroke')?.pts, likeItem(s.next, 'stroke')?.pts, s, u);
    return mixed && { ...a, pts: mixed, m };
  }
  if (a.t === 'bez' && b.t === 'bez') {
    const anchors = mixAnchors(a.anchors, b.anchors, likeItem(s.prev, 'bez')?.anchors, likeItem(s.next, 'bez')?.anchors, s);
    return anchors && { ...a, anchors, width: mix(a.width, b.width, u), m };
  }
  if (a.t === 'fill' && b.t === 'fill') {
    const prev = likeItem(s.prev, 'fill');
    const next = likeItem(s.next, 'fill');
    const loops = mixLoops(placedLoops(a), placedLoops(b), prev && placedLoops(prev), next && placedLoops(next), s);
    return loops && { ...a, loops, m: IDENTITY };
  }
  if (a.t === 'shape' && b.t === 'shape') return { ...a, width: mix(a.width, b.width, u), m };
  if (a.t === b.t) return { ...a, m };
  return null;
}

function byUid(items: VItem[]): Map<number, VItem> {
  const map = new Map<number, VItem>();
  for (const it of items) if (it.uid) map.set(it.uid, it);
  return map;
}

/** What a layer's drawing looks like on this frame, including in-between frames. */
export function sampleItems(layer: Layer, frame: number, drawings: DrawingStore): VItem[] {
  const track = layer.track;
  const t0 = track.activeTime(frame);
  if (t0 === null) return [];
  const k0 = track.get(t0)!;
  const items0 = drawings.items(k0.drawingId);
  if (!layer.motion || !k0.tween || t0 === frame) return items0;
  const t1 = track.nextTime(frame);
  if (t1 === null) return items0;
  const k1 = track.get(t1)!;
  if (!k1.tween) return items0;

  const neighbour = (t: number | null) => {
    const k = t === null ? undefined : track.get(t);
    return k?.tween && drawings.hasContent(k.drawingId) ? k : undefined;
  };
  const rawPrev = track.prevTime(t0);
  const rawNext = track.nextTime(t1);
  const kPrev = neighbour(rawPrev);
  const kNext = neighbour(rawNext);
  const tPrev = kPrev ? rawPrev : null;
  const tNext = kNext ? rawNext : null;
  const map1 = byUid(drawings.items(k1.drawingId));
  const mapPrev = kPrev ? byUid(drawings.items(kPrev.drawingId)) : undefined;
  const mapNext = kNext ? byUid(drawings.items(kNext.drawingId)) : undefined;
  const u = (frame - t0) / (t1 - t0);
  const smooth = layer.ease !== 'steady';
  const spanOf = (it: VItem): Span => {
    const prev = it.uid ? mapPrev?.get(it.uid) : undefined;
    const next = it.uid ? mapNext?.get(it.uid) : undefined;
    return { u, smooth, t0, t1, tPrev: prev ? tPrev : null, tNext: next ? tNext : null, prev, next };
  };
  return items0.map((a) => {
    const b = a.uid ? map1.get(a.uid) : undefined;
    if (a.t === 'fill') {
      const placed = fillOnOutline(a, b, items0, map1, spanOf);
      if (placed) return placed;
    }
    if (!b) return a;
    return mixItem(a, b, spanOf(a)) || a;
  });
}
