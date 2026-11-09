import './style.css';
import { Project, type BlendMode, type Layer, type LayerKind, type RasterKey } from './model/project';
import { History } from './model/history';
import { Compositor, type OnionPin, type OnionSettings } from './render/compositor';
import { BrushStroke, type BrushSettings, type Pt, type Rect } from './tools/brush';
import { drawShape, polyOptions, recognizeStroke, shapeBounds, shapeFromDrag, unionRect, type Shape, type ShapeKind } from './tools/shapes';
import { floodFill, traceLoops } from './tools/fill';
import { IDENTITY, apply, bezPath, drawItems, hitItem, hitOutline, insideItem, invert, toBezItem, itemPoints, mul, pointInPolygon, touch, type Anchor, type LineStyle, type VItem } from './model/vector';
import { Player } from './playback/player';
import { Timeline, type FrameRange } from './ui/timeline';
import { ensureUids, outlineOf, sampleItems } from './model/motion';
import { projectFromText, projectToText } from './model/projectFile';
import { ProjectDocument } from './ui/document';
import { setupSettings } from './ui/settings';
import { RingCursor } from './ui/cursor';
import { Viewport } from './ui/viewport';
import { showMenu, type MenuItem } from './ui/contextMenu';
import { askNumber, askChoice } from './ui/dialog';
import { followPoint, matchLoops } from './tools/fillKeys';
import { addPoint, applyBend, applyGlue, autoHandles, bendWeights, controlsOf, copyNodes, glueFills, localDelta, nearestOn, nodesOf, toBendable, type Bendable, type Glue, type NodeCopy } from './tools/bend';
import { ColourPanel } from './ui/colourPanel';
import { applyIcons, icons } from './ui/icons';
import {
  clearSelected,
  contentBounds,
  copySelected,
  boundsOf,
  dragHandle,
  drawFloating,
  floatMatrix,
  drawSelectionUI,
  hitHandle,
  lift,
  makeFloating,
  polySelection,
  rectSelection,
  transformedOutline,
  type Floating,
  type Handle,
  type P,
  type Selection,
} from './tools/selection';

type Tool = 'move' | 'select' | 'lasso' | 'brush' | 'eraser' | 'fill' | 'picker' | 'text' | 'pen' | 'points' | 'reshape' | 'hand' | 'zoom' | 'rotview' | ShapeKind;
const TOOL_NAMES: Record<Tool, string> = {
  move: 'Move',
  select: 'Rectangle select',
  lasso: 'Lasso select',
  brush: 'Brush',
  eraser: 'Eraser',
  fill: 'Fill bucket',
  picker: 'Colour picker',
  text: 'Text',
  hand: 'Hand',
  zoom: 'Zoom',
  line: 'Line',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  poly: 'Polygon / star',
  pen: 'Pen (curves)',
  points: 'Bend points',
  reshape: 'Reshape',
  rotview: 'Rotate view',
};

// ---------------------------------------------------------------- state
const project = new Project(1280, 720);
const first = project.addLayer('Layer 1');
first.track.set(0, { drawingId: project.drawings.create(), origin: 'drawn' });

let frame = 0;
let activeLayerId = first.id;
let tool: Tool = 'brush';
let exposure: number | 'hold' = 1; // how many frames a new drawing lasts
let newDrawingStarts: 'blank' | 'copy' = 'blank';
let fingerDraws = false;
let fillShapes = false;
let holdToStraighten = false;
let fillTolerance = 40;
let fillGrow = true;
let fillAllLayers = true;
let fillKeysMode: 'ask' | 'all' | 'one' = 'ask';
let clipboard: HTMLCanvasElement | null = null; // a copied drawing (full size)
let clipboardSel: Selection | null = null; // set when the clipboard holds only a selected part
let backColor = '#ffffff'; // fill colour for filled shapes

// Selection state
let selection: Selection | null = null; // the dashed outline
let floating: Floating | null = null; // pixels being moved/resized/rotated
let floatEdit: Edit | null = null; // the drawing those pixels came from (for undo)
let selectionDraft: Selection | null = null; // outline while you're still dragging it
let clipboardItems: VItem[] | null = null; // copied vector shapes
let showGrid = false;
let showSafe = false;
let placingReference = false; // true only while moving or resizing a reference picture

const brush: BrushSettings = {
  size: 8,
  color: '#1b1b1f',
  eraser: false,
  pressure: true,
  minPressureSize: 0.15,
  smoothing: 0.5,
};
const onion: OnionSettings = {
  pins: [],
  enabled: true,
  before: 1,
  after: 1,
  opacity: 0.35,
  beforeColor: '#e0413a', // previous drawings: red
  afterColor: '#2f9e58', // next drawings: green
};

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
applyIcons();

const settings = setupSettings(() => {
  timeline.refreshColours();
  scheduleRender(true);
});
$('open-settings').onclick = () => settings.open();

const view = $<HTMLCanvasElement>('view');
const viewCtx = view.getContext('2d')!;
const compositor = new Compositor(project);
const history = new History(50, () => {
  document_.markChanged();
  scheduleRender();
});
const cursor = new RingCursor(document.body);
const viewport = new Viewport($('stage'), view, project.width, project.height, (z) => {
  $('zoom-reset').textContent = `${Math.round(z * 100)}%`;
  scheduleRender();
});

const activeLayer = (): Layer => project.layerById(activeLayerId) ?? project.layers[project.layers.length - 1];

// A spare canvas for sampling colours / edges.
const scratch = document.createElement('canvas');
scratch.width = project.width;
scratch.height = project.height;
const scratchCtx = scratch.getContext('2d', { willReadFrequently: true })!;

// ---------------------------------------------------------------- rendering
let shapePreview: { shape: Shape; width: number } | null = null;
let renderQueued = false;

function scheduleRender(namesToo = false): void {
  if (namesToo) timeline.renderNames();
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderNow);
}

/** Draw the picture and timeline for the current frame. */
function renderNow(): void {
  renderQueued = false;
  if (!player.playing) document_.watch(savedSettings());
  const v = viewport.view();
  compositor.render(viewCtx, frame, player.playing ? null : onion, v);
  viewCtx.save();
  viewCtx.setTransform(...v.m);
  if (shapePreview) {
    drawShape(viewCtx, shapePreview.shape, {
      width: shapePreview.width,
      color: brush.color,
      fill: fillShapes && shapePreview.shape.kind !== 'line',
      fillColor: backColor,
      eraser: false,
    });
  }
  // selection: the moving pixels, the dashed outline, and the handles
  const scale = viewScale();
  if (floating) drawFloating(viewCtx, floating);
  if (selectionDraft) drawSelectionUI(viewCtx, selectionDraft.points, scale, null);
  else if (floating) drawSelectionUI(viewCtx, transformedOutline(floating), scale, isSelectTool() ? floating : null);
  else if (selection) drawSelectionUI(viewCtx, selection.points, scale, isSelectTool() ? asFloating(selection) : null);
  drawPenDraft(scale);
  if (tool === 'points' && !player.playing) drawBendPoints(scale);
  drawSnapGuides(scale);
  drawGuides(scale);
  viewCtx.restore();
  timeline.render();
  updateStylePanel();
  const fps = project.fps;
  $('frame-counter').textContent = `Frame ${frame + 1} / ${project.length}`;
  $('time-counter').textContent = `${((frame + 1) / fps).toFixed(1)}s / ${(project.length / fps).toFixed(1)}s`;
  const play = $('play');
  const wanted = player.playing ? 'pause' : 'play';
  if (play.dataset.state !== wanted) {
    play.dataset.state = wanted;
    play.innerHTML = icons[wanted];
  }
  updateLayerPanel();
}

function updateLayerPanel(): void {
  const layer = activeLayer();
  $('layer-name').textContent = layer.name;
  $('layer-kind').textContent = layer.reference ? 'Reference' : layer.kind === 'vector' ? 'Vector' : 'Bitmap';
  $('layer-kind').className = `badge ${layer.reference ? 'reference' : layer.kind}`;
  $('motion-toggle').classList.toggle('on', layer.motion);
  $<HTMLSelectElement>('layer-ease').value = layer.ease;
  $<HTMLSelectElement>('layer-ease').disabled = !layer.motion;
  $('layer-lock').textContent = layer.locked ? 'Unlock' : 'Lock';
  $<HTMLSelectElement>('layer-blend').value = layer.blend;
  const slider = input('layer-opacity');
  if (document.activeElement !== slider) slider.value = String(Math.round(layer.opacity * 100));
  $('layer-opacity-value').textContent = `${Math.round(layer.opacity * 100)}%`;
}

/** Screen pixels per drawing pixel. */
const viewScale = () => viewport.zoom;

let statusTimer = 0;
function status(text: string): void {
  $('status').textContent = text;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => ($('status').textContent = ''), 5000);
}

// ---------------------------------------------------------------- playback
const player = new Player(
  () => project.fps,
  () => project.length,
  (f) => {
    frame = f;
    renderNow(); // drawn in this same screen refresh, so timing stays even
  },
  () => scheduleRender(),
);

function goTo(f: number): void {
  player.stop();
  const target = Math.max(0, Math.min(project.length - 1, f));
  if (target !== frame) finishSelection(); // a selection belongs to one frame's drawing
  frame = target;
  scheduleRender();
}

function togglePlay(): void {
  finishSelection();
  if (player.playing) player.stop();
  else player.play(frame);
  scheduleRender();
}

// ---------------------------------------------------------------- timeline
const timeline = new Timeline($('timeline'), {
  project,
  frame: () => frame,
  activeLayerId: () => selectedFolder ?? activeLayerId,
  pick(f, layerId) {
    selectedFolder = null;
    if (layerId && project.layerById(layerId)?.folder) layerId = null;
    if (layerId && layerId !== activeLayerId) {
      finishSelection();
      activeLayerId = layerId;
      scheduleRender(true);
    }
    goTo(f);
  },
  selectLayer(id) {
    if (project.layerById(id)?.folder) {
      selectedFolder = id;
    } else {
      if (id !== activeLayerId) finishSelection();
      selectedFolder = null;
      activeLayerId = id;
    }
    timeline.markActive();
    scheduleRender();
  },
  toggleVisible(id) {
    const l = project.layerById(id);
    if (l) l.visible = !l.visible;
    scheduleRender(true);
  },
  rename(id, name) {
    const l = project.layerById(id);
    if (l) l.name = name;
    scheduleRender(true);
  },
  cellMenu: (x, y) => showMenu(x, y, [...frameMenuItems(true)]),
  rightClick: (f, layerId) => {
    rightClicked = { frame: f, layerId: layerId ?? activeLayerId, returnTo: frame };
  },
  pins: () => onion.pins,
  moveFrames,
  toggleLock,
  toggleMotion,
  layerMenu: (id, x, y) => {
    if (project.layerById(id)?.folder) {
      selectedFolder = id;
      timeline.markActive();
      scheduleRender();
      showMenu(x, y, folderMenuItems(id));
      return;
    }
    selectedFolder = null;
    activeLayerId = id;
    scheduleRender(true);
    showMenu(x, y, layerMenuItems(id));
  },
  toggleOutline: (id) => flipLayer(id, 'outline'),
  toggleHighlight: (id) => flipLayer(id, 'highlight'),
  toggleFolder: (id) => flipLayer(id, 'open'),
  setAll,
  newLayerMenu,
  newFolder,
  deleteSelected: () => void deleteSelected(),
  dropLayer,
});

// ---------------------------------------------------------------- drawings on the timeline
type Created = [number, RasterKey][];

/**
 * Put a new drawing at frame `at`. If "Each new drawing lasts" is N frames, an empty frame
 * is also placed N frames later (unless another drawing starts sooner).
 */
function placeDrawing(layer: Layer, at: number, key: RasterKey): Created {
  if (layer.motion) key.tween = true;
  layer.track.set(at, key);
  return [[at, key], ...placeEndMarker(layer, at)];
}

/** Add the empty frame that ends a drawing after "Each new drawing lasts" frames. */
function placeEndMarker(layer: Layer, at: number): Created {
  if (exposure === 'hold' || layer.motion || layer.reference) return [];
  const end = at + exposure;
  const next = layer.track.nextTime(at);
  if (end >= project.length || layer.track.has(end) || (next !== null && next <= end)) return [];
  const blank: RasterKey = { drawingId: project.drawings.create(), origin: 'drawn' };
  layer.track.set(end, blank);
  return [[end, blank]];
}

const hasInk = (key: RasterKey | undefined) => !!key && project.drawings.hasContent(key.drawingId);

/** The nearest drawing with ink at or before this frame (skipping empty frames). */
function previousInk(layer: Layer, at: number): RasterKey | undefined {
  for (let t = layer.track.activeTime(at); t !== null; t = layer.track.prevTime(t)) {
    const k = layer.track.get(t);
    if (hasInk(k)) return k;
  }
  return undefined;
}

function newBlankKey(): void {
  const layer = activeLayer();
  if (layer.track.has(frame)) return status('A drawing already starts on this frame — draw on it, or pick another frame.');
  const created = placeDrawing(layer, frame, { drawingId: project.drawings.create(), origin: 'drawn' });
  history.push({
    label: 'New drawing',
    undo: () => created.forEach(([t]) => layer.track.delete(t)),
    redo: () => created.forEach(([t, k]) => layer.track.set(t, k)),
  });
}

/** Put a copy of the previous drawing on this frame, ready to change. */
function duplicateHere(): void {
  const layer = activeLayer();
  if (hasInk(layer.track.get(frame))) return status('This frame already has its own drawing. Go to an empty frame first.');
  const source = previousInk(layer, frame);
  if (!source) return status('There is no earlier drawing on this layer to duplicate.');
  if (layer.kind === 'vector') pasteImage(noCanvas, 'Duplicate here', project.drawings.items(source.drawingId));
  else pasteImage(project.drawings.get(source.drawingId)!, 'Duplicate here');
}

function deleteKey(): void {
  const layer = activeLayer();
  const key = layer.track.get(frame);
  if (!key) return status('No drawing starts on this frame. Go to the frame with the dot to remove it.');
  const at = frame;
  history.run({
    label: 'Remove drawing',
    redo: () => layer.track.delete(at),
    undo: () => layer.track.set(at, key),
  });
}

/** Show the drawing you see now for one more frame: push every later keyframe right by 1. */
function holdAdd(): void {
  const layer = activeLayer();
  const at = frame;
  const oldLength = project.length;
  history.run({
    label: 'Longer',
    redo: () => {
      layer.track.shiftFrom(at + 1, 1);
      const times = layer.track.allTimes();
      const last = times[times.length - 1] ?? 0;
      if (last >= project.length) setLength(last + 1);
    },
    undo: () => {
      layer.track.shiftFrom(at + 2, -1);
      setLength(oldLength);
    },
  });
}

/** Show the drawing you see now for one frame less: pull every later keyframe left by 1. */
function holdRemove(): void {
  const layer = activeLayer();
  const start = layer.track.activeTime(frame);
  const next = layer.track.nextTime(frame);
  if (start === null) return status('There is no drawing here to shorten.');
  if (next === null) return status('This drawing lasts until the end — lower "Length" to shorten the animation.');
  if (next - start <= 1) return status('This drawing is already only 1 frame long. Use "Remove" to delete it.');
  history.run({
    label: 'Shorter',
    redo: () => layer.track.shiftFrom(next, -1),
    undo: () => layer.track.shiftFrom(next - 1, 1),
  });
}

function setLength(n: number): void {
  project.length = Math.max(1, Math.min(2000, Math.round(n) || 1));
  input('length').value = String(project.length);
  if (frame >= project.length) frame = project.length - 1;
}

// ---------------------------------------------------------------- undo / redo
/** Undo: if something is being moved right now, the first undo just puts it back. */
function undo(): void {
  if (textBox) return cancelText();
  if (floating) return cancelFloating();
  selection = null;
  stylePick = null;
  history.undo();
}
function redo(): void {
  finishSelection();
  history.redo();
}

// ---------------------------------------------------------------- selections (select, lasso, move)
const hasSelection = () => !!(selection || floating);
const FULL: Rect = { x: 0, y: 0, w: 1280, h: 720 };

/** The shapes of the vector drawing showing now. */
function showingItems(): VItem[] {
  const layer = activeLayer();
  const key = layer.track.active(frame);
  if (!key || layer.kind !== 'vector') return [];
  return layer.motion ? sampleItems(layer, frame, project.drawings) : project.drawings.items(key.drawingId);
}

/** The drawn things you clicked or boxed, by id. Empty of meaning unless something is selected. */
let stylePick: Set<number> | null = null;

/** A colour and the outline around it are one thing: picking either one takes both. */
function withPartners(picked: VItem[], items: VItem[]): VItem[] {
  const all = new Set(picked);
  for (const it of items) {
    if (it.t !== 'fill') continue;
    const line = outlineOf(it, items);
    if (line && (all.has(it) || all.has(line))) {
      all.add(it);
      all.add(line);
    }
  }
  return items.filter((it) => all.has(it));
}

const pickItems = (sel: Selection, items: VItem[]) =>
  withPartners(stylePick ? items.filter((it) => it.uid && stylePick!.has(it.uid)) : items.filter((it) => itemPoints(it).some((p) => pointInPolygon(p, sel.points))), items);

/** Selecting on a vector layer picks whole lines and shapes, boxed tightly. */
function floatFromItems(items: VItem[]): Floating {
  const b = boundsOf(items.flatMap(itemPoints));
  const w = Math.max(1, b.w);
  const h = Math.max(1, b.h);
  const outline = [{ x: b.x, y: b.y }, { x: b.x + w, y: b.y }, { x: b.x + w, y: b.y + h }, { x: b.x, y: b.y + h }];
  return { canvas: noCanvas, x: b.x, y: b.y, w, h, tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, outline, items };
}

function rasterize(items: VItem[]): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = project.width;
  c.height = project.height;
  drawItems(c.getContext('2d')!, items);
  return c;
}

/** Start an edit that keeps the picture you see (on a held frame it copies that drawing here first). */
function beginEditKeepingPicture(): Edit | null {
  const saved = newDrawingStarts;
  newDrawingStarts = 'copy';
  const e = beginEdit();
  newDrawingStarts = saved;
  return e;
}

