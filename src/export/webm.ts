/**
 * Packs VP9 frames into a .webm file with transparency. WebM stores transparency as a second
 * stream of frames, one attached to each colour frame.
 */
export interface AlphaSample {
  data: Uint8Array;
  alpha: Uint8Array;
  key: boolean;
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const text = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

function bigEndian(n: number): Uint8Array {
  const out: number[] = [];
  let v = n;
  do {
    out.unshift(v % 256);
    v = Math.floor(v / 256);
  } while (v > 0);
  return Uint8Array.from(out);
}

function size(n: number): Uint8Array {
  let bytes = 1;
  while (n >= 2 ** (7 * bytes) - 1) bytes++;
  const out = new Uint8Array(bytes);
  let v = n;
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  out[0] |= 1 << (8 - bytes);
  return out;
}

const el = (id: number, ...payload: Uint8Array[]) => {
  const body = join(payload);
  return join([bigEndian(id), size(body.length), body]);
};
const uint = (id: number, n: number) => el(id, bigEndian(n));

function float(id: number, n: number): Uint8Array {
  const body = new Uint8Array(8);
  new DataView(body.buffer).setFloat64(0, n);
  return el(id, body);
}

function signed(id: number, n: number): Uint8Array {
  const body = new Uint8Array(4);
  new DataView(body.buffer).setInt32(0, n);
  return el(id, body);
}

export function buildWebm(samples: AlphaSample[], width: number, height: number, fps: number): Uint8Array {
  const at = (i: number) => Math.round((i * 1000) / fps);
  const header = el(0x1a45dfa3, uint(0x4286, 1), uint(0x42f7, 1), uint(0x42f2, 4), uint(0x42f3, 8), el(0x4282, text('webm')), uint(0x4287, 4), uint(0x4285, 2));
  const info = el(0x1549a966, uint(0x2ad7b1, 1_000_000), el(0x4d80, text('My Animator')), el(0x5741, text('My Animator')), float(0x4489, at(samples.length)));
  const video = el(0xe0, uint(0xb0, width), uint(0xba, height), uint(0x53c0, 1));
  const track = el(0xae, uint(0xd7, 1), uint(0x73c5, 1), uint(0x83, 1), uint(0x9c, 0), el(0x86, text('V_VP9')), uint(0x55ee, 1), uint(0x23e383, Math.round(1e9 / fps)), video);
  const tracks = el(0x1654ae6b, track);

  const clusters: Uint8Array[] = [];
  let groups: Uint8Array[] = [];
  let clusterStart = 0;
  const close = () => {
    if (groups.length) clusters.push(el(0x1f43b675, uint(0xe7, clusterStart), ...groups));
    groups = [];
  };
  samples.forEach((s, i) => {
    if (s.key) {
      close();
      clusterStart = at(i);
    }
    const relative = at(i) - clusterStart;
    const block = el(0xa1, Uint8Array.of(0x81, (relative >> 8) & 255, relative & 255, 0), s.data);
    const additions = el(0x75a1, el(0xa6, uint(0xee, 1), el(0xa5, s.alpha)));
    const length = uint(0x9b, at(i + 1) - at(i));
    groups.push(s.key ? el(0xa0, block, additions, length) : el(0xa0, block, additions, length, signed(0xfb, at(i - 1) - at(i))));
  });
  close();
  return join([header, el(0x18538067, info, tracks, ...clusters)]);
}
