/** Simple line icons, drawn for this app (24×24, use the current text colour). */
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons: Record<string, string> = {
  brush: svg('<path d="M14.5 4.5l5 5L10 19H5v-5z"/><path d="M12.5 6.5l5 5"/>'),
  eraser: svg('<path d="M4 15.5l9-9a2 2 0 0 1 2.8 0l3.7 3.7a2 2 0 0 1 0 2.8L13 19.5H8z"/><path d="M8.5 11l5 5"/><path d="M13 19.5h7"/>'),
  line: svg('<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.3" fill="currentColor"/><circle cx="19" cy="5" r="1.3" fill="currentColor"/>'),
  rect: svg('<rect x="4.5" y="6" width="15" height="12" rx="1"/>'),
  ellipse: svg('<ellipse cx="12" cy="12" rx="8" ry="6"/>'),
  pen: svg('<path d="M12 3l5.5 9.5L13.5 21h-3l-4-8.5z"/><path d="M12 3v9"/><circle cx="12" cy="13" r="1.4"/>'),
  points: svg('<path d="M4 18C8 5 16 5 20 18"/><rect x="2" y="16" width="4" height="4" fill="currentColor"/><rect x="18" y="16" width="4" height="4" fill="currentColor"/><circle cx="12" cy="8.2" r="2.4" fill="currentColor"/>'),
  reshape: svg('<path d="M3 17c4-9 7-9 9-5s5 4 9-5"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/>'),
  poly: svg('<path d="M12 3.5l8.5 6.2-3.2 10h-10.6l-3.2-10z"/>'),
  rotview: svg('<path d="M20 12a8 8 0 1 1-2.5-5.8"/><path d="M20 3v5h-5"/>'),
  move: svg('<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>'),
  select: svg('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M12 4h0M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 12h0M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M12 20h0M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h0" stroke-dasharray="0"/>'),
  lasso: svg('<path d="M7.5 15.5C4.5 14 3.5 11.8 4.4 9.6 5.7 6.4 10 4.5 14.3 5.2 18.6 5.9 21 8.6 20 11.6c-.9 2.8-4.6 4.6-8.8 4.4"/><path d="M7.5 15.5c-1 1.2-.4 2.7.9 3 1.1.3 2-.4 2-1.4 0-1.3-1.4-2-2.9-1.6z"/><path d="M8.6 19c.2 1.1-.2 1.8-1 2.2"/>'),
  text: svg('<path d="M5 6.5V5h14v1.5M12 5v14M9.5 19h5"/>'),
  swap: svg('<path d="M7 4L4 7l3 3"/><path d="M4 7h11a4 4 0 0 1 4 4"/><path d="M17 20l3-3-3-3"/><path d="M20 17H9a4 4 0 0 1-4-4"/>'),
  fill: svg('<path d="M5 11l6.5-6.5 7 7L12 18a2 2 0 0 1-2.8 0L5 13.8a2 2 0 0 1 0-2.8z"/><path d="M5 11h13.5"/><path d="M20 15.5s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3z" fill="currentColor"/>'),
  picker: svg('<path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5z"/><path d="M12.5 7.5L5 15v4h4l7.5-7.5"/>'),
  hand: svg('<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11"/><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5"/><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L4 15.2a1.6 1.6 0 0 1 2.4-2.1L8 14.5"/>'),
  zoomIn: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>'),
  zoomOut: svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5"/>'),
  fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  undo: svg('<path d="M9 7L4.5 11.5 9 16"/><path d="M5 11.5h9a5 5 0 0 1 0 10h-2"/>'),
  redo: svg('<path d="M15 7l4.5 4.5L15 16"/><path d="M19 11.5h-9a5 5 0 0 0 0 10h2"/>'),
  first: svg('<path d="M6 5v14"/><path d="M18 6l-8 6 8 6z"/>'),
  prev: svg('<path d="M15 6l-7 6 7 6"/>'),
  next: svg('<path d="M9 6l7 6-7 6"/>'),
  last: svg('<path d="M18 5v14"/><path d="M6 6l8 6-8 6z"/>'),
  play: svg('<path d="M8 5.5l11 6.5-11 6.5z" fill="currentColor"/>'),
  pause: svg('<rect x="7" y="5.5" width="3.5" height="13" fill="currentColor"/><rect x="13.5" y="5.5" width="3.5" height="13" fill="currentColor"/>'),
  loop: svg('<path d="M17 4l3 3-3 3"/><path d="M4 12v-1a4 4 0 0 1 4-4h12"/><path d="M7 20l-3-3 3-3"/><path d="M20 12v1a4 4 0 0 1-4 4H4"/>'),
  newFrame: svg('<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M12 9v6M9 12h6"/>'),
  copyFrame: svg('<rect x="8" y="7" width="11" height="13" rx="1.5"/><path d="M5 16V5.5A1.5 1.5 0 0 1 6.5 4H15"/>'),
  clearFrame: svg('<rect x="5" y="4" width="14" height="16" rx="1.5"/><path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>'),
  longer: svg('<path d="M4 12h12"/><path d="M13 8l4 4-4 4"/><path d="M20 6v12"/>'),
  shorter: svg('<path d="M20 12H8"/><path d="M11 8l-4 4 4 4"/><path d="M4 6v12"/>'),
  layerAdd: svg('<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M18 15v6M15 18h6"/>'),
  layerDel: svg('<path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M15 18h6"/>'),
  eye: svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: svg('<path d="M4 4l16 16"/><path d="M9.8 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3 3.8"/><path d="M6.2 7.8A16 16 0 0 0 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4-.9"/>'),
  lock: svg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5" fill="currentColor"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 7 0v3"/>'),
  unlock: svg('<rect x="5.5" y="10.5" width="13" height="9.5" rx="1.5"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.6-1.6"/>'),
  folder: svg('<path d="M3.5 18.5v-13h6l2 2.5h9v10.5z"/>'),
  folderAdd: svg('<path d="M3.5 18.5v-13h6l2 2.5h9v10.5z"/><path d="M12 11v5M9.5 13.5h5"/>'),
  pageAdd: svg('<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  trash: svg('<path d="M4.5 6.5h15M9.5 6.5v-3h5v3M6.5 6.5l1 14h9l1-14M10.5 10.5v6M13.5 10.5v6"/>'),
  caretOpen: svg('<path d="M6 9l6 7 6-7z" fill="currentColor"/>'),
  caretClosed: svg('<path d="M9 6l7 6-7 6z" fill="currentColor"/>'),
  dot: svg('<circle cx="12" cy="12" r="3.2" fill="currentColor"/>'),
  outlineBox: svg('<rect x="7.5" y="5" width="9" height="14" rx="0.5"/>'),
  settings: svg('<path d="M4 7h9M18 7h2M4 17h2M11 17h9"/><circle cx="15.5" cy="7" r="2.5"/><circle cx="8.5" cy="17" r="2.5"/>'),
  help: svg('<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9"/><circle cx="12" cy="16.6" r=".6" fill="currentColor"/>'),
};

/** Put icons into every element that has data-icon="name". */
export function applyIcons(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-icon]').forEach((el) => {
    const icon = icons[el.dataset.icon!];
    if (icon) el.insertAdjacentHTML('afterbegin', icon);
  });
}
