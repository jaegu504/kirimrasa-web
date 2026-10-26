// "Kirim" tab — mirrors ui/screens/composer/ComposerScreen.kt (+ WhatsAppPreviewBubble, AttachmentCard).
import { api, upload, uploadUrl, errText } from '../api.js';
import { h, icon, tile, segmented, pill, iconButton, sectionHeader, largeTitle, toast, openDialog, replay } from '../dom.js';
import { t } from '../i18n.js';
import {
  S, on, emit, MAX_BUBBLES, MAX_ATTACHMENTS, MAX_UPLOAD, TONES, account, isLinked, anyLinked,
  spin, interpolate, mediaKind, formatSize, initials, selectedCount, estimateMinutes, delayRange,
} from '../store.js';
import { saveDraft, saveSettings, refreshCampaign } from '../actions.js';

const ACCOUNTS = ['personal', 'business', 'dual'];
const MEDIA_ICON = { image: ['image', 'pink'], video: ['video', 'indigo'], audio: ['audio', 'orange'], document: ['file', 'blue'] };
const ACCEPT = 'image/*,video/*,audio/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt';

let root;
let el = {};            // patchable nodes
let lastFocus = 0;      // bubble that variable pills insert into
const caret = {};       // bubble index -> [start, end]
let uploads = [];       // { key, name, progress }
let aiBusy = false;
let aiError = '';
let showOptions = false;
let sending = false;

export function render(container) {
  root = container;
  const c = t().compose;
  el = {};

  el.banner = h('button', { type: 'button', class: 'banner tone-blue press', onclick: () => emit('go', { tab: 'settings', opts: { link: 'personal' } }) },
    tile('chat', 'green', 30), h('span', null, c.linkBanner), icon('right', 20, 'chev'));

  el.status = h('div', { class: 'status-list' });
  el.recipients = h('strong', { class: 'row-title' });
  el.bubbles = h('div', { class: 'card pad-16 bubbles-card' });
  el.aiLabel = h('span', null, c.aiTidy);
  el.aiTile = tile('sparkle', 'purple');
  el.aiError = h('p', { class: 'alert tone-red', role: 'alert', hidden: true });
  el.options = h('div', { class: 'card pad-16 stack-14 options', hidden: !showOptions });
  el.optionsChev = icon(showOptions ? 'down' : 'right', 20, 'chev');
  el.warning = h('button', { type: 'button', class: 'alert tone-orange row-alert press', hidden: true, onclick: () => setOptions(true) });
  el.preview = h('div', { class: 'chat' });
  el.sendLabel = h('span', null);
  el.plane = icon('send', 20, 'plane');
  el.send = h('button', { type: 'button', class: 'capsule send press', onclick: send }, el.plane, el.sendLabel);
  el.estimate = h('p', { class: 'caption center' });
  el.file = h('input', { type: 'file', accept: ACCEPT, multiple: true, hidden: true, onchange: (e) => { pickFiles([...e.target.files]); e.target.value = ''; } });

  const tones = h('div', { class: 'chips' }, TONES.map((k) => pill(c.tones[k], k === S.aiTone ? 'purple' : 'fill', () => {
    S.aiTone = k;
    tones.querySelectorAll('.pill').forEach((p, i) => {
      const on = TONES[i] === k;
      p.className = `pill press tone-${on ? 'purple' : 'fill'}`;
      p.setAttribute('aria-pressed', String(on));
    });
  }, { selected: k === S.aiTone })));

  root.replaceChildren(
    largeTitle(c.title, iconButton('help', c.help, showHelp, 'round-card')),
    el.banner,
    h('div', { class: 'compose-grid' },
      h('div', { class: 'stack-12 compose-main' },
        segmented([c.personal, c.business, c.dual], ACCOUNTS.indexOf(S.draft.account), (i) => {
          S.draft.account = ACCOUNTS[i]; saveDraft(); updateStatus();
        }, { label: c.personal + ' / ' + c.business }),
        el.status,
        h('div', { class: 'card' },
          h('button', { type: 'button', class: 'list-row tall press', onclick: () => emit('go', { tab: 'contacts' }) },
            tile('users', 'blue', 36),
            h('span', { class: 'row-text' }, h('span', { class: 'caption' }, c.to), el.recipients),
            icon('right', 22, 'chev'))),
        sectionHeader(c.writeMessage),
        el.bubbles,
        h('div', { class: 'action-tiles' },
          h('button', { type: 'button', class: 'card action-tile press', onclick: () => {
            if (S.draft.attachments.length + uploads.length >= MAX_ATTACHMENTS) toast(c.attachFull, 'orange'); else el.file.click();
          } }, tile('clip', 'teal'), h('span', null, c.attach)),
          h('button', { type: 'button', class: 'card action-tile press', onclick: rewrite }, el.aiTile, el.aiLabel),
          el.file),
        el.aiError,
        h('div', { class: 'stack-6' }, h('p', { class: 'caption pad-left-4' }, c.aiStyle), tones),
        h('button', { type: 'button', class: 'options-toggle press', 'aria-expanded': String(showOptions), onclick: () => setOptions(!showOptions) },
          h('span', { class: 'strong' }, c.moreOptions), h('span', { class: 'muted push' }, c.moreOptionsHint), el.optionsChev),
        el.options,
        el.warning),
      h('aside', { class: 'stack-12 compose-side' },
        sectionHeader(c.preview),
        el.preview,
        h('div', { class: 'stack-8 send-block' }, el.send, el.estimate))));

  buildOptions();
  buildBubbles();
  updateStatus();
  updateRecipients();
  updateAi();
}

