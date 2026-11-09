import type { Layer, Project } from '../model/project';
import { drawItems, drawOutlines } from '../model/vector';
import { sampleItems } from '../model/motion';
import type { VItem } from '../model/vector';

/** A frame whose ghost stays on screen while you work on other frames. */
export interface OnionPin {
  layerId: string;
  frame: number;
  color: string;
  opacity: number; // 0..1
}

export interface OnionSettings {
  enabled: boolean;
  before: number; // how many previous drawings to show
  after: number; // how many next drawings to show
  opacity: number; // 0..1, strength of the nearest ghost
  beforeColor: string;
  afterColor: string;
  pins: OnionPin[];
}

/** Where the drawing sits on the target canvas. Numbers are the canvas transform. */
export interface View {
  m: [number, number, number, number, number, number];
  width: number; // target canvas size in real pixels
  height: number;
}

/**
 * Builds the picture for one frame: paper, onion-skin ghosts, then visible layers
 * bottom-to-top. Everything is drawn at the target's real resolution, so vector layers stay
 * sharp at any zoom. Like Krita, ghosts are neighbouring drawings, tinted and fading.
 */
export class Compositor {
  private layerCanvas = document.createElement('canvas');
  private tint = document.createElement('canvas');

  /** While a line is being drawn, everything except that line is kept as finished pictures. */
  live: { layerId: string; before: VItem[]; item: VItem } | null = null;
  private liveKey = '';
  private plain = false; // the fill bucket needs real colours, not outlines
  private liveBelow = document.createElement('canvas');
  private liveBase = document.createElement('canvas');
  private liveAbove = document.createElement('canvas');

  constructor(private project: Project) {}

  private fit(c: HTMLCanvasElement, v: View): CanvasRenderingContext2D {
    if (c.width !== v.width || c.height !== v.height) {
      c.width = v.width;
      c.height = v.height;
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(...v.m);
    return ctx;
  }

  /** Draw one drawing (bitmap or vector) into ctx, which already has the view transform. */
  private paintDrawing(ctx: CanvasRenderingContext2D, layer: Layer, drawingId: string, frame?: number): void {
    const d = this.project.drawings;
    if (layer.kind === 'vector') {
      this.paintItems(ctx, layer, frame !== undefined && layer.motion ? sampleItems(layer, frame, d) : (d.items(drawingId) as VItem[]));
    } else {
      const px = d.get(drawingId);
      if (!px) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(px, 0, 0);
      if (layer.outline && !this.plain) {
        // Pixels have no lines to trace, so a bitmap layer shows as a flat shape in its colour.
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-in';
        ctx.fillStyle = layer.color;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.restore();
      }
    }
  }

  private paintItems(ctx: CanvasRenderingContext2D, layer: Layer, items: VItem[]): void {
    if (!layer.outline || this.plain) return drawItems(ctx, items);
    const m = ctx.getTransform();
    drawOutlines(ctx, items, layer.color, 1.5 / (Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1));
  }

  render(ctx: CanvasRenderingContext2D, frame: number, onion: OnionSettings | null, v: View): void {
    const p = this.project;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.setTransform(...v.m);
    // Nothing shows outside the paper.
    ctx.beginPath();
    ctx.rect(0, 0, p.width, p.height);
    ctx.clip();

    const index = this.live ? p.layers.findIndex((l) => l.id === this.live!.layerId) : -1;
    if (index >= 0) {
      this.renderLive(ctx, frame, onion, v, index);
      ctx.restore();
      return;
    }
    this.paintBelow(ctx, frame, onion, v, p.layers.length);
    ctx.restore();
  }

  /** Paper, ghosts and the first `count` layers. */
  private paintBelow(ctx: CanvasRenderingContext2D, frame: number, onion: OnionSettings | null, v: View, count: number): void {
    const p = this.project;
    ctx.fillStyle = p.background;
    ctx.fillRect(0, 0, p.width, p.height);
    if (onion?.enabled) {
      for (const layer of p.layers) if (p.isShown(layer)) this.drawOnion(ctx, layer, frame, onion, v);
    }
    if (onion) {
      // Frames you pinned stay visible even when the normal onion skin is switched off.
      for (const pin of onion.pins) {
        const layer = p.layers.find((l) => l.id === pin.layerId);
        if (layer && p.isShown(layer)) this.drawPin(ctx, layer, frame, pin, v);
      }
    }
    p.layers.slice(0, count).forEach((layer) => {
      if (p.isShown(layer)) this.drawLayer(ctx, layer, frame, v);
    });
  }

  /** One line changes while you draw, so only that line is redrawn. */
  private renderLive(ctx: CanvasRenderingContext2D, frame: number, onion: OnionSettings | null, v: View, index: number): void {
    const p = this.project;
    const live = this.live!;
    const layer = p.layers[index];
    const above = p.layers.slice(index + 1).filter((l) => p.isShown(l));
    const simpleAbove = above.every((l) => l.blend === 'source-over');
    const key = `${v.m.join()}|${v.width}|${v.height}|${frame}`;
    if (key !== this.liveKey) {
      this.liveKey = key;
      this.paintBelow(this.fit(this.liveBelow, v), frame, onion, v, index);
      this.paintItems(this.fit(this.liveBase, v), layer, live.before);
      const a = this.fit(this.liveAbove, v);
      if (simpleAbove) for (const l of above) this.drawLayer(a, l, frame, v);
    }
    const lc = this.fit(this.layerCanvas, v);
    lc.save();
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.drawImage(this.liveBase, 0, 0);
    lc.restore();
    this.paintItems(lc, layer, [live.item]);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.liveBelow, 0, 0);
    if (p.isShown(layer)) {
      ctx.globalAlpha = layer.opacity;
      ctx.globalCompositeOperation = layer.blend;
      ctx.drawImage(this.layerCanvas, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    if (simpleAbove) ctx.drawImage(this.liveAbove, 0, 0);
    ctx.restore();
    if (!simpleAbove) for (const l of above) this.drawLayer(ctx, l, frame, v);
  }

  /** Call when a line ends, so the next one starts from fresh pictures. */
  endLive(): void {
    this.live = null;
    this.liveKey = '';
  }

  private drawLayer(ctx: CanvasRenderingContext2D, layer: Layer, frame: number, v: View): void {
    const key = layer.track.active(frame);
    if (!key || !this.project.drawings.hasContent(key.drawingId)) return;
    // Each layer is built separately so erasing only affects its own drawing.
    const lc = this.fit(this.layerCanvas, v);
    this.paintDrawing(lc, layer, key.drawingId, frame);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = layer.opacity;
    ctx.globalCompositeOperation = layer.blend;
    ctx.drawImage(this.layerCanvas, 0, 0);
    ctx.restore();
  }

  /** The finished picture for an export: no ghosts, no outlines view and no reference pictures. */
  renderFinal(ctx: CanvasRenderingContext2D, frame: number, width: number, paper: boolean): void {
    const p = this.project;
    const scale = width / p.width;
    const v: View = { m: [scale, 0, 0, scale, 0, 0], width, height: Math.round(p.height * scale) };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, v.width, v.height);
    ctx.setTransform(...v.m);
    if (paper) {
      ctx.fillStyle = p.background;
      ctx.fillRect(0, 0, p.width, p.height);
    }
    this.plain = true;
    for (const layer of p.layers) if (p.isShown(layer) && !layer.reference) this.drawLayer(ctx, layer, frame, v);
    this.plain = false;
    ctx.restore();
  }

  /** Only the visible layers on clear paper at drawing size (used by the fill bucket). */
  renderLayers(ctx: CanvasRenderingContext2D, frame: number): void {
    const p = this.project;
    const v: View = { m: [1, 0, 0, 1, 0, 0], width: p.width, height: p.height };
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, p.width, p.height);
    this.plain = true;
    for (const layer of p.layers) if (p.isShown(layer)) this.drawLayer(ctx, layer, frame, v);
    this.plain = false;
    ctx.restore();
  }

