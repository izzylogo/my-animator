/**
 * The round brush/eraser cursor: a ring whose size matches the brush on screen.
 * It's drawn as a black ring with a white ring inside, so it shows on light and dark art.
 */
export class RingCursor {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'ring-cursor';
    parent.appendChild(this.el);
    this.hide();
  }

  /** x/y are page coordinates; diameter is in screen pixels. */
  show(x: number, y: number, diameter: number, dashed: boolean): void {
    const d = Math.max(4, diameter);
    const s = this.el.style;
    s.display = 'block';
    s.width = s.height = `${d}px`;
    s.transform = `translate(${x - d / 2}px, ${y - d / 2}px)`;
    this.el.classList.toggle('dashed', dashed);
    this.el.classList.toggle('tiny', diameter < 6);
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
