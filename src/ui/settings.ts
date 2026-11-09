import { DEFAULT_THEME, applyTheme, loadTheme, saveTheme, type Theme } from './theme';

const ACCENTS = [
  ['White', '#f2f2f2'],
  ['Orange', '#ff7a1a'],
  ['Red', '#f0444f'],
  ['Pink', '#ff5fa2'],
  ['Yellow', '#ffd23f'],
  ['Green', '#35c46a'],
  ['Teal', '#19bfae'],
  ['Blue', '#3b8bff'],
];

const BASES = [
  ['Graphite', '#333333'],
  ['Black', '#1b1b1b'],
  ['Slate', '#2b3440'],
  ['Forest', '#2a3a32'],
  ['Wine', '#3b2a30'],
  ['Walnut', '#3a342c'],
  ['Light grey', '#d9d9d9'],
  ['White', '#f4f4f4'],
];

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Wires up the Settings window. `changed` runs whenever the colours do. */
export function setupSettings(changed: () => void): { open(): void; isOpen(): boolean } {
  const box = element<HTMLDialogElement>('settings');
  let theme: Theme = loadTheme();

  const row = (holder: string, picker: string, part: keyof Theme, colours: string[][]) => {
    const swatches = element(holder);
    const custom = element<HTMLInputElement>(picker);
    const buttons = colours.map(([name, hex]) => {
      const b = document.createElement('button');
      b.className = 'set-swatch';
      b.style.background = hex;
      b.setAttribute('aria-label', name);
      b.title = name;
      b.onclick = () => choose(part, hex);
      swatches.append(b);
      return b;
    });
    custom.oninput = () => choose(part, custom.value);
    return () => {
      custom.value = theme[part];
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(colours[i][1] === theme[part])));
    };
  };

  const shows = [row('set-accents', 'set-accent', 'accent', ACCENTS), row('set-bases', 'set-base', 'base', BASES)];
  const show = () => shows.forEach((s) => s());

  function apply(): void {
    applyTheme(theme);
    saveTheme(theme);
    show();
    changed();
  }

  function choose(part: keyof Theme, hex: string): void {
    theme = { ...theme, [part]: hex };
    apply();
  }

  element('set-reset').onclick = () => {
    theme = { ...DEFAULT_THEME };
    apply();
  };
  element('set-done').onclick = () => box.close();
  box.addEventListener('click', (e) => {
    if (e.target === box) box.close();
  });

  applyTheme(theme);
  show();
  return {
    open: () => box.showModal(),
    isOpen: () => box.open,
  };
}
