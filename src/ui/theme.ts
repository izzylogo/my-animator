/** The app's look: two colours you choose, and every other interface colour worked out from them. */
export interface Theme {
  accent: string;
  base: string;
}

export const DEFAULT_THEME: Theme = { accent: '#f2f2f2', base: '#333333' };

const STORE_KEY = 'my-animator-theme';
const WHITE = '#ffffff';
const BLACK = '#000000';
const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

export function loadTheme(): Theme {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return { accent: isHex(saved.accent) ? saved.accent : DEFAULT_THEME.accent, base: isHex(saved.base) ? saved.base : DEFAULT_THEME.base };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(theme));
  } catch {
    // the choice still applies until the app closes
  }
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function mix(a: string, b: string, t: number): string {
  const to = channels(b);
  return `#${channels(a)
    .map((v, i) => Math.round(v + (to[i] - v) * t).toString(16).padStart(2, '0'))
    .join('')}`;
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every interface colour for a theme. Any choice of colours stays readable. */
export function themeColours(theme: Theme): Record<string, string> {
  let base = theme.base;
  const dark = luminance(base) < 0.18;
  const lighter = dark ? WHITE : BLACK; // raised surfaces step this way, away from the base
  const deeper = dark ? BLACK : WHITE;
  const text = dark ? '#f2f2f2' : '#1e1e1e';
  const dim = dark ? '#c4c4c4' : '#484848';
  for (let i = 0; i < 60 && contrast(dim, mix(base, lighter, 0.083)) < 4.5; i++) base = mix(base, deeper, 0.05);

  let edge = 0.377;
  while (edge < 0.9 && contrast(mix(base, lighter, edge), base) < 3) edge += 0.03;

  let accent = theme.accent;
  for (let i = 0; i < 30 && contrast(accent, base) < 3; i++) accent = mix(accent, text, 0.1);
  const onAccent = contrast(accent, '#1e1e1e') >= contrast(accent, WHITE) ? '#1e1e1e' : WHITE;

  return {
    '--bg': mix(base, deeper, 0.176),
    '--stage': mix(base, lighter, 0.113),
    '--panel': base,
    '--panel-2': mix(base, lighter, 0.083),
    '--panel-3': mix(base, lighter, 0.152),
    '--line': mix(base, lighter, 0.127),
    '--line-soft': mix(base, lighter, 0.064),
    '--control-edge': mix(base, lighter, edge),
    '--row-active': mix(base, lighter, 0.088),
    '--text': text,
    '--text-dim': dim,
    '--focus': dark ? WHITE : BLACK,
    '--accent': accent,
    '--on-accent': onAccent,
    '--accent-soft': `${accent}2e`,
    '--accent-hover': onAccent === WHITE ? mix(accent, BLACK, 0.14) : mix(accent, WHITE, 0.3),
    '--past-end': dark ? 'rgba(0, 0, 0, 0.25)' : 'rgba(0, 0, 0, 0.08)',
    // Amber always means keyframes and red the playhead; on a light base they go deeper to show up.
    '--key': dark ? '#ffc861' : '#a85f00',
    '--on-key': dark ? '#1e1e1e' : WHITE,
    '--key-hover': dark ? '#ffd688' : '#8f5100',
    '--hold': dark ? 'rgba(255, 200, 97, 0.45)' : 'rgba(168, 95, 0, 0.45)',
    '--hold-blank': dark ? 'rgba(196, 196, 196, 0.3)' : 'rgba(72, 72, 72, 0.3)',
    '--empty': dark ? '#a0a0a0' : '#666666',
    '--playhead': dark ? '#ff5f6d' : '#d0202f',
    '--playhead-fill': dark ? 'rgba(255, 95, 109, 0.16)' : 'rgba(208, 32, 47, 0.14)',
    '--seconds': dark ? '#dcdcdc' : '#303030',
    'color-scheme': dark ? 'dark' : 'light',
  };
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement.style;
  for (const [name, value] of Object.entries(themeColours(theme))) root.setProperty(name, value);
}
