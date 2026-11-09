import type { Layer, Project } from '../model/project';
import { icons } from './icons';

/** A block of frames picked on the timeline. Layers are listed top to bottom. */
export interface FrameRange {
  layerIds: string[];
  from: number;
  to: number;
}

export interface TimelineHost {
  project: Project;
  frame(): number;
  activeLayerId(): string;
  /** Click or drag on the grid: jump to a frame (and pick a layer if a row was hit). */
  pick(frame: number, layerId: string | null): void;
  selectLayer(layerId: string): void;
  toggleVisible(layerId: string): void;
  rename(layerId: string, name: string): void;
  /** Right-click on a frame cell (after it has been picked). */
  cellMenu(x: number, y: number): void;
  /** A frame was right-clicked; called before the playhead moves. */
  rightClick(frame: number, layerId: string | null): void;
  /** Frames showing a pinned onion skin. */
  pins(): { layerId: string; frame: number; color: string }[];
  /** Right-click on a layer name. */
  layerMenu(layerId: string, x: number, y: number): void;
  /** A selected block of frames was dragged sideways. */
  moveFrames(range: FrameRange, delta: number, copy: boolean): void;
  toggleLock(layerId: string): void;
  toggleMotion(layerId: string): void;
  toggleOutline(layerId: string): void;
  toggleHighlight(layerId: string): void;
  toggleFolder(layerId: string): void;
  setAll(kind: 'highlight' | 'outline' | 'visible' | 'locked'): void;
  newLayerMenu(x: number, y: number): void;
  newFolder(): void;
  deleteSelected(): void;
  dropLayer(id: string, targetId: string, where: 'above' | 'below' | 'into'): void;
}

const CELL_W = 18;
const ROW_H = 28;
const SECONDS_H = 15; // top strip: seconds
const RULER_H = 36; // seconds strip + frame numbers

/**
 * The timeline: layer names on the left, a frame grid on the right.
 * ● keyframe with a drawing   ○ blank keyframe   ▬ held frames   red column = current frame
 */
export class Timeline {
  private names: HTMLDivElement;
  private scroller: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private drag: { mode: 'scrub' } | { mode: 'range' } | { mode: 'block'; start: number; row: number; delta: number } | null = null;
  private sel: { f0: number; f1: number; r0: number; r1: number } | null = null;