/** Make sure the selected pixels are lifted and ready to move. With no selection, takes the whole drawing. */
function ensureFloating(): boolean {
  if (floating) return true;
  if (activeLayer().kind === 'vector') {
    placingReference = true;
    const e = beginEditKeepingPicture();
    placingReference = false;
    if (!e) return false;
    const id = e.key.drawingId;
    const current = project.drawings.items(id);
    const picked = selection ? pickItems(selection, current) : [...current];
    if (!picked.length) {
      commitEdit(e, null, '', false);
      status('Nothing to move here — there are no lines inside that area.');
      selection = null;
      return false;
    }
    project.drawings.setItems(id, current.filter((it) => !picked.includes(it)));
    floatEdit = e;
    floating = floatFromItems(picked);
    return true;
  }
  if (!selection) {
    const key = activeLayer().track.active(frame);
    const box = hasInk(key) ? contentBounds(project.drawings.get(key!.drawingId)!) : null;
    if (!box) {
      status('Nothing to move — there is no drawing on this frame.');
      return false;
    }
    selection = rectSelection({ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, false);
  }
  const e = beginEditKeepingPicture();
  if (!e) return false;
  floatEdit = e;
  floating = lift(e.canvas, selection);
  return true;
}

/** Put moved/resized pixels down into the drawing (one undo step). */
function applyFloating(): void {
  if (!floating || !floatEdit) return;
  const f = floating;
  const e = floatEdit;
  floating = null;
  floatEdit = null;
  if (f.items) {
    const m = floatMatrix(f);
    const id = e.key.drawingId;
    project.drawings.setItems(id, [...project.drawings.items(id), ...f.items.map((it) => ({ ...it, m: mul(m, it.m) }))]);
  } else {
    drawFloating(e.canvas.getContext('2d')!, f);
  }
  commitEdit(e, FULL, 'Move / resize', true);
  selection = polySelection(transformedOutline(f));
  scheduleRender();
}

/** Put the pixels back where they were (or drop a paste). */
function cancelFloating(): void {
  if (!floating || !floatEdit) return;
  const e = floatEdit;
  const f = floating;
  floating = null;
  floatEdit = null;
  e.canvas.getContext('2d')!.putImageData(e.before, 0, 0);
  commitEdit(e, null, '', false); // removes any drawing that was created just for this
  selection = polySelection(f.outline);
  scheduleRender();
}

/** Apply any move and remove the dashed outline. */
function finishSelection(): void {
  applyFloating();
  selection = null;
  stylePick = null;
  selectionDraft = null;
  scheduleRender();
}

function selectAll(): void {
  finishSelection();
  selection = rectSelection({ x: 0, y: 0 }, { x: project.width, y: project.height }, false);
  if (!isSelectTool()) setTool('select');
  scheduleRender();
}

function flipSelection(horizontal: boolean): void {
  if (!ensureFloating()) return;
  if (horizontal) floating!.sx *= -1;
  else floating!.sy *= -1;
  scheduleRender();
}

/** Delete the selected pixels. */
function deleteSelection(): void {
  if (floating && floatEdit) {
    // pixels are already lifted out of the drawing; just drop them
    const e = floatEdit;
    floating = null;
    floatEdit = null;
    commitEdit(e, { x: 0, y: 0, w: project.width, h: project.height }, 'Delete selection', false);
  } else if (selection) {
    const e = beginEditKeepingPicture();
    if (!e) return;
    if (e.layer.kind === 'vector') {
      const id = e.key.drawingId;
      const items = project.drawings.items(id);
      const picked = pickItems(selection, items);
      project.drawings.setItems(id, items.filter((it) => !picked.includes(it)));
    } else {
      clearSelected(e.canvas, selection);
    }
    commitEdit(e, { x: 0, y: 0, w: project.width, h: project.height }, 'Delete selection', false);
  }
  selection = null;
  scheduleRender();
}

// ---------------------------------------------------------------- many frames at once (copy, paste, reverse)
interface ClipCell {
  drawingId: string;
  label?: string;
}
type ClipFrames = (ClipCell | null)[]; // what shows on each frame (null = nothing)
let frameClip: { span: number; rows: { kind: LayerKind; frames: ClipFrames }[] } | null = null;
let lastCopy: 'art' | 'frames' = 'art';

/** The timeline selection, but only when it's more than one single frame. */
function multiRange(): FrameRange | null {
  const r = timeline.range();
  return r && (r.to > r.from || r.layerIds.length > 1) ? r : null;
}

/** A private copy of what shows on each frame, so later edits don't change it. */
function readFrames(layer: Layer, from: number, to: number): ClipFrames {
  const seen = new Map<string, ClipCell>();
  const out: ClipFrames = [];
  for (let f = from; f <= to; f++) {
    const k = layer.track.active(f);
    if (!k || !hasInk(k)) {
      out.push(null);
      continue;
    }
    if (layer.motion && k.tween && !layer.track.has(f) && layer.track.nextTime(f) !== null) {
      // an in-between frame: copy exactly what it looks like
      const drawingId = project.drawings.create();
      project.drawings.setItems(drawingId, sampleItems(layer, f, project.drawings).map((it) => ({ ...it })));
      out.push({ drawingId, label: k.label });
      continue;
    }
    let cell = seen.get(k.drawingId);
    if (!cell) {
      cell = { drawingId: project.drawings.duplicate(k.drawingId), label: k.label };
      seen.set(k.drawingId, cell);
    }
    out.push(cell);
  }
  return out;
}

/** A new drawing from a copied one, converted if it's going onto the other layer type. */
function drawingFor(cell: ClipCell, from: LayerKind, to: LayerKind): string {
  const d = project.drawings;
  if (from === to) return d.duplicate(cell.drawingId);
  const id = d.create();
  if (to === 'bitmap') {
    d.ensure(id).getContext('2d')!.drawImage(rasterize(d.items(cell.drawingId)), 0, 0);
    d.setPainted(id, true);
  } else {
    d.setItems(id, [{ t: 'image', canvas: d.get(cell.drawingId)!, x: 0, y: 0, m: IDENTITY }]);
  }
  return id;
}

/** Replace the frames from `at` onward with these, leaving later frames looking as they did. */
function writeFrames(layer: Layer, at: number, frames: ClipFrames, kind: LayerKind): void {
  const track = layer.track;
  const end = at + frames.length;
  const after = track.has(end) ? undefined : track.active(end);
  for (const t of [...track.allTimes()]) if (t >= at && t < end) track.delete(t);
  const made = new Map<ClipCell, RasterKey>();
  frames.forEach((cell, i) => {
    if (i > 0 && cell === frames[i - 1]) return; // same drawing: it just stays on screen
    if (!cell) {
      track.set(at + i, { drawingId: project.drawings.create(), origin: 'drawn' });
      return;
    }
    let key = made.get(cell);
    if (!key) {
      key = { drawingId: drawingFor(cell, kind, layer.kind), label: cell.label, origin: 'drawn' };
      made.set(cell, key);
    } else {
      key = { ...key, drawingId: project.drawings.duplicate(key.drawingId) };
    }
    track.set(at + i, layer.motion ? { ...key, tween: true } : key);
  });
  if (end > project.length) setLength(end);
  if (end < project.length && !track.has(end) && frames[frames.length - 1]) {
    // keep what used to show after the pasted block
    const drawingId = after && hasInk(after) ? project.drawings.duplicate(after.drawingId) : project.drawings.create();
    track.set(end, { drawingId, label: after?.label, origin: 'drawn' });
  }
}

/** Run a change to several layers' frames as one undo step. */
function recordFrames(label: string, layers: Layer[], change: () => void): void {
  const snap = () => layers.map((l) => ({ l, kind: l.kind, motion: l.motion, keys: l.track.allTimes().map((t) => [t, l.track.get(t)!] as const) }));
  const restore = (s: ReturnType<typeof snap>) =>
    s.forEach(({ l, kind, motion, keys }) => {
      [...l.track.allTimes()].forEach((t) => l.track.delete(t));
      keys.forEach(([t, k]) => l.track.set(t, k));
      l.kind = kind;
      l.motion = motion;
      timeline.renderNames();
    });
  finishSelection();
  const before = snap();
  const oldLength = project.length;
  change();
  const after = snap();
  const newLength = project.length;
  history.push({
    label,
    undo: () => {
      restore(before);
      setLength(oldLength);
    },
    redo: () => {
      restore(after);
      setLength(newLength);
    },
  });
}

const rangeLayers = (r: FrameRange) => r.layerIds.map((id) => project.layerById(id)!);

function unlocked(layers: Layer[]): boolean {
  if (layers.some((l) => project.isLocked(l))) {
    status('One of those layers is locked. Unlock it first.');
    return false;
  }
  return true;
}

function copyFrames(): boolean {
  const r = multiRange();
  if (!r) return false;
  const rows = rangeLayers(r).map((l) => ({ kind: l.kind, frames: readFrames(l, r.from, r.to) }));
  frameClip = { span: r.to - r.from + 1, rows };
  lastCopy = 'frames';
  status(`${frameClip.span} frames copied. Click where they should start, then Ctrl+V (or Ctrl+Shift+V for reversed).`);
  return true;
}

function clearFrames(): void {
  const r = multiRange();
  if (!r) return;
  const layers = rangeLayers(r);
  if (!unlocked(layers)) return;
  const span = r.to - r.from + 1;
  recordFrames('Clear frames', layers, () => layers.forEach((l) => writeFrames(l, r.from, new Array(span).fill(null), l.kind)));
}

function cutFrames(): void {
  if (copyFrames()) clearFrames();
}

function pasteFrames(reversed: boolean): void {
  if (!frameClip) return status('Select two or more frames on the timeline and copy them first.');
  const clip = frameClip;
  const rows = [...project.layers].reverse().filter((l) => !l.folder);
  const first = rows.indexOf(activeLayer());
  const targets = clip.rows.map((_, i) => rows[first + i]).filter(Boolean);
  if (!unlocked(targets)) return;
  const at = frame;
  recordFrames(reversed ? 'Paste frames reversed' : 'Paste frames', targets, () =>
    targets.forEach((l, i) => writeFrames(l, at, reversed ? [...clip.rows[i].frames].reverse() : clip.rows[i].frames, clip.rows[i].kind)),
  );
  timeline.setRange(activeLayerId, targets.length, at, at + clip.span - 1);
  const missing = clip.rows.length - targets.length;
  status(`Pasted ${clip.span} frames${reversed ? ' in reverse' : ''} from frame ${at + 1}.${missing ? ` ${missing} layer(s) had nowhere to go.` : ''}`);
}

/** Flip the selected frames so they play backwards, where they are. */
function reverseFrames(): void {
  const r = multiRange();
  if (!r) return status('Select two or more frames first.');
  const layers = rangeLayers(r);
  if (!unlocked(layers)) return;
  recordFrames('Reverse frames', layers, () =>
    layers.forEach((l) => writeFrames(l, r.from, readFrames(l, r.from, r.to).reverse(), l.kind)),
  );
  status(`Reversed ${r.to - r.from + 1} frames.`);
}

function moveFrames(r: FrameRange, delta: number, copy: boolean): void {
  if (r.from === r.to && r.layerIds.length === 1) return moveKey(r.layerIds[0], r.from, r.from + delta, copy);
  const layers = rangeLayers(r);
  if (!unlocked(layers)) return;
  const span = r.to - r.from + 1;
  recordFrames(copy ? 'Copy frames' : 'Move frames', layers, () =>
    layers.forEach((l) => {
      const cells = readFrames(l, r.from, r.to);
      if (!copy) writeFrames(l, r.from, new Array(span).fill(null), l.kind);
      writeFrames(l, r.from + delta, cells, l.kind);
    }),
  );
}

/** Turn keyframe mode on or off for a layer. */
function toggleMotion(id = activeLayerId): void {
  const layer = project.layerById(id);
  if (!layer) return;
  if (layer.reference) return status('A reference picture stays still. Keyframes are for your drawings.');
  if (project.isLocked(layer)) return status('This layer is locked.');
  const d = project.drawings;
  if (!layer.motion && !layer.track.allTimes().some((t) => hasInk(layer.track.get(t)))) return status('Draw something on this layer first, then turn on keyframes.');
  const turningOn = !layer.motion;
  recordFrames(turningOn ? 'Keyframes on' : 'Keyframes off', [layer], () => {
    let seenInk = false;
    for (const t of [...layer.track.allTimes()]) {
      const k = layer.track.get(t)!;
      if (turningOn && seenInk && !hasInk(k)) {
        layer.track.delete(t); // the drawing now stays on screen instead of ending
        continue;
      }
      let drawingId = k.drawingId;
      if (turningOn && hasInk(k)) {
        seenInk = true;
        if (layer.kind === 'bitmap') {
          // a bitmap drawing becomes one picture that can move, resize and turn
          drawingId = d.create();
          const copy = document.createElement('canvas');
          copy.width = project.width;
          copy.height = project.height;
          copy.getContext('2d')!.drawImage(d.get(k.drawingId)!, 0, 0);
          d.setItems(drawingId, [{ t: 'image', canvas: copy, x: 0, y: 0, m: IDENTITY }]);
        }
        ensureUids(d.items(drawingId));
      }
      layer.track.set(t, { ...k, drawingId, tween: turningOn });
    }
    if (turningOn) layer.kind = 'vector';
    layer.motion = turningOn;
  });
  scheduleRender(true);
  status(turningOn ? 'Keyframes on. Go to any frame and move or bend the drawing: the frames between fill in by themselves.' : 'Keyframes off. Drawings now stay as they are until the next one.');
}

/** Bring in a picture to draw over. It sits under your drawings and spans the whole animation. */
async function importReference(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return status(`${file.name} isn't a picture, so it can't be a reference.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return status(`Couldn't read ${file.name}.`);
  }
  const shrink = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * shrink);
  c.height = Math.round(bitmap.height * shrink);
  c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height);
  bitmap.close();
  const s = Math.min(project.width / c.width, project.height / c.height);
  finishSelection();
  const layer = project.addLayer(file.name.replace(/\.[^.]+$/, ''), 0, 'vector');
  project.layers.splice(0, 1); // the command re-adds it
  layer.reference = true;
  layer.opacity = 0.6;
  const drawingId = project.drawings.create();
  const item: VItem = { t: 'image', canvas: c, x: 0, y: 0, m: [s, 0, 0, s, (project.width - c.width * s) / 2, (project.height - c.height * s) / 2] };
  project.drawings.setItems(drawingId, [item]);
  layer.track.set(0, { drawingId, origin: 'drawn' });
  insertLayerCmd(layer, 0, 'Import reference');
  setTool('move');
  status('Reference added. Drag or resize it now, then pick the Brush to draw over it. Change its strength with Opacity.');
}

function selectAllFrames(): void {
  const rows = [...project.layers].reverse().filter((l) => !l.folder);
  if (rows[0]) timeline.setRange(rows[0].id, rows.length, 0, project.length - 1);
}

// ---------------------------------------------------------------- copy / cut / paste
function copyDrawing(): boolean {
  if (!hasSelection() && multiRange()) return copyFrames();
  lastCopy = 'art';
  const key = activeLayer().track.active(frame);
  clipboardItems = null;
  if (floating) {
    // copy exactly what you see in the moving selection
    clipboard = document.createElement('canvas');
    clipboard.width = project.width;
    clipboard.height = project.height;
    drawFloating(clipboard.getContext('2d')!, floating);
    if (floating.items) {
      const m = floatMatrix(floating);
      clipboardItems = floating.items.map((it) => ({ ...it, m: mul(m, it.m) }));
    }
    clipboardSel = polySelection(transformedOutline(floating));
    status('Selection copied. Press Ctrl+V to paste it (here or on another frame), then drag it into place.');
    return true;
  }
  if (!hasInk(key)) {
    status('Nothing to copy — there is no drawing on this frame.');
    return false;
  }
  if (activeLayer().kind === 'vector') {
    const items = selection ? pickItems(selection, showingItems()) : [...showingItems()];
    if (!items.length) {
      status('Nothing to copy inside that area.');
      return false;
    }
    clipboardItems = items.map((it) => ({ ...it }));
    clipboard = rasterize(items);
    clipboardSel = selection;
    status(selection ? 'Selection copied. Press Ctrl+V to paste it, then drag it into place.' : 'Drawing copied. Go to another frame (or layer) and press Ctrl+V.');
    return true;
  }
  const src = project.drawings.get(key!.drawingId)!;
  if (selection) {
    clipboard = copySelected(src, selection);
    clipboardSel = selection;
    status('Selection copied. Press Ctrl+V to paste it (here or on another frame), then drag it into place.');
    return true;
  }
  clipboard = document.createElement('canvas');
  clipboard.width = src.width;
  clipboard.height = src.height;
  clipboard.getContext('2d')!.drawImage(src, 0, 0);
  clipboardSel = null;
  status('Drawing copied. Go to another frame (or layer) and press Ctrl+V, or right-click → Paste.');
  return true;
}

function cutDrawing(): void {
  if (!hasSelection() && multiRange()) return cutFrames();
  if (hasSelection()) {
    if (copyDrawing()) deleteSelection();
    return;
  }
  if (!copyDrawing()) return;
  if (activeLayer().track.get(frame)) {
    deleteKey();
    status('Drawing cut. Go to another frame and press Ctrl+V to paste it.');
  } else {
    status('Copied. (Cut only removes a drawing on the frame where it starts — the one with the dot.)');
  }
}

function pasteDrawing(): void {
  if (lastCopy === 'frames' && frameClip) return pasteFrames(false);
  if (!clipboard) return status('Nothing copied yet. Right-click a drawing → Copy first.');
  if (clipboardSel) {
    // a copied part: paste it as a moveable piece on top of this frame
    finishSelection();
    const e = beginEdit();
    if (!e) return;
    floatEdit = e;
    if (e.layer.kind === 'vector') {
      let items = clipboardItems?.map((it) => ({ ...it }));
      if (!items) {
        const piece = makeFloating(clipboard, clipboardSel);
        items = [{ t: 'image', canvas: piece.canvas, x: piece.x, y: piece.y, m: IDENTITY }];
      }
      stylePick = null;
      floating = floatFromItems(items);
    } else {
      floating = makeFloating(clipboard, clipboardSel);
    }
    setTool('move');
    status('Pasted — drag it into place, then press Enter (or pick another tool).');
    scheduleRender();
    return;
  }
  pasteImage(clipboard, 'Paste', clipboardItems);
}

/** Paint a picture onto this frame: into its own drawing if it has one, or a new drawing. */
function pasteImage(src: HTMLCanvasElement, label: string, items?: VItem[] | null): void {
  const saved = newDrawingStarts;
  newDrawingStarts = 'blank'; // a pasted drawing replaces what was showing, not adds to a copy
  const e = beginEdit();
  newDrawingStarts = saved;
  if (!e) return;
  if (e.layer.kind === 'vector') {
    const id = e.key.drawingId;
    const add: VItem[] = items ? items.map((it) => ({ ...it })) : [{ t: 'image', canvas: src, x: 0, y: 0, m: IDENTITY }];
    project.drawings.setItems(id, [...project.drawings.items(id), ...add]);
  } else {
    const ctx = e.canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(src, 0, 0);
  }
  commitEdit(e, FULL, label, true);
  status(`${label === 'Paste' ? 'Pasted' : 'Duplicated'} onto frame ${frame + 1}.`);
}