export function onShow() { updateRecipients(); updatePreview(); }

on('accounts', () => root && updateStatus());
on('contacts', () => root && (updateRecipients(), updatePreview()));
on('settings', (p) => { if (root && (p.defaults || p.antiBan)) { updatePreview(); updateSend(); updateWarning(); } });

// ---------- account status ----------
function statusLabel(acc, prefix) {
  const c = t().compose;
  const st = acc?.status || 'DISCONNECTED';
  const [text, tone] = isLinked(acc) ? [c.connected(acc.phone ? '+' + acc.phone : ''), 'green']
    : st === 'CONNECTING' || st === 'PAIRING' ? [c.connecting, 'orange'] : [c.notConnected, 'grey'];
  return h('span', { class: 'status-label tone-' + tone }, h('i', { class: 'dot' }), (prefix ? prefix + ': ' : '') + text);
}

function updateStatus() {
  const c = t().compose;
  const a = S.draft.account;
  el.status.replaceChildren(...(a === 'dual'
    ? [statusLabel(account('personal'), c.personal), statusLabel(account('business'), c.business)]
    : [statusLabel(account(a))]));
  el.banner.hidden = anyLinked();
}

function updateRecipients() {
  const c = t().compose;
  const sel = selectedCount();
  const total = S.contacts.length;
  el.recipients.textContent = sel > 0 ? c.selectedContacts(sel) : total === 0 ? c.noContacts : c.allContactsCount(total);
  updateSend();
}

// ---------- bubbles ----------
function buildBubbles({ enterIndex = -1, fade = false } = {}) {
  const c = t().compose;
  const b = S.draft.bubbles;
  const nodes = b.map((text, i) => {
    const ta = h('textarea', {
      class: 'field bubble-input', rows: 3, placeholder: c.placeholder, 'aria-label': c.bubble(i + 1),
      oninput: (e) => { S.draft.bubbles[i] = e.target.value; caret[i] = null; changed(); },
      onfocus: () => { lastFocus = i; },
      onblur: (e) => { caret[i] = [e.target.selectionStart, e.target.selectionEnd]; },
    });
    ta.value = text;
    const block = h('div', { class: 'bubble-block' + (i === enterIndex ? ' enter' : '') + (fade ? ' ai-fade' : ''), dataset: { i } },
      i > 0 ? h('hr', { class: 'sep' }) : null,
      h('div', { class: 'bubble-head' },
        h('span', { class: 'bubble-label' }, c.bubble(i + 1)),
        b.length > 1 ? iconButton('x', c.removeBubble(i + 1), () => removeBubble(i, block), 'small') : null),
      S.draft.attachments.filter((a) => a.bubbleIndex === i).map(attachmentCard),
      ta);
    return block;
  });
  const separate = S.draft.attachments.filter((a) => !(a.bubbleIndex >= 0 && a.bubbleIndex < b.length)).map(attachmentCard);
  const pending = uploads.map((u) => h('div', { class: 'att-card uploading' },
    h('div', { class: 'att-row' }, tile('upload', 'teal', 44),
      h('div', { class: 'row-text' }, h('span', { class: 'att-name' }, u.name), h('span', { class: 'caption' }, c.uploading(u.progress)),
        h('div', { class: 'progress' }, h('i', { style: { width: u.progress + '%' } }))))));
  const pills = h('div', { class: 'chips' },
    pill(c.addNickname, 'blue', () => insertVariable('{Nickname}')),
    pill(c.addCompany, 'orange', () => insertVariable('{Company}')),
    pill(c.addPromo, 'orange', () => insertVariable('{Custom_1}')),
    b.length < MAX_BUBBLES ? pill(c.addBubble, 'fill', addBubble) : null);
  el.bubbles.replaceChildren(...nodes, ...separate, ...pending, pills);
  el.bubbles.classList.toggle('ai-busy', aiBusy);
  changed(false);
}

