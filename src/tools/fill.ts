import type { Rect } from './brush';

/**
 * Paint bucket: fills the area around (x, y) that has a similar colour to the clicked
 * pixel, on ONE drawing (so lines on other layers don't block it).
 *
 * tolerance: 0..255, how different a pixel may be and still count as "the same area".
 * growEdges: grow the filled area by 1–2 pixels so it tucks under soft line edges
 * (otherwise a thin pale halo shows between the fill and the line).
 */
export function floodFill(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  color: string,
  tolerance: number,
  growEdges: boolean,
  /** Optional picture to find the area's edges in (e.g. all layers); defaults to the drawing itself. */
  sample?: ImageData,
): Rect | null {
  const w = canvas.width;
  const h = canvas.height;
  const sx = Math.floor(x);
  const sy = Math.floor(y);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;

  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data; // the drawing we paint into
  const s = sample ? sample.data : d; // where we look for edges
  const i0 = (sy * w + sx) * 4;
  const [r0, g0, b0, a0] = [s[i0], s[i0 + 1], s[i0 + 2], s[i0 + 3]];

  const similar = (p: number) => {
    const i = p * 4;
    // Fully transparent pixels all count as the same "empty paper", whatever their RGB.
    if (a0 === 0) return s[i + 3] <= tolerance;
    return (
      Math.abs(s[i] - r0) <= tolerance &&
      Math.abs(s[i + 1] - g0) <= tolerance &&
      Math.abs(s[i + 2] - b0) <= tolerance &&
      Math.abs(s[i + 3] - a0) <= tolerance
    );
  };

  // Scanline flood fill into a mask.
  const mask = new Uint8Array(w * h);
  const stack = [sy * w + sx];
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  while (stack.length) {
    const p = stack.pop()!;
    if (mask[p]) continue;
    const py = (p / w) | 0;
    let left = p;
    const rowStart = py * w;
    while (left > rowStart && !mask[left - 1] && similar(left - 1)) left--;
    let right = p;
    const rowEnd = rowStart + w - 1;
    while (right < rowEnd && !mask[right + 1] && similar(right + 1)) right++;
    for (let q = left; q <= right; q++) {
      mask[q] = 1;
      if (py > 0 && !mask[q - w] && similar(q - w)) stack.push(q - w);
      if (py < h - 1 && !mask[q + w] && similar(q + w)) stack.push(q + w);
    }
    minX = Math.min(minX, left - rowStart);
    maxX = Math.max(maxX, right - rowStart);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }

  // Grow the area by 2 px so it slides under anti-aliased line edges.
  let fillMask = mask;
  const grow = growEdges ? 2 : 0;
  if (grow) {
    fillMask = new Uint8Array(mask);
    for (let pass = 0; pass < grow; pass++) {
      const src = new Uint8Array(fillMask);
      for (let yy = Math.max(0, minY - pass - 1); yy <= Math.min(h - 1, maxY + pass + 1); yy++) {
        for (let xx = Math.max(0, minX - pass - 1); xx <= Math.min(w - 1, maxX + pass + 1); xx++) {
          const p = yy * w + xx;
          if (src[p]) continue;
          if ((xx > 0 && src[p - 1]) || (xx < w - 1 && src[p + 1]) || (yy > 0 && src[p - w]) || (yy < h - 1 && src[p + w])) {
            fillMask[p] = 1;
          }
        }
      }
    }
    minX = Math.max(0, minX - grow);
    minY = Math.max(0, minY - grow);
    maxX = Math.min(w - 1, maxX + grow);
    maxY = Math.min(h - 1, maxY + grow);
  }

  // Paint the fill colour *behind* existing pixels in the grown edge (so lines stay crisp),
  // and solidly inside the area.
  const [fr, fg, fb] = parseHex(color);
  for (let yy = minY; yy <= maxY; yy++) {
    for (let xx = minX; xx <= maxX; xx++) {
      const p = yy * w + xx;
      if (!fillMask[p]) continue;
      const i = p * 4;
      if (mask[p]) {
        d[i] = fr;
        d[i + 1] = fg;
        d[i + 2] = fb;
        d[i + 3] = 255;
      } else {
        // edge pixel: put the fill underneath the existing (line) colour
        const a = d[i + 3] / 255;
        d[i] = Math.round(d[i] * a + fr * (1 - a));
        d[i + 1] = Math.round(d[i + 1] * a + fg * (1 - a));
        d[i + 2] = Math.round(d[i + 2] * a + fb * (1 - a));
        d[i + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0, minX, minY, maxX - minX + 1, maxY - minY + 1);
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Turn a filled area into outline loops [x0,y0,x1,y1,...] so it can be a sharp vector fill.
 * Walks the edges between filled and empty pixels and joins them up.
 */
export function traceLoops(canvas: HTMLCanvasElement, box: Rect): number[][] {
  const { x: bx, y: by, w, h } = box;
  const d = canvas.getContext('2d')!.getImageData(bx, by, w, h).data;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 127;
  const key = (x: number, y: number) => (y + 1) * (w + 3) + x + 1;
  const next = new Map<number, number[]>();
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const v = next.get(k);
    if (v) v.push(x1, y1);
    else next.set(k, [x1, y1]);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue;
      if (!on(x, y - 1)) add(x, y, x + 1, y);
      if (!on(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!on(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!on(x - 1, y)) add(x, y + 1, x, y);
    }
  }
  const loops: number[][] = [];
  for (const startKey of [...next.keys()]) {
    while (next.get(startKey)?.length) {
      const sx = (startKey % (w + 3)) - 1;
      const sy = Math.floor(startKey / (w + 3)) - 1;
      const loop: number[] = [];
      let cx = sx;
      let cy = sy;
      let dirX = 0;
      let dirY = 0;
      do {
        const v = next.get(key(cx, cy));
        if (!v || !v.length) break;
        const ny = v.pop()!;
        const nx = v.pop()!;
        const dx = nx - cx;
        const dy = ny - cy;
        if (dx !== dirX || dy !== dirY) loop.push(cx + bx, cy + by); // keep corners only
        dirX = dx;
        dirY = dy;
        cx = nx;
        cy = ny;
      } while (cx !== sx || cy !== sy);
      if (loop.length >= 6) loops.push(loop);
    }
  }
  return loops;
}