/** Erase everything in the drawing showing on this frame. */
function clearDrawing(): void {
  const key = activeLayer().track.active(frame);
  if (!hasInk(key)) return status('This frame is already empty.');
  if (activeLayer().kind === 'vector') {
    const id = key!.drawingId;
    const before = project.drawings.items(id);
    history.run({ label: 'Clear drawing', redo: () => project.drawings.setItems(id, []), undo: () => project.drawings.setItems(id, before) });
    return;
  }
  const canvas = project.drawings.get(key!.drawingId)!;
  const ctx = canvas.getContext('2d')!;
  const before = ctx.getImageData(0, 0, canvas.width, canvas.height);
  history.run({
    label: 'Clear drawing',
    redo: () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      project.drawings.setPainted(key!.drawingId, false);
    },
    undo: () => {
      ctx.putImageData(before, 0, 0);
      project.drawings.setPainted(key!.drawingId, true);
    },
  });
}

// ---------------------------------------------------------------- layers
let selectedFolder: string | null = null; // a folder row picked on the timeline; drawing stays on the active layer

function flipLayer(id: string, what: 'outline' | 'highlight' | 'open'): void {
  const l = project.layerById(id);
  if (l) l[what] = !l[what];
  scheduleRender(true);
}

/** The header buttons: change every layer at once. If any layer is still off, turn them all on. */
function setAll(kind: 'highlight' | 'outline' | 'visible' | 'locked'): void {
  const layers = project.layers.filter((l) => !(l.folder && (kind === 'highlight' || kind === 'outline')));
  const wanted = kind === 'visible' ? !layers.some((l) => l.visible) : !layers.every((l) => l[kind]);
  layers.forEach((l) => (l[kind] = wanted));
  scheduleRender(true);
}

function newLayerMenu(x: number, y: number): void {
  showMenu(x, y, [
    { label: 'New vector layer  (sharp at any zoom)', action: () => addLayer('vector') },
    { label: 'New bitmap layer  (painted pixels)', action: () => addLayer('bitmap') },
  ]);
}

/** One undo step for any change to the order or folders of the layers. */
function layerEdit(label: string, change: () => void): void {
  const order = [...project.layers];
  const parents = new Map(order.map((l) => [l, l.parent]));
  const active = activeLayerId;
  const folder = selectedFolder;
  history.run({
    label,
    redo: () => {
      change();
      timeline.renderNames();
    },
    undo: () => {
      project.layers.splice(0, project.layers.length, ...order);
      parents.forEach((p, l) => (l.parent = p));
      activeLayerId = active;
      selectedFolder = folder;
      timeline.renderNames();
    },
  });
}

function newFolder(): void {
  const count = project.layers.filter((l) => l.folder).length + 1;
  const active = activeLayer();
  const anchor = active.parent ? project.layerById(active.parent) ?? active : active;
  const index = project.layers.indexOf(anchor) + 1;
  const folder = project.addLayer(`Folder ${count}`, index);
  project.layers.splice(index, 1); // the edit adds it
  folder.folder = true;
  folder.open = true;
  layerEdit('New folder', () => {
    project.layers.splice(index, 0, folder);
    selectedFolder = folder.id;
  });
  status('Folder added. Drag layers onto it to put them inside.');
}

const blockOf = (l: Layer) => (l.folder ? project.layers.filter((x) => x === l || x.parent === l.id) : [l]);

function dropLayer(id: string, targetId: string, where0: 'above' | 'below' | 'into'): void {
  const layer = project.layerById(id);
  const target0 = project.layerById(targetId);
  if (!layer || !target0) return;
  const block = blockOf(layer);
  if (block.includes(target0)) return;
  // A folder can't go inside a folder: it goes next to the folder instead.
  let target = target0;
  let where = where0;
  if (layer.folder && target.parent) {
    target = project.layerById(target.parent)!;
    where = 'above';
  }
  if (where === 'below' && target.folder) where = target.open === false ? 'below' : 'into';
  layerEdit(where === 'into' ? 'Move into folder' : 'Move layer', () => {
    const rest = project.layers.filter((l) => !block.includes(l));
    let at = rest.indexOf(target);
    if (where === 'above') at += 1;
    if (where === 'below' && target.folder) at = rest.findIndex((l) => l === target || l.parent === target.id);
    rest.splice(at, 0, ...block);
    project.layers.splice(0, project.layers.length, ...rest);
    if (!layer.folder) layer.parent = where === 'into' ? target.id : target.folder ? null : target.parent ?? null;
  });
}

function takeOutOfFolder(layer: Layer): void {
  const folder = layer.parent ? project.layerById(layer.parent) : undefined;
  if (!folder) return;
  layerEdit('Take out of folder', () => {
    const rest = project.layers.filter((l) => l !== layer);
    rest.splice(rest.indexOf(folder) + 1, 0, layer);
    project.layers.splice(0, project.layers.length, ...rest);
    layer.parent = null;
  });
}

function pickLayerColour(layer: Layer): void {
  const box = Object.assign(document.createElement('input'), { type: 'color', value: layer.color });
  box.oninput = () => {
    layer.color = box.value;
    scheduleRender(true);
  };
  box.click();
}

async function deleteSelected(): Promise<void> {
  const folder = selectedFolder ? project.layerById(selectedFolder) : undefined;
  if (!folder) return deleteLayer();
  const inside = project.layers.filter((l) => l.parent === folder.id);
  const realLeft = project.layers.filter((l) => !l.folder && !inside.includes(l)).length;
  let keep = true;
  if (inside.length) {
    const answer = await askChoice(`Delete ${folder.name}?`, `It holds ${inside.length} ${inside.length === 1 ? 'layer' : 'layers'}. ${realLeft ? 'Keep what is inside, or delete it with the folder.' : 'What is inside stays, because the project needs at least one layer.'}`, [
      { label: 'Cancel', value: 'cancel' as const },
      ...(realLeft ? [{ label: 'Delete folder and layers', value: 'all' as const }] : []),
      { label: 'Keep the layers', value: 'keep' as const, primary: true },
    ]);
    if (!answer || answer === 'cancel') return;
    keep = answer === 'keep';
  }
  layerEdit('Delete folder', () => {
    const gone = keep ? [folder] : [folder, ...inside];
    if (keep) inside.forEach((l) => (l.parent = null));
    project.layers.splice(0, project.layers.length, ...project.layers.filter((l) => !gone.includes(l)));
    selectedFolder = null;
    if (!project.layerById(activeLayerId)) activeLayerId = project.layers.find((l) => !l.folder)!.id;
  });
}

function insertLayerCmd(layer: Layer, index: number, label: string): void {
  const previous = activeLayerId;
  selectedFolder = null;
  history.run({
    label,
    redo: () => {
      project.layers.splice(index, 0, layer);
      activeLayerId = layer.id;
      timeline.renderNames();
    },
    undo: () => {
      project.layers.splice(project.layers.indexOf(layer), 1);
      activeLayerId = previous;
      timeline.renderNames();
    },
  });
}

function addLayer(kind: LayerKind = 'vector'): void {
  const index = project.layers.indexOf(activeLayer()) + 1;
  const layer = project.addLayer(`${kind === 'vector' ? 'Vector' : 'Bitmap'} ${project.layers.length + 1}`, index, kind);
  layer.track.set(0, { drawingId: project.drawings.create(), origin: 'drawn' });
  project.layers.splice(index, 1); // the command re-adds it
  layer.parent = activeLayer().parent ?? null;
  insertLayerCmd(layer, index, 'Add layer');
}

function duplicateLayer(): void {
  const src = activeLayer();
  const index = project.layers.indexOf(src) + 1;
  const layer = project.addLayer(`${src.name} copy`, index, src.kind);
  project.layers.splice(index, 1);
  layer.opacity = src.opacity;
  layer.blend = src.blend;
  layer.motion = src.motion;
  layer.ease = src.ease;
  layer.reference = src.reference;
  layer.parent = src.parent ?? null;
  for (const t of src.track.allTimes()) {
    const k = src.track.get(t)!;
    const drawingId = hasInk(k) ? project.drawings.duplicate(k.drawingId) : project.drawings.create();
    layer.track.set(t, { ...k, drawingId });
  }
  insertLayerCmd(layer, index, 'Duplicate layer');
}

function moveLayer(dir: 1 | -1): void {
  const layer = activeLayer();
  const i = project.layers.indexOf(layer);
  const j = i + dir;
  if (j < 0 || j >= project.layers.length) return status(dir > 0 ? 'This layer is already at the top.' : 'This layer is already at the bottom.');
  layerEdit(dir > 0 ? 'Move layer up' : 'Move layer down', () => {
    [project.layers[i], project.layers[j]] = [project.layers[j], project.layers[i]];
    // whatever sits just above it now decides which folder it's in
    const above = project.layers[j + 1];
    layer.parent = above ? (above.folder ? above.id : above.parent ?? null) : null;
  });
}

function deleteLayer(id = activeLayerId): void {
  if (realLayerCount() <= 1) return status('The last layer can’t be deleted.');
  const layer = project.layerById(id)!;
  const index = project.layers.indexOf(layer);
  layerEdit('Delete layer', () => {
    project.layers.splice(index, 1);
    const below = project.layers.slice(0, index).reverse().find((l) => !l.folder);
    activeLayerId = (below ?? project.layers.find((l) => !l.folder)!).id;
  });
}

const realLayerCount = () => project.layers.filter((l) => !l.folder).length;

/** Turn a vector layer into pixels (useful for painting over it). Can't be turned back, except with Undo. */
function convertToBitmap(id: string): void {
  const layer = project.layerById(id);
  if (!layer || layer.kind === 'bitmap') return;
  const oldKeys = layer.track.allTimes().map((t) => [t, layer.track.get(t)!] as const);
  const newKeys = oldKeys.map(([t, k]) => {
    const drawingId = project.drawings.create();
    if (hasInk(k)) {
      project.drawings.ensure(drawingId).getContext('2d')!.drawImage(rasterize(project.drawings.items(k.drawingId)), 0, 0);
      project.drawings.setPainted(drawingId, true);
    }
    return [t, { ...k, drawingId }] as const;
  });
  const swap = (keys: typeof oldKeys, kind: LayerKind) => {
    keys.forEach(([t, k]) => layer.track.set(t, k));
    layer.kind = kind;
    timeline.renderNames();
  };
  finishSelection();
  history.run({ label: 'Convert to bitmap', redo: () => swap(newKeys, 'bitmap'), undo: () => swap(oldKeys, 'vector') });
  status('Converted to a bitmap layer.');
}

function toggleLock(id = activeLayerId): void {
  const l = project.layerById(id);
  if (!l) return;
  l.locked = !l.locked;
  scheduleRender(true);
}

/** Drag a drawing to another frame on the timeline (Alt = make a copy). */
function moveKey(layerId: string, from: number, to: number, copy: boolean): void {
  const layer = project.layerById(layerId);
  const key = layer?.track.get(from);
  if (!layer || !key || from === to) return;
  if (project.isLocked(layer)) return status('This layer is locked.');
  if (hasInk(layer.track.get(to))) return status('There is already a drawing on that frame.');
  finishSelection();
  const replaced = layer.track.get(to);
  const moved: RasterKey = copy ? { ...key, drawingId: project.drawings.duplicate(key.drawingId) } : key;
  // the empty frame that ends this drawing travels with it
  const nextT = layer.track.nextTime(from);
  const nextKey = nextT === null ? undefined : layer.track.get(nextT);
  const tail = !copy && nextT !== null && nextT !== to && !hasInk(nextKey) && !layer.track.has(nextT + (to - from)) ? nextT : null;
  history.run({
    label: copy ? 'Copy drawing to frame' : 'Move drawing',
    redo: () => {
      if (!copy) layer.track.delete(from);
      layer.track.set(to, moved);
      if (tail !== null) {
        layer.track.delete(tail);
        layer.track.set(tail + (to - from), nextKey!);
      }
    },
    undo: () => {
      if (tail !== null) {
        layer.track.delete(tail + (to - from));
        layer.track.set(tail, nextKey!);
      }
      layer.track.delete(to);
      if (replaced) layer.track.set(to, replaced);
      if (!copy) layer.track.set(from, key);
    },
  });
}

function renameLayer(id: string): void {
  const el = document.querySelector<HTMLInputElement>(`.tl-name input[data-layer-id="${id}"]`);
  el?.focus();
  el?.select();
}

// ---------------------------------------------------------------- painting (shared by all drawing tools)
interface Edit {
  layer: Layer;
  key: RasterKey;
  created: Created;
  canvas: HTMLCanvasElement;
  before: ImageData;
  beforeItems: VItem[]; // vector layers: the shapes before this edit
  wasPainted: boolean;
}

// Vector edits don't touch pixels; these stand in so the code path stays the same.
const noCanvas = document.createElement('canvas');
noCanvas.width = noCanvas.height = 1;
const noPixels = new ImageData(1, 1);

/** Get the drawing to paint on at this frame, creating a new one if this frame has none. */
function beginEdit(): Edit | null {
  if (floating) applyFloating(); // put down anything being moved before painting
  let layer = activeLayer();
  if (layer.reference && !placingReference) {
    // A reference is only for looking at: drawing goes on the nearest normal layer.
    const normal = [...project.layers].reverse().find((l) => !l.reference);
    if (!normal) {
      status('Add a normal layer to draw on. The reference picture only guides you.');
      return null;
    }
    activeLayerId = normal.id;
    layer = normal;
    timeline.renderNames();
  }
  if (!project.isShown(layer)) {
    status('This layer is hidden. Click its eye on the timeline to show it.');
    return null;
  }
  if (project.isLocked(layer)) {
    status('This layer is locked — unlock it in the Layer panel to draw on it.');
    return null;
  }
  let key = layer.track.get(layer.reference ? 0 : frame);
  let created: Created = [];
  const motionSource = !key && layer.motion ? layer.track.active(frame) : undefined;
  if (motionSource && hasInk(motionSource)) {
    // Keyframe mode: editing any frame makes a new keyframe from exactly what's showing there.
    ensureUids(project.drawings.items(motionSource.drawingId));
    const nextT = layer.track.nextTime(frame);
    if (nextT !== null) ensureUids(project.drawings.items(layer.track.get(nextT)!.drawingId));
    const drawingId = project.drawings.create();
    project.drawings.setItems(drawingId, sampleItems(layer, frame, project.drawings).map((it) => ({ ...it })));
    key = { drawingId, label: motionSource.label, origin: 'drawn', tween: true };
    layer.track.set(frame, key);
    created = [[frame, key]];
  } else if (!key) {
    const showing = layer.track.active(frame);
    const copy = newDrawingStarts === 'copy' && hasInk(showing);
    key = {
      drawingId: copy ? project.drawings.duplicate(showing!.drawingId) : project.drawings.create(),
      label: showing?.label,
      origin: 'drawn',
    };
    created = placeDrawing(layer, frame, key);
  } else if (!hasInk(key)) {
    // First ink on an empty frame: it should also only last the chosen number of frames.
    created = placeEndMarker(layer, frame);
  }
  if (layer.kind === 'vector') {
    return { layer, key, created, canvas: noCanvas, before: noPixels, beforeItems: [...project.drawings.items(key.drawingId)], wasPainted: hasInk(key) };
  }
  const canvas = project.drawings.ensure(key.drawingId);
  const before = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
  return { layer, key, created, canvas, before, beforeItems: [], wasPainted: hasInk(key) };
}

/** Finish an edit: remember only the changed rectangle for undo. */
function commitEdit(e: Edit, box: Rect | null, label: string, addsInk: boolean): void {
  if (e.layer.kind === 'vector') {
    const id = e.key.drawingId;
    const before = e.beforeItems;
    if (!box) {
      project.drawings.setItems(id, before);
      e.created.forEach(([t]) => e.layer.track.delete(t));
      scheduleRender();
      return;
    }
    const after = [...project.drawings.items(id)];
    project.drawings.setItems(id, after);
    history.push({
      label,
      undo: () => {
        project.drawings.setItems(id, before);
        e.created.forEach(([t]) => e.layer.track.delete(t));
      },
      redo: () => {
        e.created.forEach(([t, k]) => e.layer.track.set(t, k));
        project.drawings.setItems(id, after);
      },
    });
    return;
  }
  if (!box) {
    e.created.forEach(([t]) => e.layer.track.delete(t));
    scheduleRender();
    return;
  }
  const ctx = e.canvas.getContext('2d')!;
  const tmp = document.createElement('canvas');
  tmp.width = box.w;
  tmp.height = box.h;
  const tctx = tmp.getContext('2d')!;
  tctx.putImageData(e.before, -box.x, -box.y, box.x, box.y, box.w, box.h);
  const beforeBox = tctx.getImageData(0, 0, box.w, box.h);
  const afterBox = ctx.getImageData(box.x, box.y, box.w, box.h);
  const painted = e.wasPainted || addsInk;
  project.drawings.setPainted(e.key.drawingId, painted);
  history.push({
    label,
    undo: () => {
      ctx.putImageData(beforeBox, box.x, box.y);
      project.drawings.setPainted(e.key.drawingId, e.wasPainted);
      e.created.forEach(([t]) => e.layer.track.delete(t));
    },
    redo: () => {
      e.created.forEach(([t, k]) => e.layer.track.set(t, k));
      ctx.putImageData(afterBox, box.x, box.y);
      project.drawings.setPainted(e.key.drawingId, painted);
    },
  });
}

function toDoc(ev: { clientX: number; clientY: number; pointerType?: string; pressure?: number }): Pt {
  const { x, y } = viewport.toDoc(ev.clientX, ev.clientY);
  // Mouse has no pressure: treat it as full. Pens report 0..1 via Windows Ink.
  let p = ev.pointerType === 'mouse' || ev.pressure === undefined ? 1 : ev.pressure;
  if (ev.pointerType === 'touch' && p === 0) p = 1;
  return { x, y, p: Math.max(0.05, p) };
}

/** Colour picker: take the colour of the finished picture at this point. */
function pickColor(ev: PointerEvent): void {
  const { x, y } = toDoc(ev);
  if (x < 0 || y < 0 || x >= project.width || y >= project.height) return;
  compositor.render(scratchCtx, frame, null, { m: [1, 0, 0, 1, 0, 0], width: project.width, height: project.height });
  const [r, g, b] = scratchCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
  const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  setColor(hex);
  status(`Picked colour ${hex}.`);
}

function recolor(target: VItem, inside: boolean): void {
  const index = showingItems().indexOf(target);
  const e = beginEditKeepingPicture();
  if (!e) return;
  const id = e.key.drawingId;
  const items = [...project.drawings.items(id)];
  const it = items[index];
  if (it && inside) items[index] = { ...it, fillColor: brush.color } as VItem;
  else if (it && 'color' in it) items[index] = { ...it, color: brush.color } as VItem;
  project.drawings.setItems(id, items);
  commitEdit(e, FULL, 'Recolour', true);
}