function changed(save = true) {
  if (save) saveDraft();
  updatePreview();
  updateSend();
  updateWarning();
}

function insertVariable(v) {
  const areas = el.bubbles.querySelectorAll('.bubble-input');
  const i = Math.min(lastFocus, areas.length - 1);
  const ta = areas[i];
  const [s, e] = caret[i] || [ta.value.length, ta.value.length];
  ta.setRangeText(v, s, e, 'end');
  caret[i] = [ta.selectionStart, ta.selectionEnd];
  S.draft.bubbles[i] = ta.value;
  ta.focus();
  changed();
}

function addBubble() {
  if (S.draft.bubbles.length >= MAX_BUBBLES) return;
  S.draft.bubbles.push('');
  const i = S.draft.bubbles.length - 1;
  lastFocus = i;
  buildBubbles({ enterIndex: i });
  el.bubbles.querySelectorAll('.bubble-input')[i]?.focus();
  saveDraft();
}

function removeBubble(i, block) {
  if (S.draft.bubbles.length <= 1 || block.classList.contains('leave')) return;
  const done = () => {
    S.draft.bubbles.splice(i, 1);
    S.draft.attachments.forEach((a) => {
      if (a.bubbleIndex === i) a.bubbleIndex = Math.max(0, i - 1);
      else if (a.bubbleIndex > i) a.bubbleIndex -= 1;
    });
    for (const k of Object.keys(caret)) delete caret[k];
    lastFocus = Math.min(lastFocus, S.draft.bubbles.length - 1);
    buildBubbles();
    saveDraft();
  };
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
  block.style.height = block.offsetHeight + 'px';
  block.classList.add('leave');
  requestAnimationFrame(() => { block.style.height = '0px'; });
  setTimeout(done, 260);
}

// ---------- attachments ----------
function attachmentCard(att) {
  const c = t().compose;
  const n = S.draft.bubbles.length;
  const separate = !(att.bubbleIndex >= 0 && att.bubbleIndex < n);
  const kind = mediaKind(att.mime);
  const thumb = kind === 'image'
    ? h('img', { class: 'att-thumb', src: uploadUrl(att.uploadId), alt: att.name, loading: 'lazy' })
    : tile(...MEDIA_ICON[kind], 44);
  const opts = [...Array(n)].map((_, i) => (n > 3 ? String(i + 1) : c.bubble(i + 1))).concat(c.separate);
  return h('div', { class: 'att-card' },
    h('div', { class: 'att-row' }, thumb,
      h('div', { class: 'row-text' },
        h('span', { class: 'att-name' }, att.name),
        h('span', { class: 'caption' }, `${c.media[kind]} · ${formatSize(att.size)} · ${separate ? c.sentSeparately : c.sentWithBubble}`)),
      iconButton('x', c.removeAttachment, () => {
        S.draft.attachments = S.draft.attachments.filter((a) => a !== att);
        api('/uploads/' + encodeURIComponent(att.uploadId), { method: 'DELETE' }).catch(() => {});
        buildBubbles(); saveDraft();
      }, 'small')),
    h('span', { class: 'caption strong' }, c.sendFileIn),
    segmented(opts, separate ? n : att.bubbleIndex, (i) => {
      att.bubbleIndex = i === n ? -1 : i;
      setTimeout(() => { buildBubbles(); saveDraft(); }, 220); // let the thumb slide before the card moves
    }, { label: c.sendFileIn, small: true }));
}

