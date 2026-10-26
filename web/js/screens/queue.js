// "Status" tab — mirrors ui/screens/queue/LiveQueueScreen.kt for the server-side campaign.
import { api, errText } from '../api.js';
import { h, icon, pill, largeTitle, sectionHeader, openDialog, rollText, replay, toast } from '../dom.js';
import { t } from '../i18n.js';
import { S, on, campaignActive } from '../store.js';
import { refreshCampaign } from '../actions.js';

const C = 2 * Math.PI * 77; // ring circumference
const FILTERS = ['all', 'active', 'sent', 'pending', 'failed'];
let root, el = {};
let filter = 'all';
let limit = 150;
let lastState = null;
let ticker = null;
let observer;

export function render(container) {
  root = container;
  el = {};
  lastState = S.campaign?.state ?? null;
  const q = t().queue;
  const svgNS = 'http://www.w3.org/2000/svg';
  const ring = document.createElementNS(svgNS, 'svg');
  ring.setAttribute('viewBox', '0 0 168 168');
  ring.innerHTML = `<defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--green)"/><stop offset="1" style="stop-color:var(--teal)"/></linearGradient></defs>
    <circle class="ring-track" cx="84" cy="84" r="77"/>
    <circle class="ring-arc ring-glow" cx="84" cy="84" r="77" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>
    <circle class="ring-arc" cx="84" cy="84" r="77" stroke-dasharray="${C}" stroke-dashoffset="${C}"/>`;
  el.ringSvg = ring;
  el.num = h('span', { class: 'ring-num' }, '0');
  el.total = h('span', { class: 'ring-total' }, '/0');
  el.ring = h('div', { class: 'ring', role: 'img' }, ring, h('div', { class: 'ring-center' }, h('div', null, el.num, el.total), h('span', { class: 'caption' }, q.sentWord)));
  el.title = h('p', { class: 'caption center' });
  el.doneCheck = h('div', { class: 'done-check', hidden: true }, icon('check', 40));
  el.phase = h('div', { class: 'phase-pill' });
  el.controls = h('div', { class: 'controls' });
  el.note = h('p', { class: 'alert tone-green note' }, icon('info', 18), h('span', null, q.serverNote));
  el.empty = h('div', { class: 'card pad-24 stack-8 center' }, h('strong', { class: 'title-17' }, q.emptyTitle), h('p', { class: 'muted' }, q.emptyHint(t().nav.compose)));
  el.summary = h('span', { class: 'caption' });
  el.filters = h('div', { class: 'chips scroll-x' }, FILTERS.map((f) => pill(q.filters[f], f === filter ? 'blue' : 'card', () => {
    filter = f; limit = 150;
    el.filters.querySelectorAll('.pill').forEach((p, i) => { p.className = `pill press tone-${FILTERS[i] === f ? 'blue' : 'card'}`; p.setAttribute('aria-pressed', String(FILTERS[i] === f)); });
    renderList(true);
  }, { selected: f === filter })));
  el.list = h('div', { class: 'card queue-list', role: 'list' });
  el.listEmpty = h('p', { class: 'muted center pad-24', hidden: true }, q.filterEmpty);
  el.sentinel = h('div', { class: 'sentinel' });
  el.main = h('div', { class: 'stack-16' },
    h('div', { class: 'card pad-20 stack-16 progress-card' }, el.ring, el.doneCheck, el.title, h('div', { class: 'center-row' }, el.phase), el.controls),
    h('div', { class: 'stack-8' }, sectionHeader(q.recipients, el.summary), el.filters),
    el.list, el.listEmpty, el.sentinel);

  root.replaceChildren(largeTitle(q.title), el.note, el.empty, el.main);
  observer?.disconnect();
  observer = new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting) && S.campaign && limit < S.campaign.items.length) { limit += 300; renderList(); } }, { rootMargin: '600px 0px' });
  observer.observe(el.sentinel);
  update(true);
}