/** Every keyframe of a keyframe-mode layer that has something on it. */
function motionTimes(layer: Layer): number[] {
  return layer.track.allTimes().filter((t) => {
    const k = layer.track.get(t);
    return !!k?.tween && hasInk(k);
  });
}

function giveLayerUids(layer: Layer): void {
  if (layer.kind !== 'vector') return;
  if (layer.motion) {
    for (const t of layer.track.allTimes()) ensureUids(project.drawings.items(layer.track.get(t)!.drawingId));
  } else {
    const key = layer.track.active(frame);
    if (key) ensureUids(project.drawings.items(key.drawingId));
  }
}

/** Remember these drawings, for one undo step that can cover several keyframes. */
function snapshotKeys(keys: RasterKey[]): Map<string, VItem[]> {
  return new Map(keys.map((k) => [k.drawingId, [...project.drawings.items(k.drawingId)]]));
}

function pushKeyEdit(label: string, layer: Layer, before: Map<string, VItem[]>, created: Created = []): void {
  const after = new Map([...before.keys()].map((id) => [id, [...project.drawings.items(id)]]));
  history.push({
    label,
    undo: () => {
      before.forEach((items, id) => project.drawings.setItems(id, items));
      created.forEach(([t]) => layer.track.delete(t));
    },
    redo: () => {
      created.forEach(([t, k]) => layer.track.set(t, k));
      after.forEach((items, id) => project.drawings.setItems(id, items));
    },
  });
}

/** The closest pixel to a spot that matches the colour clicked on the original frame. */
function findSeed(img: ImageData, cx: number, cy: number, rgba: number[]): { x: number; y: number } | null {
  const similar = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return false;
    const i = (Math.floor(y) * img.width + Math.floor(x)) * 4;
    const d = img.data;
    if (rgba[3] === 0) return d[i + 3] <= fillTolerance;
    return Math.abs(d[i] - rgba[0]) <= fillTolerance && Math.abs(d[i + 1] - rgba[1]) <= fillTolerance && Math.abs(d[i + 2] - rgba[2]) <= fillTolerance && Math.abs(d[i + 3] - rgba[3]) <= fillTolerance;
  };
  for (let r = 0; r <= 16; r += 2) {
    const steps = r ? 16 : 1;
    for (let a = 0; a < steps; a++) {
      const x = cx + Math.cos((a * Math.PI * 2) / steps) * r;
      const y = cy + Math.sin((a * Math.PI * 2) / steps) * r;
      if (similar(x, y)) return { x, y };
    }
  }
  return null;
}

function fillEveryKey(x: number, y: number, layer: Layer, times: number[]): void {
  const showing = showingItems();
  const keys = times.map((t) => layer.track.get(t)!);
  const hit = [...showing].reverse().find((it) => hitItem(scratchCtx, it, x, y));
  if (hit?.uid) {
    // Clicked straight on a line or a colour: change it on every keyframe.
    const inside = !hitOutline(scratchCtx, hit, x, y) && (hit.t === 'shape' || hit.t === 'bez') && hit.fill;
    const before = snapshotKeys(keys);
    for (const k of keys) {
      project.drawings.setItems(k.drawingId, project.drawings.items(k.drawingId).map((it) => {
        if (it.uid !== hit.uid) return it;
        if (inside) return { ...it, fillColor: brush.color } as VItem;
        return 'color' in it ? ({ ...it, color: brush.color } as VItem) : it;
      }));
    }
    pushKeyEdit('Recolour all keyframes', layer, before);
    status(`Changed the colour on all ${keys.length} keyframes.`);
    scheduleRender();
    return;
  }

  const W = project.width;
  const H = project.height;
  const picture = (t: number, items: VItem[]) => {
    if (fillAllLayers) {
      compositor.renderLayers(scratchCtx, t);
      return scratchCtx.getImageData(0, 0, W, H);
    }
    return rasterize(items).getContext('2d')!.getImageData(0, 0, W, H);
  };
  const flood = (px: number, py: number, img: ImageData) => {
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const box = floodFill(c, px, py, brush.color, fillTolerance, fillGrow, img);
    return { c, box, leaked: !!box && box.w >= W - 4 && box.h >= H - 4 };
  };
  const source = picture(frame, showing);
  const i0 = (Math.floor(y) * W + Math.floor(x)) * 4;
  const rgba = [source.data[i0], source.data[i0 + 1], source.data[i0 + 2], source.data[i0 + 3]];
  const sourceLeaks = flood(x, y, source).leaked;

  const done: { key: RasterKey; loops: number[][] }[] = [];
  const failed: number[] = [];
  for (const t of times) {
    const key = layer.track.get(t)!;
    const items = project.drawings.items(key.drawingId);
    const spot = followPoint(showing, items, x, y);
    const img = picture(t, items);
    const seed = findSeed(img, spot.x, spot.y, rgba);
    const result = seed && flood(seed.x, seed.y, img);
    if (!result?.box || (result.leaked && !sourceLeaks)) {
      failed.push(t + 1);
      continue;
    }
    done.push({ key, loops: traceLoops(result.c, result.box) });
  }
  if (!done.length) {
    status('Could not find that area on the keyframes. Try clicking well inside it.');
    return;
  }
  const matched = matchLoops(done.map((d) => d.loops));
  const before = snapshotKeys(done.map((d) => d.key));
  const shared: VItem = { t: 'fill', loops: [], color: brush.color, m: IDENTITY };
  ensureUids([shared]);
  done.forEach((d, i) => {
    const fill: VItem = { t: 'fill', loops: matched[i], color: brush.color, m: IDENTITY, uid: shared.uid };
    project.drawings.setItems(d.key.drawingId, [fill, ...project.drawings.items(d.key.drawingId)]);
  });
  pushKeyEdit('Fill all keyframes', layer, before);
  status(failed.length ? `Filled ${done.length} keyframes. Couldn't find the area on frame ${failed.join(', ')}: it may have a gap there.` : `Filled all ${done.length} keyframes. The colour now moves with your drawing.`);
  scheduleRender();
}

async function fillAt(ev: PointerEvent): Promise<void> {
  const { x, y } = toDoc(ev);
  if (x < 0 || y < 0 || x >= project.width || y >= project.height) return;
  const layer = activeLayer();
  if (layer.kind === 'vector' && layer.motion && project.isShown(layer) && !project.isLocked(layer)) {
    const times = motionTimes(layer);
    if (times.length > 1) {
      giveLayerUids(layer);
      const scope =
        fillKeysMode === 'ask'
          ? await askChoice<'all' | 'one'>('Fill all frames?', `This layer has ${times.length} keyframes. Fill the same area on all of them, so the colour moves with your drawing?`, [
              { label: 'Only here, until the next keyframe', value: 'one' },
              { label: 'Fill all frames', value: 'all', primary: true },
            ])
          : fillKeysMode;
      if (!scope) return;
      if (scope === 'all') return fillEveryKey(x, y, layer, times);
    }
  }
  fillOne(x, y);
}

function fillOne(x: number, y: number): void {
  let sample: ImageData | undefined;
  if (fillAllLayers) {
    compositor.renderLayers(scratchCtx, frame);
    sample = scratchCtx.getImageData(0, 0, project.width, project.height);
  }
  if (activeLayer().kind === 'vector') {
    // Clicking straight on a line or shape recolours it (like an ink bottle).
    const hit = [...showingItems()].reverse().find((it) => hitItem(scratchCtx, it, x, y));
    if (hit) return recolor(hit, !hitOutline(scratchCtx, hit, x, y) && (hit.t === 'shape' || hit.t === 'bez') && hit.fill);
    const e = beginEdit();
    if (!e) return;
    const tmp = document.createElement('canvas');
    tmp.width = project.width;
    tmp.height = project.height;
    const own = sample ?? rasterize(project.drawings.items(e.key.drawingId)).getContext('2d')!.getImageData(0, 0, project.width, project.height);
    const box = floodFill(tmp, x, y, brush.color, fillTolerance, fillGrow, own);
    if (box) {
      const id = e.key.drawingId;
      const fillItem: VItem = { t: 'fill', loops: traceLoops(tmp, box), color: brush.color, m: IDENTITY };
      project.drawings.setItems(id, [fillItem, ...project.drawings.items(id)]);
    }
    commitEdit(e, box, 'Fill', true);
    return;
  }
  const e = beginEdit();
  if (!e) return;
  const box = floodFill(e.canvas, x, y, brush.color, fillTolerance, fillGrow, sample);
  commitEdit(e, box, 'Fill', true);
}

// ---------------------------------------------------------------- pointer input on the canvas
let pointerId: number | null = null;
let edit: Edit | null = null;
let stroke: BrushStroke | null = null;
let strokeErases = false;
let strokeSnap: { shape: Shape; width: number; strokeBox: Rect | null } | null = null;
let holdTimer = 0;
let shapeStart: Pt | null = null;
let panning: { id: number; x: number; y: number } | null = null;

const isPaintTool = () => tool === 'brush' || tool === 'eraser';
const isSelectTool = () => tool === 'move' || tool === 'select' || tool === 'lasso';
const isShapeTool = () => tool === 'line' || tool === 'rect' || tool === 'ellipse' || tool === 'poly';

function updateCursor(ev: PointerEvent): void {
  if ((!isPaintTool() && tool !== 'reshape') || ev.pointerType === 'touch' || panning) return cursor.hide();
  cursor.show(ev.clientX, ev.clientY, (tool === 'reshape' ? reshapeRadius() * 2 : brush.size) * viewScale(), tool === 'eraser');
}

// Hand tool or middle mouse button: drag the canvas around (works anywhere in the stage).
$('stage').addEventListener('pointerdown', (ev) => {
  const wantsPan = (tool === 'hand' && ev.button === 0) || ev.button === 1;
  if (!wantsPan || pointerId !== null) return;
  ev.preventDefault();
  panning = { id: ev.pointerId, x: ev.clientX, y: ev.clientY };
  view.classList.add('grabbing');
  cursor.hide();
  try {
    $('stage').setPointerCapture(ev.pointerId);
  } catch {
    /* synthetic pointer */
  }
});
$('stage').addEventListener('pointermove', (ev) => {
  if (!panning || ev.pointerId !== panning.id) return;
  viewport.panBy(ev.clientX - panning.x, ev.clientY - panning.y);
  panning = { ...panning, x: ev.clientX, y: ev.clientY };
});
const endPan = (ev: PointerEvent) => {
  if (panning && ev.pointerId === panning.id) {
    panning = null;
    view.classList.remove('grabbing');
  }
};
$('stage').addEventListener('pointerup', endPan);
$('stage').addEventListener('pointercancel', endPan);

// Mouse wheel: Ctrl+wheel zooms at the pointer; plain wheel scrolls the view.
$('stage').addEventListener(
  'wheel',
  (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey) viewport.zoomBy(Math.exp(-ev.deltaY * 0.0015), ev.clientX, ev.clientY);
    else if (ev.shiftKey) viewport.panBy(-ev.deltaY, 0);
    else viewport.panBy(-ev.deltaX, -ev.deltaY);
  },
  { passive: false },
);

view.addEventListener('pointerdown', (ev) => {
  if (pointerId !== null || panning) return;
  // The pen's eraser end (flip the pen over) always erases.
  const penEraser = ev.pointerType === 'pen' && (ev.button === 5 || (ev.buttons & 32) !== 0);
  if (ev.button !== 0 && !penEraser) return; // right-click etc. are handled elsewhere
  if (ev.pointerType === 'touch' && !fingerDraws) return;
  if (tool === 'hand') return;
  player.stop();

  if (tool === 'zoom') return viewport.zoomBy(ev.altKey ? 0.8 : 1.25, ev.clientX, ev.clientY);
  if (tool === 'picker' || (ev.altKey && !penEraser)) return pickColor(ev);
  if (tool === 'fill' && !penEraser) return fillAt(ev);
  if (tool === 'text' && !penEraser) return startText(ev);
  if (isSelectTool() && !penEraser) return selectPointerDown(ev);
  if (tool === 'pen' && !penEraser) return penDown(ev);
  if (tool === 'reshape' && !penEraser) return reshapeDown(ev);
  if (tool === 'points' && !penEraser) return bendDown(ev);
  if (tool === 'rotview') {
    rotDrag = { id: ev.pointerId, angle: pointerAngle(ev) };
    return;
  }

  edit = beginEdit();
  if (!edit) return;
  pointerId = ev.pointerId;
  try {
    view.setPointerCapture(ev.pointerId); // keep receiving the pen even outside the canvas
  } catch {
    /* not capturable (e.g. synthetic events) — drawing still works inside the canvas */
  }
  const pt = toDoc(ev);
  if (isPaintTool() || penEraser) {
    strokeErases = tool === 'eraser' || penEraser;
    brush.eraser = strokeErases;
    stroke = new BrushStroke(edit.canvas, brush, pt);
    strokeSnap = null;
    if (edit.layer.kind === 'vector') {
      vStroke = { t: 'stroke', pts: [], color: brush.color, erase: strokeErases, m: IDENTITY };
      syncVStroke();
      project.drawings.setItems(edit.key.drawingId, [...edit.beforeItems, vStroke]);
      compositor.live = { layerId: edit.layer.id, before: edit.beforeItems, item: vStroke };
    }
    restAt = { ...pt };
    restSince = performance.now();
    clearInterval(restTimer);
    restTimer = window.setInterval(glideToPen, 16);
    armHoldTimer();
  } else {
    shapeStart = pt;
    shapePreview = null;
  }
  scheduleRender();
});

view.addEventListener('pointermove', (ev) => {
  updateCursor(ev);
  if (isSelectTool()) return selectPointerMove(ev);
  if (tool === 'pen') return penMove(ev);
  if (reshaping) return reshapeMove(ev);
  if (tool === 'points') return bendMove(ev);
  if (rotDrag && ev.pointerId === rotDrag.id) {
    const a = pointerAngle(ev);
    viewport.rotateBy(a - rotDrag.angle);
    rotDrag.angle = a;
    return;
  }
  if (ev.pointerId !== pointerId || !edit) return;
  const last = toDoc(ev);

  if (stroke) {
    if (strokeSnap) {
      // Already straightened: a snapped line keeps following the pen's end point.
      if (strokeSnap.shape.kind === 'line') {
        strokeSnap.shape = { ...strokeSnap.shape, x2: last.x, y2: last.y };
        redrawSnap();
      }
      return;
    }
    // Coalesced events = every pen sample since the last screen update (smoother lines).
    const events = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    for (const e of events.length ? events : [ev]) stroke.add(toDoc(e));
    if (Math.hypot(last.x - restAt.x, last.y - restAt.y) > 2 / viewScale()) {
      restAt = last;
      restSince = performance.now();
    }
    syncVStroke();
    armHoldTimer();
  } else if (shapeStart) {
    shapePreview = { shape: shapeFromDrag(tool as ShapeKind, shapeStart, last, ev.shiftKey, ev.altKey), width: brush.size };
  }
  scheduleRender();
});

view.addEventListener('dblclick', (ev) => {
  if (tool === 'points') return bendToggle(ev);
  if (tool === 'pen' && pen) {
    pen.anchors.pop(); // the double-click added one extra point
    finishPen(false);
  }
});

view.addEventListener('pointerleave', () => {
  if (pointerId === null) cursor.hide();
});

/** "Hold to straighten": restart the countdown on every real movement. */
let lastHoldPos: Pt | null = null;
function armHoldTimer(): void {
  if (!holdToStraighten || tool !== 'brush' || strokeErases || !stroke) return;
  const pts = stroke.points;
  const p = pts[pts.length - 1];
  if (lastHoldPos && p && Math.hypot(p.x - lastHoldPos.x, p.y - lastHoldPos.y) < 3 / viewScale()) return;
  lastHoldPos = p ? { ...p } : null;
  clearTimeout(holdTimer);
  holdTimer = window.setTimeout(trySnap, 550);
}

function trySnap(): void {
  if (!stroke || !edit || strokeSnap) return;
  const shape = recognizeStroke(stroke.points);
  if (!shape) return;
  strokeSnap = { shape, width: stroke.averageWidth(), strokeBox: stroke.bounds() };
  redrawSnap();
  status(shape.kind === 'line' ? 'Straightened into a line — keep moving to adjust the end, lift to finish.' : 'Turned into an ellipse — lift the pen to finish.');
}

function redrawSnap(): void {
  if (!edit || !strokeSnap) return;
  if (edit.layer.kind === 'vector') {
    const item: VItem = { t: 'shape', shape: strokeSnap.shape, width: strokeSnap.width, color: brush.color, fill: false, fillColor: backColor, m: IDENTITY };
    project.drawings.setItems(edit.key.drawingId, [...edit.beforeItems, item]);
    scheduleRender();
    return;
  }
  const ctx = edit.canvas.getContext('2d')!;
  ctx.putImageData(edit.before, 0, 0); // remove the hand-drawn stroke
  drawShape(ctx, strokeSnap.shape, { width: strokeSnap.width, color: brush.color, fill: false, eraser: false });
  scheduleRender();
}

/** Copy the smoothed pen path into the vector stroke being drawn. */
let vStroke: (VItem & { t: 'stroke' }) | null = null;
function syncVStroke(): void {
  if (!vStroke || !stroke) return;
  const s = stroke;
  for (let i = vStroke.pts.length; i < s.points.length; i++) {
    const p = s.points[i];
    vStroke.pts.push({ x: p.x, y: p.y, w: s.width(p.p) });
  }
  touch(vStroke);
}

/** The pen has paused: bring the trailing line up to it, so it never looks stuck. */
let restAt: Pt = { x: 0, y: 0, p: 0 };
let restSince = 0;
let restTimer = 0;
function glideToPen(): void {
  if (!stroke || strokeSnap || performance.now() - restSince < 90) return;
  if (stroke.catchUp()) {
    syncVStroke();
    scheduleRender();
  }
}

