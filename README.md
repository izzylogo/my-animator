<p align="center">
  <img src="assets/logo-256.png" alt="My Animator logo" width="96" />
</p>

<h1 align="center">My Animator</h1>

<p align="center">A desktop app for 2D frame-by-frame and keyframe animation, built for drawing with a pen.</p>

---

My Animator is a personal 2D animation app for Windows, written from scratch with Electron, TypeScript and the HTML canvas. You draw on a 1280×720 paper, lay your drawings out on a timeline, and play them back straight away.

It is a work in progress. It doesn't export video yet, so finished animations can only be played inside the app for now. See [What's planned](#whats-planned).

## Features

**Drawing**
- Pressure-sensitive brush and eraser with adjustable line smoothing
- Pen tool for curves, plus line, rectangle, ellipse, polygon and star shapes
- Text, fill bucket and colour picker
- Colour panel with a colour field, hue strip, Hex and RGB boxes, recent colours and swatches
- Vector layers, which stay sharp and editable, and bitmap layers for painted pixels
- Click anything you've drawn to change its colour, width or line style (solid, dashed, dotted, dash and dot)
- Bend points and a Reshape tool for adjusting lines after they're drawn

**Animating**
- Timeline with drawings, held frames and empty frames
- Keyframes mode: draw two poses and the frames between are worked out for you, with smooth or steady motion
- Colour fills that move with their outlines between keyframes
- Onion skin, with pinned frames you can keep visible
- Copy, paste and paste frames reversed
- "Fill to", which holds a drawing up to the frame you choose
- Play, loop and adjustable speed

**Layers**
- Add, duplicate, rename, reorder, hide and lock
- Folders, opacity, blend modes and thin-outline view
- Reference pictures to trace over

**Selecting and moving**
- Rectangle select and lasso
- Move, resize, rotate, flip, and squash and stretch
- Snapping to line up with other frames

**Files and workspace**
- Save and open projects as `.myanim` files
- A backup copy every minute, offered back after a crash
- 50 steps of undo and redo
- Zoom, pan, rotate and flip the view, with a grid and safe-area guides
- Settings for the accent colour and base colour of the whole app

## How to run it

The app has been built and tested on Windows only. Electron also runs on macOS and Linux, but they haven't been tried.

### What you need

- [Node.js](https://nodejs.org/) (the LTS version is fine; this project is developed on Node 22)
- [Git](https://git-scm.com/downloads), to download the code

### Steps

1. Open a terminal and download the project:

   ```bash
   git clone https://github.com/izzylogo/my-animator.git
   ```

2. Go into its folder:

   ```bash
   cd my-animator
   ```

3. Install what it needs. This takes a few minutes the first time:

   ```bash
   npm install
   ```

4. Build and start the app:

   ```bash
   npm run app
   ```

**On Windows there's a shortcut:** after downloading the project, double-click `Start Animator.bat`. It installs everything the first time, then starts the app.

### Trying it in a browser

```bash
npm run dev
```

Then open http://localhost:5173. This is meant for development. Drawing works, but saving and opening files only work in the desktop app.

## Keyboard shortcuts

| Keys | Action |
|---|---|
| `B` / `E` | Brush / Eraser |
| `V` | Move |
| `M` / `L` | Rectangle select / Lasso |
| `P` | Pen |
| `T` | Text |
| `G` | Fill bucket |
| `I` | Colour picker |
| `N` / `R` / `C` / `Y` | Line / Rectangle / Ellipse / Polygon |
| `Space` | Play or pause |
| `,` `.` or `←` `→` | Previous or next frame |
| `K` / `D` | New drawing / Duplicate drawing |
| `+` / `−` | Hold a drawing longer / shorter |
| `O` | Onion skin on or off |
| `[` / `]` | Smaller / larger brush |
| `Ctrl+Z` / `Ctrl+Y` | Undo / Redo |
| `Ctrl+S` / `Ctrl+Shift+S` | Save / Save as |
| `Ctrl+O` / `Ctrl+N` | Open / New project |
| `?` | Show all shortcuts in the app |

Tools with a small triangle in their corner hold more tools. Right-click them, or press and hold with a pen, to see the list.

## What's planned

- Export to MP4, GIF, PNG sequence and transparent video
- Symbols, bones and a camera
- Audio and lip-sync
- More brushes and selection tools

[DESIGN.md](DESIGN.md) has the full plan, [TOOLS.md](TOOLS.md) lists every tool and its status, and [PROGRESS.md](PROGRESS.md) records what's been done so far.

## Project layout

| Folder | What's in it |
|---|---|
| `src/model` | The project, layers, keyframes, motion, undo and the file format |
| `src/tools` | Brush, shapes, fill, selection and bending |
| `src/render` | Draws the picture for each frame |
| `src/ui` | Timeline, colour panel, dialogs, settings and theme |
| `src/playback` | Playing the animation |
| `electron` | The desktop window and file access |
| `assets` | The logo and app icon |

## Built with

[Electron](https://www.electronjs.org/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/) and the HTML canvas. All code and icons were written for this project. The workflow takes ideas from public documentation for Krita, Synfig, OpenToonz, Adobe Animate and Moho.
