/** Packs H.264 frames into a standard .mp4 file. The index sits at the front, so it plays while downloading. */
export interface VideoSample {
  data: Uint8Array;
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
const zeros = (n: number) => new Uint8Array(n);
const u16 = (...v: number[]) => join(v.map((n) => Uint8Array.of((n >> 8) & 255, n & 255)));
const u32 = (...v: number[]) => join(v.map((n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)));

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const body = join(parts);
  return join([u32(body.length + 8), text(type), body]);
}

const IDENTITY = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);

export function buildMp4(samples: VideoSample[], decoderConfig: Uint8Array, width: number, height: number, fps: number): Uint8Array {
  const timescale = fps * 512;
  const delta = 512;
  const duration = samples.length * delta;
  const ftyp = box('ftyp', text('isom'), u32(512), text('isomiso2avc1mp41'));

  const sampleEntry = box(
    'avc1',
    zeros(6),
    u16(1),
    zeros(16),
    u16(width, height),
    u32(0x480000, 0x480000, 0),
    u16(1),
    zeros(32),
    u16(0x18, 0xffff),
    box('avcC', decoderConfig),
  );

  const moov = (dataOffset: number) => {
    const keys = samples.flatMap((s, i) => (s.key ? [i + 1] : []));
    const stbl = box(
      'stbl',
      box('stsd', u32(0, 1), sampleEntry),
      box('stts', u32(0, 1, samples.length, delta)),
      box('stss', u32(0, keys.length, ...keys)),
      box('stsc', u32(0, 1, 1, samples.length, 1)),
      box('stsz', u32(0, 0, samples.length, ...samples.map((s) => s.data.length))),
      box('stco', u32(0, 1, dataOffset)),
    );
    const minf = box('minf', box('vmhd', u32(1), zeros(8)), box('dinf', box('dref', u32(0, 1), box('url ', u32(1)))), stbl);
    const mdia = box(
      'mdia',
      box('mdhd', u32(0, 0, 0, timescale, duration), u16(0x55c4, 0)),
      box('hdlr', u32(0, 0), text('vide'), zeros(12), text('My Animator\0')),
      minf,
    );
    const tkhd = box('tkhd', u32(3, 0, 0, 1, 0, duration, 0, 0), u16(0, 0, 0, 0), IDENTITY, u32(width * 0x10000, height * 0x10000));
    const mvhd = box('mvhd', u32(0, 0, 0, timescale, duration, 0x10000), u16(0x100, 0), zeros(8), IDENTITY, zeros(24), u32(2));
    return box('moov', mvhd, box('trak', tkhd, mdia));
  };

  const headerSize = ftyp.length + moov(0).length + 8;
  const data = join(samples.map((s) => s.data));
  return join([ftyp, moov(headerSize), u32(data.length + 8), text('mdat'), data]);
}
