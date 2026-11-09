# PROGRESS

Read this first in any new session. Design and phase plan: [DESIGN.md](DESIGN.md).

## Status: Phase 1 + owner feedback rounds 1–12 built — waiting for the owner to test

Last updated: 2026-11-08

### Direction (from the owner)
The owner pointed at **PhotoCraft** (github.com/storytold/photocraft — MIT/Apache, a clean-room
Photoshop rebuild in Rust) as the feel they want: a professional, *familiar* app — tools on the
left, an options bar for the current tool, side panels, brush cursor that matches the brush,
Photoshop-style stroke smoothing, every action a command (good for the AI plans).
We use it as a design reference only; no code copied. We stay on Electron + TypeScript.

### Phase 1 — Draw & flip ✅ built
- Electron + TypeScript + Vite; `Start Animator.bat` launches it.
- Canvas 1280×720; pressure brush, eraser, layers (add/delete/rename/show-hide).
- Timeline with keyframes, holds, empty frames, scrubbing; onion skin; play/loop/fps/length.
- Undo/redo (50 steps). AI hook in `src/ai/inbetween.ts`.

### Feedback round 1 (2026-11-08) ✅ built
Owner asked:
1. *What are Hold +1/−1?* → renamed **Longer / Shorter** with clearer tooltips.
2. *A drawing on frame 1 showed until frame ~10* → that was "hold until next drawing".
   New setting **"Each new drawing lasts: 1 / 2 / 3 / 4 frames / until the next drawing"**
   (default **1 frame**). It places an empty frame after the drawing. New drawings start
   **empty** by default (option: "as a copy"). Onion skin skips empty frames.
3. *Easier interface* → new layout: top bar (undo/redo, Shortcuts help), left toolbox with
   icons + labels, options bar for the current tool, right panel (Colour + swatches, Onion skin
   with explanation, Paper), bottom bar with icon buttons and plain labels, timeline legend,
   friendlier status messages, shortcuts dialog (? key).
4. *Shapes* → **Line (L), Rectangle (R), Ellipse (C)**; Shift = 45° / square / circle,
   Alt = from centre; "Filled" option; live preview while dragging.
5. *Line correction & smoothness* → **Smoothing** slider (pulled-string stabiliser with
   catch-up at the end), strokes joined with curves; **Hold to straighten**: keep the pen still
   ~0.5 s at the end of a stroke → snaps to a straight line (end still adjustable) or ellipse.
6. *Round cursor* → brush and eraser show a **round ring the size of the brush** (scaled to
   the zoom); eraser ring is dashed; shape tools use a crosshair.

Verified by Claude in the browser preview: layout renders; drawing lasts 1 frame (empty frame
placed after it) and onion ghost shows on the next frame; ellipse tool draws; ring cursor size
follows brush size (60 px → 44 px on screen at 0.73 zoom), dashed for eraser, crosshair for
shapes; hold-to-straighten snaps shaky line → line, loop → ellipse, leaves zigzags alone;
smoothing visibly removes jitter; pressure varies width; build + type-check clean.
NOT verified: real Wacom pen feel (owner to test).

### Feedback round 2 (2026-11-08) ✅ built
Owner asked:
1. *Right-click does nothing* → right-click menus on the canvas (undo/redo, copy/cut/paste,
   duplicate, clear, tools, zoom), on timeline frames (new/duplicate/copy/cut/paste/remove,
   longer/shorter) and on layer names (rename, duplicate, move up/down, hide, add, delete).
2. *Show time above the frames* → seconds strip on the ruler ("1s" above frame 12 at 12 fps,
   half-second ticks), plus a time counter next to the frame counter.
3. *Duplicate and paste a drawing into another frame* → **Copy / Cut / Paste** (Ctrl+C/X/V,
   buttons, menus) — paste works across frames and layers; "Copy drawing" renamed
   **Duplicate here** and now copies the previous drawing even onto an empty frame.
4. *More things* → **Fill bucket** (G; tolerance, fills under line edges, can use lines on all
   layers), **Colour picker** (I or Alt+click), **Hand** tool (H) + **zoom** (Ctrl+wheel,
   buttons, Ctrl+0 fit, Ctrl+1 100%, middle-drag pans), **Layer panel** (opacity, duplicate,
   up/down), **pen eraser end** erases with any tool, **Clear this drawing**.
