# My Animator — Design

A personal 2D animation app for Windows (HP EliteBook x360 with Wacom pen).
All code is written fresh. Ideas come from studying open-source animators (Krita,
Synfig, OpenToonz, Glaxnimate) and public docs of commercial apps — no copied code,
icons or assets.

## Look and feel

Reference: **PhotoCraft** (MIT/Apache, a clean-room Photoshop rebuild) — the target is the
same "familiar by design" feel, but for animation (think Adobe Animate's layout):
- Left toolbox (icon + label), options bar for the current tool, right panels, timeline at the
  bottom, plain-language labels and tooltips, a shortcuts sheet.
- Brush cursor is a ring the size of the brush; stroke smoothing with a pulled string.
- Every change is a command object (`History`), so later an automation/AI channel can drive
  the same actions the buttons do.

**AI direction reference: ArtCraft** (same team, MIT/Apache) — an AI image/video "IDE" where
you compose the scene and pose a mannequin, then models generate the final art. Its
"Character Identity Transfer" (posed mannequin → your character) matches our plan: stick-figure
keyframes + character name → AI in-betweens. Phase 11 should follow that pattern (pose guide +
character reference images → image model), through the `InbetweenProvider` hook.

## Technology

**Electron + TypeScript + HTML canvas**, built with Vite.

- Runs as a normal Windows desktop window; no C++ or Rust compiler needed.
- Pen pressure comes from Windows Ink through standard "pointer events".
- Canvas drawing is GPU-accelerated, fine on Intel HD 620 at 1280×720.
- Later: FFmpeg (bundled) for MP4/GIF/transparent video, Web Audio for sound/waveforms.
- The core (`src/model`) has no Electron code, so it could move to Tauri later for a
  smaller app if wanted.

## The main parts

```
                ┌──────────────────────── Electron window ────────────────────────┐
                │                                                                  │
  Pen / mouse ──►  TOOLS (brush, eraser; later fill, shapes, picker)               │
                │        │ paints pixels / edits shapes                             │
                │        ▼                                                          │
                │  ┌──────────── PROJECT MODEL (src/model) ─────────────┐          │
  Keyboard ─────►  │  Project ─► Layers ─► Tracks (keyframe lists)      │          │
  & buttons     │  │                        │  frame → key {drawingId,  │◄── HISTORY (undo/redo)
                │  │                        │               label}      │          │
                │  │  DrawingStore: drawingId → pixels (lazy, shareable)│◄── FILES (save/open/autosave) [later]
                │  └────────────┬──────────────────────────┬────────────┘          │
                │               │ "what's on frame N?"     │ keys + labels         │
                │               ▼                          ▼                        │
                │  RENDERER / COMPOSITOR            AI HOOK (src/ai)  [later]       │
                │  paper → onion ghosts →           InbetweenProvider: stick-figure │
                │  layers (→ tweens, symbols,       keys + character name ──► new   │
                │  bones, camera later)             'generated' keyframes           │
                │        │                                                          │
                │        ▼                                                          │
                │  CANVAS VIEW        TIMELINE UI ◄──► PLAYER (fps clock, loop)     │
                │                         │                                         │
                │                         ▼                                         │
                │                   EXPORT (PNG seq, GIF, MP4, alpha video) [later] │
                └──────────────────────────────────────────────────────────────────┘
```

**Key ideas borrowed from how Krita works (see the Krita study):**
- A track stores only the frames that have a keyframe; held frames are "the last key
  at or before this frame" (binary search) — `KeyframeTrack.activeTime()`.
- A keyframe holds a *ticket* (`drawingId`); pixels live separately in `DrawingStore`.
  This enables clones and keeps saving simple (one file per drawing, linked by name).
- Blank keyframes cost nothing until painted on.
- Onion skin shows neighbouring *keyframes*, tinted red (before) / green (after), fading.
- Playback is clock-based: it skips frames when busy rather than slowing down.

## Folder map

| Path | What it does |
|---|---|
| `electron/main.cjs` | Opens the desktop window |
| `src/main.ts` | Wires everything together: state, buttons, shortcuts, drawing |
| `src/model/keyframeTrack.ts` | Sparse frame→keyframe list (held/blank frame logic) |
| `src/model/project.ts` | Project, layers, keyframes, DrawingStore |
| `src/model/history.ts` | Undo/redo stack |
| `src/render/compositor.ts` | Builds the picture for a frame, incl. onion skin |
| `src/tools/brush.ts` | Pressure brush + eraser, smoothing |
| `src/tools/shapes.ts` | Line/rectangle/ellipse, hold-to-straighten recognition |
| `src/model/vector.ts` | Vector drawings: lines, shapes, curves, text and fills as maths |
| `TOOLS.md` | Researched checklist of animation tools and their status |
| `src/tools/fill.ts` | Fill bucket (flood fill), tracing fills into vector outlines |
| `src/tools/selection.ts` | Rectangle/lasso selections, move/resize/rotate/flip |
| `src/ui/cursor.ts` | Round brush-size cursor |
| `src/ui/viewport.ts` | Zoom and pan |
| `src/ui/contextMenu.ts` | Right-click menus |
| `src/ui/icons.ts` | The app's own line icons |
| `src/playback/player.ts` | Frame-rate clock, looping |
| `src/ui/timeline.ts` | Timeline grid and layer list |
| `src/ai/inbetween.ts` | Plug-in point for the future AI in-betweener |

## Build phases

Each phase ends with something you can run and test.

1. **Draw & flip** — pressure brush, eraser, layers (basic), timeline with keyframes,
   held and blank frames, onion skin, fps, play/loop/scrub, undo. ✅ built
   + feedback round 1: new layout, shapes (line/rect/ellipse), smoothing, hold-to-straighten,
   round brush cursor, "each drawing lasts N frames". ✅ built
   + feedback round 2: right-click menus, seconds on the ruler, copy/cut/paste, fill bucket,
   colour picker, zoom/pan + hand tool, layer opacity/duplicate/reorder, pen eraser end. ✅ built
   (this pulled most of Phase 3 forward; blend modes and brush stabiliser options remain)
2. **Save your work** — own project format (zip of JSON + PNGs, like .kra), open, autosave,
   recent files; drag-move keyframes on the timeline; clones.
3. **Better drawing** — layer opacity & blend modes, fill bucket, colour picker,
   brush smoothing/stabiliser, canvas zoom/pan/rotate (view only), document size.
4. **Export** — PNG sequence, GIF, MP4, transparent video (bundled FFmpeg).
5. **Vector layer** — lines, shapes, editable curves with fill and stroke.
6. **Tweening** — number tracks with easing curves (move, scale, rotate, opacity),
   then shape tweens on vector layers.
7. **Symbols** — draw once, reuse with per-copy position/scale/rotation and own timing.
8. **Camera** — pan, zoom, rotate across the scene, tweened like any property.
9. **Audio** — import sound, waveform on the timeline, scrubbing audio, lip-sync helpers
   (mouth-shape sets + phoneme markers).
10. **Bones** — skeleton bound to a drawing, forward kinematics, then IK.
11. **AI in-betweens** — label stick-figure keys with a character; a provider fills the gaps.

Later phases may be reordered depending on what you want first.