function endPointer(ev: PointerEvent): void {
  if (bendDrag && ev.pointerId === bendDrag.id) return bendUp();
  if (selDrag && ev.pointerId === selDrag.id) return selectPointerUp();
  if (rotDrag && ev.pointerId === rotDrag.id) {
    rotDrag = null;
    return;
  }
  if (pen) pen.dragging = false;
  if (reshaping && ev.pointerId === reshaping.id) return reshapeUp();
  if (ev.pointerId !== pointerId || !edit) return;
  pointerId = null;
  clearTimeout(holdTimer);
  clearInterval(restTimer);
  compositor.endLive();
  lastHoldPos = null;
  const e = edit;
  edit = null;

  if (stroke) {
    let box: Rect | null;
    if (strokeSnap) {
      const s = strokeSnap;
      box = unionRect(unionRect(s.strokeBox, shapeBounds(s.shape, s.width, project.width, project.height)), stroke.bounds());
    } else {
      stroke.finish();
      syncVStroke();
      box = stroke.bounds();
    }
    if (e.layer.kind === 'vector') box = FULL;
    vStroke = null;
    commitEdit(e, box, strokeErases ? 'Erase' : 'Brush stroke', !strokeErases);
    stroke = null;
    strokeSnap = null;
  } else if (shapeStart) {
    const shape = shapePreview?.shape;
    shapePreview = null;
    shapeStart = null;
    if (!shape) return commitEdit(e, null, '', false);
    if (e.layer.kind === 'vector') {
      const id = e.key.drawingId;
      const item: VItem = { t: 'shape', shape, width: brush.size, color: brush.color, fill: fillShapes && shape.kind !== 'line', fillColor: backColor, m: IDENTITY };
      project.drawings.setItems(id, [...project.drawings.items(id), item]);
      commitEdit(e, FULL, TOOL_NAMES[tool], true);
      scheduleRender();
      return;
    }
    drawShape(e.canvas.getContext('2d')!, shape, {
      width: brush.size,
      color: brush.color,
      fill: fillShapes && shape.kind !== 'line',
      fillColor: backColor,
      eraser: false,
    });
    commitEdit(e, shapeBounds(shape, brush.size, project.width, project.height), TOOL_NAMES[tool], true);
  }
  scheduleRender();
}
view.addEventListener('pointerup', endPointer);
view.addEventListener('pointercancel', endPointer);

// ---------------------------------------------------------------- select / lasso / move tools
let selDrag: {
  id: number;
  mode: 'rect' | 'lasso' | 'transform' | 'click';
  start: P;
  points: P[];
  handle?: Handle;
  startFloat?: Floating;
  snap?: SnapTarget[];
} | null = null;

const dummyCanvas = document.createElement('canvas');
/** Treat a plain selection like an unmoved floating piece (so it gets handles too). */
function asFloating(sel: Selection): Floating {
  const b = sel.bounds;
  return { canvas: dummyCanvas, x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), tx: 0, ty: 0, sx: 1, sy: 1, rot: 0, outline: sel.points };
}

/** The piece with handles right now (moving pixels, or a plain selection). */
const handleTarget = (): Floating | null => floating ?? (selection ? asFloating(selection) : null);

const HANDLE_CURSORS: Record<Handle, string> = {
  move: 'move', rotate: 'grab', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
  nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize',
};

function hitAt(p: P): Handle | null {
  const t = handleTarget();
  const s = viewScale();
  return t ? hitHandle(t, p, 9 / s, 26 / s) : null;
}

function selectPointerDown(ev: PointerEvent): void {
  const p = toDoc(ev);
  let handle = hitAt(p);
  if (tool === 'move' && !handle) handle = 'move'; // the Move tool moves wherever you grab
  if (handle === 'move' && activeLayer().kind === 'vector') {
    // A click picks what's under the pen; only a real drag moves anything.
    selDrag = { id: ev.pointerId, mode: 'click', start: p, points: [] };
  } else if (handle) {
    if (!ensureFloating()) return;
    selDrag = { id: ev.pointerId, mode: 'transform', start: p, points: [], handle, startFloat: { ...floating! }, snap: handle === 'move' ? snapTargets(floating!) : undefined };
  } else {
    finishSelection(); // clicking outside: put down the old selection, start a new one
    selDrag = { id: ev.pointerId, mode: tool === 'lasso' ? 'lasso' : 'rect', start: p, points: [p] };
  }
  try {
    view.setPointerCapture(ev.pointerId);
  } catch {
    /* synthetic pointer */
  }
  scheduleRender();
}

function selectPointerMove(ev: PointerEvent): void {
  const p = toDoc(ev);
  if (!selDrag || ev.pointerId !== selDrag.id) {
    // just hovering: show what a drag would do
    const h = hitAt(p);
    view.style.cursor = h ? HANDLE_CURSORS[h] : tool === 'move' ? 'move' : 'crosshair';
    return;
  }
  if (selDrag.mode === 'click') {
    if (Math.hypot(p.x - selDrag.start.x, p.y - selDrag.start.y) * viewScale() < 3) return;
    if (!ensureFloating()) {
      selDrag = null;
      return;
    }
    selDrag = { ...selDrag, mode: 'transform', handle: 'move', startFloat: { ...floating! }, snap: snapTargets(floating!) };
  }
  if (selDrag.mode === 'transform' && floating && selDrag.startFloat) {
    const h = selDrag.handle!;
    const squash = ev.shiftKey && h !== 'rotate' && h !== 'move';
    dragHandle(floating, selDrag.startFloat, h, selDrag.start, p, { volume: squash, free: ev.altKey, snap: ev.shiftKey });
    if (squash) status('Squash and stretch: the size (volume) stays the same.');
    if (h === 'move') applySnap(floating, selDrag.snap ?? [], ev.ctrlKey);
  } else if (selDrag.mode === 'rect') {
    selectionDraft = rectSelection(selDrag.start, p, ev.shiftKey);
  } else if (selDrag.mode === 'lasso') {
    // use every pen sample, so the lasso follows your hand closely
    const samples = typeof ev.getCoalescedEvents === 'function' ? ev.getCoalescedEvents() : [];
    for (const e of samples.length ? samples : [ev]) {
      const q = toDoc(e);
      const last = selDrag.points[selDrag.points.length - 1];
      if (Math.hypot(q.x - last.x, q.y - last.y) > 1.5 / viewScale()) selDrag.points.push(q);
    }
    selectionDraft = polySelection(selDrag.points);
  }
  scheduleRender();
}

function selectPointerUp(): void {
  const d = selDrag!;
  selDrag = null;
  snapLines = {};
  if (d.mode === 'click') return clickPick(d.start);
  if (d.mode !== 'transform') {
    const draft = selectionDraft;
    selectionDraft = null;
    // a tiny drag or a click just clears the selection
    selection = draft && draft.bounds.w > 2 && draft.bounds.h > 2 ? draft : null;
    if (!selection && activeLayer().kind === 'vector') return clickPick(d.start);
    if (selection && activeLayer().kind === 'vector') {
      giveLayerUids(activeLayer());
      stylePick = null;
      const picked = pickItems(selection, showingItems());
      if (!picked.length) {
        selection = null;
        status('No lines inside that area. On a vector layer, circle part of a line to pick it.');
        scheduleRender();
        return;
      }
      selection = polySelection(floatFromItems(picked).outline);
      stylePick = new Set(picked.filter(canPick).map((it) => it.uid!));
    }
    if (selection) status('Selected. Drag inside to move it, use the handles to resize or rotate, Delete to erase, Ctrl+C to copy.');
  }
  scheduleRender();
}

// ---------------------------------------------------------------- change something already drawn
const canPick = (it: VItem) => it.t !== 'image' && !(it.t === 'stroke' && it.erase);
const hasLine = (it: VItem): it is VItem & { t: 'stroke' | 'shape' | 'bez' } => it.t === 'stroke' || it.t === 'shape' || it.t === 'bez';
const averageWidth = (it: VItem & { t: 'stroke' }) => it.pts.reduce((sum, q) => sum + q.w, 0) / Math.max(1, it.pts.length);

/** The drawn thing under this spot: lines first, then colour fills, then the inside of an empty shape. */
function itemAt(p: P): VItem | null {
  if (activeLayer().kind !== 'vector') return null;
  giveLayerUids(activeLayer());
  const items = showingItems().filter(canPick).reverse();
  const reach = 14 / viewScale();
  const inText = (it: VItem) => {
    if (it.t !== 'text') return false;
    const b = boundsOf(itemPoints(it));
    return p.x >= b.x && p.y >= b.y && p.x <= b.x + b.w && p.y <= b.y + b.h;
  };
  return (
    items.find((it) => it.t !== 'fill' && (hitItem(scratchCtx, it, p.x, p.y, reach) || inText(it))) ??
    items.find((it) => it.t === 'fill' && hitItem(scratchCtx, it, p.x, p.y)) ??
    items.find((it) => insideItem(scratchCtx, it, p.x, p.y)) ??
    null
  );
}

function clickPick(p: P): void {
  applyFloating();
  const hit = itemAt(p);
  selection = hit ? polySelection(floatFromItems([hit]).outline) : null;
  stylePick = hit ? new Set([hit.uid!]) : null;
  if (hit) status('Selected. Change its colour, width or line style on the right, or drag it to move it.');
  scheduleRender();
}

/** The picked things as they are stored on this frame's drawing. */
function pickedItems(): VItem[] {
  if (!stylePick || !(selection || floating)) return [];
  const key = activeLayer().track.active(frame);
  if (!key || activeLayer().kind !== 'vector') return [];
  // while it's being moved, the thing is lifted out of the drawing
  return [...project.drawings.items(key.drawingId), ...(floating?.items ?? [])].filter((it) => it.uid && stylePick!.has(it.uid));
}

let styleBefore: Map<string, VItem[]> | null = null; // the drawings before the change you're making now

/** Change the picked things on this drawing, or on every keyframe of a keyframe layer. */
function restyle(change: (it: VItem) => VItem): void {
  if (!stylePick) return;
  applyFloating();
  const layer = activeLayer();
  const key = layer.track.active(frame);
  if (!key) return;
  if (project.isLocked(layer)) return status('This layer is locked — unlock it in the Layer panel first.');
  const keys = bendKeys(layer, key);
  styleBefore ??= snapshotKeys(keys);
  for (const k of keys) {
    const start = styleBefore.get(k.drawingId);
    if (start) project.drawings.setItems(k.drawingId, start.map((it) => (it.uid && stylePick!.has(it.uid) ? change(it) : it)));
  }
  scheduleRender();
}

function styleDone(label: string): void {
  if (styleBefore) pushKeyEdit(label, activeLayer(), styleBefore);
  styleBefore = null;
}

const restyleColour = (c: string) => restyle((it) => ('color' in it ? ({ ...it, color: c } as VItem) : it));
const restyleInside = (c: string) => restyle((it) => ((it.t === 'shape' || it.t === 'bez') && it.fill ? { ...it, fillColor: c } : it));
const restyleLine = (style: LineStyle) => restyle((it) => (hasLine(it) ? ({ ...it, style } as VItem) : it));
function restyleWidth(width: number): void {
  const w = Math.max(1, Math.min(120, width || 1));
  restyle((it) => {
    if (it.t === 'shape' || it.t === 'bez') return { ...it, width: w };
    if (it.t !== 'stroke') return it;
    const scale = w / (averageWidth(it) || 1);
    return { ...it, pts: it.pts.map((q) => ({ ...q, w: Math.max(0.5, q.w * scale) })) };
  });
}

const ITEM_NAMES: Partial<Record<VItem['t'], string>> = { stroke: 'Line', shape: 'Shape', bez: 'Curve', text: 'Text', fill: 'Colour fill' };

/** Show the panel for what's selected. Left alone while you're in the middle of changing it. */
function updateStylePanel(): void {
  const items = pickedItems();
  $('style-card').hidden = !items.length;
  if (!items.length || styleBefore) return;
  const first = items[0];
  const lined = items.find(hasLine);
  const filled = items.find((it) => (it.t === 'shape' || it.t === 'bez') && it.fill) as (VItem & { fillColor: string }) | undefined;
  $('style-what').textContent = items.length > 1 ? `${items.length} things` : ITEM_NAMES[first.t] ?? 'Item';
  if ('color' in first) input('style-color').value = first.color;
  $('style-fill-row').hidden = !filled;
  if (filled) input('style-fill').value = filled.fillColor;
  $('style-width-row').hidden = $('style-line-row').hidden = !lined;
  if (lined) {
    const w = String(Math.round(lined.t === 'stroke' ? averageWidth(lined) : lined.width));
    input('style-width').value = input('style-width-num').value = w;
    $<HTMLSelectElement>('style-line').value = lined.style ?? 'solid';
  }
}

// ---------------------------------------------------------------- pen (curves) tool
let pen: { anchors: Anchor[]; dragging: boolean; hover: P | null } | null = null;

function penDown(ev: PointerEvent): void {
  const p = toDoc(ev);
  if (!pen) pen = { anchors: [], dragging: false, hover: null };
  const first = pen.anchors[0];
  if (first && pen.anchors.length > 1 && Math.hypot(p.x - first.x, p.y - first.y) < 10 / viewScale()) return finishPen(true);
  pen.anchors.push({ x: p.x, y: p.y, ix: p.x, iy: p.y, ox: p.x, oy: p.y });
  pen.dragging = true;
  try {
    view.setPointerCapture(ev.pointerId);
  } catch {
    /* synthetic pointer */
  }
  scheduleRender();
}

function penMove(ev: PointerEvent): void {
  if (!pen) return;
  const p = toDoc(ev);
  pen.hover = p;
  if (pen.dragging) {
    // dragging pulls out the curve handles, mirrored around the point
    const a = pen.anchors[pen.anchors.length - 1];
    a.ox = p.x;
    a.oy = p.y;
    a.ix = a.x * 2 - p.x;
    a.iy = a.y * 2 - p.y;
  }
  scheduleRender();
}

function finishPen(closed: boolean): void {
  const d = pen;
  pen = null;
  if (!d || d.anchors.length < 2) return scheduleRender();
  const e = beginEdit();
  if (!e) return;
  const fill = closed && fillShapes;
  if (e.layer.kind === 'vector') {
    const id = e.key.drawingId;
    const item: VItem = { t: 'bez', anchors: d.anchors, closed, width: brush.size, color: brush.color, fill, fillColor: backColor, m: IDENTITY };
    project.drawings.setItems(id, [...project.drawings.items(id), item]);
  } else {
    const ctx = e.canvas.getContext('2d')!;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.lineWidth = brush.size;
    ctx.strokeStyle = brush.color;
    ctx.fillStyle = backColor;
    const path = bezPath(d.anchors, closed);
    if (fill) ctx.fill(path);
    ctx.stroke(path);
    ctx.restore();
  }
  commitEdit(e, FULL, 'Pen', true);
  scheduleRender();
}

function drawPenDraft(scale: number): void {
  if (!pen) return;
  const c = viewCtx;
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = brush.size;
  c.lineCap = c.lineJoin = 'round';
  c.strokeStyle = brush.color;
  c.stroke(bezPath(pen.anchors, false));
  const last = pen.anchors[pen.anchors.length - 1];
  c.lineWidth = 1 / scale;
  c.strokeStyle = '#1f7ae0';
  if (last && pen.hover && !pen.dragging) {
    c.beginPath();
    c.moveTo(last.x, last.y);
    c.quadraticCurveTo(last.ox, last.oy, pen.hover.x, pen.hover.y);
    c.stroke();
  }
  if (last) {
    c.beginPath();
    c.moveTo(last.ix, last.iy);
    c.lineTo(last.ox, last.oy);
    c.stroke();
  }
  const r = 3.5 / scale;
  c.fillStyle = '#fff';
  for (const a of pen.anchors) {
    c.fillRect(a.x - r, a.y - r, r * 2, r * 2);
    c.strokeRect(a.x - r, a.y - r, r * 2, r * 2);
  }
  c.restore();
}

// ---------------------------------------------------------------- reshape tool (push lines like a magnet)
let reshaping: { id: number; e: Edit; last: P } | null = null;
const reshapeRadius = () => Math.max(10, num('reach'));

function reshapeDown(ev: PointerEvent): void {
  if (activeLayer().kind !== 'vector') return status('Reshape only works on vector layers, because bitmap layers are just pixels.');
  const e = beginEditKeepingPicture();
  if (!e) return;
  const id = e.key.drawingId;
  // Work on private copies, and turn plain shapes into curves that can bend.
  project.drawings.setItems(id, project.drawings.items(id).map((it): VItem => {
    if (it.t === 'stroke') return { ...it, pts: it.pts.map((q) => ({ ...q })) };
    if (it.t === 'bez') return { ...it, anchors: it.anchors.map((q) => ({ ...q })) };
    if (it.t === 'fill') return { ...it, loops: it.loops.map((l) => [...l]) };
    if (it.t === 'shape') {
      const b = toBezItem(it);
      return { ...b, anchors: b.anchors.map((q) => ({ ...q })) };
    }
    return it;
  }));
  reshaping = { id: ev.pointerId, e, last: toDoc(ev) };
  try {
    view.setPointerCapture(ev.pointerId);
  } catch {
    /* synthetic pointer */
  }
}

function reshapeMove(ev: PointerEvent): void {
  if (!reshaping || ev.pointerId !== reshaping.id) return;
  const p = toDoc(ev);
  const dx = p.x - reshaping.last.x;
  const dy = p.y - reshaping.last.y;
  reshaping.last = p;
  const r = reshapeRadius();
  for (const it of project.drawings.items(reshaping.e.key.drawingId)) {
    if (it.t !== 'stroke' && it.t !== 'bez' && it.t !== 'fill') continue;
    const inv = invert(it.m);
    const lx = inv[0] * dx + inv[2] * dy;
    const ly = inv[1] * dx + inv[3] * dy;
    let moved = false;
    // how strongly the pull reaches a point: 1 under the cursor, fading to 0 at the edge
    const pull = (x: number, y: number) => {
      const d = Math.hypot(it.m[0] * x + it.m[2] * y + it.m[4] - p.x, it.m[1] * x + it.m[3] * y + it.m[5] - p.y);
      if (d >= r) return 0;
      moved = true;
      return (1 - d / r) ** 2;
    };
    if (it.t === 'stroke') {
      for (const q of it.pts) {
        const k = pull(q.x, q.y);
        q.x += lx * k;
        q.y += ly * k;
      }
    } else if (it.t === 'bez') {
      for (const q of it.anchors) {
        const k = pull(q.x, q.y);
        q.x += lx * k;
        q.y += ly * k;
        q.ix += lx * k;
        q.iy += ly * k;
        q.ox += lx * k;
        q.oy += ly * k;
      }
    } else {
      for (const loop of it.loops) {
        for (let i = 0; i < loop.length; i += 2) {
          const k = pull(loop[i], loop[i + 1]);
          loop[i] += lx * k;
          loop[i + 1] += ly * k;
        }
      }
    }
    if (moved) touch(it);
  }
  scheduleRender();
}

function reshapeUp(): void {
  const r = reshaping!;
  reshaping = null;
  commitEdit(r.e, FULL, 'Reshape', true);
  scheduleRender();
}

// ---------------------------------------------------------------- snap into line while moving
interface SnapTarget {
  x: number;
  y: number;
  frame: number; // shown counting from 0; -1 = where the drag began
}
let snapEnabled = true;
let snapLines: { x?: number; y?: number } = {};