5. *Look at ArtCraft* (github.com/storytold/artcraft, MIT/Apache, same team as PhotoCraft): an
   AI image/video "IDE" — compose 2D/3D, pose mannequins, then generate with models (Nano
   Banana, GPT Image, Kling, Veo…). Its "Character Identity Transfer" (posed mannequin → your
   character) is the same idea as our stick-figure in-betweener → noted in DESIGN.md as the
   model for the AI phase.

Verified by Claude in the browser preview: right-click menus on canvas, timeline and layer
names (items greyed when not usable); seconds strip shows 1s/2s; copy → paste onto frame 5
via timeline menu; duplicate here, cut + paste to frame 12; ellipse + fill (no halo); colour
picker; zoom to 112% and hand-drag pan; duplicate layer; layer opacity 35%; pen eraser end
(button 5) erases while Brush is selected; build + type-check clean.
NOT verified with real hardware: Wacom pen (pressure, hover ring, eraser end, barrel button).

### Feedback round 3 (2026-11-08) ✅ built
Owner showed a Photoshop-style toolbar and asked for select/move tools "and the rest", plus a
full list of ArtCraft's features (given in chat).
- **Toolbox** now two columns of icons (like Photoshop/PhotoCraft), tooltips name each tool.
- **Move (V)**, **Rectangle select (M)**, **Lasso select (L)**: select part of a drawing, drag
  to move, corner/edge handles resize (corners keep proportions, Shift = free), round handle
  rotates (Shift = 15° steps), Flip ↔ / ↕, Apply (Enter) / Cancel (Esc) / Deselect (Ctrl+D),
  Select all (Ctrl+A), Ctrl+T = transform; Delete erases the selected part; Ctrl+C/X/V copy a
  selected part — paste arrives as a movable piece on the current frame. Move tool with no
  selection moves the whole drawing on that frame.
- **Text (T)**: click and type; font style, size, bold; Ctrl+Enter or click away to finish.
- **Zoom tool (Z)**: click to zoom in, Alt+click out.
- **Front/back colour squares** with swap (X); filled shapes use the back colour; right-click a
  swatch to set the back colour.
- Shortcut changes: Line is now **N** (L = Lasso). Undo while moving a selection first puts it back.
- Skipped on purpose (photo-editing tools, not useful for animation): crop, clone stamp,
  healing, dodge/burn, history brush, quick mask.

Verified by Claude in the browser preview: rectangle select → move → proportional resize →
rotate 45° (Shift snap) → Apply; undo/redo; lasso + Ctrl+C → paste on frame 3 → drag → Enter;
Text tool typed "HELLO!"; Select all + Flip ↔; no console errors; build clean.

### Feedback round 4 (2026-11-08) ✅ built
See [TOOLS.md](TOOLS.md) for the researched checklist of animation tools and what's in or planned.
- **Vector or Bitmap per layer** (Layer button / menus; new default is vector). Vector drawings
  are stored as shapes (`src/model/vector.ts`); "Convert to bitmap" available (one-way, undoable).