  constructor(root: HTMLElement, private host: TimelineHost) {
    root.classList.add('timeline');
    this.names = document.createElement('div');
    this.names.className = 'tl-names';
    this.scroller = document.createElement('div');
    this.scroller.className = 'tl-grid';
    this.canvas = document.createElement('canvas');
    this.scroller.appendChild(this.canvas);
    root.append(this.names, this.scroller);

    this.canvas.addEventListener('pointerdown', (e) => {
      const cell = this.cellAt(e);
      if (e.button === 2) {
        if (cell) this.host.rightClick(cell.frame, cell.onRow ? this.rows()[cell.row].id : null);
        // right-click keeps a selection if you clicked inside it
        if (cell && !this.inRange(cell.frame, cell.row)) {
          this.sel = cell.onRow ? { f0: cell.frame, f1: cell.frame, r0: cell.row, r1: cell.row } : null;
          this.handlePointer(e, true);
        }
        this.render();
        return;
      }
      if (e.button !== 0 || !cell) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic pointer */
      }
      if (!cell.onRow) {
        this.drag = { mode: 'scrub' }; // the ruler moves the playhead and keeps your selection
        this.handlePointer(e, false);
      } else if (e.shiftKey && this.sel) {
        this.sel.f1 = cell.frame;
        this.sel.r1 = cell.row;
        this.drag = { mode: 'range' };
      } else if (this.inRange(cell.frame, cell.row)) {
        this.drag = { mode: 'block', start: cell.frame, row: cell.row, delta: 0 };
      } else {
        this.sel = { f0: cell.frame, f1: cell.frame, r0: cell.row, r1: cell.row };
        this.drag = { mode: 'range' };
        this.handlePointer(e, true);
      }
      this.render();
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.host.cellMenu(e.clientX, e.clientY);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const cell = this.cellAt(e);
      if (!cell) return;
      if (this.drag.mode === 'scrub') {
        this.handlePointer(e, false);
      } else if (this.drag.mode === 'range' && this.sel) {
        this.sel.f1 = cell.frame;
        this.sel.r1 = cell.row;
      } else if (this.drag.mode === 'block') {
        const r = this.range();
        this.drag.delta = r ? Math.max(-r.from, cell.frame - this.drag.start) : 0;
      }
      this.render();
    });
    const end = (e: PointerEvent) => {
      const d = this.drag;
      this.drag = null;
      if (d?.mode === 'block' && e.type === 'pointerup') {
        const r = this.range();
        if (r && d.delta !== 0) {
          this.host.moveFrames(r, d.delta, e.altKey);
          this.sel!.f0 += d.delta;
          this.sel!.f1 += d.delta;
        } else if (r) {
          // a plain click inside the selection picks just that frame
          this.sel = { f0: d.start, f1: d.start, r0: d.row, r1: d.row };
          this.handlePointer(e, true);
        }
      }
      this.render();
    };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
    new ResizeObserver(() => this.render()).observe(this.scroller);
    void document.fonts?.ready.then(() => this.render());
  }

  /** Layers top-to-bottom, the way they stack visually. */
  private rows(): Layer[] {
    const p = this.host.project;
    return [...p.layers].reverse().filter((l) => !l.parent || p.layerById(l.parent)?.open !== false);
  }

  private cellAt(e: PointerEvent): { frame: number; row: number; onRow: boolean } | null {
    const r = this.canvas.getBoundingClientRect();
    const y = e.clientY - r.top;
    const rows = this.rows().length;
    if (!rows) return null;
    const frame = Math.max(0, Math.min(this.host.project.length - 1, Math.floor((e.clientX - r.left) / CELL_W)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((y - RULER_H) / ROW_H)));
    return { frame, row, onRow: y > RULER_H };
  }

  private inRange(frame: number, row: number): boolean {
    const s = this.sel;
    return !!s && frame >= Math.min(s.f0, s.f1) && frame <= Math.max(s.f0, s.f1) && row >= Math.min(s.r0, s.r1) && row <= Math.max(s.r0, s.r1);
  }

  /** The selected block of frames, if any. */
  range(): FrameRange | null {
    const s = this.sel;
    if (!s) return null;
    const rows = this.rows();
    const top = Math.min(s.r0, s.r1);
    const bottom = Math.min(rows.length - 1, Math.max(s.r0, s.r1));
    const layerIds = rows.slice(top, bottom + 1).filter((l) => !l.folder).map((l) => l.id);
    if (!layerIds.length) return null;
    return { layerIds, from: Math.min(s.f0, s.f1), to: Math.max(s.f0, s.f1) };
  }

  clearRange(): void {
    this.sel = null;
    this.render();
  }

  /** Select a block of frames, starting at a layer and going down `rows` layers. */
  setRange(layerId: string, rows: number, from: number, to: number): void {
    const r0 = this.rows().findIndex((l) => l.id === layerId);
    if (r0 < 0) return;
    this.sel = { f0: from, f1: to, r0, r1: r0 + rows - 1 };
    this.render();
  }

  private handlePointer(e: PointerEvent, pickRow: boolean): void {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const frame = Math.max(0, Math.min(this.host.project.length - 1, Math.floor(x / CELL_W)));
    let layerId: string | null = null;
    if (pickRow && y > RULER_H) {
      const row = this.rows()[Math.floor((y - RULER_H) / ROW_H)];
      if (row) layerId = row.id;
    }
    this.host.pick(frame, layerId);
  }

  /** Show which row is selected, without rebuilding the rows under the pointer. */
  markActive(): void {
    this.names.querySelectorAll<HTMLElement>('.tl-name').forEach((r) => r.classList.toggle('active', r.dataset.id === this.host.activeLayerId()));
  }

  private button(cls: string, title: string, label: string, content: string, act: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = cls;
    b.title = title;
    b.setAttribute('aria-label', label);
    b.innerHTML = content;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      act();
    });
    return b;
  }

  /** Rebuild the layer name column (call when layers are added/removed/renamed). */
  renderNames(): void {
    this.names.replaceChildren();
    const h = this.host;
    const head = document.createElement('div');
    head.className = 'tl-head';
    const all = (kind: 'highlight' | 'outline' | 'visible' | 'locked') => () => h.setAll(kind);
    head.append(
      this.button('head-btn', 'New layer', 'New layer', icons.pageAdd, () => {
        const r = head.getBoundingClientRect();
        h.newLayerMenu(r.left + 4, r.bottom + 2);
      }),
      this.button('head-btn', 'New folder', 'New folder', icons.folderAdd, () => h.newFolder()),
      this.button('head-btn', 'Delete the selected layer or folder', 'Delete the selected layer or folder', icons.trash, () => h.deleteSelected()),
      Object.assign(document.createElement('span'), { className: 'spacer' }),
      this.button('head-btn col', 'Highlight every layer', 'Highlight every layer', icons.dot, all('highlight')),
      this.button('head-btn col', 'Show every layer as outlines', 'Show every layer as outlines', icons.outlineBox, all('outline')),
      this.button('head-btn col', 'Hide or show every layer', 'Hide or show every layer', icons.eyeOff, all('visible')),
      this.button('head-btn col', 'Lock or unlock every layer', 'Lock or unlock every layer', icons.lock, all('locked')),
    );
    this.names.appendChild(head);
    for (const layer of this.rows()) {
      const row = document.createElement('div');
      row.dataset.id = layer.id;
      row.className = 'tl-name' + (layer.id === h.activeLayerId() ? ' active' : '') + (h.project.isShown(layer) ? '' : ' hidden-layer') + (layer.parent ? ' in-folder' : '') + (layer.folder ? ' is-folder' : '');
      row.style.height = `${ROW_H}px`;
      if (layer.highlight) row.style.setProperty('--tag', layer.color);
      row.classList.toggle('tagged', layer.highlight);
      row.addEventListener('pointerdown', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('button')) return; // the row's own buttons must get their click
        h.selectLayer(layer.id);
        if (e.button === 0) this.startRowDrag(e, layer);
      });
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        h.layerMenu(layer.id, e.clientX, e.clientY);
      });

      const name = document.createElement('input');
      name.dataset.layerId = layer.id;
      name.value = layer.name;
      name.title = 'Click to rename';
      name.setAttribute('aria-label', `Name of ${layer.name}`);
      name.addEventListener('change', () => h.rename(layer.id, name.value.trim() || layer.name));
      name.addEventListener('keydown', (e) => {
        e.stopPropagation(); // typing a name must not trigger shortcuts
        if (e.key === 'Enter' || e.key === 'Escape') name.blur();
      });

      const eye = this.button('eye' + (layer.visible ? '' : ' off'), layer.visible ? 'Hide this layer' : 'Show this layer', `${layer.visible ? 'Hide' : 'Show'} ${layer.name}`, layer.visible ? icons.eye : icons.eyeOff, () => h.toggleVisible(layer.id));
      const lock = this.button('lock' + (layer.locked ? ' on' : ''), layer.locked ? 'Unlock this layer' : 'Lock this layer', `${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`, layer.locked ? icons.lock : icons.unlock, () => h.toggleLock(layer.id));

      if (layer.folder) {
        const caret = this.button('caret', layer.open ? 'Close this folder' : 'Open this folder', `${layer.open ? 'Close' : 'Open'} ${layer.name}`, layer.open ? icons.caretOpen : icons.caretClosed, () => h.toggleFolder(layer.id));
        const mark = Object.assign(document.createElement('span'), { className: 'folder-mark', innerHTML: icons.folder });
        row.append(caret, mark, name, eye, lock);
      } else {
        const badge = document.createElement('span');
        badge.className = `badge ${layer.kind}`;
        badge.textContent = layer.reference ? 'R' : layer.kind === 'vector' ? 'V' : 'B';
        badge.title = layer.reference ? 'Reference picture to trace' : layer.kind === 'vector' ? 'Vector layer: sharp at any zoom' : 'Bitmap layer: painted pixels';
        if (layer.reference) badge.className = 'badge reference';

        const motion = this.button('motion' + (layer.motion ? ' on' : ''), layer.motion ? 'Keyframes are on. Click to turn off' : 'Turn on keyframes: move or bend on any frame, and the frames between fill in', `${layer.motion ? 'Turn off' : 'Turn on'} keyframes for ${layer.name}`, layer.motion ? '◆' : '◇', () => h.toggleMotion(layer.id));
        motion.disabled = layer.reference;

        const dot = this.button('dot' + (layer.highlight ? ' on' : ''), layer.highlight ? 'Remove the highlight' : 'Highlight this layer on the timeline', `${layer.highlight ? 'Remove highlight from' : 'Highlight'} ${layer.name}`, icons.dot, () => h.toggleHighlight(layer.id));
        dot.style.color = layer.highlight ? layer.color : '';

        const box = document.createElement('span');
        box.className = 'outline-swatch';
        box.style.borderColor = layer.color;
        box.style.background = layer.outline ? 'transparent' : layer.color;
        const outline = this.button('outline', layer.outline ? 'Show this layer normally' : 'Show this layer as outlines', `${layer.outline ? 'Show normally:' : 'Show as outlines:'} ${layer.name}`, '', () => h.toggleOutline(layer.id));
        outline.append(box);

        row.append(badge, motion, name, dot, outline, eye, lock);
      }
      this.names.appendChild(row);
    }
  }

  /** Drag a row up or down to reorder it, or onto a folder to put it inside. */
  private startRowDrag(down: PointerEvent, layer: Layer): void {
    let dragging = false;
    let drop: { id: string; where: 'above' | 'below' | 'into' } | null = null;
    const line = document.createElement('div');
    line.className = 'drop-line';
    const clear = () => this.names.querySelectorAll('.drop-into').forEach((r) => r.classList.remove('drop-into'));
    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(e.clientY - down.clientY) < 6) return;
        dragging = true;
        (document.activeElement as HTMLElement | null)?.blur();
        this.names.appendChild(line);
      }
      clear();
      drop = null;
      line.hidden = true;
      const rows = [...this.names.querySelectorAll<HTMLElement>('.tl-name')];
      const row = rows.find((r) => {
        const b = r.getBoundingClientRect();
        return e.clientY >= b.top && e.clientY < b.bottom;
      });
      if (!row || row.dataset.id === layer.id) return;
      const b = row.getBoundingClientRect();
      const y = (e.clientY - b.top) / b.height;
      const isFolder = row.classList.contains('is-folder');
      if (isFolder && !layer.folder && y > 0.25 && y < 0.75) {
        row.classList.add('drop-into');
        drop = { id: row.dataset.id!, where: 'into' };
        return;
      }
      const above = y < 0.5;
      drop = { id: row.dataset.id!, where: above ? 'above' : 'below' };
      line.hidden = false;
      line.style.top = `${(above ? b.top : b.bottom) - this.names.getBoundingClientRect().top - 1}px`;
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      clear();
      line.remove();
      if (dragging && drop) this.host.dropLayer(layer.id, drop.id, drop.where);
    };
    const cancel = () => {
      drop = null;
      up();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  private colours = new Map<string, string>();
  /** The app's colours were changed in Settings. */
  refreshColours(): void {
    this.colours.clear();
    this.render();
  }

  /** Theme colours are looked up once: reading them every frame would slow playback. */
  private colour(name: string): string {
    let c = this.colours.get(name);
    if (c === undefined) {
      c = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      this.colours.set(name, c);
    }
    return c;
  }

  /** Redraw the frame grid (cheap; call on every change). */
  render(): void {
    const p = this.host.project;
    const rows = this.rows();
    const cols = p.length + 12; // a little room past the end
    const cssW = Math.max(cols * CELL_W, this.scroller.clientWidth);
    const cssH = RULER_H + rows.length * ROW_H;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(cssW * dpr) || this.canvas.height !== Math.round(cssH * dpr)) {
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.canvas.style.width = `${cssW}px`;
      this.canvas.style.height = `${cssH}px`;
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const col = (n: string) => this.colour(n);

    // Ruler: seconds on top, frame numbers below.
    ctx.fillStyle = col('--panel-2');
    ctx.fillRect(0, 0, cssW, RULER_H);
    ctx.fillStyle = col('--line');
    ctx.fillRect(0, SECONDS_H, cssW, 1);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const fps = p.fps;
    for (let f = 0; f < cols; f++) {
      const x = f * CELL_W;
      const n = f + 1; // frames are shown counting from 1
      const inRange = f < p.length;
      // e.g. at 12 fps, frame 12 is where 1 second has played
      if (n % fps === 0) {
        ctx.fillStyle = inRange ? col('--seconds') : col('--line');
        ctx.font = "600 11px Poppins, 'Segoe UI', sans-serif";
        ctx.fillText(`${n / fps}s`, x + CELL_W / 2, SECONDS_H / 2 + 1);
        ctx.fillRect(x + CELL_W - 1, 0, 1, RULER_H);
      } else if (fps % 2 === 0 && n % (fps / 2) === 0 && fps >= 6) {
        ctx.fillStyle = col('--line');
        ctx.fillRect(x + CELL_W - 1, SECONDS_H - 5, 1, 5); // half-second tick
      }
      if (n === 1 || n % 5 === 0) {
        ctx.fillStyle = inRange ? col('--text-dim') : col('--line');
        ctx.font = "11px Poppins, 'Segoe UI', sans-serif";
        ctx.fillText(String(n), x + CELL_W / 2, SECONDS_H + (RULER_H - SECONDS_H) / 2);
      }
    }

    // Rows
    rows.forEach((layer, i) => {
      const y = RULER_H + i * ROW_H;
      const active = layer.id === this.host.activeLayerId();
      ctx.fillStyle = active ? col('--row-active') : layer.folder ? col('--panel-2') : col('--panel');
      ctx.fillRect(0, y, cssW, ROW_H);
      if (layer.highlight) {
        ctx.fillStyle = layer.color;
        ctx.globalAlpha = 0.28;
        ctx.fillRect(0, y, cssW, ROW_H);
        ctx.globalAlpha = 1;
      }
      // frames past the end are greyed out
      ctx.fillStyle = col('--past-end');
      ctx.fillRect(p.length * CELL_W, y, cssW, ROW_H);
      // cell lines
      ctx.fillStyle = col('--line');
      for (let f = 0; f <= cols; f++) ctx.fillRect(f * CELL_W, y, f % 5 === 0 ? 1 : 0.5, ROW_H);
      ctx.fillRect(0, y + ROW_H - 1, cssW, 1);

      const times = layer.track.allTimes();
      times.forEach((t, k) => {
        const end = k + 1 < times.length ? times[k + 1] : p.length; // held until next key
        const key = layer.track.get(t)!;
        const filled = p.drawings.hasContent(key.drawingId);
        const cx = t * CELL_W + CELL_W / 2;
        const cy = y + ROW_H / 2;
        if (filled) {
          // drawing stays on screen: a bar to where the next key starts
          if (end - t > 1) {
            ctx.fillStyle = col('--hold');
            ctx.beginPath();
            ctx.roundRect(cx, cy - 3, (end - t - 1) * CELL_W, 6, 3);
            ctx.fill();
          }
          if (layer.motion && key.tween) {
            // keyframe: a diamond, joined to the next one by a band
            if (k + 1 < times.length) {
              ctx.fillStyle = col('--key');
              ctx.fillRect(cx, cy - 2, (times[k + 1] - t) * CELL_W, 4);
            }
            ctx.beginPath();
            ctx.moveTo(cx, cy - 7);
            ctx.lineTo(cx + 7, cy);
            ctx.lineTo(cx, cy + 7);
            ctx.lineTo(cx - 7, cy);
            ctx.closePath();
            ctx.fillStyle = col('--key');
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = col('--bg');
            ctx.stroke();
            return;
          }
          ctx.beginPath();
          ctx.arc(cx, cy, 5, 0, Math.PI * 2);
          ctx.fillStyle = col('--key');
          ctx.fill();
        } else {
          // empty frame: small hollow square (nothing shows from here)
          ctx.lineWidth = 1.5;
          ctx.strokeStyle = col('--empty');
          ctx.strokeRect(cx - 4, cy - 4, 8, 8);
        }
      });
    });

    // Frames with a pinned onion skin, in that ghost's colour
    for (const pin of this.host.pins()) {
      const i = rows.findIndex((l) => l.id === pin.layerId);
      if (i < 0) continue;
      const x = pin.frame * CELL_W;
      const y = RULER_H + i * ROW_H;
      ctx.fillStyle = pin.color;
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y, CELL_W, ROW_H);
      ctx.globalAlpha = 1;
      ctx.fillRect(x, y, CELL_W, 3);
      ctx.fillRect(x, y + ROW_H - 4, CELL_W, 3);
    }

    // The selected block of frames, and where it will land if it's being dragged
    if (this.sel) {
      const s = this.sel;
      const x0 = Math.min(s.f0, s.f1) * CELL_W;
      const w = (Math.abs(s.f1 - s.f0) + 1) * CELL_W;
      const y0 = RULER_H + Math.min(s.r0, s.r1) * ROW_H;
      const h = (Math.abs(s.r1 - s.r0) + 1) * ROW_H;
      ctx.fillStyle = col('--accent-soft');
      ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = col('--accent');
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x0 + 0.75, y0 + 0.75, w - 1.5, h - 1.5);
      if (this.drag?.mode === 'block' && this.drag.delta !== 0) {
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + this.drag.delta * CELL_W + 1, y0 + 1, w - 2, h - 2);
        ctx.setLineDash([]);
      }
    }

    // Playhead
    const f = this.host.frame();
    ctx.fillStyle = col('--playhead-fill');
    ctx.fillRect(f * CELL_W, 0, CELL_W, cssH);
    ctx.fillStyle = col('--playhead');
    ctx.fillRect(f * CELL_W + CELL_W / 2 - 0.75, 0, 1.5, cssH);
    ctx.fillRect(f * CELL_W, 0, CELL_W, 3);

    this.keepVisible(f);
  }

  private keepVisible(frame: number): void {
    const x = frame * CELL_W;
    const s = this.scroller;
    if (x < s.scrollLeft) s.scrollLeft = x - CELL_W * 2;
    else if (x + CELL_W > s.scrollLeft + s.clientWidth) s.scrollLeft = x + CELL_W * 3 - s.clientWidth;
  }
}