function centreOfBox(b: Rect): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The centre of what is being moved, as it looks on another frame. */
function centreOnFrame(layer: Layer, t: number, f: Floating): { x: number; y: number } | null {
  const key = layer.track.active(t);
  if (!key || !hasInk(key)) return null;
  if (layer.kind === 'vector') {
    const all = layer.motion ? sampleItems(layer, t, project.drawings) : project.drawings.items(key.drawingId);
    const ids = new Set((f.items ?? []).map((it) => it.uid).filter(Boolean));
    const same = all.filter((it) => it.uid && ids.has(it.uid));
    const points = (same.length ? same : all).flatMap(itemPoints);
    return points.length ? centreOfBox(boundsOf(points)) : null;
  }
  const canvas = project.drawings.get(key.drawingId);
  const box = canvas && contentBounds(canvas);
  return box ? centreOfBox(box) : null;
}

function snapTargets(f: Floating): SnapTarget[] {
  if (!snapEnabled) return [];
  const layer = activeLayer();
  const frames = new Set<number>();
  for (const pin of onion.pins) if (pin.layerId === layer.id && pin.frame !== frame) frames.add(pin.frame);
  if (layer.motion) {
    for (const t of motionTimes(layer)) if (t !== frame) frames.add(t);
  } else {
    // Frame-by-frame: the drawings either side, or every line would pull at you.
    const here = layer.track.activeTime(frame);
    if (here !== null) {
      const before = layer.track.prevTime(here);
      const after = layer.track.nextTime(here);
      if (before !== null) frames.add(before);
      if (after !== null) frames.add(after);
    }
  }
  const out: SnapTarget[] = [];
  for (const t of frames) {
    const c = centreOnFrame(layer, t, f);
    if (c) out.push({ ...c, frame: t });
  }
  // Last, so when they tie a real frame wins over the spot the drag began.
  out.push({ x: f.x + f.w / 2 + f.tx, y: f.y + f.h / 2 + f.ty, frame: -1 });
  return out;
}

/** Pull the moving piece's centre onto any close target, one direction at a time. */
function applySnap(f: Floating, targets: SnapTarget[], off: boolean): void {
  const before = snapLines;
  snapLines = {};
  if (off || !snapEnabled) return;
  const reach = 8 / viewScale();
  const cx = f.x + f.w / 2 + f.tx;
  const cy = f.y + f.h / 2 + f.ty;
  const nearest = (axis: 'x' | 'y', at: number) => {
    let best: SnapTarget | null = null;
    for (const t of targets) {
      if (Math.abs(t[axis] - at) <= reach && (!best || Math.abs(t[axis] - at) < Math.abs(best[axis] - at) - 0.01)) best = t;
    }
    return best;
  };
  const hitX = nearest('x', cx);
  const hitY = nearest('y', cy);
  if (hitX) {
    f.tx += hitX.x - cx;
    snapLines.x = hitX.x;
  }
  if (hitY) {
    f.ty += hitY.y - cy;
    snapLines.y = hitY.y;
  }
  const hit = hitX && hitX.frame >= 0 ? hitX : hitY && hitY.frame >= 0 ? hitY : hitX ?? hitY;
  if (hit && (snapLines.x !== before.x || snapLines.y !== before.y)) {
    const what = hitX && hitY && hitX.frame === hitY.frame ? 'Exactly on' : hit === hitX ? 'Straight up and down from' : 'Level with';
    status(hit.frame < 0 ? `${what} where it started. Hold Ctrl to move freely.` : `${what} frame ${hit.frame + 1}. Hold Ctrl to move freely.`);
  }
}

function drawSnapGuides(scale: number): void {
  if (snapLines.x === undefined && snapLines.y === undefined) return;
  const c = viewCtx;
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.strokeStyle = '#ff2fa8';
  c.lineWidth = 1.5 / scale;
  c.beginPath();
  if (snapLines.x !== undefined) {
    c.moveTo(snapLines.x, 0);
    c.lineTo(snapLines.x, project.height);
  }
  if (snapLines.y !== undefined) {
    c.moveTo(0, snapLines.y);
    c.lineTo(project.width, snapLines.y);
  }
  c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- onion skin pinned to a frame
let rightClicked: { frame: number; layerId: string; returnTo: number } | null = null;
const PIN_PURPLE = '#9b5cff';
const PIN_GRAY = '#808794';

const pinAt = (layerId: string, f: number) => onion.pins.find((p) => p.layerId === layerId && p.frame === f);

function showPin(layerId: string, f: number): void {
  if (!pinAt(layerId, f)) onion.pins.push({ layerId, frame: f, color: PIN_PURPLE, opacity: 0.5 });
  onion.pins.sort((a, b) => a.frame - b.frame);
  renderPinList();
  scheduleRender();
}

function hidePin(pin: OnionPin): void {
  onion.pins = onion.pins.filter((p) => p !== pin);
  renderPinList();
  scheduleRender();
}

function colourPin(pin: OnionPin, color: string): void {
  pin.color = color;
  renderPinList();
  scheduleRender();
}

/** The panel's list of pinned frames, each with its own colour and strength. */
function renderPinList(): void {
  const box = $('onion-pins');
  box.textContent = '';
  onion.pins = onion.pins.filter((p) => project.layers.some((l) => l.id === p.layerId));
  if (!onion.pins.length) {
    const hint = document.createElement('div');
    hint.className = 'pin-empty';
    hint.textContent = 'To keep a frame visible, right-click it on the timeline and choose Show Onion Skin.';
    box.append(hint);
    return;
  }
  const manyLayers = project.layers.length > 1;
  for (const pin of onion.pins) {
    const row = document.createElement('div');
    row.className = 'pin-row';
    const name = document.createElement('span');
    const layerName = project.layers.find((l) => l.id === pin.layerId)?.name;
    name.textContent = `Frame ${pin.frame + 1}`;
    name.title = manyLayers ? `Frame ${pin.frame + 1} on ${layerName}` : `Frame ${pin.frame + 1}`;
    const color = document.createElement('input');
    color.type = 'color';
    color.value = pin.color;
    color.dataset.pin = `${pin.layerId}:${pin.frame}`;
    color.title = 'Colour of this ghost';
    color.oninput = () => {
      pin.color = color.value;
      scheduleRender();
    };
    const strength = document.createElement('input');
    strength.type = 'range';
    strength.min = '10';
    strength.max = '100';
    strength.value = String(Math.round(pin.opacity * 100));
    strength.title = 'How strong this ghost looks';
    strength.oninput = () => {
      pin.opacity = Number(strength.value) / 100;
      scheduleRender();
    };
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Hide this onion skin';
    close.onclick = () => hidePin(pin);
    row.append(name, color, strength, close);
    box.append(row);
  }
}

/** The right-click menu's onion skin entries; the playhead goes back to where you were working. */
function pinMenuItems(): MenuItem[] {
  const target = rightClicked ?? { frame, layerId: activeLayerId, returnTo: frame };
  const layer = project.layers.find((l) => l.id === target.layerId) ?? activeLayer();
  const back = () => goTo(target.returnTo);
  const pin = pinAt(layer.id, target.frame);
  if (!pin) {
    return [
      {
        label: 'Show Onion Skin',
        disabled: !hasInk(layer.track.active(target.frame)),
        action: () => {
          showPin(layer.id, target.frame);
          back();
          status(`Frame ${target.frame + 1} now shows as a ghost on every other frame. Change its colour in the Onion skin panel.`);
        },
      },
      'separator',
    ];
  }
  return [
    { label: 'Hide Onion Skin', action: () => { hidePin(pin); back(); } },
    { label: 'Onion colour: purple', disabled: pin.color === PIN_PURPLE, action: () => { colourPin(pin, PIN_PURPLE); back(); } },
    { label: 'Onion colour: gray', disabled: pin.color === PIN_GRAY, action: () => { colourPin(pin, PIN_GRAY); back(); } },
    {
      label: 'Choose onion colour…',
      action: () => {
        back();
        document.querySelector<HTMLInputElement>(`input[data-pin="${pin.layerId}:${pin.frame}"]`)?.click();
      },
    },
    'separator',
  ];
}

// ---------------------------------------------------------------- bend points
type BendFind = { kind: 'node' | 'in' | 'out' | 'line'; uid: number; node: number; seg: number; t: number; x: number; y: number; count: number };
interface BendLive {
  layer: Layer;
  e: Edit;
  before: Map<string, VItem[]>;
  item: Bendable;
  orig: NodeCopy;
  weights: Float32Array;
  glue: Glue[];
}
interface BendDrag {
  id: number;
  start: P;
  find: BendFind;
  live: BendLive | null;
}
let bendSel: { uid: number; node: number } | null = null;
let bendHover: BendFind | null = null;
let bendDrag: BendDrag | null = null;
let bendCache = new WeakMap<VItem, Bendable>();

function bendable(it: VItem): Bendable | null {
  let b = bendCache.get(it);
  if (b) return b;
  const made = toBendable(it);
  if (made) bendCache.set(it, made);
  return made;
}

function bendCandidates(): Bendable[] {
  const layer = activeLayer();
  if (layer.kind !== 'vector') return [];
  giveLayerUids(layer);
  return showingItems().map(bendable).filter((b): b is Bendable => !!b && !!b.uid);
}

function bendFind(x: number, y: number): BendFind | null {
  const nodeReach = 10 / viewScale();
  const lineReach = 8 / viewScale();
  const all = bendCandidates();
  const selected = bendSel ? all.find((it) => it.uid === bendSel!.uid) : undefined;
  const near = (p: { x: number; y: number }, m: Bendable['m']) => Math.hypot(m[0] * p.x + m[2] * p.y + m[4] - x, m[1] * p.x + m[3] * p.y + m[5] - y) <= nodeReach;
  const found = (kind: BendFind['kind'], it: Bendable, node: number, seg = 0, t = 0): BendFind => ({ kind, uid: it.uid!, node, seg, t, x, y, count: nodesOf(it).length });
  if (selected?.t === 'bez' && bendSel) {
    const a = selected.anchors[bendSel.node];
    if (a && !a.corner) {
      if (near({ x: a.ox, y: a.oy }, selected.m)) return found('out', selected, bendSel.node);
      if (near({ x: a.ix, y: a.iy }, selected.m)) return found('in', selected, bendSel.node);
    }
  }
  const order = selected ? [selected, ...[...all].reverse().filter((it) => it !== selected)] : [...all].reverse();
  for (const it of order) {
    const nodes = nodesOf(it);
    const c = controlsOf(it).find((i) => near(nodes[i], it.m));
    if (c !== undefined && (it === selected || (nearestOn(it, x, y)?.dist ?? Infinity) <= lineReach)) return found('node', it, c);
    const h = nearestOn(it, x, y);
    if (h && h.dist <= lineReach) return { ...found('line', it, -1, h.seg, h.t), x: h.x, y: h.y };
  }
  return null;
}

/** The keyframes that must stay in step when a point is added, removed or changed. */
function bendKeys(layer: Layer, key: RasterKey): RasterKey[] {
  if (!layer.motion) return [key];
  const keys = motionTimes(layer).map((t) => layer.track.get(t)!);
  return keys.includes(key) ? keys : [...keys, key];
}

function makeBendable(key: RasterKey, uid: number): void {
  project.drawings.setItems(key.drawingId, project.drawings.items(key.drawingId).map((it) => (it.uid === uid ? toBendable(it) ?? it : it)));
}

const bendItemIn = (key: RasterKey, uid: number) => project.drawings.items(key.drawingId).find((it): it is Bendable => it.uid === uid && (it.t === 'stroke' || it.t === 'bez'));

function startBend(d: BendDrag): boolean {
  const layer = activeLayer();
  const e = beginEditKeepingPicture();
  if (!e) return false;
  const keys = bendKeys(layer, e.key);
  const before = snapshotKeys(keys);
  before.set(e.key.drawingId, e.beforeItems);
  for (const k of keys) makeBendable(k, d.find.uid);
  if (d.find.kind === 'line') {
    // The same point goes on every keyframe, so they can still blend into each other.
    for (const k of keys) {
      const it = bendItemIn(k, d.find.uid);
      if (it && nodesOf(it).length === d.find.count) {
        const index = addPoint(it, d.find.seg, d.find.t);
        if (k === e.key) d.find.node = index;
      }
    }
    d.find.kind = 'node';
  }
  // The edge of any colour under this line travels with it, on a private copy.
  project.drawings.setItems(e.key.drawingId, project.drawings.items(e.key.drawingId).map((it) => (it.t === 'fill' ? { ...it, loops: it.loops.map((l) => [...l]) } : it)));
  const item = bendItemIn(e.key, d.find.uid);
  if (!item) {
    commitEdit(e, null, '', false);
    return false;
  }
  bendSel = { uid: d.find.uid, node: d.find.node };
  const weights = bendWeights(item, d.find.node);
  const fills = project.drawings.items(e.key.drawingId).filter((it): it is VItem & { t: 'fill' } => it.t === 'fill');
  d.live = { layer, e, before, item, orig: copyNodes(item), weights, glue: glueFills(item, fills, weights) };
  return true;
}

function bendDown(ev: PointerEvent): void {
  if (activeLayer().kind !== 'vector') return status('Bend points work on vector layers, because bitmap layers are just pixels.');
  const p = toDoc(ev);
  const find = bendFind(p.x, p.y);
  if (!find) {
    bendSel = null;
    scheduleRender();
    return;
  }
  try {
    view.setPointerCapture(ev.pointerId);
  } catch {
    /* synthetic pointer */
  }
  bendDrag = { id: ev.pointerId, start: p, find, live: null };
  if (find.kind === 'line') {
    if (!startBend(bendDrag)) bendDrag = null;
  } else {
    bendSel = { uid: find.uid, node: find.node };
  }
  bendHover = null;
  scheduleRender();
}

function bendMove(ev: PointerEvent): void {
  const p = toDoc(ev);
  if (bendDrag) {
    if (ev.pointerId !== bendDrag.id) return;
    const d = bendDrag;
    if (!d.live) {
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * viewScale() < 3) return;
      if (!startBend(d)) {
        bendDrag = null;
        return;
      }
    }
    const { item, orig, weights, glue } = d.live!;
    if (item.t === 'bez' && (d.find.kind === 'in' || d.find.kind === 'out')) {
      const a = item.anchors[d.find.node];
      const q = apply(invert(item.m), p.x, p.y);
      const mirror = !ev.altKey;
      a.manual = true;
      if (d.find.kind === 'out') {
        a.ox = q.x;
        a.oy = q.y;
        if (mirror) {
          a.ix = 2 * a.x - q.x;
          a.iy = 2 * a.y - q.y;
        }
      } else {
        a.ix = q.x;
        a.iy = q.y;
        if (mirror) {
          a.ox = 2 * a.x - q.x;
          a.oy = 2 * a.y - q.y;
        }
      }
      touch(item);
    } else {
      const worldX = p.x - d.start.x;
      const worldY = p.y - d.start.y;
      const local = localDelta(item.m, worldX, worldY);
      applyBend(item, orig, weights, local.x, local.y);
      applyGlue(glue, worldX, worldY);
    }
    scheduleRender();
    return;
  }
  const h = bendFind(p.x, p.y);
  const same = h?.kind === bendHover?.kind && h?.uid === bendHover?.uid && h?.node === bendHover?.node && h?.kind !== 'line';
  bendHover = h;
  view.style.cursor = h ? 'pointer' : '';
  if (!same) scheduleRender();
}

function bendUp(): void {
  const d = bendDrag!;
  bendDrag = null;
  bendCache = new WeakMap();
  if (d.live) pushKeyEdit('Bend', d.live.layer, d.live.before, d.live.e.created);
  scheduleRender();
}

/** Change a point on this keyframe and all the others in step with it, as one undo. */
function changePoint(label: string, uid: number, change: (it: Bendable) => void): void {
  const layer = activeLayer();
  const key = layer.track.active(frame);
  if (!key) return;
  if (project.isLocked(layer)) return status('This layer is locked — unlock it in the Layer panel first.');
  const keys = bendKeys(layer, key);
  const before = snapshotKeys(keys);
  for (const k of keys) {
    makeBendable(k, uid);
    const it = bendItemIn(k, uid);
    if (it) {
      change(it);
      touch(it);
    }
  }
  pushKeyEdit(label, layer, before);
  bendCache = new WeakMap();
  scheduleRender();
}

const bendTarget = () => (bendHover?.kind === 'node' ? { uid: bendHover.uid, node: bendHover.node } : bendSel);

function bendRemovePoint(): void {
  const target = bendTarget();
  if (!target) return;
  const it = bendCandidates().find((i) => i.uid === target.uid);
  if (!it) return;
  const closed = it.t === 'bez' && it.closed;
  const last = nodesOf(it).length - 1;
  if (!closed && (target.node === 0 || target.node === last)) return status("The two ends of a line stay as points, so they can't be removed.");
  if (closed && controlsOf(it).length <= 2) return status('A closed shape needs at least two points.');
  changePoint('Remove point', target.uid, (x) => {
    const q = nodesOf(x)[target.node] as Anchor | undefined;
    if (q) {
      q.ctrl = false;
      q.manual = false;
    }
  });
  bendSel = null;
  bendHover = null;
  status('Point removed. The line keeps its shape.');
}

function bendSetCorner(target: { uid: number; node: number }, corner: boolean): void {
  changePoint(corner ? 'Make point sharp' : 'Make point smooth', target.uid, (x) => {
    const q = nodesOf(x)[target.node] as Anchor | undefined;
    if (!q) return;
    q.corner = corner;
    if (x.t !== 'bez') return;
    q.manual = false;
    if (corner) {
      q.ix = q.ox = q.x;
      q.iy = q.oy = q.y;
    }
    autoHandles(x.anchors, x.closed);
  });
}

function bendToggle(ev: MouseEvent): void {
  const p = toDoc(ev);
  const find = bendFind(p.x, p.y);
  if (find?.kind !== 'node') return;
  const it = bendCandidates().find((i) => i.uid === find.uid);
  if (!it) return;
  const corner = !nodesOf(it)[find.node].corner;
  bendSetCorner(find, corner);
  bendSel = { uid: find.uid, node: find.node };
  status(corner ? 'Sharp point: lines meet at a peak.' : 'Smooth point: the line curves through it.');
}