export function onShow() {
  update();
  clearInterval(ticker);
  ticker = setInterval(() => { if (S.tab === 'queue' && !document.hidden) updatePhase(); }, 1000);
}

on('campaign', () => root && update());

function update(initial = false) {
  const camp = S.campaign;
  const has = !!camp && camp.total > 0;
  el.empty.hidden = has;
  el.main.hidden = !has;
  el.note.hidden = !campaignActive(camp);
  if (!has) return;
  const q = t().queue;
  const { sent = 0, total = 0, failed = 0 } = camp;
  const p = total ? Math.min(1, sent / total) : 0;
  el.ringSvg.querySelectorAll('.ring-arc').forEach((a) => { a.style.strokeDashoffset = C * (1 - p); a.style.opacity = p > 0 ? '' : '0'; });
  rollText(el.num, sent);
  el.total.textContent = '/' + total;
  el.ring.setAttribute('aria-label', q.ringDescription(sent, total));
  el.title.textContent = camp.title || '';
  const done = camp.state === 'done';
  el.doneCheck.hidden = !done;
  if (done && lastState !== 'done' && !initial) replay(el.doneCheck, 'pop-big');
  lastState = camp.state;
  rollText(el.summary, q.summary(sent, failed, Math.max(0, total - sent - failed)));
  updatePhase();
  renderControls();
  renderList();
}