  private drawOnion(ctx: CanvasRenderingContext2D, layer: Layer, frame: number, o: OnionSettings, v: View): void {
    const track = layer.track;
    const current = track.activeTime(frame);
    // Previous drawings: empty frames are skipped, so "1 before" means the previous actual drawing.
    let t = current === null ? null : track.prevTime(current);
    for (let i = 1; i <= o.before && t !== null; t = track.prevTime(t)) {
      if (!this.hasPixels(layer, t)) continue;
      this.drawGhost(ctx, layer, t, o.beforeColor, o.opacity * ((o.before - i + 1) / o.before), v);
      i++;
    }
    t = track.nextTime(frame);
    for (let i = 1; i <= o.after && t !== null; t = track.nextTime(t)) {
      if (!this.hasPixels(layer, t)) continue;
      this.drawGhost(ctx, layer, t, o.afterColor, o.opacity * ((o.after - i + 1) / o.after), v);
      i++;
    }
  }

  private drawPin(ctx: CanvasRenderingContext2D, layer: Layer, frame: number, pin: OnionPin, v: View): void {
    if (pin.frame === frame) return;
    // A held drawing that is already on screen doesn't need a ghost of itself.
    if (!layer.motion && layer.track.activeTime(frame) === layer.track.activeTime(pin.frame)) return;
    const key = layer.track.active(pin.frame);
    if (!key || !this.project.drawings.hasContent(key.drawingId)) return;
    this.drawGhost(ctx, layer, pin.frame, pin.color, pin.opacity, v, true);
  }

  private hasPixels(layer: Layer, time: number): boolean {
    const key = layer.track.get(time);
    return !!key && this.project.drawings.hasContent(key.drawingId);
  }

  private drawGhost(ctx: CanvasRenderingContext2D, layer: Layer, time: number, color: string, alpha: number, v: View, exact = false): void {
    const key = exact ? layer.track.active(time) : layer.track.get(time);
    if (!key || alpha <= 0) return;
    const t = this.fit(this.tint, v);
    this.paintDrawing(t, layer, key.drawingId, exact ? time : undefined);
    t.setTransform(1, 0, 0, 1, 0, 0);
    t.globalCompositeOperation = 'source-in'; // keep the shape, replace its colour
    t.fillStyle = color;
    t.fillRect(0, 0, this.tint.width, this.tint.height);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.tint, 0, 0);
    ctx.restore();
  }
}
