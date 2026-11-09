import type { View } from '../render/compositor';
import { apply, invert, type Matrix } from '../model/vector';

/**
 * Zoom, pan, rotate and flip for the canvas. The on-screen canvas always matches the
 * window's real pixels and the picture is redrawn for the current zoom, so vector lines
 * stay perfectly sharp.
 */
export class Viewport {
  zoom = 1;
  rotation = 0; // radians
  flipped = false;
  private panX = 0; // offset of the paper centre from the stage centre, in screen pixels
  private panY = 0;
  private fitMode = true; // keep fitting when the window resizes, until the user zooms

  constructor(
    private stage: HTMLElement,
    private canvas: HTMLCanvasElement,
    private docW: number,
    private docH: number,
    private onChange: (zoom: number) => void,
  ) {
    new ResizeObserver(() => {
      this.syncSize();
      if (this.fitMode) this.fit();
      else this.onChange(this.zoom);
    }).observe(stage);
  }

  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.stage.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.stage.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.width = `${this.stage.clientWidth}px`;
    this.canvas.style.height = `${this.stage.clientHeight}px`;
  }

  /** Transform from drawing pixels to CSS pixels inside the stage. */
  private cssMatrix(): Matrix {
    const cos = Math.cos(this.rotation) * this.zoom;
    const sin = Math.sin(this.rotation) * this.zoom;
    const fx = this.flipped ? -1 : 1;
    const a = cos * fx;
    const b = sin * fx;
    const c = -sin;
    const d = cos;
    const cx = this.stage.clientWidth / 2 + this.panX;
    const cy = this.stage.clientHeight / 2 + this.panY;
    const hw = this.docW / 2;
    const hh = this.docH / 2;
    return [a, b, c, d, cx - a * hw - c * hh, cy - b * hw - d * hh];
  }

  view(): View {
    const dpr = window.devicePixelRatio || 1;
    const m = this.cssMatrix();
    return {
      m: [m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr],
      width: this.canvas.width,
      height: this.canvas.height,
    };
  }

  /** Screen position → drawing pixels. */
  toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.stage.getBoundingClientRect();
    return apply(invert(this.cssMatrix()), clientX - r.left, clientY - r.top);
  }

  fit(): void {
    this.syncSize();
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!w || !h) return;
    this.zoom = Math.min(w / this.docW, h / this.docH) * 0.94;
    this.panX = this.panY = 0;
    this.rotation = 0;
    this.flipped = false;
    this.fitMode = true;
    this.onChange(this.zoom);
  }

  /** Zoom by a factor, keeping the point under (clientX, clientY) still. */
  zoomBy(factor: number, clientX?: number, clientY?: number): void {
    const r = this.stage.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const px = (clientX ?? cx) - cx;
    const py = (clientY ?? cy) - cy;
    const z2 = Math.min(64, Math.max(0.05, this.zoom * factor));
    this.panX = px - ((px - this.panX) * z2) / this.zoom;
    this.panY = py - ((py - this.panY) * z2) / this.zoom;
    this.zoom = z2;
    this.fitMode = false;
    this.onChange(this.zoom);
  }

  setZoom(z: number): void {
    this.zoomBy(z / this.zoom);
  }

  panBy(dx: number, dy: number): void {
    this.panX += dx;
    this.panY += dy;
    this.fitMode = false;
    this.onChange(this.zoom);
  }

  rotateBy(radians: number): void {
    this.rotation += radians;
    this.fitMode = false;
    this.onChange(this.zoom);
  }

  resetRotation(): void {
    this.rotation = 0;
    this.onChange(this.zoom);
  }

  flip(): void {
    this.flipped = !this.flipped;
    this.fitMode = false;
    this.onChange(this.zoom);
  }
}
