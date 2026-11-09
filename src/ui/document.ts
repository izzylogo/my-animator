import { askChoice } from './dialog';

interface Problem {
  error: string;
}
interface Saved {
  name: string;
}
interface Picked {
  text: string;
  name: string;
}

/** What the desktop side offers. Missing when the page runs in an ordinary browser. */
interface FileBridge {
  save(text: string, suggested: string): Promise<Saved | Problem | null>;
  saveAs(text: string, suggested: string): Promise<Saved | Problem | null>;
  open(): Promise<Picked | Problem | null>;
  opened(): Promise<unknown>;
  forget(): Promise<unknown>;
  autosave(text: string): Promise<unknown>;
  recovered(): Promise<{ text: string } | Problem | null>;
  clearAutosave(): Promise<unknown>;
  setChanged(changed: boolean): Promise<unknown>;
  closeNow(): Promise<unknown>;
  onCloseRequested(listener: () => void): void;
}

declare global {
  interface Window {
    animatorFiles?: FileBridge;
  }
}

export interface DocumentHost {
  /** Put down anything half-finished, so it's included in the file. */
  settle(): void;
  toText(): string;
  /** Read a file and show it. Throws, leaving your work alone, if the file can't be read. */
  load(text: string): Promise<void>;
  startBlank(): void;
  /** Is it safe to take a background copy right now? */
  idle(): boolean;
  status(text: string): void;
  settings(): string;
}

const AUTOSAVE_EVERY = 60_000;
const isProblem = (x: object): x is Problem => 'error' in x;

/** Tracks which file you're in, whether it has unsaved changes, and everything that writes it. */
export class ProjectDocument {
  private name: string | null = null;
  private changed = false;
  private needsAutosave = false;
  private settled: string;
  private asking = false;

  constructor(private host: DocumentHost, private showName: (name: string, changed: boolean) => void) {
    this.settled = host.settings();
    this.show();
    const files = window.animatorFiles;
    if (!files) return;
    files.onCloseRequested(() => void this.closeWindow());
    window.setInterval(() => void this.autosave(), AUTOSAVE_EVERY);
    void this.offerRecovery();
  }

  private get title(): string {
    return this.name ?? 'Untitled';
  }

  private show(): void {
    this.showName(this.title, this.changed);
    document.title = `${this.changed ? '* ' : ''}${this.title} - My Animator`;
  }

  private setChanged(changed: boolean): void {
    if (changed) this.needsAutosave = true;
    if (changed === this.changed) return;
    this.changed = changed;
    this.show();
    void window.animatorFiles?.setChanged(changed);
  }

  /** Call whenever the drawings change. */
  markChanged(): void {
    this.setChanged(true);
  }

  /** Settings that don't go through undo (speed, layer switches...) are noticed by comparing them. */
  watch(settings: string): void {
    if (settings !== this.settled) {
      this.settled = settings;
      this.markChanged();
    }
  }

  /** The state on screen now is the state in the file. */
  private markClean(): void {
    this.settled = this.host.settings();
    this.needsAutosave = false;
    this.setChanged(false);
    this.show(); // the name may have changed even if the saved state didn't
  }

  private tell(title: string, text: string): Promise<unknown> {
    return askChoice(title, text, [{ label: 'Close', value: true, primary: true }]);
  }

  private unavailable(): void {
    this.host.status('Saving works in the desktop app. Double-click Start Animator.bat to use it.');
  }

  /** Returns true if the work is safely in a file. */
  async save(askWhere = false): Promise<boolean> {
    const files = window.animatorFiles;
    if (!files) {
      this.unavailable();
      return false;
    }
    this.host.settle();
    let result;
    try {
      const text = this.host.toText();
      result = await (askWhere ? files.saveAs(text, this.title) : files.save(text, this.title));
    } catch (problem) {
      result = { error: String(problem) };
    }
    if (!result) return false;
    if (isProblem(result)) {
      await this.tell('Unable to save', `Your work is still open here. Choose Save as and pick another folder, or check that the disk has space. (${result.error})`);
      return false;
    }
    this.name = result.name;
    this.markClean();
    this.host.status(`Saved ${result.name}.`);
    return true;
  }

  /** Ask about unsaved work. Returns false if you'd rather stay where you are. */
  private async readyToLeave(): Promise<boolean> {
    this.host.settle();
    if (!this.changed) return true;
    if (this.asking) return false;
    this.asking = true;
    const choice = await askChoice<'save' | 'discard'>(`Save changes to ${this.title}?`, "Your latest changes will be lost if you don't save them.", [
      { label: 'Cancel', value: null as never },
      { label: "Don't save", value: 'discard' },
      { label: 'Save', value: 'save', primary: true },
    ]);
    this.asking = false;
    if (!choice) return false;
    return choice === 'discard' || this.save();
  }

  async newProject(): Promise<void> {
    if (!(await this.readyToLeave())) return;
    this.host.startBlank();
    await window.animatorFiles?.forget();
    this.name = null;
    this.markClean();
    this.host.status('New project.');
  }

  async open(): Promise<void> {
    const files = window.animatorFiles;
    if (!files) return this.unavailable();
    if (!(await this.readyToLeave())) return;
    const picked = await files.open();
    if (!picked) return;
    if (isProblem(picked)) {
      await this.tell('Unable to open that file', `Check that it still exists and try again. (${picked.error})`);
      return;
    }
    try {
      await this.host.load(picked.text);
    } catch (problem) {
      await this.tell(`Unable to open ${picked.name}`, `The file may be damaged. Your current work hasn't been changed. (${problem instanceof Error ? problem.message : problem})`);
      return;
    }
    await files.opened();
    this.name = picked.name;
    this.markClean();
    this.host.status(`Opened ${picked.name}.`);
  }

  private async autosave(): Promise<void> {
    if (!this.changed || !this.needsAutosave || !this.host.idle()) return;
    this.needsAutosave = false;
    await window.animatorFiles?.autosave(this.host.toText());
  }

  private async offerRecovery(): Promise<void> {
    const files = window.animatorFiles!;
    const found = await files.recovered();
    if (!found || isProblem(found)) return;
    const choice = await askChoice<'restore' | 'discard'>('Bring back your unsaved work?', 'My Animator closed before your latest changes were saved. A recent copy was kept.', [
      { label: 'Discard it', value: 'discard' },
      { label: 'Bring it back', value: 'restore', primary: true },
    ]);
    if (choice === 'discard') {
      await files.clearAutosave();
    } else if (choice === 'restore') {
      try {
        await this.host.load(found.text);
        this.name = null;
        this.markChanged();
        this.host.status('Your work is back. Save it to keep it.');
      } catch {
        await this.tell('Unable to bring back that copy', 'The copy was damaged, so nothing has been changed.');
      }
    }
  }

  private async closeWindow(): Promise<void> {
    if (!(await this.readyToLeave())) return;
    const files = window.animatorFiles!;
    await files.clearAutosave();
    await files.closeNow();
  }
}
