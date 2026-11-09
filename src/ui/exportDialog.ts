import { ExportCancelled, canMakeMp4, runExport, type ExportFormat, type ExportJob, type ExportSink } from '../export/exporter';
import type { Project } from '../model/project';

export interface ExportHost {
  project: Project;
  fileTitle(): string;
  settle(): void;
  draw(ctx: CanvasRenderingContext2D, frame: number, width: number, paper: boolean): void;
}

const FORMATS: { id: ExportFormat; name: string; about: string; button: string }[] = [
  { id: 'mp4', name: 'Video (MP4)', about: 'Best for YouTube, TikTok and sharing.', button: 'Export MP4' },
  { id: 'gif', name: 'GIF', about: 'A short silent loop for chats and websites.', button: 'Export GIF' },
  { id: 'png', name: 'PNG pictures', about: 'One picture per frame, for video editing apps.', button: 'Export PNGs' },
  { id: 'webm', name: 'Transparent video (WebM)', about: 'No background, for placing over footage. Some editors can’t read it; if yours can’t, use PNG pictures.', button: 'Export WebM' },
];

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The Export window: choose, watch a preview, export, then open what you made. */
export function setupExport(host: ExportHost): { open(): void; isOpen(): boolean } {
  const dialog = element<HTMLDialogElement>('export');
  const size = element<HTMLSelectElement>('ex-size');
  const paper = element<HTMLInputElement>('ex-paper');
  const from = element<HTMLInputElement>('ex-from');
  const to = element<HTMLInputElement>('ex-to');
  const preview = element<HTMLCanvasElement>('ex-preview').getContext('2d')!;
  const problem = element('ex-problem');
  const views = { setup: element('ex-setup'), working: element('ex-working'), done: element('ex-done') };

  let format: ExportFormat = 'mp4';
  let sizeChosen = false;
  let busy = false;
  let stopRequested = false;
  let previewTimer = 0;
  let previewFrame = 0;

  const holder = element('ex-formats');
  for (const f of FORMATS) {
    const label = document.createElement('label');
    label.className = 'ex-format';
    label.innerHTML = `<input type="radio" name="ex-format" value="${f.id}" /><span><strong></strong><small></small></span>`;
    label.querySelector('strong')!.textContent = f.name;
    label.querySelector('small')!.textContent = f.about;
    const radio = label.querySelector('input')!;
    radio.checked = f.id === format;
    radio.onchange = () => {
      format = f.id;
      refresh();
    };
    holder.append(label);
  }

  const partOnly = () => element<HTMLInputElement>('ex-part').checked;
  const showView = (name: keyof typeof views) => (Object.keys(views) as (keyof typeof views)[]).forEach((k) => (views[k].hidden = k !== name));

  /** The chosen frames, counted from 0, or null if the numbers aren't usable. */
  function range(): { first: number; last: number } | null {
    const length = host.project.length;
    if (!partOnly()) return { first: 0, last: length - 1 };
    const a = Number(from.value);
    const b = Number(to.value);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b > length || a > b) return null;
    return { first: a - 1, last: b - 1 };
  }

  /** Does this format keep the paper? MP4 has to, and transparent video never does. */
  const keepsPaper = () => (format === 'mp4' ? true : format === 'webm' ? false : paper.checked);

  function refresh(): void {
    if (format === 'gif' && !sizeChosen) size.value = '640';
    else if (!sizeChosen) size.value = '1280';
    element('ex-paper-row').hidden = format === 'mp4' || format === 'webm';
    from.disabled = to.disabled = !partOnly();
    element('ex-go').textContent = FORMATS.find((f) => f.id === format)!.button;
    element('ex-stage').classList.toggle('see-through', !keepsPaper());
    const r = range();
    const fps = host.project.fps;
    element('ex-summary').textContent = r ? `${plural(r.last - r.first + 1, 'frame')} · ${((r.last - r.first + 1) / fps).toFixed(1)} seconds · ${fps} frames per second` : '';
    element('ex-range-error').textContent = r ? '' : `Enter frames from 1 to ${host.project.length}, with the first number no bigger than the second.`;
    previewFrame = r ? r.first : 0;
    drawPreview();
  }

  function drawPreview(): void {
    host.draw(preview, previewFrame, preview.canvas.width, keepsPaper());
  }

  function startPreview(): void {
    clearInterval(previewTimer);
    drawPreview();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    previewTimer = window.setInterval(() => {
      const r = range();
      if (!r || busy) return;
      previewFrame = previewFrame >= r.last || previewFrame < r.first ? r.first : previewFrame + 1;
      drawPreview();
    }, 1000 / host.project.fps);
  }

  async function go(): Promise<void> {
    const files = window.animatorFiles;
    const r = range();
    if (!r) return refresh();
    problem.textContent = '';
    if (!files) {
      problem.textContent = 'Exporting works in the desktop app. Open My Animator from your Desktop icon.';
      return;
    }
    const picked = await files.exportPick(format === 'png' ? 'folder' : format, host.fileTitle());
    if (!picked) return;
    if ('error' in picked) {
      problem.textContent = `Unable to use that location. Choose another folder and try again. (${picked.error})`;
      return;
    }
    busy = true;
    stopRequested = false;
    showView('working');
    const bar = element<HTMLProgressElement>('ex-bar');
    bar.value = 0;
    element('ex-count').textContent = 'Getting ready…';

    const width = Number(size.value);
    const height = Math.round((width * host.project.height) / host.project.width);
    const withPaper = keepsPaper();
    const job: ExportJob = {
      format,
      from: r.first,
      to: r.last,
      width,
      height,
      fps: host.project.fps,
      paper: withPaper,
      baseName: host.fileTitle().replace(/[^\w -]/g, '_') || 'frame',
      draw: (ctx, frame) => host.draw(ctx, frame, width, withPaper),
    };
    const sink: ExportSink = {
      file: async (bytes) => {
        const result = await files.exportWrite(bytes);
        if (result && 'error' in result) throw new Error(result.error);
      },
      frame: async (name, bytes) => {
        const result = await files.exportFrame(name, bytes);
        if (result && 'error' in result) throw new Error(result.error);
      },
    };
    try {
      await runExport(job, sink, {
        cancelled: () => stopRequested,
        progress: (done, total) => {
          bar.max = total;
          bar.value = done;
          element('ex-count').textContent = `Frame ${done} of ${total}`;
        },
      });
      element('ex-done-name').textContent = picked.name;
      showView('done');
      element('ex-show').focus();
    } catch (failure) {
      await files.exportDiscard();
      showView('setup');
      if (!(failure instanceof ExportCancelled)) problem.textContent = `Unable to finish the export. Check that the disk has space and try again. (${failure instanceof Error ? failure.message : failure})`;
    } finally {
      busy = false;
    }
  }

  element('ex-go').onclick = () => void go();
  element('ex-close').onclick = () => dialog.close();
  element('ex-cancel').onclick = () => (stopRequested = true);
  element('ex-finish').onclick = () => dialog.close();
  element('ex-show').onclick = () => void window.animatorFiles?.exportShow();
  element('ex-open').onclick = () => void window.animatorFiles?.exportOpen();
  size.onchange = () => {
    sizeChosen = true;
    refresh();
  };
  paper.onchange = refresh;
  from.oninput = to.oninput = refresh;
  element<HTMLInputElement>('ex-all').onchange = element<HTMLInputElement>('ex-part').onchange = refresh;
  dialog.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  dialog.addEventListener('close', () => clearInterval(previewTimer));

  return {
    open() {
      host.settle();
      problem.textContent = '';
      showView('setup');
      const length = host.project.length;
      from.max = to.max = String(length);
      from.value = '1';
      to.value = String(length);
      void canMakeMp4().then((able) => {
        const radio = holder.querySelector<HTMLInputElement>('input[value="mp4"]')!;
        radio.disabled = !able;
        if (able) return;
        radio.closest('label')!.querySelector('small')!.textContent = 'Not available on this computer.';
        if (format === 'mp4') {
          format = 'gif';
          holder.querySelector<HTMLInputElement>('input[value="gif"]')!.checked = true;
          refresh();
        }
      });
      refresh();
      dialog.showModal();
      startPreview();
    },
    isOpen: () => dialog.open,
  };
}
