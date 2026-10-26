// Tiny DOM helpers: h() builds elements, icon() returns an inline SVG, plus toast/dialog/segmented controls.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : String(c));
  }
}

const P = {
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  tune: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  ticks: '<path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor"/>',
  play: '<path d="M6 3l14 9-14 9z" fill="currentColor"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  unlink: '<path d="m18.84 12.25 1.72-1.71a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5 5 0 0 0 7.07 7.07l1.71-1.71"/><path d="M8 2v3M2 8h3M16 22v-3M22 16h-3"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>',
  work: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  video: '<path d="M7 4l13 8-13 8z" fill="currentColor"/>',
  audio: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z"/><path d="M14 2v6h6"/>',
  warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  timer: '<path d="M10 2h4"/><path d="M12 14l3-3"/><circle cx="12" cy="14" r="8"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  retry: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61"/><path d="M2 2l20 20"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  bang: '<path d="M12 5v9M12 19h.01"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  cancel: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="M15 9l-6 6M9 9l6 6" stroke="var(--card)"/>',
};

export function icon(name, size = 20, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('width', size);
  s.setAttribute('height', size);
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '2');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = P[name] || '';
  return s;
}

/** Rounded square with a gradient and a white glyph (Apple.kt IconTile). */
export function tile(name, gradient, size = 34) {
  return h('span', { class: 'tile', style: { width: size + 'px', height: size + 'px', borderRadius: size * 0.3 + 'px', background: `var(--g-${gradient})` } },
    icon(name, Math.round(size * 0.56)));
}

/** iOS segmented control with a sliding thumb. */
export function segmented(options, index, onSelect, { label, small } = {}) {
  const root = h('div', { class: 'seg' + (small ? ' seg-sm' : ''), role: 'tablist', 'aria-label': label || null });
  root.style.setProperty('--n', options.length);
  const set = (i) => {
    root.style.setProperty('--i', i);
    [...root.children].forEach((b, j) => { b.setAttribute('aria-selected', String(i === j)); b.tabIndex = i === j ? 0 : -1; });
  };
  options.forEach((o, i) => root.append(h('button', {
    type: 'button', role: 'tab', class: 'seg-btn',
    onclick: () => { if (Number(root.style.getPropertyValue('--i')) !== i) { set(i); onSelect(i); } },
    onkeydown: (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const j = (i + d + options.length) % options.length;
      root.children[j].focus(); root.children[j].click();
    },
  }, o)));
  set(Math.max(0, index));
  return root;
}

/** iOS switch. */
export function toggle(on, onChange, label) {
  const b = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-checked': String(on), 'aria-label': label });
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const v = b.getAttribute('aria-checked') !== 'true';
    b.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return b;
}

export function pill(text, tone, onClick, { iconName, selected, cls } = {}) {
  return h('button', { type: 'button', class: `pill tone-${tone} press${cls ? ' ' + cls : ''}`, 'aria-pressed': selected == null ? null : String(!!selected), onclick: onClick },
    iconName ? icon(iconName, 16) : null, text);
}

export function iconButton(name, label, onClick, cls = '') {
  return h('button', { type: 'button', class: 'icon-btn press ' + cls, 'aria-label': label, title: label, onclick: onClick }, icon(name, 22));
}

/** Uppercase grey caption above a card. */
export function sectionHeader(text, trailing) {
  return h('div', { class: 'section-header' }, h('h2', null, text), trailing || null);
}

export function largeTitle(text, ...trailing) {
  return h('header', { class: 'large-title' }, h('h1', null, text), h('div', { class: 'lt-trailing' }, trailing));
}

let toastTimer;
export function toast(msg, tone = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show ' + (tone ? 'tone-' + tone : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/** Modal alert/sheet. actions: [{ label, kind: 'primary'|'danger'|'plain', onClick() -> false keeps open }] */
export function openDialog({ title, body, actions }) {
  const prev = document.activeElement;
  const close = () => {
    overlay.classList.add('closing');
    document.removeEventListener('keydown', onKey);
    setTimeout(() => overlay.remove(), 180);
    prev?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const box = h('div', { class: 'dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('h3', null, title),
    body ? h('div', { class: 'dialog-body' }, body) : null,
    h('div', { class: 'dialog-actions' }, actions.map((a) => h('button', {
      type: 'button', class: `dlg-btn ${a.kind || 'plain'} press`,
      onclick: async () => { if ((await a.onClick?.()) !== false) close(); },
    }, a.label))));
  const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  (box.querySelector('input,textarea') || box.querySelector('.dlg-btn:last-child'))?.focus();
  return close;
}

/** Restart a CSS animation class on an element. */
export function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/** Set text and roll it up when the value changes (count roll). */
export function rollText(el, text) {
  if (el.textContent === String(text)) return;
  el.textContent = text;
  replay(el, 'roll');
}

/** replaceChildren that skips null/false (h() does this for its own children). */
export const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((x) => x != null && x !== false));

export function debounce(fn, ms) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}
