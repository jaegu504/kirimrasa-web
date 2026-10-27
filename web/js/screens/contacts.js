// "Kontak" tab — mirrors ui/screens/contacts/ContactManagerScreen.kt, with CSV import instead of phone-book sync.
// The list renders in chunks as you scroll and uses one delegated listener, so 2000+ contacts stay smooth.
import { api, errText } from '../api.js';
import { h, icon, pill, iconButton, largeTitle, toast, openDialog, rollText, replay, debounce, fill } from '../dom.js';
import { t } from '../i18n.js';
import { S, emit, selectedCount, initials, smartNickname, normalizePhone } from '../store.js';
import { refreshContacts } from '../actions.js';

const CHUNK = 100;
const AVATARS = ['orange', 'blue', 'purple', 'green', 'pink', 'teal', 'indigo'];
const TAG_COLORS = ['blue', 'orange', 'purple', 'pink', 'teal', 'indigo'];

let root, el = {};
let query = '';
let filter = 'all';         // 'all' | 'selected' | 'tag:<name>'
let expandedId = null;
let tagEditorId = null;
let helpOpen = false;
let importMsg = '';
let filtered = [];
let rendered = 0;
let observer;
const nickTimers = new Map();

const hash = (s) => { let x = 0; for (const ch of String(s)) x = (x * 31 + ch.codePointAt(0)) | 0; return Math.abs(x); };
const tagColor = (name) => TAG_COLORS[hash(name) % TAG_COLORS.length];
const byId = (id) => S.contacts.find((c) => String(c.id) === String(id));
const displayName = (c) => (c.name || '').replace(/\(.*?\)/g, '').trim() || c.phone;

function tagNames() {
  const set = new Set(t().contacts.defaultTags);
  for (const c of S.contacts) for (const g of c.tags || []) set.add(g);
  return [...set];
}

export function render(container) {
  root = container;
  const c = t().contacts;
  el = {};
  el.file = h('input', { type: 'file', accept: '.csv,.vcf,text/csv,text/vcard,text/x-vcard', hidden: true, onchange: (e) => { importCsv(e.target.files[0]); e.target.value = ''; } });
  el.importBtn = pill(c.importCsv, 'blue', () => el.file.click(), { iconName: 'upload' });
  el.importMsg = h('p', { class: 'caption', hidden: !importMsg }, importMsg);
  el.search = h('input', { class: 'field-bare', type: 'search', placeholder: c.searchPlaceholder, 'aria-label': c.searchPlaceholder, value: query });
  el.clear = iconButton('cancel', c.clearSearch, () => { el.search.value = ''; query = ''; el.clear.hidden = true; renderList(); el.search.focus(); }, 'small clear-btn');
  el.clear.hidden = !query;
  const onSearch = debounce(() => { query = el.search.value.trim().toLowerCase(); renderList(); }, 120);
  el.search.addEventListener('input', () => { el.clear.hidden = !el.search.value; onSearch(); });
  el.chips = h('div', { class: 'chips scroll-x', role: 'toolbar' });
  el.caption = h('span', { class: 'section-caption' });
  el.selAll = h('button', { type: 'button', class: 'text-btn press', onclick: () => selectAll(true) }, c.selectAll);
  el.selNone = h('button', { type: 'button', class: 'text-btn press', onclick: () => selectAll(false) }, c.deselectAll);
  el.empty = h('div', { class: 'card pad-20 center muted', hidden: true });
  el.list = h('div', { class: 'card contact-list', role: 'list' });
  el.sentinel = h('div', { class: 'sentinel', 'aria-hidden': 'true' });
  el.barCount = h('span', { class: 'bar-count' });
  el.bar = h('div', { class: 'selection-bar', hidden: true },
    el.barCount,
    h('button', { type: 'button', class: 'bar-btn ghost press', onclick: batchLabel }, c.giveLabel),
    h('button', { type: 'button', class: 'bar-btn press', onclick: () => emit('go', { tab: 'compose' }) }, c.use));

  const help = h('div', { class: 'card help-card' },
    h('button', { type: 'button', class: 'list-row press', 'aria-expanded': String(helpOpen), onclick: (e) => {
      helpOpen = !helpOpen;
      e.currentTarget.setAttribute('aria-expanded', String(helpOpen));
      e.currentTarget.querySelector('.chev').replaceWith(icon(helpOpen ? 'down' : 'right', 20, 'chev'));
      helpBody.hidden = !helpOpen;
      if (helpOpen) replay(helpBody, 'fade-in');
    } }, icon('info', 20, 'c-blue'), h('span', { class: 'row-text strong' }, c.helpTitle), icon(helpOpen ? 'down' : 'right', 20, 'chev')));
  const helpBody = h('div', { class: 'help-body', hidden: !helpOpen },
    h('ol', { class: 'steps' }, c.helpSteps.map((s) => h('li', null, s))), h('p', { class: 'caption' }, c.helpNote));
  help.append(helpBody);

  el.list.addEventListener('click', onListClick);
  el.list.addEventListener('input', onListInput);
  el.list.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.tag-input')) { e.preventDefault(); addTagFromInput(e.target); }
  });

  root.replaceChildren(
    largeTitle(c.title,
      iconButton('download', c.exportCsv, exportCsv),
      iconButton('plus', c.addContact, addContact),
      el.importBtn),
    el.importMsg,
    help,
    h('label', { class: 'search' }, icon('search', 18, 'muted-icon'), el.search, el.clear),
    el.chips,
    h('div', { class: 'caption-row' }, el.caption, h('div', null, el.selNone, el.selAll)),
    el.empty,
    el.list,
    el.sentinel,
    el.bar,
    el.file);

  observer?.disconnect();
  observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) appendChunk(); }, { rootMargin: '800px 0px' });
  observer.observe(el.sentinel);
  renderList();
}

