// Electron "shell": opens one desktop window, loads the built app from ../dist, and does the
// parts a web page isn't allowed to do itself: file boxes, and reading and writing files.
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const FILTERS = [{ name: 'My Animator project', extensions: ['myanim'] }];
const autosavePath = () => path.join(app.getPath('userData'), 'autosave.myanim');

let win = null;
let currentPath = null; // the file you're working in; the page is never told the full path
let pendingOpen = null; // picked in the Open box, not yet read successfully
let hasChanges = false;
let closing = false;

const titleOf = (file) => path.basename(file, path.extname(file));

/** Write beside the real file first, so a crash mid-save can't ruin the one you already have. */
async function writeSafely(file, text) {
  const temp = `${file}.saving`;
  await fs.writeFile(temp, text, 'utf8');
  await fs.rename(temp, file);
}

const removeAutosave = () => fs.rm(autosavePath(), { force: true });

async function writeProject(file, text) {
  await writeSafely(file, text);
  currentPath = file;
  await removeAutosave();
  return { name: titleOf(file) };
}

/** Every file action reports a problem as {error}, so the page can explain it calmly. */
const handle = (channel, work) =>
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await work(...args);
    } catch (problem) {
      return { error: problem.message };
    }
  });

async function saveAs(text, suggested) {
  const start = currentPath ?? path.join(app.getPath('documents'), `${suggested}.myanim`);
  const answer = await dialog.showSaveDialog(win, { title: 'Save animation', defaultPath: start, filters: FILTERS });
  return answer.canceled || !answer.filePath ? null : writeProject(answer.filePath, text);
}

handle('file-save', (text, suggested) => (currentPath ? writeProject(currentPath, text) : saveAs(text, suggested)));
handle('file-save-as', saveAs);
handle('file-open', async () => {
  const answer = await dialog.showOpenDialog(win, { title: 'Open animation', filters: FILTERS, properties: ['openFile'] });
  if (answer.canceled || !answer.filePaths[0]) return null;
  const file = answer.filePaths[0];
  const text = await fs.readFile(file, 'utf8');
  pendingOpen = file;
  return { text, name: titleOf(file) };
});
// Only called once the page has read the file without a problem.
handle('file-opened', async () => {
  currentPath = pendingOpen;
  await removeAutosave();
});
handle('file-forget', async () => {
  currentPath = null;
  await removeAutosave();
});
// ---- exports. The page only ever hands over bytes; the place on disk stays here.
const EXPORT_TYPES = {
  mp4: { name: 'MP4 video', extensions: ['mp4'] },
  gif: { name: 'GIF animation', extensions: ['gif'] },
  webm: { name: 'WebM video', extensions: ['webm'] },
};
let exportTarget = null; // { file } or { folder }

/** A new folder beside nothing else, so an export never overwrites earlier pictures. */
async function freshFolder(parent, base) {
  for (let n = 1; n < 1000; n++) {
    const folder = path.join(parent, n === 1 ? base : `${base} ${n}`);
    try {
      await fs.mkdir(folder);
      return folder;
    } catch (problem) {
      if (problem.code !== 'EEXIST') throw problem;
    }
  }
  throw new Error('Too many export folders with that name.');
}

handle('export-pick', async (kind, suggested) => {
  const safeName = String(suggested).replace(/[<>:"/\\|?*]/g, '_');
  const documents = app.getPath('documents');
  if (kind === 'folder') {
    const answer = await dialog.showOpenDialog(win, { title: 'Choose where to put the pictures', defaultPath: documents, properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Export here' });
    if (answer.canceled || !answer.filePaths[0]) return null;
    const folder = await freshFolder(answer.filePaths[0], `${safeName} frames`);
    exportTarget = { folder };
    return { name: path.basename(folder) };
  }
  const type = EXPORT_TYPES[kind];
  if (!type) throw new Error('Unknown export type.');
  const answer = await dialog.showSaveDialog(win, { title: `Export ${type.name}`, defaultPath: path.join(documents, `${safeName}.${type.extensions[0]}`), filters: [type] });
  if (answer.canceled || !answer.filePath) return null;
  exportTarget = { file: answer.filePath };
  return { name: path.basename(answer.filePath) };
});
handle('export-write', async (bytes) => {
  await writeSafely(exportTarget.file, Buffer.from(bytes));
});
handle('export-frame', async (name, bytes) => {
  await fs.writeFile(path.join(exportTarget.folder, path.basename(String(name))), Buffer.from(bytes));
});
handle('export-discard', async () => {
  // Only ever a folder this export created a moment ago.
  if (exportTarget?.folder) await fs.rm(exportTarget.folder, { recursive: true, force: true });
  exportTarget = null;
});
handle('export-show', () => {
  if (exportTarget?.file) shell.showItemInFolder(exportTarget.file);
  else if (exportTarget?.folder) return shell.openPath(exportTarget.folder).then(() => undefined);
});
handle('export-open', () => (exportTarget ? shell.openPath(exportTarget.file ?? exportTarget.folder).then(() => undefined) : undefined));

handle('autosave-write', (text) => writeSafely(autosavePath(), text));
handle('autosave-read', async () => {
  try {
    return { text: await fs.readFile(autosavePath(), 'utf8') };
  } catch {
    return null;
  }
});
handle('autosave-clear', removeAutosave);
handle('set-changed', (changed) => {
  hasChanges = changed;
});
handle('close-now', () => {
  closing = true;
  win.close();
});

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#161616',
    title: 'My Animator',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  // No default menu: its Undo/Redo shortcuts would fight with the app's own.
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // With unsaved changes, ask first. The page shows the question and closes the window itself.
  win.on('close', (event) => {
    if (closing || !hasChanges) return;
    event.preventDefault();
    win.webContents.send('close-requested');
  });

  // F12 opens developer tools (handy when reporting a problem).
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

app.setAppUserModelId('com.myanimator.app'); // so Windows shows this app's own icon on the taskbar
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