function drawBendPoints(scale: number): void {
  const layer = activeLayer();
  if (layer.kind !== 'vector') return;
  const ids = new Set([bendSel?.uid, bendHover?.uid]);
  const c = viewCtx;
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = 1.5 / scale;
  for (const shown of showingItems()) {
    if (!shown.uid || !ids.has(shown.uid)) continue;
    const it = toBendable(shown);
    if (!it) continue;
    const at = (x: number, y: number) => apply(it.m, x, y);
    c.strokeStyle = '#1f7ae0';
    if (it.t === 'stroke') {
      c.beginPath();
      it.pts.forEach((q, i) => {
        const w = at(q.x, q.y);
        if (i) c.lineTo(w.x, w.y);
        else c.moveTo(w.x, w.y);
      });
      c.stroke();
    } else {
      const placed = new Path2D();
      placed.addPath(bezPath(it.anchors, it.closed), new DOMMatrix(it.m));
      c.stroke(placed);
    }
    const nodes = nodesOf(it);
    for (const i of controlsOf(it)) {
      const w = at(nodes[i].x, nodes[i].y);
      const on = bendSel?.uid === it.uid && bendSel?.node === i;
      const r = (on ? 6 : 5) / scale;
      c.fillStyle = on ? '#1f7ae0' : '#fff';
      c.beginPath();
      if (nodes[i].corner) c.rect(w.x - r, w.y - r, r * 2, r * 2);
      else c.arc(w.x, w.y, r, 0, Math.PI * 2);
      c.fill();
      c.stroke();
    }
    const sel = bendSel && bendSel.uid === it.uid && it.t === 'bez' ? it.anchors[bendSel.node] : undefined;
    if (sel && !sel.corner) {
      for (const [hx, hy] of [[sel.ix, sel.iy], [sel.ox, sel.oy]]) {
        const a = at(sel.x, sel.y);
        const h = at(hx, hy);
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.lineTo(h.x, h.y);
        c.stroke();
        c.fillStyle = '#1f7ae0';
        c.beginPath();
        c.arc(h.x, h.y, 4 / scale, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  if (bendHover?.kind === 'line' && !bendDrag) {
    c.fillStyle = 'rgba(31,122,224,0.45)';
    c.strokeStyle = '#1f7ae0';
    c.beginPath();
    c.arc(bendHover.x, bendHover.y, 5 / scale, 0, Math.PI * 2);
    c.fill();
    c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------- rotate view, grid and safe area
let rotDrag: { id: number; angle: number } | null = null;

function pointerAngle(ev: PointerEvent): number {
  const r = $('stage').getBoundingClientRect();
  return Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2));
}

function drawGuides(scale: number): void {
  if (!showGrid && !showSafe) return;
  const c = viewCtx;
  const { width: w, height: h } = project;
  c.save();
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = 1 / scale;
  if (showGrid) {
    c.strokeStyle = 'rgba(31,122,224,0.28)';
    c.beginPath();
    for (let x = 80; x < w; x += 80) {
      c.moveTo(x, 0);
      c.lineTo(x, h);
    }
    for (let y = 80; y < h; y += 80) {
      c.moveTo(0, y);
      c.lineTo(w, y);
    }
    c.stroke();
  }
  if (showSafe) {
    c.strokeStyle = 'rgba(255,90,90,0.75)';
    c.setLineDash([8 / scale, 6 / scale]);
    c.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9); // action safe
    c.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8); // title safe
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(w / 2 - 14 / scale, h / 2);
    c.lineTo(w / 2 + 14 / scale, h / 2);
    c.moveTo(w / 2, h / 2 - 14 / scale);
    c.lineTo(w / 2, h / 2 + 14 / scale);
    c.stroke();
  }
  c.restore();
}

// ---------------------------------------------------------------- text tool
let textBox: { el: HTMLTextAreaElement; at: P } | null = null;

function textFont(sizePx: number): string {
  const bold = input('font-bold').checked ? 'bold ' : '';
  return `${bold}${sizePx}px ${$<HTMLSelectElement>('font-family').value}`;
}

function startText(ev: PointerEvent): void {
  if (textBox) return commitText();
  const at = toDoc(ev);
  const size = Math.max(8, num('font-size'));
  const el = document.createElement('textarea');
  el.className = 'text-entry';
  el.rows = 1;
  el.style.left = `${ev.clientX}px`;
  el.style.top = `${ev.clientY}px`;
  el.style.font = textFont(size * viewScale());
  el.style.color = brush.color;
  document.body.appendChild(el);
  textBox = { el, at };
  const grow = () => {
    el.style.width = '0px';
    el.style.height = '0px';
    el.style.width = `${el.scrollWidth + 8}px`;
    el.style.height = `${el.scrollHeight}px`;
  };
  grow();
  el.addEventListener('input', grow);
  el.addEventListener('keydown', (e) => {
    e.stopPropagation(); // typing must not trigger shortcuts
    if (e.key === 'Escape') cancelText();
    else if (e.key === 'Enter' && e.ctrlKey) commitText();
  });
  el.addEventListener('blur', () => commitText());
  setTimeout(() => el.focus(), 0);
}

function cancelText(): void {
  const t = textBox;
  textBox = null;
  t?.el.remove();
}

/** Paint the typed text into the drawing. */
function commitText(): void {
  const t = textBox;
  if (!t) return;
  textBox = null;
  const text = t.el.value;
  t.el.remove();
  if (!text.trim()) return;
  const e = beginEdit();
  if (!e) return;
  const size = Math.max(8, num('font-size'));
  if (e.layer.kind === 'vector') {
    const lines = text.split('\n');
    scratchCtx.font = textFont(size);
    const w = Math.max(...lines.map((l) => scratchCtx.measureText(l).width));
    const id = e.key.drawingId;
    const item: VItem = { t: 'text', x: t.at.x, y: t.at.y, lines, font: textFont(size), size, color: brush.color, w, m: IDENTITY };
    project.drawings.setItems(id, [...project.drawings.items(id), item]);
    commitEdit(e, FULL, 'Text', true);
    scheduleRender();
    return;
  }
  const ctx = e.canvas.getContext('2d')!;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.font = textFont(size);
  ctx.fillStyle = brush.color;
  ctx.textBaseline = 'top';
  const lines = text.split('\n');
  let widest = 0;
  lines.forEach((line, i) => {
    ctx.fillText(line, t.at.x, t.at.y + i * size * 1.2);
    widest = Math.max(widest, ctx.measureText(line).width);
  });
  ctx.restore();
  const x = Math.max(0, Math.floor(t.at.x - 4));
  const y = Math.max(0, Math.floor(t.at.y - 4));
  const w = Math.min(project.width - x, Math.ceil(widest + 12));
  const h = Math.min(project.height - y, Math.ceil(lines.length * size * 1.2 + 12));
  commitEdit(e, w > 0 && h > 0 ? { x, y, w, h } : null, 'Text', true);
  scheduleRender();
}

// ---------------------------------------------------------------- right-click menus
function frameMenuItems(onTimeline: boolean): MenuItem[] {
  if (onTimeline) {
    const r = multiRange();
    const block: MenuItem[] = [];
    if (r) {
      block.push(
        { label: `Copy ${r.to - r.from + 1} frames`, shortcut: 'Ctrl+C', action: () => void copyFrames() },
        { label: 'Cut frames', shortcut: 'Ctrl+X', action: cutFrames },
        { label: 'Reverse these frames', action: reverseFrames },
        { label: 'Clear these frames', shortcut: 'Delete', action: clearFrames },
      );
    }
    if (frameClip) {
      block.push(
        { label: `Paste ${frameClip.span} frames`, shortcut: 'Ctrl+V', action: () => pasteFrames(false) },
        { label: `Paste ${frameClip.span} frames reversed`, shortcut: 'Ctrl+Shift+V', action: () => pasteFrames(true) },
      );
    }
    block.push({ label: 'Select all frames', action: selectAllFrames }, 'separator');
    return [...pinMenuItems(), fillToItem(), 'separator', ...block, ...singleFrameItems(onTimeline)];
  }
  return singleFrameItems(onTimeline);
}

function fillToItem(): MenuItem {
  const target = rightClicked ?? { frame, layerId: activeLayerId, returnTo: frame };
  const layer = project.layerById(target.layerId) ?? activeLayer();
  return { label: 'Fill to…', action: () => void fillTo(layer, target.frame), disabled: !hasInk(layer.track.active(target.frame)) || target.frame >= project.length - 1 };
}

/** Keep the drawing on this frame on screen up to a frame you choose. */
async function fillTo(layer: Layer, from: number): Promise<void> {
  if (project.isLocked(layer)) return status('This layer is locked. Unlock it first.');
  const end = await askNumber('Fill to frame', `The drawing on frame ${from + 1} will stay on screen up to the frame you choose.`, project.length, from + 2, project.length, 'Fill');
  if (end === null) return;
  const last = end - 1;
  const covered = layer.track.allTimes().filter((t) => t > from && t <= last);
  const drawings = covered.filter((t) => hasInk(layer.track.get(t))).length;
  if (drawings) {
    const go = await askChoice(`Replace ${drawings} ${drawings === 1 ? 'drawing' : 'drawings'}?`, `Frames ${from + 2} to ${end} already have ${drawings === 1 ? 'a drawing' : 'drawings'}. Filling removes ${drawings === 1 ? 'it' : 'them'}. You can undo this.`, [
      { label: 'Cancel', value: false },
      { label: 'Replace and fill', value: true, primary: true },
    ]);
    if (!go) return;
  }
  const removed = covered.map((t) => [t, layer.track.get(t)!] as const);
  const stop: RasterKey | null = last + 1 < project.length && !layer.track.has(last + 1) ? { drawingId: project.drawings.create(), origin: 'drawn' } : null;
  history.run({
    label: 'Fill to frame',
    redo: () => {
      removed.forEach(([t]) => layer.track.delete(t));
      if (stop) layer.track.set(last + 1, stop);
    },
    undo: () => {
      if (stop) layer.track.delete(last + 1);
      removed.forEach(([t, k]) => layer.track.set(t, k));
    },
  });
  status(`Frame ${from + 1}'s drawing now stays on screen through frame ${end}.`);
}

function singleFrameItems(onTimeline: boolean): MenuItem[] {
  const layer = activeLayer();
  const startsHere = layer.track.get(frame);
  const showing = hasInk(layer.track.active(frame));
  const items: MenuItem[] = [];
  if (onTimeline) {
    items.push(
      { label: 'New drawing', shortcut: 'K', action: newBlankKey, disabled: !!startsHere },
      'separator',
    );
  }
  items.push(
    { label: 'Copy drawing', shortcut: 'Ctrl+C', action: () => void copyDrawing(), disabled: !showing },
    { label: 'Cut drawing', shortcut: 'Ctrl+X', action: cutDrawing, disabled: !hasInk(startsHere) },
    { label: 'Paste drawing', shortcut: 'Ctrl+V', action: pasteDrawing, disabled: !clipboard },
    { label: 'Duplicate previous drawing here', shortcut: 'D', action: duplicateHere, disabled: hasInk(startsHere) || !previousInk(layer, frame) },
    'separator',
    { label: 'Clear this drawing', action: clearDrawing, disabled: !showing },
  );
  if (onTimeline) {
    items.push(
      { label: 'Remove drawing', shortcut: 'Delete', action: deleteKey, disabled: !startsHere },
      'separator',
      { label: 'Longer (one more frame)', shortcut: '+', action: holdAdd },
      { label: 'Shorter (one frame less)', shortcut: '−', action: holdRemove },
    );
  }
  return items;
}

function canvasMenuItems(): MenuItem[] {
  return [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: () => undo() },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: () => redo() },
    'separator',
    ...(tool === 'points' && bendTarget()
      ? ([
          { label: 'Remove this point', shortcut: 'Delete', action: bendRemovePoint },
          { label: 'Make this point sharp', action: () => bendSetCorner(bendTarget()!, true) },
          { label: 'Make this point smooth', action: () => bendSetCorner(bendTarget()!, false) },
          'separator',
        ] as MenuItem[])
      : []),
    ...(hasSelection()
      ? ([
          { label: 'Apply move / resize', shortcut: 'Enter', action: applyFloating, disabled: !floating },
          { label: 'Cancel move / resize', shortcut: 'Esc', action: cancelFloating, disabled: !floating },
          { label: 'Flip left–right', action: () => flipSelection(true) },
          { label: 'Flip upside down', action: () => flipSelection(false) },
          { label: 'Delete selected part', shortcut: 'Delete', action: deleteSelection },
          { label: 'Deselect', shortcut: 'Ctrl+D', action: finishSelection },
          'separator',
        ] as MenuItem[])
      : ([{ label: 'Select all', shortcut: 'Ctrl+A', action: selectAll }, 'separator'] as MenuItem[])),
    ...frameMenuItems(false),
    'separator',
    { label: 'Brush', shortcut: 'B', action: () => setTool('brush') },
    { label: 'Eraser', shortcut: 'E', action: () => setTool('eraser') },
    { label: 'Fill bucket', shortcut: 'G', action: () => setTool('fill') },
    { label: 'Colour picker', shortcut: 'I', action: () => setTool('picker') },
    'separator',
    { label: 'Fit to window', shortcut: 'Ctrl+0', action: () => viewport.fit() },
    { label: 'Show at 100%', shortcut: 'Ctrl+1', action: () => viewport.setZoom(1) },
  ];
}

function layerMenuItems(id: string): MenuItem[] {
  const layer = project.layerById(id)!;
  const i = project.layers.indexOf(layer);
  return [
    { label: 'Rename layer', action: () => renameLayer(id) },
    { label: 'Duplicate layer', action: duplicateLayer },
    { label: 'Move up', action: () => moveLayer(1), disabled: i === project.layers.length - 1 },
    { label: 'Move down', action: () => moveLayer(-1), disabled: i === 0 },
    { label: layer.visible ? 'Hide layer' : 'Show layer', action: () => { layer.visible = !layer.visible; scheduleRender(true); } },
    'separator',
    { label: layer.locked ? 'Unlock layer' : 'Lock layer', action: () => toggleLock(id) },
    { label: 'Layer colour…', action: () => pickLayerColour(layer) },
    ...project.layers.filter((l) => l.folder && l.id !== layer.parent).reverse().map((f) => ({ label: `Move into ${f.name}`, action: () => dropLayer(id, f.id, 'into') })),
    ...(layer.parent ? [{ label: 'Take out of folder', action: () => takeOutOfFolder(layer) }] : []),
    { label: layer.motion ? 'Turn off keyframes' : 'Turn on keyframes', action: () => toggleMotion(id), disabled: layer.reference },
    { label: 'Convert to bitmap', action: () => convertToBitmap(id), disabled: layer.kind === 'bitmap' || layer.motion || layer.reference },
    'separator',
    { label: 'New vector layer', action: () => addLayer('vector') },
    { label: 'New bitmap layer', action: () => addLayer('bitmap') },
    { label: 'Import reference picture…', action: () => input('ref-file').click() },
    { label: 'Delete layer', action: () => deleteLayer(id), disabled: realLayerCount() <= 1 },
  ];
}

function folderMenuItems(id: string): MenuItem[] {
  const folder = project.layerById(id)!;
  return [
    { label: 'Rename folder', action: () => renameLayer(id) },
    { label: folder.open ? 'Close folder' : 'Open folder', action: () => flipLayer(id, 'open') },
    { label: folder.visible ? 'Hide folder' : 'Show folder', action: () => flipFolderShown(folder) },
    { label: folder.locked ? 'Unlock folder' : 'Lock folder', action: () => toggleLock(id) },
    'separator',
    { label: 'New folder', action: newFolder },
    { label: 'Delete folder', action: () => void deleteSelected() },
  ];
}

function flipFolderShown(folder: Layer): void {
  folder.visible = !folder.visible;
  scheduleRender(true);
}

$('stage').addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  if (pointerId !== null) return;
  const p = toDoc(ev);
  const change: MenuItem[] = itemAt(p)
    ? [{ label: 'Change colour, width, line style', action: () => { setTool('move'); clickPick(p); } }, 'separator']
    : [];
  showMenu(ev.clientX, ev.clientY, [...change, ...canvasMenuItems()]);
});
// No browser menu anywhere else (text boxes keep theirs for copy/paste of text).
document.addEventListener('contextmenu', (ev) => {
  if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
});

// ---------------------------------------------------------------- tools and options
function setTool(t: Tool): void {
  const slot = slots.find((s) => s.tools.includes(t));
  if (slot) {
    slot.current = t;
    drawSlot(slot);
  }
  if (textBox) commitText();
  if (pen && t !== 'pen') finishPen(false);
  const wasSelect = isSelectTool();
  tool = t;
  // leaving the selection tools puts the selection down (painting isn't limited to it yet)
  if (wasSelect && !isSelectTool()) finishSelection();
  bendSel = null;
  bendHover = null;
  view.style.cursor = '';
  scheduleRender();
  document.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  document.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => {
    el.hidden = !el.dataset.for!.split(' ').includes(t);
  });
  $('tool-name').textContent = TOOL_NAMES[t];
  $('size-label').textContent = isShapeTool() ? 'Line width' : 'Size';
  view.classList.toggle('round', isPaintTool());
  view.classList.toggle('cross', isShapeTool() || t === 'fill' || t === 'pen' || t === 'text' || t === 'points');
  view.classList.toggle('picker', t === 'picker');
  view.classList.toggle('grab', t === 'hand' || t === 'rotview');
  if (!isPaintTool() && t !== 'reshape') cursor.hide();
}

function setSize(n: number): void {
  brush.size = Math.max(1, Math.min(120, Math.round(n) || 1));
  input('size').value = input('size-num').value = String(brush.size);
}

function setOnion(enabled: boolean): void {
  onion.enabled = enabled;
  input('onion').checked = enabled;
  scheduleRender();
}

let colourPanel: ColourPanel | null = null;

function setColor(c: string): void {
  brush.color = c;
  colourPanel?.set(c);
  input('color').value = c;
  input('color-front').value = c;
}

function setBackColor(c: string): void {
  backColor = c;
  input('color-back').value = c;
}

function swapColors(): void {
  const f = brush.color;
  setColor(backColor);
  setBackColor(f);
}

const num = (id: string) => Number(input(id).value);

const tip = Object.assign(document.createElement('div'), { id: 'tip', hidden: true });

// One column of tools. A slot holding several tools opens a drop-down on right-click or a long press.
const TOOL_SLOTS: (Tool[] | null)[] = [
  ['move', 'points', 'reshape'],
  ['select', 'lasso'],
  null,
  ['brush'],
  ['eraser'],
  ['pen'],
  ['text'],
  ['fill'],
  ['picker'],
  null,
  ['line'],
  ['rect', 'ellipse', 'poly'],
  null,
  ['hand', 'rotview', 'zoom'],
];
const TOOL_KEYS: Record<Tool, string> = { move: 'V', points: 'A', reshape: 'W', select: 'M', lasso: 'L', brush: 'B', eraser: 'E', pen: 'P', text: 'T', fill: 'G', picker: 'I', line: 'N', rect: 'R', ellipse: 'C', poly: 'Y', hand: 'H', rotview: 'J', zoom: 'Z' };
const toolIcon = (t: Tool) => icons[t === 'zoom' ? 'zoomIn' : t];

interface Slot {
  tools: Tool[];
  current: Tool;
  el: HTMLButtonElement;
}
const slots: Slot[] = [];

