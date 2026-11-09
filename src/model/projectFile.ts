import type { OnionPin } from '../render/compositor';
import { KeyframeTrack } from './keyframeTrack';
import { reserveUids } from './motion';
import type { Layer, Project, RasterKey } from './project';
import type { VItem } from './vector';

/**
 * A project file is plain text (JSON). Bitmap drawings and pictures are PNGs written as text.
 * The points of a line are stored once and shared between keyframes, as they are in memory,
 * which keeps files small and keeps playback of an opened file as quick as a fresh one.
 */
const FORMAT = 'my-animator';
const VERSION = 1;

export interface WorkPlace {
  frame: number;
  activeLayerId: string;
  pins: OnionPin[];
}

export interface OpenedProject extends WorkPlace {
  fps: number;
  length: number;
  background: string;
  layers: Layer[];
  drawings: { id: string; items?: VItem[]; canvas?: HTMLCanvasElement }[];
}

const GEOMETRY = { stroke: 'pts', shape: 'shape', bez: 'anchors', fill: 'loops' } as const;
type WithGeometry = keyof typeof GEOMETRY;
const hasGeometry = (t: string): t is WithGeometry => t in GEOMETRY;

export function projectToText(project: Project, place: WorkPlace): string {
  const shared = new Map<object, number>();
  const packItem = (it: VItem): unknown => {
    if (it.t === 'image') {
      const { canvas, ...rest } = it;
      return { ...rest, png: canvas.toDataURL('image/png') };
    }
    if (!hasGeometry(it.t)) return it;
    const field = GEOMETRY[it.t];
    const geometry = (it as unknown as Record<string, object>)[field];
    if (!shared.has(geometry)) shared.set(geometry, shared.size);
    return { ...it, [field]: shared.get(geometry) };
  };

  const drawings: Record<string, unknown> = {};
  const layers = project.layers.map(({ track, ...rest }) => {
    const keys = track.allTimes().map((t) => {
      const key = track.get(t)!;
      if (!drawings[key.drawingId] && project.drawings.hasContent(key.drawingId)) {
        const canvas = project.drawings.get(key.drawingId);
        drawings[key.drawingId] = rest.kind === 'bitmap' ? { png: canvas?.toDataURL('image/png') } : { items: project.drawings.items(key.drawingId).map(packItem) };
      }
      return [t, key];
    });
    return { ...rest, keys };
  });
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    width: project.width,
    height: project.height,
    fps: project.fps,
    length: project.length,
    background: project.background,
    ...place,
    layers,
    geometry: [...shared.keys()],
    drawings,
  });
}

async function pngToCanvas(source: unknown): Promise<HTMLCanvasElement> {
  if (typeof source !== 'string' || !source.startsWith('data:image/')) throw new Error('A picture in the file is unreadable.');
  const image = new Image();
  // Not image.decode(): that waits for a screen refresh, which never comes if the window is covered.
  await new Promise((done, fail) => {
    image.onload = done;
    image.onerror = () => fail(new Error('A picture in the file is unreadable.'));
    image.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  return canvas;
}

function need(ok: unknown, what: string): asserts ok {
  if (!ok) throw new Error(what);
}

/** Read a whole file without touching the open project, so a damaged file can't wreck your work. */
export async function projectFromText(text: string, width: number, height: number): Promise<OpenedProject> {
  const data = JSON.parse(text);
  need(data?.format === FORMAT, 'This is not a My Animator project.');
  need(data.version <= VERSION, 'This project was made by a newer version of My Animator.');
  need(data.width === width && data.height === height, 'This project is a different picture size.');
  need(Array.isArray(data.layers) && data.layers.length, 'The project has no layers.');
  need(Array.isArray(data.geometry), 'The drawings in the file are unreadable.');

  let highestUid = 0;
  const unpackItem = async (raw: Record<string, unknown>): Promise<VItem> => {
    need(Array.isArray(raw?.m) && raw.m.length === 6, 'A drawing in the file is unreadable.');
    highestUid = Math.max(highestUid, Number(raw.uid) || 0);
    const t = String(raw.t);
    if (t === 'image') {
      const { png, ...rest } = raw;
      return { ...rest, canvas: await pngToCanvas(png) } as unknown as VItem;
    }
    if (t === 'text') return raw as unknown as VItem;
    need(hasGeometry(t), 'A drawing in the file is unreadable.');
    const field = GEOMETRY[t as WithGeometry];
    const geometry = data.geometry[raw[field] as number];
    need(geometry, 'A drawing in the file is unreadable.');
    return { ...raw, [field]: geometry } as unknown as VItem;
  };

  const drawings: OpenedProject['drawings'] = [];
  for (const [id, saved] of Object.entries<{ items?: Record<string, unknown>[]; png?: string }>(data.drawings ?? {})) {
    if (saved.items) drawings.push({ id, items: await Promise.all(saved.items.map(unpackItem)) });
    else if (saved.png) drawings.push({ id, canvas: await pngToCanvas(saved.png) });
  }
  reserveUids(highestUid);

  const layers = data.layers.map((saved: Layer & { keys: [number, RasterKey][] }): Layer => {
    need(Array.isArray(saved.keys), 'A layer in the file is unreadable.');
    const { keys, ...rest } = saved;
    const track = new KeyframeTrack<RasterKey>();
    for (const [t, key] of keys) {
      need(Number.isInteger(t) && t >= 0 && typeof key?.drawingId === 'string', 'A layer in the file is unreadable.');
      track.set(t, key);
    }
    return { ...rest, track };
  });
  need(
    layers.some((l: Layer) => !l.folder),
    'The project has no layers.',
  );

  return {
    fps: Number(data.fps) || 24,
    length: Number(data.length) || 48,
    background: String(data.background ?? '#ffffff'),
    frame: Number(data.frame) || 0,
    activeLayerId: String(data.activeLayerId),
    pins: Array.isArray(data.pins) ? data.pins : [],
    layers,
    drawings,
  };
}
