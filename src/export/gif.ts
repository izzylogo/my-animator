/** A looping GIF, written frame by frame. Each frame gets its own 256-colour palette. */
const BINS = 32768; // colours are grouped 5 bits per channel, which leaves flat cartoon colours exact

interface Palette {
  colours: number[][];
  lookup: Int16Array;
}

function buildPalette(rgba: Uint8ClampedArray, limit: number): Palette {
  const count = new Uint32Array(BINS);
  const sum = new Float64Array(BINS * 3);
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    const key = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
    count[key]++;
    sum[key * 3] += rgba[i];
    sum[key * 3 + 1] += rgba[i + 1];
    sum[key * 3 + 2] += rgba[i + 2];
  }
  const used: number[] = [];
  for (let key = 0; key < BINS; key++) if (count[key]) used.push(key);
  const channel = (key: number, c: number) => (key >> (10 - c * 5)) & 31;

  // Keep splitting the busiest group of colours until there are enough groups.
  const groups: number[][] = used.length ? [used] : [];
  while (groups.length < limit) {
    let best = -1;
    let bestScore = 0;
    let bestChannel = 0;
    groups.forEach((g, i) => {
      if (g.length < 2) return;
      let total = 0;
      for (const k of g) total += count[k];
      for (let c = 0; c < 3; c++) {
        let low = 31;
        let high = 0;
        for (const k of g) {
          const v = channel(k, c);
          if (v < low) low = v;
          if (v > high) high = v;
        }
        const score = (high - low) * Math.sqrt(total);
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestChannel = c;
        }
      }
    });
    if (best < 0) break;
    const sorted = groups[best].sort((a, b) => channel(a, bestChannel) - channel(b, bestChannel));
    const half = sorted.reduce((n, k) => n + count[k], 0) / 2;
    let seen = 0;
    let cut = 1;
    for (; cut < sorted.length - 1; cut++) {
      seen += count[sorted[cut - 1]];
      if (seen >= half) break;
    }
    groups[best] = sorted.slice(0, cut);
    groups.push(sorted.slice(cut));
  }

  const lookup = new Int16Array(BINS);
  const colours = groups.map((g, index) => {
    const totals = [0, 0, 0];
    let n = 0;
    for (const k of g) {
      lookup[k] = index;
      n += count[k];
      for (let c = 0; c < 3; c++) totals[c] += sum[k * 3 + c];
    }
    return totals.map((t) => Math.round(t / n));
  });
  return { colours, lookup };
}

export class GifWriter {
  private parts: Uint8Array[] = [];

  constructor(private width: number, private height: number) {
    const size = [width & 255, width >> 8, height & 255, height >> 8];
    const looping = [0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, 0, 0, 0];
    this.parts.push(Uint8Array.from([...Array.from('GIF89a', (c) => c.charCodeAt(0)), ...size, 0x70, 0, 0, ...looping]));
  }

  addFrame(rgba: Uint8ClampedArray, delay: number, clear: boolean): void {
    const { colours, lookup } = buildPalette(rgba, clear ? 255 : 256);
    const blank = colours.length;
    const entries = colours.length + (clear ? 1 : 0);
    let bits = 1;
    while (1 << bits < entries) bits++;
    const indices = new Uint8Array(this.width * this.height);
    for (let i = 0, p = 0; p < indices.length; i += 4, p++) {
      indices[p] = rgba[i + 3] < 128 ? blank : lookup[((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3)];
    }
    const table = new Uint8Array(3 << bits);
    colours.forEach((c, i) => table.set(c, i * 3));
    const w = [this.width & 255, this.width >> 8];
    const h = [this.height & 255, this.height >> 8];
    const packed = clear ? (2 << 2) | 1 : 1 << 2;
    this.parts.push(Uint8Array.of(0x21, 0xf9, 4, packed, delay & 255, delay >> 8, clear ? blank : 0, 0, 0x2c, 0, 0, 0, 0, ...w, ...h, 0x80 | (bits - 1)), table, compress(indices, Math.max(2, bits)));
  }

  finish(): Uint8Array {
    this.parts.push(Uint8Array.of(0x3b));
    const out = new Uint8Array(this.parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of this.parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }
}

/** GIF's LZW compression, split into the short blocks the format requires. */
function compress(indices: Uint8Array, minBits: number): Uint8Array {
  const clearCode = 1 << minBits;
  const endCode = clearCode + 1;
  const bytes: number[] = [minBits];
  let block: number[] = [];
  let holding = 0;
  let held = 0;
  let bits = minBits + 1;
  let next = endCode + 1;
  let codes = new Map<number, number>();

  const flushBlock = () => {
    if (!block.length) return;
    bytes.push(block.length);
    for (const b of block) bytes.push(b);
    block = [];
  };
  const emit = (code: number) => {
    holding |= code << held;
    held += bits;
    while (held >= 8) {
      block.push(holding & 255);
      holding >>>= 8;
      held -= 8;
      if (block.length === 255) flushBlock();
    }
  };

  emit(clearCode);
  let current = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const value = indices[i];
    const key = (current << 8) | value;
    const known = codes.get(key);
    if (known !== undefined) {
      current = known;
      continue;
    }
    emit(current);
    if (next === 4096) {
      emit(clearCode);
      codes = new Map();
      next = endCode + 1;
      bits = minBits + 1;
    } else {
      if (next >= 1 << bits) bits++;
      codes.set(key, next++);
    }
    current = value;
  }
  emit(current);
  emit(endCode);
  if (held > 0) block.push(holding & 255);
  flushBlock();
  bytes.push(0);
  return Uint8Array.from(bytes);
}
