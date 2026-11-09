/**
 * One floating box for every bit of help in the app: short tips on hover or keyboard focus,
 * richer cards on the tools, and information popups that stay open when clicked.
 * Any element with a `title` gets a tip automatically, including rows built later.
 */
export interface HintCard {
  title: string;
  keys?: string;
  body: string;
  foot?: string;
}

export const INFO: Record<string, HintCard> = {
  colour: { title: 'Colour', body: 'Click a swatch to set your drawing colour. Right-click a swatch to set the back colour, which fills the inside of filled shapes.' },
  layer: {
    title: 'Layers',
    body: 'Layers keep parts of your scene separate, so you can change one without touching the others.',
    foot: 'Vector layers stay sharp and can be reshaped. Bitmap layers are painted pixels.',
  },
  onion: {
    title: 'Onion skin',
    keys: 'O',
    body: 'Shows nearby drawings faintly while you draw, so you can see where the motion is coming from and going to.',
    foot: 'Red is before this frame, green is after it. Onion skin never appears in exports.',
  },
  reference: { title: 'Reference pictures', body: 'Bring in a picture to trace over. It stays still behind your drawing.', foot: 'Reference pictures are left out when you export.' },
  paper: { title: 'Paper', body: 'The background colour of your animation. Exports use this colour unless you turn the paper off.' },
};

const SHOW_DELAY = 450;
const WARM_FOR = 500;
const HIDE_GRACE = 140;
const SELECTOR = '[title],[data-tip],[data-card],[data-info]';

const cards = new WeakMap<Element, () => HintCard>();
const box = document.createElement('div');
box.className = 'popcard';
box.setAttribute('role', 'tooltip');
box.popover = 'manual';

let anchor: HTMLElement | null = null;
let pinned = false;
let showTimer = 0;
let hideTimer = 0;
let hiddenAt = 0;

/** Give an element a richer card, built fresh each time it's shown. */
export function hoverCard(el: HTMLElement, make: () => HintCard): void {
  cards.set(el, make);
  el.dataset.card = '';
}

export function hideHint(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (anchor) hiddenAt = performance.now();
  anchor?.setAttribute('aria-expanded', 'false');
  anchor = null;
  pinned = false;
  if (box.matches(':popover-open')) box.hidePopover();
}

/** Turn a native title into ours, keeping what a screen reader announces. */
function adopt(el: HTMLElement): void {
  const title = el.getAttribute('title');
  if (!title) return;
  el.dataset.tip = title;
  el.removeAttribute('title');
  if (el.hasAttribute('aria-label')) return;
  if (el.textContent?.trim()) el.setAttribute('aria-description', title);
  else el.setAttribute('aria-label', title);
}

/** "Undo (Ctrl+Z)" becomes the words plus a key label. */
function parseTip(text: string): HintCard {
  const found = /^(.*\S)\s*\(([^()]{1,14}|\?)\)$/.exec(text);
  const looksLikeKeys = found && /^(Ctrl\+.+|[A-Z?,.+−-]|Delete|Enter|Esc|Space|Home|End)$/.test(found[2]);
  return looksLikeKeys ? { title: '', body: found[1], keys: found[2] } : { title: '', body: text };
}

function contentFor(el: HTMLElement): HintCard | null {
  const make = cards.get(el);
  if (make) return make();
  if (el.dataset.info) return INFO[el.dataset.info] ?? null;
  return el.dataset.tip ? parseTip(el.dataset.tip) : null;
}

function fill(card: HintCard): void {
  box.replaceChildren();
  const add = (parent: HTMLElement, tag: string, cls: string, text: string) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    node.textContent = text;
    parent.append(node);
    return node;
  };
  const head = document.createElement('div');
  head.className = 'popcard-head';
  if (card.title) {
    add(head, 'strong', '', card.title);
    if (card.keys) add(head, 'kbd', '', card.keys);
    box.append(head);
    add(box, 'p', 'popcard-body', card.body);
  } else {
    add(head, 'span', '', card.body);
    if (card.keys) add(head, 'kbd', '', card.keys);
    box.append(head);
  }
  if (card.foot) add(box, 'p', 'popcard-foot', card.foot);
}

function place(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const w = box.offsetWidth;
  const h = box.offsetHeight;
  const gap = 8;
  const edge = 8;
  const beside = el.closest('.tool-rail, #tool-rail');
  let left: number;
  let top: number;
  if (beside) {
    left = r.right + gap;
    top = r.top + r.height / 2 - h / 2;
  } else {
    left = r.left + r.width / 2 - w / 2;
    top = r.bottom + h + gap + edge > innerHeight ? r.top - h - gap : r.bottom + gap;
  }
  box.style.left = `${Math.round(Math.max(edge, Math.min(innerWidth - w - edge, left)))}px`;
  box.style.top = `${Math.round(Math.max(edge, Math.min(innerHeight - h - edge, top)))}px`;
}

function show(el: HTMLElement): void {
  const card = contentFor(el);
  if (!card || !el.isConnected) return;
  clearTimeout(hideTimer);
  anchor = el;
  fill(card);
  // Showing it again puts it above any window that opened since.
  if (box.matches(':popover-open')) box.hidePopover();
  box.showPopover();
  place(el);
}

function showSoon(el: HTMLElement): void {
  clearTimeout(showTimer);
  const warm = anchor !== null || performance.now() - hiddenAt < WARM_FOR;
  showTimer = window.setTimeout(() => show(el), warm ? 0 : SHOW_DELAY);
}

function hideSoon(): void {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(hideHint, HIDE_GRACE);
}

export function setupHints(): void {
  document.body.append(box);

  document.addEventListener('pointerover', (e) => {
    if (pinned || e.pointerType === 'touch') return;
    const target = e.target as HTMLElement;
    if (box.contains(target)) return clearTimeout(hideTimer);
    const el = target.closest<HTMLElement>(SELECTOR);
    if (!el) return hideSoon();
    adopt(el);
    if (el === anchor) return clearTimeout(hideTimer);
    clearTimeout(hideTimer);
    showSoon(el);
  });

  document.addEventListener('focusin', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>(SELECTOR);
    if (!el || pinned) return;
    adopt(el);
    if ((e.target as HTMLElement).matches(':focus-visible')) show(el);
  });
  document.addEventListener('focusout', () => {
    if (!pinned) hideSoon();
  });

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    if (!box.contains(target) && !target.closest('[data-info]')) hideHint();
  });

  document.addEventListener('click', (e) => {
    const info = (e.target as HTMLElement).closest<HTMLElement>('[data-info]');
    if (!info) return;
    e.preventDefault();
    if (pinned && anchor === info) return hideHint();
    hideHint();
    show(info);
    pinned = true;
    info.setAttribute('aria-expanded', 'true');
  });

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || !anchor) return;
      if (pinned) e.stopPropagation();
      hideHint();
    },
    true,
  );
}
