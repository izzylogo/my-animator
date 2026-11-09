import { GifWriter } from './gif';
import { buildMp4, type VideoSample } from './mp4';
import { buildWebm } from './webm';

export type ExportFormat = 'mp4' | 'gif' | 'png' | 'webm';

export interface ExportJob {
  format: ExportFormat;
  from: number; // first frame, counted from 0
  to: number; // last frame, included
  width: number;
  height: number;
  fps: number;
  paper: boolean;
  baseName: string;
  draw(ctx: CanvasRenderingContext2D, frame: number): void;
}

export interface ExportSink {
  file(bytes: Uint8Array): Promise<void>;
  frame(name: string, bytes: Uint8Array): Promise<void>;
}

export class ExportCancelled extends Error {}

export interface ExportControl {
  cancelled(): boolean;
  progress(done: number, total: number): void;
}

const breathe = () => new Promise((resolve) => setTimeout(resolve, 0));

function canvasFor(job: ExportJob, options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = job.width;
  canvas.height = job.height;
  return canvas.getContext('2d', options)!;
}

async function h264Config(job: ExportJob): Promise<VideoEncoderConfig | null> {
  const level = job.width * job.height * job.fps > 1920 * 1080 * 30 ? '2a' : '28';
  for (const profile of ['4d00', '4200']) {
    const config: VideoEncoderConfig = {
      codec: `avc1.${profile}${level}`,
      width: job.width,
      height: job.height,
      framerate: job.fps,
      bitrate: Math.round(job.width * job.height * job.fps * 0.28),
      avc: { format: 'avc' },
    };
    if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
  }
  return null;
}

export async function canMakeMp4(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    return (await h264Config({ width: 1280, height: 720, fps: 24 } as ExportJob)) !== null;
  } catch {
    return false;
  }
}

/** One video encoder with its finished frames, waiting politely when it falls behind. */
class Stream {
  samples: { data: Uint8Array; key: boolean }[] = [];
  description: Uint8Array | null = null;
  private failure: Error | null = null;
  private encoder: VideoEncoder;

  constructor(config: VideoEncoderConfig) {
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.samples.push({ data, key: chunk.type === 'key' });
        const description = meta?.decoderConfig?.description;
        if (description) this.description = new Uint8Array(description instanceof ArrayBuffer ? description : description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength) as ArrayBuffer);
      },
      error: (e) => (this.failure = e),
    });
    this.encoder.configure(config);
  }

  private check(): void {
    if (this.failure) throw this.failure;
  }

  async add(frame: VideoFrame, keyFrame: boolean): Promise<void> {
    this.check();
    this.encoder.encode(frame, { keyFrame });
    frame.close();
    while (this.encoder.encodeQueueSize > 3) {
      await new Promise((resolve) => setTimeout(resolve, 4));
      this.check();
    }
  }

  async finish(): Promise<void> {
    await this.encoder.flush();
    this.check();
    this.close();
  }

  close(): void {
    if (this.encoder.state !== 'closed') this.encoder.close();
  }
}

const frameTime = (index: number, fps: number) => Math.round((index * 1_000_000) / fps);

async function makeMp4(job: ExportJob, sink: ExportSink, control: ExportControl): Promise<void> {
  const config = await h264Config(job);
  if (!config) throw new Error('MP4 video is not available on this computer.');
  const ctx = canvasFor(job);
  const stream = new Stream(config);
  const total = job.to - job.from + 1;
  try {
    for (let i = 0; i < total; i++) {
      if (control.cancelled()) throw new ExportCancelled();
      job.draw(ctx, job.from + i);
      await stream.add(new VideoFrame(ctx.canvas, { timestamp: frameTime(i, job.fps), duration: frameTime(1, job.fps), alpha: 'discard' }), i % (job.fps * 2) === 0);
      control.progress(i + 1, total);
      await breathe();
    }
    await stream.finish();
  } finally {
    stream.close();
  }
  if (!stream.description) throw new Error('The video encoder gave no settings.');
  await sink.file(buildMp4(stream.samples as VideoSample[], stream.description, job.width, job.height, job.fps));
}