export function onShow() { renderList(); }

// ---------- filtering + chunked list ----------
function computeFiltered() {
  const tag = filter.startsWith('tag:') ? filter.slice(4) : null;
  return S.contacts.filter((c) => {
    if (filter === 'selected' && !c.selected) return false;
    if (tag && !(c.tags || []).includes(tag)) return false;
    if (!query) return true;
    return (c.name || '').toLowerCase().includes(query) || (c.phone || '').includes(query.replace(/\D/g, '') || '\u0000')
      || (c.nickname || '').toLowerCase().includes(query);
  });
}

function renderList() {
  if (!root) return;
  filtered = computeFiltered();
  rendered = 0;
  el.list.replaceChildren();
  appendChunk();
  replay(el.list, 'fade-in');
  const c = t().contacts;
  el.empty.hidden = filtered.length > 0;
  el.list.hidden = filtered.length === 0;
  el.empty.textContent = filter === 'selected' ? c.emptySelected : (query || filter !== 'all') ? c.emptyNoMatch : c.emptyNoContacts;
  renderChips();
  updateCounts();
}

function appendChunk() {
  if (rendered >= filtered.length) return;
  const frag = document.createDocumentFragment();
  const end = Math.min(filtered.length, rendered + (rendered === 0 ? 60 : CHUNK));
  for (let i = rendered; i < end; i++) frag.append(row(filtered[i]));
  rendered = end;
  el.list.append(frag);
}

function renderChips() {
  const c = t().contacts;
  const sel = selectedCount();
  const chip = (label, key, color) => h('button', {
    type: 'button', class: 'chip press', 'aria-pressed': String(filter === key),
    onclick: () => { filter = filter === key && key !== 'all' ? 'all' : key; renderList(); },
  }, color ? h('i', { class: 'dot', style: { background: `var(--${color})` } }) : null, label);
  fill(el.chips,
    chip(c.all(S.contacts.length), 'all'),
    sel > 0 || filter === 'selected' ? chip(c.selectedFilter(sel), 'selected', 'blue') : null,
    ...tagNames().map((g) => chip(g, 'tag:' + g, tagColor(g))));
}

function updateCounts() {
  const c = t().contacts;
  const sel = selectedCount();
  rollText(el.caption, c.selectedCaption(sel).toUpperCase());
  const allInView = filtered.length > 0 && filtered.every((x) => x.selected);
  el.selNone.hidden = !(sel > 0 || allInView);
  el.selAll.hidden = !(filtered.length > 0 && !allInView);
  if (sel > 0) rollText(el.barCount, c.barCount(sel));
  if (el.bar.hidden !== (sel === 0)) {
    el.bar.hidden = sel === 0;
    if (sel > 0) replay(el.bar, 'slide-up');
  }
  root.classList.toggle('has-bar', sel > 0);
}