- **Sharp zoom**: the on-screen canvas now matches real screen pixels and everything is redrawn
  for the current zoom (`src/ui/viewport.ts`, `src/render/compositor.ts`). Vector stays crisp up
  to 6400%; bitmap is smoothed instead of blocky (still soft, because it's pixels).
- **Lasso fixes**: uses every pen sample; only the real outline counts as "inside" (starting
  outside the shape but inside its box begins a new selection). On vector layers selection picks
  whole lines and shapes.
- **Squash and stretch**: hold Shift while dragging a resize handle; area stays constant and the
  opposite side stays planted. Alt = stretch freely. Outlines keep an even thickness.
- **New tools**: Pen (Bezier), Polygon/Star, Reshape (magnet), Rotate view, Flip view, grid, safe
  area, recolour by clicking a vector line or fill, layer lock, blend modes, drag drawings on the
  timeline (Alt copies).
- **New interface**: menu bar (Edit, View, Layer, Frame, Help), options bar, floating toolbox with
  hover labels, card panels, single control strip above the timeline.
- Shortcuts added: P pen, Y polygon, W reshape, J rotate view, Q flip view.

Verified by Claude in the browser preview: vector vs bitmap at 721% zoom; lasso on bitmap (partial
cut, second lasso inside old box); ball stretched with Shift (232×232 → about 157×342, area within
1%); star, pen, ellipse + fill, recolour, eraser, reshape, text on vector; drag a drawing on the
timeline; drawing with rotated view; lock; undo; vector copy/paste; convert; grid and safe area.
NOT verified: real Wacom pen; performance with very long vector animations on this laptop;
the bucket-inside-filled-shape fix was type-checked and built but not re-run in the preview.

### Feedback round 5 (2026-11-08) ✅ built
Select many frames on the timeline and copy/paste them, normally or reversed.
- Drag across frame cells to select a block (several layers too); Shift+click extends; drag the ruler to move the playhead without losing the selection. Frame menu: Select all frames.
- Copy / Cut / Paste (Ctrl+C/X/V, buttons, right-click), Paste reversed (Ctrl+Shift+V, button), Reverse these frames, Clear these frames (Delete).
- Drag a selected block sideways to move it; Alt copies. Moving one drawing is now: click its frame once, then drag.
- Pasted drawings are independent copies; pasting keeps what showed after the pasted block. Vector and bitmap convert when pasted across layer types.

Verified by Claude in the browser preview: 4-frame copy; reversed paste; normal paste; reverse in place via the menu; dragging a block; undo; no new console errors.
NOT verified: multi-layer block paste; pasting across vector and bitmap layers.

### Feedback round 6 (2026-11-08) ✅ built
- **Keyframes (like CapCut)**: "◆ Keyframes" button or the ◇ on a layer row. Moving, resizing, rotating or bending on any frame makes a keyframe from what is showing there; frames between keyframes are calculated when drawn (`src/model/motion.ts`). Layer flag `motion`, key flag `tween`; each object has a `uid` so it can be matched between poses.
- Editing an in-between frame recalculates both neighbours: changing frame 4 (keys at 1 and 12) reshapes frames 2-3 and 5-11. Frames 1 and 12 stay as they were.
- Bending uses the Reshape tool, which now also bends shapes, curves and fills (shapes become 16-point curves). It has its own Reach slider.
- Turning keyframes on for a bitmap layer turns each drawing into one picture on a vector layer: it can move, resize and rotate, but not bend. Text and pictures also can't bend.
- **Reference pictures**: "Import picture…" in the right panel, the Layer menu, or drag a file onto the app. Goes on a bottom layer (badge R, 60% opacity), spans all frames, can be moved and resized; drawing tools skip to the nearest normal layer. Layer flag `reference`: leave these out of export in Phase 4.

Verified by Claude in the browser preview: ball keyed on frames 1 and 12, bent on 4; frames 8 and 12 checked; bitmap layer keyframes; undo; reference import through the file input, moving it, drawing over it.
NOT verified: drag-and-drop import; the Windows file picker itself; real pen; playback speed with very detailed keyframed drawings. There is no easing yet: in-betweens move at a steady speed.

### Feedback round 7 (2026-11-08) ✅ built
Owner reported jittery animation and asked to use REA on the installed Adobe Animate 2022.
- REA looked only at Animate.exe's import and export tables (no decompiling, to respect the owner's "never copy proprietary code" rule). It showed high-resolution timers, OpenGL drawing and an Adobe vector graphics library; the tweening code itself is not visible from outside. Adobe's public docs supplied the idea used: eased motion.
- Causes found in our own code, by simulating a 60 Hz screen: playback stepped one frame backwards on every Play; frame changes close to a screen refresh gave uneven 4/5/6-refresh frames at 12 fps.
- Fixes: clock starts on the first refresh, frame changes sit half a refresh from screen updates, frames draw in the same refresh, timeline colours cached.
- Keyframe motion now runs a curve through all keyframes (`src/model/motion.ts`): gentle start and stop, continuous speed through middle keyframes, no overshoot. Layer panel "Motion": Smooth (default) or Steady.
- New projects default to 24 fps, 48 frames.

