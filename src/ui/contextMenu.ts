export type MenuItem =
  | { label: string; shortcut?: string; action: () => void; disabled?: boolean; icon?: string; current?: boolean }
  | 'separator';

let open: HTMLDivElement | null = null;

/** Close the right-click menu if one is showing. */
export function closeMenu(): void {
  open?.remove();
  open = null;
}

/** Show a right-click menu at page position (x, y). */
export function showMenu(x: number, y: number, items: MenuItem[]): void {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  for (const item of items) {
    if (item === 'separator') {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'cm-sep' }));
      continue;
    }
    const row = document.createElement('button');
    row.className = 'cm-item' + (item.current ? ' current' : '');
    row.disabled = !!item.disabled;
    row.innerHTML = `<span class="cm-label">${item.icon ?? ''}<span>${item.label}</span></span><kbd>${item.shortcut ?? ''}</kbd>`;
    row.addEventListener('click', () => {
      closeMenu();
      item.action();
    });
    menu.appendChild(row);
  }
  document.body.appendChild(menu);
  // keep it on screen
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - r.width - 6)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - r.height - 6)}px`;
  open = menu;
}

// Close on any click elsewhere, Escape, scroll or window resize.
window.addEventListener('pointerdown', (e) => {
  if (open && !open.contains(e.target as Node)) closeMenu();
}, true);
window.addEventListener('keydown', (e) => {
  if (open && e.key === 'Escape') closeMenu();
});
window.addEventListener('resize', closeMenu);
window.addEventListener('wheel', closeMenu, { passive: true });
