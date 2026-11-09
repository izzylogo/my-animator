import { itemPoints, toBezItem, type VItem } from '../model/vector';

/** Points that can be compared one-to-one between two poses of the same object. */
function matchingPoints(a: VItem, b: VItem): [{ x: number; y: number }[], { x: number; y: number }[]] | null {
  const a2 = a.t === 'shape' && b.t === 'bez' ? toBezItem(a) : a;
  const b2 = b.t === 'shape' && a.t === 'bez' ? toBezItem(b) : b;
  if (a2.t !== b2.t) return null;
  const pa = itemPoints(a2);
  const pb = itemPoints(b2);
  return pa.length === pb.length && pa.length ? [pa, pb] : null;
}

/**
 * Where a clicked spot ends up in another keyframe: it travels with the lines around it,
 * and nearby lines count much more than faraway ones.
 */
export function followPoint(from: VItem[], to: VItem[], x: number, y: number): { x: number; y: number } {
  const others = new Map<number, VItem>();
  for (const it of to) if (it.uid) others.set(it.uid, it);
  let sum = 0;
  let dx = 0;
  let dy = 0;
  for (const a of from) {
    if (a.t === 'fill' || !a.uid) continue;
    const b = others.get(a.uid);
    if (!b) continue;
    const pairs = matchingPoints(a, b);
    if (!pairs) continue;
    pairs[0].forEach((p, i) => {
      const d2 = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y) + 1;
      const w = 1 / (d2 * d2);
      sum += w;
      dx += w * (pairs[1][i].x - p.x);
      dy += w * (pairs[1][i].y - p.y);
    });
  }
  return sum ? { x: x + dx / sum, y: y + dy / sum } : { x, y };
}

function area(l: number[]): number {
  let a = 0;
  const n = l.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    a += l[i] * l[j + 1] - l[j] * l[i + 1];
  }
  return a / 2;
}

function perimeter(l: number[]): number {
  let p = 0;
  const n = l.length;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n;
    p += Math.hypot(l[j] - l[i], l[j + 1] - l[i + 1]);
  }
  return p;
}

/** Evenly spaced corners around a loop. */
function resample(l: number[], count: number): number[] {
  const total = perimeter(l);
  const step = total / count;
  const n = l.length;
  const out: number[] = [];
  let i = 0;
  let travelled = 0;
  let segLen = Math.hypot(l[2 % n] - l[0], l[3 % n] - l[1]);
  for (let c = 0; c < count; c++) {
    const want = c * step;
    while (travelled + segLen < want && i < n - 2) {
      travelled += segLen;
      i += 2;
      const j = (i + 2) % n;
      segLen = Math.hypot(l[j] - l[i], l[j + 1] - l[i + 1]);
    }
    const u = segLen ? (want - travelled) / segLen : 0;
    const j = (i + 2) % n;
    out.push(l[i] + (l[j] - l[i]) * u, l[i + 1] + (l[j + 1] - l[i + 1]) * u);
  }
  return out;
}

function centred(l: number[]): number[] {
  const count = l.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < l.length; i += 2) {
    cx += l[i];
    cy += l[i + 1];
  }
  cx /= count;
  cy /= count;
  return l.map((v, i) => v - (i % 2 ? cy : cx));
}

/** Turn a loop so each corner sits closest to the same corner of the reference loop. */
function align(l: number[], reference: number[]): number[] {
  let loop = l;
  if (Math.sign(area(loop)) !== Math.sign(area(reference))) {
    const flipped: number[] = [];
    for (let i = loop.length - 2; i >= 0; i -= 2) flipped.push(loop[i], loop[i + 1]);
    loop = flipped;
  }
  const a = centred(loop);
  const b = centred(reference);
  const count = a.length / 2;
  const step = Math.max(1, Math.floor(count / 90));
  let bestShift = 0;
  let best = Infinity;
  for (let shift = 0; shift < count; shift += step) {
    let cost = 0;
    for (let i = 0; i < count; i += 2) {
      const j = (i + shift) % count;
      cost += (a[j * 2] - b[i * 2]) ** 2 + (a[j * 2 + 1] - b[i * 2 + 1]) ** 2;
    }
    if (cost < best) {
      best = cost;
      bestShift = shift;
    }
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + bestShift) % count;
    out.push(loop[j * 2], loop[j * 2 + 1]);
  }
  return out;
}

/**
 * Fills traced on different keyframes have different corners. Give them all the same number
 * of evenly spaced, lined-up corners, so the colour can blend between keyframes.
 */
export function matchLoops(perKey: number[][][]): number[][][] {
  const cleaned = perKey.map((loops) => loops.filter((l) => Math.abs(area(l)) >= 16).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a))));
  const loopCount = Math.min(...cleaned.map((l) => l.length));
  const out: number[][][] = cleaned.map(() => []);
  for (let index = 0; index < loopCount; index++) {
    const longest = Math.max(...cleaned.map((loops) => perimeter(loops[index])));
    const corners = Math.round(Math.min(900, Math.max(48, longest / 3)));
    let reference: number[] | null = null;
    cleaned.forEach((loops, k) => {
      const even = resample(loops[index], corners);
      const lined = reference ? align(even, reference) : even;
      out[k].push(lined);
      reference = lined;
    });
  }
  return out;
}
