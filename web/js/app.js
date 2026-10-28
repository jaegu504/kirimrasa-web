// Boot, login, app shell (sidebar / bottom tab bar), theme, language and polling.
import { api, errText, setUnauthorizedHandler } from './api.js';
import { h, icon, segmented } from './dom.js';
import { setLang, lang, t } from './i18n.js';
import { S, on, campaignActive } from './store.js';
import { refreshAccounts, refreshCampaign, refreshUpdate } from './actions.js';
import * as compose from './screens/compose.js';
import * as contacts from './screens/contacts.js';
import * as queue from './screens/queue.js';
import * as settings from './screens/settings.js';

// Opt-in fake backend for UI work without the gateway: open the page with ?mock=1
if (new URLSearchParams(location.search).has('mock')) (await import('./mock.js')).install();

const SCREENS = { compose, contacts, queue, settings };
const TAB_ICONS = { compose: 'send', contacts: 'user', queue: 'clock', settings: 'tune' };
const app = document.getElementById('app');

const pref = (k, d) => { try { return localStorage.getItem('kr_' + k) || d; } catch { return d; } };
const setPref = (k, v) => { try { localStorage.setItem('kr_' + k, v); } catch { /* private mode */ } };

// ---------- theme ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
let themeMode = pref('theme', 'system');
function applyTheme(mode = themeMode, animate = false) {
  themeMode = mode;
  setPref('theme', mode);
  const dark = mode === 'dark' || (mode === 'system' && mq.matches);
  const root = document.documentElement;
  if (animate) { root.classList.add('theming'); setTimeout(() => root.classList.remove('theming'), 450); }
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0E1424' : '#EEF4FF');
}
mq.addEventListener('change', () => applyTheme(themeMode, true));
applyTheme();
setLang(pref('lang', 'id'));

on('settings', (patch) => {
  if (patch.theme) applyTheme(patch.theme, true);
  if (patch.language && patch.language !== lang()) { setLang(patch.language); setPref('lang', patch.language); renderShell(); }
});

setUnauthorizedHandler(() => { stopPolling(); showLogin(); });
on('logout', () => { stopPolling(); showLogin(); });

// ---------- boot ----------
async function boot() {
  app.replaceChildren(h('div', { class: 'splash' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 72, height: 72 })));
  try {
    S.me = await api('/me');
  } catch (e) {
    if (e.code !== 'LOGIN_REQUIRED') showOffline(e);
    return;
  }
  try {
    const [settingsData, accounts, contactsData, draft, campaign] = await Promise.all([
      api('/settings'), api('/accounts'), api('/contacts'), api('/draft'),
      api('/campaign').catch((e) => { if (e.status === 404) return null; throw e; }),
    ]);
    S.settings = settingsData;
    S.accounts = accounts || [];
    S.contacts = contactsData || [];
    if (draft && Array.isArray(draft.bubbles) && draft.bubbles.length) {
      S.draft = { bubbles: draft.bubbles.slice(0, 5), attachments: draft.attachments || [], account: draft.account || 'personal' };
    }
    S.campaign = campaign && campaign.id ? campaign : null;
    S.aiTone = S.settings.aiTone || 'friendly';
  } catch (e) {
    if (e.code !== 'LOGIN_REQUIRED') showOffline(e);
    return;
  }
  setLang(S.settings.language || 'id');
  setPref('lang', lang());
  applyTheme(S.settings.theme || 'system');
  renderShell();
  startPolling();
  refreshUpdate();
  clearInterval(updateTimer);
  updateTimer = setInterval(refreshUpdate, 6 * 60 * 60 * 1000);
}
let updateTimer = null;

function showOffline(err) {
  app.replaceChildren(h('div', { class: 'center-screen' },
    h('div', { class: 'card pad-24 stack-12 center' },
      icon('warn', 32, 'c-orange'),
      h('p', { class: 'body' }, errText(err)),
      h('button', { type: 'button', class: 'capsule blue press', onclick: boot }, icon('retry', 20), h('span', null, t().retry)))));
}