async function makeTransparentVideo(job: ExportJob, sink: ExportSink, control: ExportControl): Promise<void> {
  const area = job.width * job.height;
  const config = (bitrate: number): VideoEncoderConfig => ({ codec: 'vp09.00.40.08', width: job.width, height: job.height, framerate: job.fps, bitrate: Math.round(bitrate) });
  const colour = new Stream(config(area * job.fps * 0.28));
  const clear = new Stream(config(area * job.fps * 0.12));
  const source = canvasFor(job, { willReadFrequently: true });
  const flat = canvasFor(job);
  const total = job.to - job.from + 1;
  const quarter = (job.width >> 1) * (job.height >> 1);
  const planes = new Uint8Array(area + quarter * 2).fill(128);
  try {
    for (let i = 0; i < total; i++) {
      if (control.cancelled()) throw new ExportCancelled();
      job.draw(source, job.from + i);
      const image = source.getImageData(0, 0, job.width, job.height);
      for (let p = 0; p < area; p++) {
        planes[p] = image.data[p * 4 + 3];
        image.data[p * 4 + 3] = 255;
      }
      flat.putImageData(image, 0, 0);
      const key = i % (job.fps * 2) === 0;
      const timing = { timestamp: frameTime(i, job.fps), duration: frameTime(1, job.fps) };
      await colour.add(new VideoFrame(flat.canvas, { ...timing, alpha: 'discard' }), key);
      await clear.add(new VideoFrame(planes, { ...timing, format: 'I420', codedWidth: job.width, codedHeight: job.height }), key);
      control.progress(i + 1, total);
      await breathe();
    }
    await colour.finish();
    await clear.finish();
  } finally {
    colour.close();
    clear.close();
  }
  if (colour.samples.length !== clear.samples.length) throw new Error('The colour and transparency frames did not match.');
  await sink.file(buildWebm(colour.samples.map((s, i) => ({ data: s.data, alpha: clear.samples[i].data, key: s.key })), job.width, job.height, job.fps));
}

async function makeGif(job: ExportJob, sink: ExportSink, control: ExportControl): Promise<void> {
  const ctx = canvasFor(job, { willReadFrequently: true });
  const writer = new GifWriter(job.width, job.height);
  const step = Math.ceil(job.fps / 50); // GIF viewers can't show frames shorter than 1/50 second
  const total = job.to - job.from + 1;
  const hundredths = (index: number) => Math.round((index * 100) / job.fps);
  for (let i = 0; i < total; i += step) {
    if (control.cancelled()) throw new ExportCancelled();
    job.draw(ctx, job.from + i);
    writer.addFrame(ctx.getImageData(0, 0, job.width, job.height).data, hundredths(i + step) - hundredths(i), !job.paper);
    control.progress(Math.min(i + step, total), total);
    await breathe();
  }
  await sink.file(writer.finish());
}

async function makePngs(job: ExportJob, sink: ExportSink, control: ExportControl): Promise<void> {
  const ctx = canvasFor(job);
  const total = job.to - job.from + 1;
  for (let i = 0; i < total; i++) {
    if (control.cancelled()) throw new ExportCancelled();
    job.draw(ctx, job.from + i);
    const blob = await new Promise<Blob | null>((resolve) => ctx.canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('A frame could not be made into a picture.');
    await sink.frame(`${job.baseName}_${String(job.from + i + 1).padStart(4, '0')}.png`, new Uint8Array(await blob.arrayBuffer()));
    control.progress(i + 1, total);
  }
}

export function runExport(job: ExportJob, sink: ExportSink, control: ExportControl): Promise<void> {
  const maker = { mp4: makeMp4, webm: makeTransparentVideo, gif: makeGif, png: makePngs }[job.format];
  return maker(job, sink, control);
}
