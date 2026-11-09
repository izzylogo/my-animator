import { KeyframeTrack } from './keyframeTrack';
import type { VItem } from './vector';

/** Vector = sharp at any zoom, editable shapes. Bitmap = painted pixels. */
export type LayerKind = 'vector' | 'bitmap';
export type BlendMode = 'source-over' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'lighter';

/**
 * A raster keyframe just holds a "ticket" (drawingId) pointing at pixels kept in the
 * DrawingStore, like Krita's frame IDs. That split is what lets two keyframes share
 * one drawing later (clones) and keeps saving simple.
 *
 * `label` and `origin` are the hook for the future AI in-betweener: keyframes you draw
 * as stick figures get a character label, and AI-made frames are marked 'generated'.
 */
export interface RasterKey {
  drawingId: string;
  label?: string;
  origin?: 'drawn' | 'generated';
  tween?: boolean; // keyframe mode: frames after this key blend towards the next key
}

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0..1
  blend: BlendMode;
  motion: boolean; // keyframe mode: in-between frames are worked out automatically
  ease: 'smooth' | 'steady'; // how in-betweens travel between keyframes
  reference: boolean; // an imported picture to trace; not part of the artwork
  track: KeyframeTrack<RasterKey>;
  color: string; // the layer's tag colour, used by outlines and highlight
  outline: boolean; // show this layer as thin lines in its tag colour
  highlight: boolean; // tint this layer's row on the timeline
  folder?: boolean; // a folder row: holds no drawings
  open?: boolean; // folder only: are its layers listed?
  parent?: string | null; // the folder this layer is in
}

const LAYER_COLOURS = ['#39c5e0', '#ff8a3d', '#6ad66a', '#ff6b9d', '#ffd24d', '#7aa2ff', '#e58bff', '#4de0b0'];
let nextColour = 0;

let idCounter = 0;
export const newId = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/**
 * Owns the pixels of every drawing. Drawings are created lazily: a blank keyframe
 * costs nothing until you paint on it (Krita saves empty drawings almost for free too).
 */
export class DrawingStore {
  private canvases = new Map<string, HTMLCanvasElement>();
  private vectors = new Map<string, VItem[]>();
  private painted = new Set<string>();

  constructor(readonly width: number, readonly height: number) {}

  /** A new, blank drawing. No memory is used until it's painted on. */
  create(): string {
    return newId('d');
  }

  /** The pixels to show, or undefined if the drawing is still blank. */
  get(id: string): HTMLCanvasElement | undefined {
    return this.canvases.get(id);
  }

  /** The pixels to paint on (allocated on first use). */
  ensure(id: string): HTMLCanvasElement {
    let c = this.canvases.get(id);
    if (!c) {
      c = document.createElement('canvas');
      c.width = this.width;
      c.height = this.height;
      this.canvases.set(id, c);
    }
    return c;
  }

  /** The items of a vector drawing (created on first use). */
  items(id: string): VItem[] {
    let v = this.vectors.get(id);
    if (!v) {
      v = [];
      this.vectors.set(id, v);
    }
    return v;
  }

  setItems(id: string, items: VItem[]): void {
    this.vectors.set(id, items);
    this.setPainted(id, items.length > 0);
  }

  setPainted(id: string, painted: boolean): void {
    if (painted) this.painted.add(id);
    else this.painted.delete(id);
  }

  hasContent(id: string): boolean {
    return this.painted.has(id);
  }

  /** Empty the store (a different file is being opened). */
  clear(): void {
    this.canvases.clear();
    this.vectors.clear();
    this.painted.clear();
  }

  /** Put a drawing back exactly as a saved file describes it. */
  restore(id: string, content: { items?: VItem[]; canvas?: HTMLCanvasElement }): void {
    if (content.canvas) {
      this.canvases.set(id, content.canvas);
      this.painted.add(id);
    }
    if (content.items) this.setItems(id, content.items);
  }

  /** A separate copy of a drawing (used for "duplicate keyframe"). */
  duplicate(id: string): string {
    const copy = this.create();
    const src = this.canvases.get(id);
    if (src) {
      this.ensure(copy).getContext('2d')!.drawImage(src, 0, 0);
      if (this.painted.has(id)) this.painted.add(copy);
    }
    const v = this.vectors.get(id);
    if (v) this.setItems(copy, v.map((it) => ({ ...it })));
    return copy;
  }
}

export class Project {
  fps = 24;
  length = 48; // number of frames in the animation
  background = '#ffffff';
  layers: Layer[] = []; // index 0 = bottom layer
  readonly drawings: DrawingStore;

  constructor(readonly width = 1280, readonly height = 720) {
    this.drawings = new DrawingStore(width, height);
  }

  addLayer(name: string, index = this.layers.length, kind: LayerKind = 'vector'): Layer {
    const layer: Layer = { id: newId('L'), name, kind, visible: true, locked: false, opacity: 1, blend: 'source-over', motion: false, ease: 'smooth', reference: false, track: new KeyframeTrack<RasterKey>(), color: LAYER_COLOURS[nextColour++ % LAYER_COLOURS.length], outline: false, highlight: false };
    this.layers.splice(index, 0, layer);
    return layer;
  }

  /** Back to an empty project, with no layers yet. */
  clear(): void {
    this.fps = 24;
    this.length = 48;
    this.background = '#ffffff';
    this.layers = [];
    this.drawings.clear();
  }

  layerById(id: string): Layer | undefined {
    return this.layers.find((l) => l.id === id);
  }

  /** Visible, and not inside a hidden folder. */
  isShown(l: Layer): boolean {
    return l.visible && (!l.parent || this.layerById(l.parent)?.visible !== false);
  }

  /** Locked, or inside a locked folder. */
  isLocked(l: Layer): boolean {
    return l.locked || (!!l.parent && this.layerById(l.parent)?.locked === true);
  }
}