async function pickFiles(files) {
  const c = t().compose;
  for (const file of files) {
    if (S.draft.attachments.length + uploads.length >= MAX_ATTACHMENTS) { toast(c.attachFull, 'orange'); break; }
    if (file.size > MAX_UPLOAD) { toast(c.tooBig(file.name), 'red'); continue; }
    const u = { key: Math.random(), name: file.name, progress: 0 };
    uploads.push(u);
    buildBubbles();
    let last = 0;
    try {
      const res = await upload(file, (p) => {
        u.progress = p;
        if (p - last >= 5 || p === 100) { last = p; buildUploadProgress(); }
      });
      S.draft.attachments.push({ uploadId: res.id, name: res.name || file.name, mime: res.mime || file.type, size: res.size ?? file.size, bubbleIndex: Math.min(lastFocus, S.draft.bubbles.length - 1) });
      saveDraft();
    } catch (e) {
      toast(errText(e), 'red');
    }
    uploads = uploads.filter((x) => x !== u);
    buildBubbles();
  }
}

function buildUploadProgress() {
  const c = t().compose;
  el.bubbles.querySelectorAll('.att-card.uploading').forEach((card, i) => {
    const u = uploads[i];
    if (!u) return;
    card.querySelector('.caption').textContent = c.uploading(u.progress);
    card.querySelector('.progress i').style.width = u.progress + '%';
  });
}

// ---------- AI ----------
async function rewrite() {
  const c = t().compose;
  if (aiBusy) return;
  const message = S.draft.bubbles.join('\n\n').trim();
  if (!message) { toast(c.aiNeedText, 'orange'); return; }
  aiBusy = true; aiError = ''; updateAi();
  try {
    const res = await api('/ai/rewrite', { method: 'POST', body: { message, tone: S.aiTone, maxBubbles: MAX_BUBBLES } });
    const out = (res?.bubbles || []).filter((x) => typeof x === 'string').slice(0, MAX_BUBBLES);
    if (out.length) { S.draft.bubbles = out; aiBusy = false; buildBubbles({ fade: true }); saveDraft(); }
  } catch (e) {
    aiError = errText(e);
  }
  aiBusy = false;
  updateAi();
}

function updateAi() {
  const c = t().compose;
  el.aiLabel.textContent = aiBusy ? c.aiWorking : c.aiTidy;
  el.aiTile.classList.toggle('spin', aiBusy);
  el.bubbles.classList.toggle('ai-busy', aiBusy);
  el.aiError.hidden = !aiError;
  el.aiError.textContent = aiError;
}

// ---------- options / warning ----------
function setOptions(v) {
  showOptions = v;
  el.options.hidden = !v;
  el.optionsChev.replaceWith(el.optionsChev = icon(v ? 'down' : 'right', 20, 'chev'));
  el.options.previousElementSibling.setAttribute('aria-expanded', String(v));
  if (v) replay(el.options, 'fade-in');
}

function buildOptions() {
  const c = t().compose;
  const d = S.settings.defaults || {};
  const ab = S.settings.antiBan;
  const [a, b] = delayRange();
  const field = (key, label, ph) => h('label', { class: 'stack-6' }, h('span', { class: 'strong' }, label),
    h('input', { class: 'field', type: 'text', value: d[key] || '', placeholder: ph, oninput: (e) => saveSettings({ defaults: { [key]: e.target.value } }) }));
  const info = (title, body) => [h('hr', { class: 'sep' }), h('div', { class: 'stack-4' }, h('span', { class: 'strong' }, title), h('p', { class: 'muted' }, body))];
  el.options.replaceChildren(
    field('company', c.companyLabel, c.companyPlaceholder),
    field('custom1', c.custom1Label, c.custom1Placeholder),
    h('p', { class: 'muted' }, c.nicknameNote),
    ...info(c.variationTitle, c.variationHelp),
    ...info(c.delayTitle, c.delayInfo(a, b, ab.batchSize, ab.pauseMin)));
}