// ---------- login ----------
function showLogin(errorCode) {
  const L = t().login;
  let busy = false;
  const err = h('p', { class: 'login-error', role: 'alert' }, errorCode ? t().errors[errorCode] || '' : '');
  const input = h('input', { type: 'password', id: 'pw', class: 'field', autocomplete: 'current-password', required: true, 'aria-label': L.password, placeholder: L.password });
  const eye = h('button', { type: 'button', class: 'field-icon press', 'aria-label': L.show }, icon('eye', 20));
  eye.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    eye.replaceChildren(icon(show ? 'eyeOff' : 'eye', 20));
    eye.setAttribute('aria-label', show ? L.hide : L.show);
    input.focus();
  };
  const submitLabel = h('span', null, L.submit);
  const submit = h('button', { type: 'submit', class: 'capsule send press' }, icon('lock', 20), submitLabel);
  const form = h('form', { class: 'login-card card stack-16', novalidate: true },
    h('img', { class: 'login-logo', src: 'icons/icon-192.png', alt: '', width: 96, height: 96 }),
    h('div', { class: 'center stack-4' }, h('h1', { class: 'login-title' }, 'Kirimrasa'), h('p', { class: 'muted' }, L.subtitle)),
    h('label', { class: 'field-wrap' }, input, eye),
    err, submit,
    segmented(['Indonesia', 'Türkçe'], lang() === 'tr' ? 1 : 0, (i) => {
      setLang(i ? 'tr' : 'id'); setPref('lang', lang()); showLogin();
    }, { label: 'Bahasa / Dil', small: true }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy || !input.value) { input.focus(); return; }
    busy = true; submitLabel.textContent = L.busy; err.textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: input.value } });
      boot();
    } catch (ex) {
      busy = false; submitLabel.textContent = L.submit;
      err.textContent = errText(ex);
      input.select();
    }
  };
  app.replaceChildren(h('div', { class: 'center-screen login-screen' }, form));
  input.focus();
}

// ---------- shell ----------
let badgeEls = [];
let updateDots = [];
on('update', () => updateDots.forEach((d) => { d.hidden = !S.update?.available; }));
function renderShell() {
  const nav = t().nav;
  const tabs = Object.keys(SCREENS);
  badgeEls = [];
  updateDots = [];
  const navButton = (tab, cls) => {
    const badge = tab === 'queue' ? h('span', { class: 'badge', hidden: true })
      : tab === 'settings' ? h('span', { class: 'badge dot', hidden: !S.update?.available, 'aria-label': t().settings.updateTitle }) : null;
    if (tab === 'queue') badgeEls.push(badge);
    if (tab === 'settings') updateDots.push(badge);
    return h('button', {
      type: 'button', class: cls + ' press', dataset: { tab }, 'aria-current': S.tab === tab ? 'page' : null,
      onclick: () => go(tab),
    }, h('span', { class: 'nav-icon' }, icon(TAB_ICONS[tab], 24), badge), h('span', { class: 'nav-label' }, nav[tab]));
  };
  const sections = tabs.map((tab) => h('section', { class: 'screen', id: 'tab-' + tab, hidden: S.tab !== tab, 'aria-label': nav[tab] }));
  app.replaceChildren(h('div', { class: 'shell' },
    h('nav', { class: 'sidebar', 'aria-label': 'Kirimrasa' },
      h('div', { class: 'brand' }, h('img', { src: 'icons/icon-192.png', alt: '', width: 40, height: 40 }), h('span', null, 'Kirimrasa')),
      tabs.map((tab) => navButton(tab, 'side-item'))),
    h('main', { id: 'main' }, sections),
    h('nav', { class: 'tabbar', 'aria-label': 'Kirimrasa' }, tabs.map((tab) => navButton(tab, 'tab-item')))));
  tabs.forEach((tab, i) => SCREENS[tab].render(sections[i]));
  SCREENS[S.tab].onShow?.();
  updateBadge();
}

function go(tab, opts) {
  if (!SCREENS[tab]) return;
  const prev = S.tab;
  S.tab = tab;
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
  for (const k of Object.keys(SCREENS)) {
    const sec = document.getElementById('tab-' + k);
    if (!sec) continue;
    sec.hidden = k !== tab;
    if (k === tab && prev !== tab) { sec.classList.remove('enter'); void sec.offsetWidth; sec.classList.add('enter'); }
  }
  window.scrollTo({ top: 0 });
  SCREENS[tab].onShow?.(opts);
  if (tab === 'queue') refreshCampaign();
  if (tab === 'compose' || tab === 'settings') refreshAccounts();
  schedulePoll();
}
on('go', ({ tab, opts }) => go(tab, opts));

function updateBadge() {
  const c = S.campaign;
  const n = campaignActive(c) ? Math.max(0, c.total - c.sent - c.failed) : 0;
  badgeEls.forEach((b) => { b.hidden = n === 0; b.textContent = n > 99 ? '99+' : n; });
}
on('campaign', updateBadge);

// ---------- polling ----------
let pollTimer = null;
function schedulePoll() {
  clearTimeout(pollTimer);
  if (!S.settings) return;
  // 2 s while the page is visible and something is happening, otherwise 10 s
  const fast = !document.hidden && (S.tab === 'queue' || campaignActive());
  pollTimer = setTimeout(async () => { await refreshCampaign(); schedulePoll(); }, fast ? 2000 : 10000);
}
const startPolling = schedulePoll;
function stopPolling() { clearTimeout(pollTimer); pollTimer = null; S.settings = null; }
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.settings) { refreshCampaign(); schedulePoll(); } });

boot();