// ---------- rows ----------
function subtitle(c) {
  const T = t().contacts;
  const tags = (c.tags || []).map((g) => ' · ' + g).join('');
  return c.nickname
    ? [T.calledAs(c.nickname) + tags]
    : [h('span', { class: 'c-orange-text' }, T.noNickname), tags];
}

function row(c) {
  const T = t().contacts;
  const expanded = String(expandedId) === String(c.id);
  const node = h('div', { class: 'contact-row' + (expanded ? ' expanded' : ''), role: 'listitem', dataset: { id: c.id } },
    h('div', { class: 'c-main', dataset: { act: 'toggle' } },
      h('span', { class: 'avatar', style: { background: `var(--g-${AVATARS[hash(c.phone) % AVATARS.length]})` } }, initials(c.name)),
      h('span', { class: 'row-text' }, h('strong', { class: 'ellipsis' }, displayName(c)), h('span', { class: 'sub ellipsis' }, subtitle(c))),
      h('button', { type: 'button', class: 'icon-btn small press' + (expanded ? ' c-blue' : ''), dataset: { act: 'edit' }, 'aria-label': T.editContact, 'aria-expanded': String(expanded) }, icon('pencil', 20)),
      h('button', { type: 'button', role: 'checkbox', class: 'check' + (c.selected ? ' on' : ''), 'aria-checked': String(!!c.selected), 'aria-label': displayName(c), dataset: { act: 'toggle' } }, icon('check', 16))));
  if (expanded) node.append(editor(c));
  return node;
}

function editor(c) {
  const T = t().contacts;
  const nick = h('input', { class: 'field nick-input', type: 'text', value: c.nickname || '', placeholder: T.nicknameHint(t().nicknameFallback), 'aria-label': T.nicknameLabel });
  const tagsOpen = String(tagEditorId) === String(c.id);
  return h('div', { class: 'c-edit stack-10' },
    h('span', { class: 'caption' }, '+' + c.phone),
    h('span', { class: 'caption strong' }, T.nicknameLabel),
    nick,
    h('div', { class: 'chips scroll-x' },
      h('button', { type: 'button', class: 'pill tone-blue press', dataset: { act: 'first' } }, T.firstNameOnly),
      h('button', { type: 'button', class: 'pill tone-blue press', dataset: { act: 'notes' } }, T.removeNotes),
      h('button', { type: 'button', class: 'pill tone-blue press', dataset: { act: 'greet' } }, T.addGreeting),
      h('button', { type: 'button', class: 'pill tone-purple press', dataset: { act: 'labels' }, 'aria-expanded': String(tagsOpen) }, icon('tag', 16), T.labels),
      h('button', { type: 'button', class: 'pill tone-red press', dataset: { act: 'delete' } }, icon('trash', 16), T.deleteContact)),
    tagsOpen ? h('div', { class: 'tag-editor stack-8 fade-in' },
      h('div', { class: 'chips' }, tagNames().map((g) => h('button', {
        type: 'button', class: 'chip small press', dataset: { act: 'tag', tag: g }, 'aria-pressed': String((c.tags || []).includes(g)),
      }, h('i', { class: 'dot', style: { background: `var(--${tagColor(g)})` } }), g))),
      h('div', { class: 'inline-form' },
        h('input', { class: 'field tag-input', type: 'text', placeholder: T.typeNewLabel, 'aria-label': T.typeNewLabel, maxlength: 30 }),
        h('button', { type: 'button', class: 'pill tone-blue press', dataset: { act: 'addtag' } }, T.add))) : null);
}

function patchRow(c) {
  const old = el.list.querySelector(`.contact-row[data-id="${CSS.escape(String(c.id))}"]`);
  if (old) old.replaceWith(row(c));
}

async function patch(c, body) {
  try { Object.assign(c, await api('/contacts/' + encodeURIComponent(c.id), { method: 'PATCH', body })); }
  catch (e) { toast(errText(e), 'red'); }
}

function onListClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !el.list.contains(btn)) return;
  const rowEl = btn.closest('.contact-row');
  const c = byId(rowEl?.dataset.id);
  if (!c) return;
  const act = btn.dataset.act;
  if (act === 'toggle') {
    if (e.target.closest('.c-edit')) return;
    toggleSelect(c, rowEl);
  } else if (act === 'edit') {
    const prev = expandedId != null ? byId(expandedId) : null;
    expandedId = String(expandedId) === String(c.id) ? null : c.id;
    tagEditorId = null;
    if (prev && prev !== c) patchRow(prev);
    patchRow(c);
    if (expandedId != null) el.list.querySelector(`.contact-row[data-id="${CSS.escape(String(c.id))}"] .nick-input`)?.focus();
  } else if (act === 'first' || act === 'notes' || act === 'greet') {
    const smart = smartNickname(c.name);
    const nickname = act === 'first' ? smart
      : act === 'notes' ? (smart ? c.name.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim() : '')
      : `${t().greetingWord} ${c.nickname || smart || t().nicknameFallback}`;
    c.nickname = nickname;
    patchRow(c);
    patch(c, { nickname });
    emit('contacts');
  } else if (act === 'labels') {
    tagEditorId = String(tagEditorId) === String(c.id) ? null : c.id;
    patchRow(c);
  } else if (act === 'tag') {
    const g = btn.dataset.tag;
    const tags = (c.tags || []).includes(g) ? c.tags.filter((x) => x !== g) : [...(c.tags || []), g];
    c.tags = tags;
    patchRow(c);
    patch(c, { tags });
  } else if (act === 'addtag') {
    addTagFromInput(rowEl.querySelector('.tag-input'));
  } else if (act === 'delete') {
    const T = t().contacts;
    openDialog({
      title: T.deleteTitle(displayName(c)), body: h('p', null, T.deleteBody),
      actions: [{ label: t().cancel }, { label: T.delete, kind: 'danger', onClick: async () => {
        try {
          await api('/contacts/' + encodeURIComponent(c.id), { method: 'DELETE' });
          S.contacts = S.contacts.filter((x) => x !== c);
          expandedId = null;
          renderList(); emit('contacts');
        } catch (err) { toast(errText(err), 'red'); }
      } }],
    });
  }
}

function addTagFromInput(input) {
  const g = input?.value.trim();
  const c = byId(input?.closest('.contact-row')?.dataset.id);
  if (!g || !c) return;
  if (!(c.tags || []).includes(g)) {
    c.tags = [...(c.tags || []), g];
    patch(c, { tags: c.tags });
  }
  patchRow(c);
  renderChips();
  el.list.querySelector(`.contact-row[data-id="${CSS.escape(String(c.id))}"] .tag-input`)?.focus();
}

function onListInput(e) {
  if (!e.target.matches('.nick-input')) return;
  const rowEl = e.target.closest('.contact-row');
  const c = byId(rowEl.dataset.id);
  if (!c) return;
  c.nickname = e.target.value;
  rowEl.querySelector('.sub').replaceChildren(...subtitle(c));
  clearTimeout(nickTimers.get(c.id));
  // Saves 400 ms after the last keystroke, like the app's NicknameEditor
  nickTimers.set(c.id, setTimeout(() => { patch(c, { nickname: c.nickname }); emit('contacts'); }, 400));
}

async function toggleSelect(c, rowEl) {
  c.selected = !c.selected;
  const chk = rowEl.querySelector('.check');
  chk.classList.toggle('on', c.selected);
  chk.setAttribute('aria-checked', String(c.selected));
  if (c.selected) replay(chk, 'pop');
  updateCounts();
  renderChips();
  emit('contacts');
  try { await api('/contacts/' + encodeURIComponent(c.id), { method: 'PATCH', body: { selected: c.selected } }); }
  catch (e) {
    c.selected = !c.selected;
    chk.classList.toggle('on', c.selected);
    chk.setAttribute('aria-checked', String(c.selected));
    updateCounts(); emit('contacts');
    toast(errText(e), 'red');
  }
}

async function selectAll(value) {
  // "Batal pilih" clears every contact; "Pilih semua" selects what the current search/filter shows
  let body, targets;
  if (!value) { body = { selected: false }; targets = S.contacts; }
  else if (query || filter === 'selected') { targets = filtered; body = { selected: true, ids: targets.map((c) => c.id) }; }
  else if (filter.startsWith('tag:')) { targets = filtered; body = { selected: true, tag: filter.slice(4) }; }
  else { targets = S.contacts; body = { selected: true }; }
  targets.forEach((c) => { c.selected = value; });
  el.list.querySelectorAll('.contact-row').forEach((r) => {
    const c = byId(r.dataset.id);
    const chk = r.querySelector('.check');
    chk.classList.toggle('on', !!c?.selected);
    chk.setAttribute('aria-checked', String(!!c?.selected));
    if (c?.selected) replay(chk, 'pop');
  });
  renderChips(); updateCounts(); emit('contacts');
  try { await api('/contacts/select', { method: 'POST', body }); }
  catch (e) { toast(errText(e), 'red'); await refreshContacts(); renderList(); }
}

