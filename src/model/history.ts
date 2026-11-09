/** Undo/redo: every change is a small object that knows how to undo and redo itself. */
export interface Command {
  label: string;
  undo(): void;
  redo(): void;
}

export class History {
  private done: Command[] = [];
  private undone: Command[] = [];

  constructor(private limit = 50, private onChange: () => void = () => {}) {}

  /** Forget everything (a different file has been opened). */
  clear(): void {
    this.done = [];
    this.undone = [];
  }

  /** Record a change that has ALREADY been applied. */
  push(cmd: Command): void {
    this.done.push(cmd);
    if (this.done.length > this.limit) this.done.shift();
    this.undone = [];
    this.onChange();
  }

  /** Apply a change now and record it. */
  run(cmd: Command): void {
    cmd.redo();
    this.push(cmd);
  }

  undo(): void {
    const cmd = this.done.pop();
    if (!cmd) return;
    cmd.undo();
    this.undone.push(cmd);
    this.onChange();
  }

  redo(): void {
    const cmd = this.undone.pop();
    if (!cmd) return;
    cmd.redo();
    this.done.push(cmd);
    this.onChange();
  }
}
