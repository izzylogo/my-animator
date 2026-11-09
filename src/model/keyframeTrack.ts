/**
 * A timeline row: a sparse "frame number -> keyframe" list (the same idea as Krita's
 * KisKeyframeChannel). Only frames that HAVE a keyframe are stored. A held frame is
 * worked out on the fly: "the last keyframe at or before this frame".
 *
 * It's generic (T), so later phases can reuse it for numbers (opacity, position...)
 * that get tweened between keys.
 */
export class KeyframeTrack<T> {
  private keys = new Map<number, T>();
  /** Keyframe times, always sorted ascending. */
  private times: number[] = [];

  get(frame: number): T | undefined {
    return this.keys.get(frame);
  }

  has(frame: number): boolean {
    return this.keys.has(frame);
  }

  set(frame: number, value: T): void {
    if (!this.keys.has(frame)) {
      this.times.splice(this.insertIndex(frame), 0, frame);
    }
    this.keys.set(frame, value);
  }

  delete(frame: number): T | undefined {
    const old = this.keys.get(frame);
    if (old === undefined) return undefined;
    this.keys.delete(frame);
    this.times.splice(this.times.indexOf(frame), 1);
    return old;
  }

  allTimes(): readonly number[] {
    return this.times;
  }

  get count(): number {
    return this.times.length;
  }

  /** Time of the keyframe that is "showing" at `frame` (held or exact), or null if none yet. */
  activeTime(frame: number): number | null {
    const i = this.insertIndex(frame + 1) - 1; // last time <= frame
    return i >= 0 ? this.times[i] : null;
  }

  active(frame: number): T | undefined {
    const t = this.activeTime(frame);
    return t === null ? undefined : this.keys.get(t);
  }

  /** Last keyframe strictly before `frame`. */
  prevTime(frame: number): number | null {
    const i = this.insertIndex(frame) - 1;
    return i >= 0 ? this.times[i] : null;
  }

  /** First keyframe strictly after `frame`. */
  nextTime(frame: number): number | null {
    const i = this.insertIndex(frame + 1);
    return i < this.times.length ? this.times[i] : null;
  }

  /** Move every keyframe at or after `from` by `delta` frames (used for "hold longer/shorter"). */
  shiftFrom(from: number, delta: number): void {
    const moved: [number, T][] = [];
    for (const t of this.times) if (t >= from) moved.push([t, this.keys.get(t)!]);
    for (const [t] of moved) this.delete(t);
    for (const [t, v] of moved) this.set(t + delta, v);
  }

  /** Index of the first time >= frame (binary search). */
  private insertIndex(frame: number): number {
    let lo = 0;
    let hi = this.times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] < frame) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
}