function updatePhase() {
  const camp = S.campaign;
  if (!camp || !el.phase) return;
  const q = t().queue;
  const secs = Math.max(0, Math.ceil(((camp.nextAt || 0) - Date.now()) / 1000));
  let text, ic, tone;
  if (camp.state === 'done') [text, ic, tone] = [q.phaseDone, 'check', 'green'];
  else if (camp.state === 'stopped') [text, ic, tone] = [q.phaseStopped, 'stop', 'fill'];
  else if (camp.state === 'idle') [text, ic, tone] = [q.phaseReady, 'clock', 'fill'];
  else if (camp.state === 'paused') [text, ic, tone] = [q.phasePaused, 'pause', 'orange'];
  else if (camp.state === 'cooling' || camp.phase === 'cooldown') [text, ic, tone] = [q.phaseCooldown(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`), 'hourglass', 'orange'];
  else if ((camp.phase === 'typing' || camp.phase === 'sending') && camp.current) [text, ic, tone] = [q.phaseTyping(camp.current), 'pencil', 'blue'];
  else [text, ic, tone] = [q.phaseWaiting(secs), 'timer', 'orange'];
  const key = tone + ic;
  if (el.phase.dataset.key !== key) {
    el.phase.dataset.key = key;
    el.phase.className = `phase-pill tone-${tone}`;
    el.phase.replaceChildren(icon(ic, 16), h('span', null, text));
    replay(el.phase, 'fade-in');
  } else {
    el.phase.lastChild.textContent = text;
  }
}

function renderControls() {
  const q = t().queue;
  const camp = S.campaign;
  const act = (path, msg) => async () => {
    try { await api('/campaign/' + path, { method: 'POST' }); } catch (e) { toast(errText(e), 'red'); }
    refreshCampaign();
    if (msg) toast(msg);
  };
  const btn = (label, ic, tone, onClick) => h('button', { type: 'button', class: `ctrl-btn tone-${tone} press`, onclick: onClick }, icon(ic, 20), label);
  const stop = btn(q.stop, 'stop', 'red', () => openDialog({
    title: q.stopConfirmTitle, body: h('p', null, q.stopConfirmBody),
    actions: [{ label: t().cancel },{ label: q.stop, kind: 'danger', onClick: act('stop') }],
  }));
  const key = camp.state + (camp.failed > 0);
  if (el.controls.dataset.key === key) return;
  el.controls.dataset.key = key;
  if (camp.state === 'running' || camp.state === 'cooling') el.controls.replaceChildren(btn(q.pause, 'pause', 'fill', act('pause')), stop);
  else if (camp.state === 'paused') el.controls.replaceChildren(btn(q.resume, 'play', 'fill', act('resume')), stop);
  else if (camp.failed > 0) el.controls.replaceChildren(h('button', { type: 'button', class: 'capsule send press', onclick: act('retry-failed') }, icon('retry', 20), h('span', null, q.retryFailed)));
  else el.controls.replaceChildren();
}

// ---------- recipients ----------
function matches(it) {
  switch (filter) {
    case 'active': return it.status === 'typing';
    case 'sent': return it.status === 'sent';
    case 'pending': return it.status === 'pending';
    case 'failed': return it.status === 'failed';
    default: return true;
  }
}

function rowSig(it, running) { return [it.status, it.error, it.sentAt, running].join('|'); }

function rowContent(it, running) {
  const q = t().queue;
  const status = it.status === 'typing' && !running ? 'pending' : it.status;
  let circle, sub, subCls = 'caption';
  if (status === 'sent') {
    circle = h('span', { class: 'st-circle tone-green' }, icon('check', 18));
    const d = it.sentAt ? new Date(it.sentAt) : null;
    sub = d && !isNaN(d) ? q.rowSent(d.toLocaleTimeString(t().locale, { hour: '2-digit', minute: '2-digit' })) : q.rowSentNoTime;
  } else if (status === 'failed') {
    circle = h('span', { class: 'st-circle tone-red' }, icon('bang', 18));
    sub = q.rowFailed(it.error ? (t().errors[it.error] || it.error) : '');
    subCls += ' c-red-text';
  } else if (status === 'typing') {
    circle = h('span', { class: 'st-circle tone-blue typing-dots' }, h('i'), h('i'), h('i'));
    sub = q.rowTyping; subCls += ' c-blue-text';
  } else {
    circle = h('span', { class: 'st-circle tone-fill' }, icon('clock', 18));
    sub = q.rowWaiting;
  }
  return [circle, h('span', { class: 'row-text' }, h('strong', { class: 'ellipsis' }, it.name || '+' + it.phone), h('span', { class: subCls }, sub))];
}

function renderList(reset = false) {
  const camp = S.campaign;
  if (!camp) return;
  const running = campaignActive(camp);
  const items = (camp.items || []).filter(matches);
  const shown = items.slice(0, limit);
  const ids = shown.map((x) => x.id).join(',');
  el.listEmpty.hidden = items.length > 0;
  el.list.hidden = items.length === 0;
  if (reset || el.list.dataset.ids !== ids) {
    el.list.dataset.ids = ids;
    const old = new Map([...el.list.children].map((r) => [r.dataset.id, r]));
    const frag = document.createDocumentFragment();
    for (const it of shown) {
      const sig = rowSig(it, running);
      let r = old.get(String(it.id));
      if (!r || r.dataset.sig !== sig) {
        const prevStatus = r?.dataset.status;
        r = h('div', { class: 'queue-row', role: 'listitem', dataset: { id: it.id, sig, status: it.status } }, rowContent(it, running));
        if (prevStatus && prevStatus !== it.status) animate(r, it.status);
      }
      frag.append(r);
    }
    el.list.replaceChildren(frag);
    if (reset) replay(el.list, 'fade-in');
    return;
  }
  for (const it of shown) {
    const r = el.list.querySelector(`[data-id="${CSS.escape(String(it.id))}"]`);
    const sig = rowSig(it, running);
    if (!r || r.dataset.sig === sig) continue;
    const prev = r.dataset.status;
    r.dataset.sig = sig; r.dataset.status = it.status;
    r.replaceChildren(...rowContent(it, running));
    if (prev !== it.status) animate(r, it.status);
  }
}

function animate(r, status) {
  if (status === 'sent') { replay(r.firstChild, 'pop'); replay(r, 'flash-green'); }
  if (status === 'failed') { replay(r, 'shake'); }
}
