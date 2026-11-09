/**
 * Plays frames at the chosen frame rate. It works from the clock, not by counting
 * screen refreshes, so if the laptop is busy it skips frames instead of slowing down.
 *
 * To keep motion even, the clock starts on the first screen refresh, and frame changes are
 * placed half a refresh away from the moments the screen updates. Without that, tiny timing
 * wobbles make a frame stay up for 4 refreshes, then 6, which the eye sees as jitter.
 */
export class Player {
  playing = false;
  loop = true;
  private startTime = -1;
  private startFrame = 0;
  private lastFrame = -1;
  private lastTick = -1;
  private refresh = 1000 / 60; // measured length of one screen refresh, in ms
  private raf = 0;

  constructor(
    private getFps: () => number,
    private getLength: () => number,
    private onFrame: (frame: number) => void,
    private onStop: () => void,
  ) {}

  play(fromFrame: number): void {
    if (this.playing) return;
    const length = this.getLength();
    // Pressing play on the last frame starts again from the beginning.
    this.startFrame = fromFrame >= length - 1 ? 0 : fromFrame;
    this.startTime = -1;
    this.lastTick = -1;
    this.lastFrame = this.startFrame;
    this.playing = true;
    this.onFrame(this.startFrame);
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.onStop();
  }

  private tick = (now: number) => {
    if (!this.playing) return;
    if (this.startTime < 0) this.startTime = now;
    if (this.lastTick >= 0) {
      const gap = now - this.lastTick;
      if (gap > 4 && gap < 40) this.refresh += (gap - this.refresh) * 0.1;
    }
    this.lastTick = now;
    const length = this.getLength();
    const elapsedFrames = Math.floor(((now - this.startTime + this.refresh / 2) * this.getFps()) / 1000);
    let frame = this.startFrame + elapsedFrames;
    if (frame >= length) {
      if (this.loop) {
        frame = frame % length;
      } else {
        this.onFrame(length - 1);
        this.stop();
        return;
      }
    }
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      this.onFrame(frame);
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}