Measured in the simulation: 12 fps now always 5 refreshes per frame; 30 fps always 2; 24 fps an even 2/3 alternation (a 60 Hz screen can't divide 24 evenly); no backward step. Motion speed per frame through keys at 1, 4, 12 went from a jump of 33 to 87 to a gradual curve.
NOT verified: how it looks on the real screen with the owner's own animation; playback speed with very detailed drawings. Hand-drawn frame-to-frame wobble is not changed by this.

### Feedback round 8 (2026-11-08) ✅ built
Owner reported: fill didn't reach the frames keyframes made; holding a line turned it into a circle; wanted brush smoothness and point-based bending; asked to look at the installed Moho 14.2.
- Moho: only the folder listing and the on-screen tool labels/help text of its tool scripts were read, no program logic (owner's "never copy proprietary code" rule). Ideas used: click a curve to add a point, drag a point to distort, Peak/Smooth points, a Smoothing setting on freehand.
- Fill on a keyframe layer now asks "Fill all frames?" (`src/ui/dialog.ts`). "On keyframes" in the Fill options: Ask me / Fill all / Only here. Fill all floods the matching spot on each keyframe (`src/tools/fillKeys.ts`), gives the fills the same corner count and uid so they blend. Clicking a line or an existing colour recolours it on every keyframe. One undo step.
- Brush: "Smoothness" slider (default 50%), now two distance-based filters in `src/tools/brush.ts`; no creep while still; the end curves in to where the pen stopped. "Hold to make a shape" is now OFF by default.
- New tool Bend points (A), `src/tools/bend.ts` plus the section in `main.ts`: click a line to add a point, drag to bend, drag handles on curves (Alt = one side only), double-click = sharp/smooth, Delete or right-click removes. Points are flags on existing samples, so keyframes keep blending; added points go on every keyframe. Colour under a bent line travels with it. Vector layers only.
- `motion.ts`: lines, curves and fills now follow the same per-number curve; fills run travel and shape change as two curves so they stay inside a moving, bending outline.
- Rect and polygon curves have more in-between anchors so bends round off.

Measured (simulated shaky line, RMS wobble in pixels): Smoothness 0% 3.58, 25% 2.80, 50% 1.26, 75% 0.74, 100% 0.54; the line trails the pen 0, 3, 12, 27, 45 px.
Tested in the app with simulated pointer events: fill-all on an in-between frame filled frames 1 and 7 correctly; bending a brush stroke, line, rectangle, ellipse; bend on frame 7 made a keyframe, undo removed it; held brush stroke for 900 ms stayed a hand-drawn line; no console errors.
NOT verified: with the real Wacom pen; fill-all on complicated drawings with gaps; a fill with no outline can't be bent with points (use Reshape); bitmap layers have no points.

### Feedback round 9 (2026-11-08) ✅ built
Owner wanted to see any chosen frame as a ghost while working elsewhere (bouncing ball returning to its frame 1 spot), in a colour they can change, and for moved objects to snap into a straight line.
- Right-click any frame or the ruler above it: Show Onion Skin. The playhead returns to where you were working. Default purple, 50%. `OnionPin` list on `OnionSettings` (`compositor.ts`), per layer and frame; works on in-between keyframe frames; stays visible when the normal onion skin is off; hidden during Play.
- When pinned, the same menu has Hide Onion Skin, purple, gray, Choose onion colour. The Onion skin panel lists every pinned frame with its own colour, strength and × button. Pinned frames are tinted on the timeline.
- Move tool snap (`snapTargets`/`applySnap` in `main.ts`): the moving object's centre clicks to the centre of the same object on pinned frames, on all other keyframes (keyframe layers) or the drawings either side (frame-by-frame layers), and to where the drag began. Pink guide line, status message says which frame. Reach is 8 screen pixels. Ctrl = no snap; "Snap to line" checkbox turns it off. Centres only, not edges.

Tested in the app with simulated pointer events: ball moved down on frame 13 snapped straight below frame 1; on frame 25, pin frame 1, drag back: "Exactly on frame 1" with both guide lines; Ctrl moved freely; colour change showed on ghost and timeline; no console errors.
NOT verified: with the real pen; pins aren't saved (no saving yet) and stay on their frame number if frames are moved.

### Feedback round 10 (2026-11-08) ✅ built
Owner wanted to click something already drawn and change its colour, width and line style, and reported lag and hanging at the highest line smoothness.
- Move tool (V): a click now picks the drawn thing under the pen (lines first, then colour fills, then the inside of an empty shape); only a real drag moves. Rectangle select and lasso pick everything inside. Right-click a drawing with any tool: "Change colour, width, line style".
- New "Selected" panel at the top of the right side (`style-card` in `index.html`, the "change something already drawn" section of `main.ts`): Colour, Inside colour (filled shapes), Width, Line style (Solid, Dashed, Dotted, Dash and dot). Swatches and the main colour box also recolour the selection. Each change is one undo step. On a keyframe layer it changes every keyframe. Text and colour fills only get a colour.
- Selected things are now tracked by uid (`stylePick`), so Delete and drag affect exactly what was clicked, not everything in its bounding box.
- `LineStyle` is an optional `style` on stroke/shape/bez items.
- Speed: hand-drawn lines were one huge outline of circles rebuilt on every screen update. They are now stretches of one width stroked in order, with fewer extra curve points (`strokeRuns`, `densify` in `vector.ts`). While drawing, the compositor keeps everything except the current line as finished pictures (`Compositor.live`, `renderLive`), and `syncVStroke` only adds new points.
- Smoothness: the filter eases off when the pen is quick (`speed` in `brush.ts`), and when the pen pauses for 90 ms the line glides up to it (`catchUp`, `glideToPen`).

Measured with a simulated 600-sample line: screen update went from 157–397 ms at 0% and 13–111 ms at 100%, growing with length, to 10–27 ms at either setting, staying flat. The cost did not turn out to be special to 100%; it grew with line length at every setting. At 100% a slow pen still trails about 45 px while moving; a 36 px gap closed fully during a pause.
Tested in the app with simulated pointer events: picking and restyling an ellipse, a line and a brush line; swatch recolour; undo and redo; empty click deselects; click then drag moves only that item; Delete removes only that item; keyframed circle changed from an in-between frame showed on frames 1 and 13; no console errors.
NOT verified: with the real pen or on the owner's laptop. New drawings always start solid (line style is only changeable afterwards). Bitmap layers can't be restyled because they are pixels.

### Design clean-up (2026-11-08) ✅ built
Owner asked to remove the purple AI-looking gradients and background. All gradients, glows, blur and the rainbow logo are gone from `style.css`. The interface is now flat neutral grey with square panels joined edge to edge, and the selected tool, Play and Apply are plain off-white. The only colours left are the amber keyframe marks and hints and the red playhead. Selection handles and bend points on the canvas are plain blue. The pinned onion ghost still starts purple because the owner asked for purple or gray in round 9.
The first pass was then replaced by the redesign below.

### Redesign (2026-11-08) ✅ built
Guided by the installed `better-*` review skills and the `frontend-design` guidance. `taste-skill` and `ui-ux-pro-max` were not installed, so they were not used.
- Mid-grey workbench (`style.css` tokens at the top): a neutral surround so colours on the paper read true. Amber now only means keyframes and drawings on the timeline; red is the playhead; selected things are off-white. Keyframe diamonds and bands are amber.
- Eye button on every layer row (`timeline.ts`, `eye`/`eyeOff` icons): open eye shows, crossed-out eye hides, and a hidden layer's name is struck through. The lock is a real padlock icon too.
- Tool hints moved to the status bar and written as plain sentences. Messages float over the canvas. Together these stop the canvas jumping when you change tools (checked: same stage size for all 18 tools).
- Right panel rows share one label column. Section titles are sentence case. Bottom bar buttons are grouped by space: drawing actions, copy and paste, Keyframes, length.
- Accessibility: visible focus ring everywhere, spoken names on the tool buttons (they lost them when tooltips were replaced), layer buttons and number boxes, hover only on real pointers. Contrast measured from the tokens: text 11.3:1 on panels, dim text 7.2:1 on panels and 5.5:1 at lowest, control edges 3.2:1, focus ring 12.6:1.
Not verified: a full keyboard-only walk, a screen reader, 200% zoom, narrow windows below 1280 wide. The canvas and timeline are pen-and-mouse surfaces with no keyboard path to draw. `user-select: none` stays on the page on purpose, because the whole app is a pen surface. The help box has no focus trap yet.

### Feedback round 11 (2026-11-08) ✅ built
- Hide and lock buttons were broken in real use: pressing a row rebuilt the row, so the click landed on a button that no longer existed. An earlier test used code-triggered clicks and missed it. Selecting a row now only marks it (`Timeline.markActive`), and the row ignores presses on its own buttons. This also fixes clicking a name to rename.
- Toolbar is one column of 11 slots (`TOOL_SLOTS` in `main.ts`). Slots with a corner triangle open a drop-down on right-click or a long press: Move/Bend points/Reshape, Rectangle select/Lasso, Rectangle/Ellipse/Polygon, Hand/Rotate view/Zoom. Icons are our own.
- Right-click a frame: "Fill to…" (`fillTo`, `askNumber` in `dialog.ts`). The drawing stays on screen through the chosen frame, an empty frame ends it. Numbers past the last frame are refused with a message. Asks first if it would replace drawings. One undo step.
- Colour panel (`src/ui/colourPanel.ts`): colour field, hue strip, hex and RGB boxes, recent colours, 72 swatches.
- Font: Poppins, loaded from Google Fonts in `index.html`, so it needs internet at least once; without it the app falls back to Segoe UI.
- Layers: header buttons for new layer, new folder, delete, and all-layers highlight, outlines, hide, lock. Each row has highlight (tints the timeline row), outlines (the coloured box; hollow = thin lines in the layer's colour, bitmap layers show as a flat shape), eye and lock. Folders are `Layer` objects with `folder: true` and layers point to them with `parent`; a selected folder is `selectedFolder`, so drawing always stays on a real layer. Drag rows to reorder or onto a folder.

Tested with real clicks and drags in the app at 1400×800: hide removed the drawing, lock, outlines, highlight, right-click drop-down, picking Polygon, Fill to (99 refused, 24 accepted, bar ends at 24), swatch, new folder, drag into folder, hiding a folder hides what's inside, folder delete question. No console errors.
NOT verified: with the real pen (long press included), offline font fallback in the built app, deleting with both choices.

### Feedback round 12 (2026-11-09) ✅ built
- Colour fill drifting from its outline after a keyframe was repositioned. Cause: the outline and the fill worked out their in-between positions separately, and the smooth curve gives different answers when a fill's `m` and loops move separately. Now `fillOnOutline` (`src/model/motion.ts`) places a fill with its outline's own numbers; `outlineOf` finds the line going around the fill (cached per loops). A fill bounded by several separate lines has no single outline, so it still blends by itself, in paper coordinates. Measured: 31 px gap before, 0 after.
- Click or box either the outline or its colour: moving, deleting or copying takes both (`withPartners` in `main.ts`).
- Saving: File menu and Ctrl+N / O / S / Shift+S. `.myanim` is JSON (`src/model/projectFile.ts`), line points stored once and shared between keyframes; bitmaps and pictures are PNG text. Keeps layers, folders, keyframes, speed, paper colour, onion pins, frame and active layer. Undo history isn't saved. Opening reads the whole file before touching the current work.
- `src/ui/document.ts` tracks the file name and unsaved changes (title `*`, "(not saved)"), asks before New, Open or closing, autosaves a recovery copy every minute to the app's userData folder and offers it at the next start. `electron/main.cjs` keeps the real path; `electron/preload.cjs` is the page's only way in. Saves write `.saving` beside the file, then rename it.
- Text one step larger (13 px / 12 px, ruler 11 px).
- Settings (gear, top right, or Edit menu): accent and base colour, 8 presets each plus Custom, Reset colours. `src/ui/theme.ts` works out every interface colour from those two and keeps text readable; choice stored in localStorage. Amber still means keyframes, red the playhead.
- Logo: an M drawn by a bouncing ball's path, with the ball in the air. `assets/logo.svg`, `assets/logo-256.png`, `assets/icon.ico` (window and taskbar). In the app it takes the accent colour.

Tested in the real desktop app with real input and files, only the native file boxes answered by the test: save, second save, Save as, new, open, unsaved-work questions, damaged file, undo after open, autosave, closing. Fill: real drags in the app on frames 5 and 8. Settings: real clicks, remembered after reload, light base, reset gives the original values.
NOT verified: real pen. In one long test run, restoring the autosave copy showed the view at 103% instead of 74%; two direct repeats of that step gave 74%, so the cause is unknown. If it shows up, Ctrl+0 fits the view.

### Next
1. Owner tests feedback rounds 1–11 with the pen.
2. Phase 2 — what's left: drag-move keyframes, clones.

## Known issues / notes
- Shapes are painted as pixels for now; editable vector shapes come in Phase 5.
- Each painted drawing uses ~3.7 MB of memory.
- The internet connection here drops large downloads (ECONNRESET). Electron v33.2.0 was
  fetched with `curl -C -` from its GitHub release, checked against the official SHA256, and
  unpacked into `node_modules/electron/dist` (plus `path.txt` = `electron.exe`). If
  `node_modules` is ever deleted, repeat that or run `npm install` on a steadier connection.
- Testing tip: the in-app browser pane pauses screen refreshes while hidden; test logic with
  timers/imports there, not `requestAnimationFrame` waits.

## How to run
- Double-click `Start Animator.bat`, or in a terminal in this folder: `npm run app`.
- Browser test mode: `npm run dev`, then open http://localhost:5173.