function updateWarning() {
  const c = t().compose;
  const all = S.draft.bubbles.join(' ');
  const d = S.settings.defaults || {};
  const empty = [
    all.includes('{Company}') && !d.company?.trim() ? c.companyName : null,
    all.includes('{Custom_1}') && !d.custom1?.trim() ? c.promoName : null,
  ].filter(Boolean);
  el.warning.hidden = !empty.length;
  if (empty.length) el.warning.replaceChildren(icon('warn', 20), h('span', null, c.emptyVarsWarning(empty.join(' & '))));
}

// ---------- preview ----------
function updatePreview() {
  const c = t().compose;
  const contact = S.contacts.find((x) => x.selected);
  const name = contact ? (contact.nickname || contact.name) : c.sampleName;
  const ctx = contact || { nickname: c.sampleName };
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const b = S.draft.bubbles;
  const atts = S.draft.attachments;
  const entries = b.map((text, i) => [text, atts.filter((a) => a.bubbleIndex === i)])
    .concat(atts.filter((a) => !(a.bubbleIndex >= 0 && a.bubbleIndex < b.length)).map((a) => ['', [a]]))
    .filter(([text, files]) => text.trim() || files.length);

  const body = h('div', { class: 'chat-body' },
    entries.length ? null : h('p', { class: 'chat-empty' }, c.previewEmpty),
    entries.map(([text, files], i) => h('div', { class: 'chat-bubble' + (i === 0 ? ' first' : '') },
      files.map((f) => {
        const kind = mediaKind(f.mime);
        return kind === 'image'
          ? h('img', { class: 'chat-img', src: uploadUrl(f.uploadId), alt: f.name })
          : h('div', { class: 'chat-file' }, tile(...MEDIA_ICON[kind], 36), h('span', null, f.name));
      }),
      text.trim() ? h('p', { class: 'chat-text' }, interpolate(spin(text), ctx)) : null,
      h('span', { class: 'chat-meta' }, time, icon('ticks', 15, 'ticks')))));
  el.preview.replaceChildren(
    h('div', { class: 'chat-head' },
      h('span', { class: 'avatar', style: { background: 'var(--g-orange)' } }, initials(name)),
      h('div', null, h('strong', null, name), h('span', { class: 'chat-typing' }, c.typing))),
    body);
}

// ---------- send ----------
function recipientsCount() { const s = selectedCount(); return s > 0 ? s : S.contacts.length; }
const hasContent = () => S.draft.bubbles.some((x) => x.trim()) || S.draft.attachments.length > 0;

function updateSend() {
  const c = t().compose;
  const n = recipientsCount();
  const ok = n > 0 && hasContent();
  el.sendLabel.textContent = sending ? c.sending : c.sendTo(n);
  el.send.disabled = !ok || sending;
  el.estimate.textContent = n === 0 ? c.needContacts : !hasContent() ? c.needMessage
    : c.estimate(c.duration(estimateMinutes(n, S.draft.bubbles.filter((x) => x.trim()).length)));
}

async function send() {
  if (sending) return;
  if (!anyLinked()) { toast(t().errors.NOT_CONNECTED, 'orange'); emit('go', { tab: 'settings', opts: { link: 'personal' } }); return; }
  sending = true; updateSend();
  try {
    await api('/campaign', { method: 'POST', body: { bubbles: S.draft.bubbles, attachments: S.draft.attachments, account: S.draft.account } });
    replay(el.plane, 'fly');
    toast(t().compose.started, 'green');
    await refreshCampaign();
    setTimeout(() => emit('go', { tab: 'queue' }), 260);
  } catch (e) {
    toast(errText(e), 'red');
    if (e.code === 'CAMPAIGN_RUNNING') emit('go', { tab: 'queue' });
    if (e.code === 'NOT_CONNECTED') emit('go', { tab: 'settings', opts: { link: 'personal' } });
  }
  sending = false; updateSend();
}

function showHelp() {
  const c = t().compose;
  openDialog({ title: c.helpTitle, body: h('ol', { class: 'steps' }, c.helpSteps.map((s) => h('li', null, s))), actions: [{ label: t().done, kind: 'primary' }] });
}