function drawSlot(s: Slot): void {
  s.el.dataset.tool = s.current;
  s.el.innerHTML = toolIcon(s.current);
  s.el.setAttribute('aria-label', `${TOOL_NAMES[s.current]} (${TOOL_KEYS[s.current]})${s.tools.length > 1 ? ', right-click for more' : ''}`);
}

function slotMenu(s: Slot): void {
  tip.hidden = true;
  const r = s.el.getBoundingClientRect();
  showMenu(r.right + 4, r.top, s.tools.map((t) => ({ label: TOOL_NAMES[t], shortcut: TOOL_KEYS[t], icon: toolIcon(t), current: t === tool, action: () => setTool(t) })));
}

for (const tools of TOOL_SLOTS) {
  if (!tools) {
    $('tool-rail').append(Object.assign(document.createElement('div'), { className: 'tool-sep' }));
    continue;
  }
  const el = document.createElement('button');
  el.className = 'tool' + (tools.length > 1 ? ' has-more' : '');
  const slot: Slot = { tools, current: tools[0], el };
  slots.push(slot);
  drawSlot(slot);
  let held = 0;
  let opened = false;
  el.onclick = () => {
    if (!opened) setTool(slot.current);
    opened = false;
  };
  if (tools.length > 1) {
    el.oncontextmenu = (e) => {
      e.preventDefault();
      slotMenu(slot);
    };
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      opened = false;
      held = window.setTimeout(() => {
        opened = true;
        slotMenu(slot);
      }, 450);
    });
    for (const end of ['pointerup', 'pointerleave', 'pointercancel']) el.addEventListener(end, () => clearTimeout(held));
  }
  $('tool-rail').append(el);
}
input('size').oninput = () => setSize(num('size'));
input('size-num').onchange = () => setSize(num('size-num'));
input('pressure').onchange = () => (brush.pressure = input('pressure').checked);
input('smoothing').oninput = () => {
  brush.smoothing = num('smoothing') / 100;
  $('smoothing-value').textContent = `${num('smoothing')}%`;
};
input('straighten').onchange = () => (holdToStraighten = input('straighten').checked);
input('fill').onchange = () => (fillShapes = input('fill').checked);
input('tolerance').oninput = () => {
  fillTolerance = num('tolerance');
  $('tolerance-value').textContent = String(fillTolerance);
};
($('fill-keys') as HTMLSelectElement).onchange = (e) => (fillKeysMode = (e.target as HTMLSelectElement).value as typeof fillKeysMode);
input('grow').onchange = () => (fillGrow = input('grow').checked);
input('fill-all').onchange = () => (fillAllLayers = input('fill-all').checked);
colourPanel = new ColourPanel(
  (hex, done) => {
    setColor(hex);
    restyleColour(hex);
    if (done) styleDone('Change colour');
  },
  (hex) => setBackColor(hex),
);
colourPanel.set(brush.color);

// With something selected, the main colour controls change it too.
function colourInput(id: string): void {
  input(id).oninput = () => {
    setColor(input(id).value);
    restyleColour(input(id).value);
  };
  input(id).onchange = () => styleDone('Change colour');
}
colourInput('color');
colourInput('color-front');
input('style-color').oninput = () => restyleColour(input('style-color').value);
input('style-color').onchange = () => styleDone('Change colour');
input('style-fill').oninput = () => restyleInside(input('style-fill').value);
input('style-fill').onchange = () => styleDone('Change inside colour');
input('style-width').oninput = () => {
  input('style-width-num').value = input('style-width').value;
  restyleWidth(num('style-width'));
};
input('style-width').onchange = () => styleDone('Change line width');
input('style-width-num').oninput = () => {
  input('style-width').value = input('style-width-num').value;
  restyleWidth(num('style-width-num'));
};
input('style-width-num').onchange = () => styleDone('Change line width');
$<HTMLSelectElement>('style-line').onchange = () => {
  restyleLine($<HTMLSelectElement>('style-line').value as LineStyle);
  styleDone('Change line style');
};
input('color-back').oninput = () => setBackColor(input('color-back').value);
$('swap-colors').onclick = swapColors;
$('sel-flip-h').onclick = () => flipSelection(true);
$('sel-flip-v').onclick = () => flipSelection(false);
$('sel-apply').onclick = applyFloating;
$('sel-cancel').onclick = cancelFloating;
$('sel-none').onclick = finishSelection;
input('paper').oninput = () => {
  project.background = input('paper').value;
  scheduleRender();
};
input('touch').onchange = () => (fingerDraws = input('touch').checked);
input('layer-opacity').oninput = () => {
  activeLayer().opacity = num('layer-opacity') / 100;
  $('layer-opacity-value').textContent = `${num('layer-opacity')}%`;
  scheduleRender();
};

$('undo').onclick = () => undo();
$('redo').onclick = () => redo();
$('key-blank').onclick = newBlankKey;
$('key-dup').onclick = duplicateHere;
$('copy').onclick = () => void copyDrawing();
$('paste').onclick = pasteDrawing;
$('paste-rev').onclick = () => pasteFrames(true);
$('key-del').onclick = deleteKey;
$('hold-add').onclick = holdAdd;
$('hold-remove').onclick = holdRemove;
$('layer-dup').onclick = duplicateLayer;
$('motion-toggle').onclick = () => toggleMotion();
$<HTMLSelectElement>('layer-ease').onchange = () => {
  activeLayer().ease = $<HTMLSelectElement>('layer-ease').value as Layer['ease'];
  scheduleRender();
};
$('import-ref').onclick = () => input('ref-file').click();
input('ref-file').onchange = () => {
  Array.from(input('ref-file').files ?? []).forEach((f) => void importReference(f));
  input('ref-file').value = '';
};
// Dropping a picture anywhere on the app also imports it.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  Array.from(e.dataTransfer?.files ?? []).forEach((f) => void importReference(f));
});
$('layer-lock').onclick = () => toggleLock();
$<HTMLSelectElement>('layer-blend').onchange = () => {
  activeLayer().blend = $<HTMLSelectElement>('layer-blend').value as BlendMode;
  scheduleRender();
};
input('poly-sides').onchange = () => (polyOptions.sides = Math.max(3, Math.min(32, Math.round(num('poly-sides')) || 5)));
input('poly-star').onchange = () => (polyOptions.star = input('poly-star').checked);
$('view-flip').onclick = () => viewport.flip();
$('view-reset').onclick = () => viewport.resetRotation();
$('layer-up').onclick = () => moveLayer(1);
$('layer-down').onclick = () => moveLayer(-1);
$('zoom-in').onclick = () => viewport.zoomBy(1.25);
$('zoom-out').onclick = () => viewport.zoomBy(0.8);
$('zoom-reset').onclick = () => viewport.setZoom(1);
$('zoom-fit').onclick = () => viewport.fit();
$<HTMLSelectElement>('exposure').onchange = () => {
  const v = $<HTMLSelectElement>('exposure').value;
  exposure = v === 'hold' ? 'hold' : Number(v);
};
$<HTMLSelectElement>('autokey').onchange = () => {
  newDrawingStarts = $<HTMLSelectElement>('autokey').value as typeof newDrawingStarts;
};
input('onion').onchange = () => setOnion(input('onion').checked);
input('snap-centre').onchange = () => (snapEnabled = input('snap-centre').checked);
renderPinList();
input('onion-before').onchange = () => {
  onion.before = Math.max(0, Math.min(5, num('onion-before')));
  scheduleRender();
};
input('onion-after').onchange = () => {
  onion.after = Math.max(0, Math.min(5, num('onion-after')));
  scheduleRender();
};
input('onion-opacity').oninput = () => {
  onion.opacity = num('onion-opacity') / 100;
  scheduleRender();
};
$('first').onclick = () => goTo(0);
$('prev').onclick = () => goTo(frame - 1);
$('next').onclick = () => goTo(frame + 1);
$('last').onclick = () => goTo(project.length - 1);
$('play').onclick = togglePlay;
$('loop').onclick = () => {
  player.loop = !player.loop;
  $('loop').classList.toggle('on', player.loop);
};
input('fps').onchange = () => {
  project.fps = Math.max(1, Math.min(60, Math.round(num('fps')) || 12));
  input('fps').value = String(project.fps);
  if (player.playing) {
    player.stop(); // restart so the new speed applies from here
    player.play(frame);
  }
  scheduleRender();
};
input('length').onchange = () => {
  setLength(num('length'));
  scheduleRender();
};

const showHelp = (show: boolean) => ($('help-overlay').hidden = !show);
$('help').onclick = () => showHelp(true);
$('help-close').onclick = () => showHelp(false);
$('help-overlay').onclick = (e) => {
  if (e.target === $('help-overlay')) showHelp(false);
};

// Buttons shouldn't keep keyboard focus, or Space would "click" them again.
document.querySelectorAll('button').forEach((b) => b.addEventListener('mouseup', () => b.blur()));

// ---------------------------------------------------------------- menu bar
const menus: Record<string, () => MenuItem[]> = {
  file: () => [
    { label: 'New', shortcut: 'Ctrl+N', action: () => void document_.newProject() },
    { label: 'Open…', shortcut: 'Ctrl+O', action: () => void document_.open() },
    'separator',
    { label: 'Save', shortcut: 'Ctrl+S', action: () => void document_.save() },
    { label: 'Save as…', shortcut: 'Ctrl+Shift+S', action: () => void document_.save(true) },
  ],
  edit: () => [
    { label: 'Undo', shortcut: 'Ctrl+Z', action: undo },
    { label: 'Redo', shortcut: 'Ctrl+Y', action: redo },
    'separator',
    { label: 'Copy', shortcut: 'Ctrl+C', action: () => void copyDrawing() },
    { label: 'Cut', shortcut: 'Ctrl+X', action: cutDrawing },
    { label: 'Paste', shortcut: 'Ctrl+V', action: pasteDrawing, disabled: !clipboard },
    'separator',
    { label: 'Select all', shortcut: 'Ctrl+A', action: selectAll },
    { label: 'Deselect', shortcut: 'Ctrl+D', action: finishSelection, disabled: !hasSelection() },
    'separator',
    { label: 'Settings…', action: () => settings.open() },
  ],
  view: () => [
    { label: 'Zoom in', shortcut: 'Ctrl+=', action: () => viewport.zoomBy(1.25) },
    { label: 'Zoom out', shortcut: 'Ctrl+−', action: () => viewport.zoomBy(0.8) },
    { label: 'Fit to window', shortcut: 'Ctrl+0', action: () => viewport.fit() },
    { label: 'Show at 100%', shortcut: 'Ctrl+1', action: () => viewport.setZoom(1) },
    'separator',
    { label: 'Rotate view left 15°', action: () => viewport.rotateBy(-Math.PI / 12) },
    { label: 'Rotate view right 15°', action: () => viewport.rotateBy(Math.PI / 12) },
    { label: 'Reset rotation', action: () => viewport.resetRotation() },
    { label: viewport.flipped ? 'Unflip view' : 'Flip view (check your drawing)', shortcut: 'Q', action: () => viewport.flip() },
    'separator',
    { label: `${showGrid ? 'Hide' : 'Show'} grid`, action: () => ((showGrid = !showGrid), scheduleRender()) },
    { label: `${showSafe ? 'Hide' : 'Show'} safe area and centre`, action: () => ((showSafe = !showSafe), scheduleRender()) },
    { label: `${onion.enabled ? 'Hide' : 'Show'} onion skin`, shortcut: 'O', action: () => setOnion(!onion.enabled) },
  ],
  layer: () => layerMenuItems(activeLayerId),
  frame: () => {
    rightClicked = null; // this menu acts on the frame you're on
    return frameMenuItems(true);
  },
  help: () => [{ label: 'Keyboard shortcuts', shortcut: '?', action: () => showHelp(true) }],
};
document.querySelectorAll<HTMLElement>('[data-menu]').forEach((b) => {
  b.onclick = () => {
    const r = b.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, menus[b.dataset.menu!]());
  };
});
// Small labels that appear beside tools when you hover.
document.body.appendChild(tip);
document.querySelectorAll<HTMLElement>('.tool').forEach((b) => {
  b.addEventListener('pointerenter', () => {
    const r = b.getBoundingClientRect();
    tip.textContent = b.getAttribute('aria-label');
    tip.style.left = `${r.right + 8}px`;
    tip.style.top = `${r.top + 4}px`;
    tip.hidden = false;
  });
  b.addEventListener('pointerleave', () => (tip.hidden = true));
});

// ---------------------------------------------------------------- keyboard shortcuts
window.addEventListener('keydown', (e) => {
  if (settings.isOpen()) return;
  if ((e.ctrlKey || e.metaKey) && ['s', 'o', 'n'].includes(e.key.toLowerCase())) {
    e.preventDefault();
    const key = e.key.toLowerCase();
    if (key === 's') void document_.save(e.shiftKey);
    else if (key === 'o') void document_.open();
    else void document_.newProject();
    return;
  }
  const t = e.target as HTMLElement;
  if (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'number')) return;
  if (t instanceof HTMLSelectElement) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();

  if (!$('help-overlay').hidden) {
    if (e.key === 'Escape' || e.key === '?') showHelp(false);
    return;
  }
  if (ctrl) {
    if (k === 'z' && !e.shiftKey) undo();
    else if (k === 'y' || (k === 'z' && e.shiftKey)) redo();
    else if (k === 'c') copyDrawing();
    else if (k === 'x') cutDrawing();
    else if (k === 'v' && e.shiftKey) pasteFrames(true);
    else if (k === 'v') pasteDrawing();
    else if (k === '0') viewport.fit();
    else if (k === '1') viewport.setZoom(1);
    else if (k === '=' || k === '+') viewport.zoomBy(1.25);
    else if (k === '-') viewport.zoomBy(0.8);
    else if (k === 'a') selectAll();
    else if (k === 'd') finishSelection();
    else if (k === 't') {
      setTool('move');
      ensureFloating();
      scheduleRender();
    } else return;
  } else if (e.key === ' ') togglePlay();
  else if (e.key === ',' || e.key === 'ArrowLeft') goTo(frame - 1);
  else if (e.key === '.' || e.key === 'ArrowRight') goTo(frame + 1);
  else if (e.key === '<') goTo(activeLayer().track.prevTime(frame) ?? frame);
  else if (e.key === '>') goTo(activeLayer().track.nextTime(frame) ?? frame);
  else if (e.key === 'Home') goTo(0);
  else if (e.key === 'End') goTo(project.length - 1);
  else if (e.key === '?') showHelp(true);
  else if (k === 'b') setTool('brush');
  else if (k === 'e') setTool('eraser');
  else if (k === 'g') setTool('fill');
  else if (k === 'i') setTool('picker');
  else if (k === 'h') setTool('hand');
  else if (e.key === 'Enter' && pen) finishPen(false);
  else if (e.key === 'Escape' && pen) {
    pen = null;
    scheduleRender();
  } else if (e.key === 'Enter' && floating) applyFloating();
  else if (e.key === 'Escape' && floating) cancelFloating();
  else if (e.key === 'Escape' && selection) finishSelection();
  else if (e.key === 'Escape' && timeline.range()) timeline.clearRange();
  else if (k === 'v') setTool('move');
  else if (k === 'm') setTool('select');
  else if (k === 'l') setTool('lasso');
  else if (k === 't') setTool('text');
  else if (k === 'z') setTool('zoom');
  else if (k === 'x') swapColors();
  else if (k === 'n') setTool('line');
  else if (k === 'p') setTool('pen');
  else if (k === 'y') setTool('poly');
  else if (k === 'w') setTool('reshape');
  else if (k === 'a') setTool('points');
  else if (k === 'q') viewport.flip();
  else if (k === 'j') setTool('rotview');
  else if (k === 'r') setTool('rect');
  else if (k === 'c') setTool('ellipse');
  else if (k === 'k') newBlankKey();
  else if (k === 'd') duplicateHere();
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    if (tool === 'points' && bendTarget()) bendRemovePoint();
    else if (hasSelection()) deleteSelection();
    else if (multiRange()) clearFrames();
    else deleteKey();
  }
  else if (e.key === '+' || e.key === '=') holdAdd();
  else if (e.key === '-') holdRemove();
  else if (k === 'o') setOnion(!onion.enabled);
  else if (e.key === '[') setSize(brush.size - (brush.size > 20 ? 4 : 1));
  else if (e.key === ']') setSize(brush.size + (brush.size >= 20 ? 4 : 1));
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------- saving and opening
/** Project settings that change without going through undo. */
const savedSettings = () =>
  JSON.stringify([project.fps, project.length, project.background, onion.pins, project.layers.map((l) => [l.id, l.name, l.visible, l.locked, l.opacity, l.blend, l.motion, l.ease, l.color, l.outline, l.highlight, l.open, l.parent])]);

/** Drop anything half-done that belongs to the project being replaced. */
function clearWorkspace(): void {
  player.stop();
  if (textBox) cancelText();
  pen = null;
  floating = null;
  floatEdit = null;
  selection = null;
  selectionDraft = null;
  stylePick = null;
  styleBefore = null;
  bendSel = null;
  bendHover = null;
  rightClicked = null;
  selectedFolder = null;
  timeline.clearRange();
  history.clear();
}

/** Bring every control in line with the project that's now open. */
function showProject(atFrame: number): void {
  frame = Math.max(0, Math.min(project.length - 1, atFrame));
  input('fps').value = String(project.fps);
  input('length').value = String(project.length);
  input('paper').value = project.background;
  renderPinList();
  viewport.fit();
  scheduleRender(true);
}

const document_ = new ProjectDocument(
  {
    settle() {
      if (textBox) commitText();
      if (pen) finishPen(false);
      applyFloating();
    },
    toText: () => projectToText(project, { frame, activeLayerId, pins: onion.pins }),
    async load(text) {
      const opened = await projectFromText(text, project.width, project.height);
      clearWorkspace();
      project.clear();
      project.fps = opened.fps;
      project.length = opened.length;
      project.background = opened.background;
      project.layers = opened.layers;
      opened.drawings.forEach(({ id, ...content }) => project.drawings.restore(id, content));
      onion.pins = opened.pins;
      const saved = project.layerById(opened.activeLayerId);
      activeLayerId = saved && !saved.folder ? saved.id : project.layers.find((l) => !l.folder)!.id;
      showProject(opened.frame);
    },
    startBlank() {
      clearWorkspace();
      project.clear();
      const layer = project.addLayer('Layer 1');
      layer.track.set(0, { drawingId: project.drawings.create(), origin: 'drawn' });
      activeLayerId = layer.id;
      onion.pins = [];
      showProject(0);
    },
    idle: () => pointerId === null && !floating && !pen && !textBox && !player.playing,
    status,
    settings: savedSettings,
  },
  (name, changed) => {
    const label = $('doc-name');
    label.textContent = changed ? `${name} (not saved)` : name;
    label.title = name;
  },
);

// ---------------------------------------------------------------- start
setTool('brush');
viewport.fit();
scheduleRender(true);