// ---------- import / export / add ----------
async function importCsv(file) {
  const c = t().contacts;
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast(t().errors.CSV_TOO_LARGE, 'red'); return; }
  el.importBtn.lastChild.textContent = c.importing;
  el.importBtn.disabled = true;
  try {
    const text = await file.text();
    const r = await api('/contacts/import', { method: 'POST', body: text, type: 'text/csv' });
    importMsg = c.importResult(r.added ?? 0, r.updated ?? 0, r.skipped ?? 0);
    toast(importMsg, 'green');
    await refreshContacts();
    renderList();
  } catch (e) {
    importMsg = e.status === 413 ? t().errors.CSV_TOO_LARGE : errText(e);
    toast(importMsg, 'red');
  }
  el.importMsg.textContent = importMsg;
  el.importMsg.hidden = !importMsg;
  el.importBtn.lastChild.textContent = c.importCsv;
  el.importBtn.disabled = false;
}

async function exportCsv() {
  try {
    const text = await api('/contacts/export');
    const url = URL.createObjectURL(new Blob([typeof text === 'string' ? text : ''], { type: 'text/csv' }));
    const a = h('a', { href: url, download: 'kirimrasa-kontak.csv' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) { toast(errText(e), 'red'); }
}

function addContact() {
  const T = t().contacts;
  const name = h('input', { class: 'field', type: 'text', autocomplete: 'name', 'aria-label': T.name, placeholder: T.name });
  const phone = h('input', { class: 'field', type: 'tel', inputmode: 'tel', autocomplete: 'tel', 'aria-label': T.phone, placeholder: T.phoneHint(S.settings.defaultCountry) });
  const nick = h('input', { class: 'field', type: 'text', 'aria-label': T.nicknameOptional, placeholder: T.nicknameOptional });
  const err = h('p', { class: 'caption c-red-text', role: 'alert' });
  openDialog({
    title: T.addContact,
    body: h('div', { class: 'stack-10' }, name, phone, nick, err),
    actions: [{ label: t().cancel }, { label: t().add, kind: 'primary', onClick: async () => {
      const p = normalizePhone(phone.value);
      if (!name.value.trim() || p.length < 8) { err.textContent = T.needNamePhone; return false; }
      try {
        const c = await api('/contacts', { method: 'POST', body: { name: name.value.trim(), phone: p, nickname: nick.value.trim() || undefined } });
        S.contacts = S.contacts.filter((x) => x.id !== c.id).concat(c).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        renderList(); emit('contacts');
        toast(T.added, 'green');
      } catch (e) { err.textContent = errText(e); return false; }
    } }],
  });
}

function batchLabel() {
  const T = t().contacts;
  const targets = S.contacts.filter((c) => c.selected);
  const input = h('input', { class: 'field', type: 'text', placeholder: T.typeNewLabel, 'aria-label': T.typeNewLabel, maxlength: 30 });
  let close;
  const apply = async (g) => {
    g = g.trim();
    if (!g) return false;
    close?.();
    const todo = targets.filter((c) => !(c.tags || []).includes(g));
    let done = 0;
    const next = async () => {
      while (todo.length) {
        const c = todo.shift();
        c.tags = [...(c.tags || []), g];
        await patch(c, { tags: c.tags });
        done++;
        if (done % 10 === 0) toast(T.labelling(done, targets.length));
      }
    };
    await Promise.all([...Array(6)].map(next)); // shortcut: one PATCH per contact (no batch-tag endpoint); fine for a few thousand
    toast(T.labelled(targets.length), 'green');
    renderList();
  };
  close = openDialog({
    title: T.batchTitle(targets.length),
    body: h('div', { class: 'stack-10' }, h('p', { class: 'muted' }, T.batchDesc),
      h('div', { class: 'chips' }, tagNames().map((g) => h('button', { type: 'button', class: 'chip press', onclick: () => apply(g) },
        h('i', { class: 'dot', style: { background: `var(--${tagColor(g)})` } }), g))),
      input),
    actions: [{ label: t().cancel }, { label: T.giveLabel, kind: 'primary', onClick: () => apply(input.value) }],
  });
}
