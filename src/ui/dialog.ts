export interface Choice<T> {
  label: string;
  value: T;
  primary?: boolean;
}

/** A small question box. Resolves with the chosen value, or null if dismissed with Esc. */
export function askChoice<T>(title: string, text: string, choices: Choice<T>[]): Promise<T | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ask-back';
    const box = document.createElement('div');
    box.className = 'ask-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    const row = document.createElement('div');
    row.className = 'ask-buttons';
    box.append(h, p, row);
    back.append(box);

    const done = (value: T | null) => {
      window.removeEventListener('keydown', keys, true);
      back.remove();
      resolve(value);
    };
    const keys = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        done((choices.find((c) => c.primary) ?? choices[0]).value);
      }
    };
    for (const c of choices) {
      const b = document.createElement('button');
      b.textContent = c.label;
      if (c.primary) b.className = 'primary';
      b.onclick = () => done(c.value);
      row.append(b);
    }
    window.addEventListener('keydown', keys, true);
    document.body.append(back);
  });
}

/** Ask for a whole number between min and max. Resolves with it, or null if cancelled. */
export function askNumber(title: string, text: string, value: number, min: number, max: number, okLabel: string): Promise<number | null> {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'ask-back';
    const box = document.createElement('div');
    box.className = 'ask-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const h = document.createElement('h3');
    h.textContent = title;
    const p = document.createElement('p');
    p.textContent = text;
    const field = document.createElement('input');
    field.type = 'number';
    field.min = String(min);
    field.max = String(max);
    field.value = String(value);
    field.className = 'ask-number';
    field.setAttribute('aria-label', title);
    const error = document.createElement('p');
    error.className = 'ask-error';
    error.setAttribute('role', 'status');
    const row = document.createElement('div');
    row.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const ok = document.createElement('button');
    ok.textContent = okLabel;
    ok.className = 'primary';
    row.append(cancel, ok);
    box.append(h, p, field, error, row);
    back.append(box);

    const done = (result: number | null) => {
      back.remove();
      resolve(result);
    };
    const accept = () => {
      const n = Number(field.value);
      if (!Number.isInteger(n) || n < min || n > max) {
        error.textContent = `Enter a frame number from ${min} to ${max}.`;
        field.focus();
        return;
      }
      done(n);
    };
    cancel.onclick = () => done(null);
    ok.onclick = accept;
    box.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') done(null);
      else if (e.key === 'Enter') accept();
    });
    document.body.append(back);
    field.focus();
    field.select();
  });
}
