// "Pengaturan" tab — mirrors ui/screens/settings/SettingsScreen.kt; server settings replace the app's "advanced" block.
import { api, errText } from '../api.js';
import { h, icon, tile, segmented, toggle, pill, sectionHeader, largeTitle, toast, openDialog, replay, fill } from '../dom.js';
import { t } from '../i18n.js';
import { S, on, emit, PRESETS, TONES, account, isLinked, delayRange, normalizePhone } from '../store.js';
import { saveSettings, refreshAccounts } from '../actions.js';

const ACC = {
  personal: { icon: 'chat', gradient: 'green', name: 'personal' },
  business: { icon: 'work', gradient: 'wab', name: 'business' },
};
let root, el = {};
const st = {
  personal: { expanded: false, phone: '', code: '', requesting: false, error: '' },
  business: { expanded: false, phone: '', code: '', requesting: false, error: '' },
};
let lastStatus = {};
let pairTimer = null;
let showBreak = false;
let showPassword = false;

export function render(container) {
  root = container;
  const s = t().settings;
  el = { acc: {} };
  for (const id of Object.keys(ACC)) el.acc[id] = h('div', { class: 'account', id: 'acc-' + id });
  el.safety = h('div', { class: 'card' });

  const toneChips = h('div', { class: 'chips' }, TONES.map((k) => pill(t().compose.tones[k], k === S.settings.aiTone ? 'purple' : 'fill', () => {
    saveSettings({ aiTone: k });
    S.aiTone = k;
    toneChips.querySelectorAll('.pill').forEach((p, i) => { const on = TONES[i] === k; p.className = `pill press tone-${on ? 'purple' : 'fill'}`; p.setAttribute('aria-pressed', String(on)); });
  }, { selected: k === S.settings.aiTone })));

  const choice = (title, ic, grad, options, index, onSelect, caption) => h('div', { class: 'choice-row stack-10' },
    h('div', { class: 'row-line' }, tile(ic, grad), h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, title), caption ? h('span', { class: 'caption' }, caption) : null)),
    segmented(options, index, onSelect, { label: title }));

  const pwInfo = h('p', { class: 'muted pad-row', hidden: !showPassword }, s.passwordInfo);
  const pwRow = h('button', { type: 'button', class: 'list-row press', 'aria-expanded': String(showPassword), onclick: (e) => {
    showPassword = !showPassword;
    pwInfo.hidden = !showPassword;
    e.currentTarget.setAttribute('aria-expanded', String(showPassword));
    e.currentTarget.querySelector('.chev').replaceWith(icon(showPassword ? 'down' : 'right', 20, 'chev'));
    if (showPassword) replay(pwInfo, 'fade-in');
  } }, tile('key', 'gray'), h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, s.password), h('span', { class: 'caption' }, s.passwordCaption)), icon(showPassword ? 'down' : 'right', 20, 'chev'));

  root.replaceChildren(
    largeTitle(s.title),
    sectionHeader(s.sectionAccounts),
    h('div', { class: 'card' }, el.acc.personal, h('hr', { class: 'sep inset-62' }), el.acc.business),
    sectionHeader(s.sectionSafety),
    el.safety,
    sectionHeader(s.sectionAi),
    h('div', { class: 'card pad-16 stack-12' },
      h('div', { class: 'row-line' }, tile('sparkle', 'purple'), h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, s.toneTitle), h('span', { class: 'caption' }, s.toneCaption))),
      toneChips),
    sectionHeader(s.sectionGeneral),
    h('div', { class: 'card' },
      choice(s.language, 'globe', 'blue', ['Indonesia', 'Türkçe'], S.settings.language === 'tr' ? 1 : 0, (i) => saveSettings({ language: i ? 'tr' : 'id' })),
      h('hr', { class: 'sep inset-62' }),
      choice(s.appearance, 'moon', 'indigo', s.themes, ['system', 'light', 'dark'].indexOf(S.settings.theme || 'system'), (i) => saveSettings({ theme: ['system', 'light', 'dark'][i] })),
      h('hr', { class: 'sep inset-62' }),
      choice(s.country, 'phone', 'green', ['+62 Indonesia', '+90 Türkiye'], S.settings.defaultCountry === '90' ? 1 : 0, (i) => saveSettings({ defaultCountry: i ? '90' : '62' }), s.countryCaption)),
    sectionHeader(s.sectionLogin),
    h('div', { class: 'card' },
      pwRow, pwInfo,
      h('hr', { class: 'sep inset-62' }),
      h('button', { type: 'button', class: 'list-row press', onclick: logout },
        tile('logout', 'pink'), h('span', { class: 'row-text' }, h('span', { class: 'row-title c-red-text' }, s.logout), h('span', { class: 'caption' }, s.logoutCaption))),
      h('hr', { class: 'sep inset-62' }),
      h('div', { class: 'list-row' }, tile('info', 'gray'), h('span', { class: 'row-text row-title' }, s.version), h('span', { class: 'muted' }, 'v' + (S.me?.version || '?')))),
    h('div', { class: 'spacer-16' }));

  lastStatus = {};
  for (const id of Object.keys(ACC)) buildAccount(id);
  buildSafety();
}

export function onShow(opts) {
  if (opts?.link && !isLinked(account(opts.link))) {
    st[opts.link].expanded = true;
    buildAccount(opts.link);
    const box = el.acc[opts.link];
    box.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setTimeout(() => box.querySelector('input')?.focus({ preventScroll: true }), 300);
  }
}

on('accounts', () => {
  if (!root) return;
  for (const id of Object.keys(ACC)) {
    const status = account(id)?.status;
    if (status === lastStatus[id]) continue;
    const becameLinked = isLinked(account(id)) && lastStatus[id] !== undefined && !['CONNECTED', 'STANDBY'].includes(lastStatus[id]);
    if (becameLinked) { st[id].code = ''; st[id].expanded = false; toast(t().settings.linked, 'green'); }
    buildAccount(id, becameLinked);
  }
});

// ---------- WhatsApp accounts ----------
function buildAccount(id, pulse = false) {
  const s = t().settings;
  const a = account(id);
  const S2 = st[id];
  const linked = isLinked(a);
  const status = a?.status || 'DISCONNECTED';
  lastStatus[id] = status;
  const [statusText, tone] = linked ? [s.statusConnected, 'green']
    : status === 'CONNECTING' || status === 'PAIRING' ? [s.statusConnecting, 'orange'] : [s.statusNotLinked, 'grey'];
  const name = s[ACC[id].name];

  const head = h('button', { type: 'button', class: 'list-row press', 'aria-expanded': String(S2.expanded), onclick: () => { S2.expanded = !S2.expanded; buildAccount(id); } },
    h('span', { class: 'tile-wrap' }, tile(ACC[id].icon, ACC[id].gradient), linked ? h('i', { class: 'status-dot' + (pulse ? ' pulse' : '') }) : null),
    h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, name), h('span', { class: 'caption c-' + tone + '-text' }, statusText)),
    !linked && !S2.expanded ? h('span', { class: 'pill tone-blue' }, s.link) : icon(S2.expanded ? 'down' : 'right', 20, 'chev'));

  let body = null;
  if (S2.expanded) {
    if (linked) {
      body = h('div', { class: 'account-body stack-10 fade-in' },
        a.phone ? h('p', { class: 'muted' }, '+' + a.phone) : null,
        h('div', { class: 'chips' },
          pill(S2.check ? s[S2.check] : s.testReady, S2.check === 'notReady' ? 'red' : S2.check === 'ready' ? 'green' : 'blue', () => checkReady(id), { iconName: 'check' }),
          pill(s.disconnect, 'red', () => disconnect(id, name), { iconName: 'unlink' })));
    } else {
      const input = h('input', { class: 'field', type: 'tel', inputmode: 'tel', autocomplete: 'tel', value: S2.phone, placeholder: t().contacts.phoneHint(S.settings.defaultCountry), 'aria-label': s.phoneLabel,
        oninput: (e) => { S2.phone = e.target.value; reqBtn.disabled = !S2.phone.trim() || S2.requesting; },
        onkeydown: (e) => { if (e.key === 'Enter') requestCode(id); } });
      const reqBtn = h('button', { type: 'button', class: 'capsule blue press', disabled: !S2.phone.trim() || S2.requesting, onclick: () => requestCode(id) },
        icon('key', 20), h('span', null, S2.requesting ? s.requesting : S2.code ? s.newCode : s.requestCode));
      body = h('div', { class: 'account-body stack-10 fade-in' },
        h('label', { class: 'caption', for: 'phone-' + id }, s.phoneLabel), Object.assign(input, { id: 'phone-' + id }),
        reqBtn,
        S2.error ? h('p', { class: 'alert tone-red', role: 'alert' }, S2.error) : null,
        S2.code ? codeBox(S2.code) : null);
    }
  }
  fill(el.acc[id], head, body);
}

function codeBox(code) {
  const s = t().settings;
  const clean = String(code).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const chars = (clean.slice(0, 4) + '-' + clean.slice(4)).split('');
  const codeEl = h('div', { class: 'pair-code', 'aria-label': clean, role: 'text' },
    chars.map((ch, i) => h('span', { class: ch === '-' ? 'dash' : 'ch', style: { animationDelay: i * 45 + 'ms' } }, ch)));
  return h('div', { class: 'code-box stack-10' },
    h('span', { class: 'caption' }, s.yourCode),
    codeEl,
    h('button', { type: 'button', class: 'capsule send press', onclick: () => copy(clean, codeEl) }, icon('copy', 20), h('span', null, s.copyCode)),
    h('p', { class: 'caption center' }, s.linkSteps),
    h('p', { class: 'caption center c-orange-text' }, s.waitingLink));
}

async function copy(text, node) {
  try { await navigator.clipboard.writeText(text); toast(t().settings.copied, 'green'); }
  catch {
    const r = document.createRange(); r.selectNodeContents(node);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  }
}

async function requestCode(id) {
  const S2 = st[id];
  const phone = normalizePhone(S2.phone);
  if (S2.requesting) return;
  if (phone.length < 8) { S2.error = t().errors.INVALID_PHONE; buildAccount(id); return; }
  S2.requesting = true; S2.error = ''; buildAccount(id);
  try {
    const r = await api(`/accounts/${id}/pair`, { method: 'POST', body: { phone } });
    S2.code = r.code || '';
    watchPairing();
  } catch (e) {
    S2.error = errText(e);
    if (e.code === 'ALREADY_CONNECTED') refreshAccounts();
  }
  S2.requesting = false;
  buildAccount(id);
}

/** Poll accounts every 3 s while a pairing code is out, for up to 5 minutes. */
function watchPairing() {
  clearInterval(pairTimer);
  const until = Date.now() + 5 * 60 * 1000;
  pairTimer = setInterval(async () => {
    const waiting = Object.keys(st).some((id) => st[id].code && !isLinked(account(id)));
    if (!waiting || Date.now() > until) { clearInterval(pairTimer); return; }
    await refreshAccounts();
  }, 3000);
}

/** Wakes the WhatsApp socket and reports whether WhatsApp accepts it, like the app's readiness test. */
async function checkReady(id) {
  const S2 = st[id];
  if (S2.check === 'checking') return;
  S2.check = 'checking';
  buildAccount(id);
  try {
    const r = await api(`/accounts/${id}/check`, { method: 'POST' });
    S2.check = r.ready ? 'ready' : 'notReady';
  } catch (e) {
    S2.check = 'notReady';
    toast(errText(e), 'red');
  }
  buildAccount(id);
  setTimeout(() => { if (S2.check !== 'checking') { S2.check = null; buildAccount(id); } }, 4000);
}

function disconnect(id, name) {
  const s = t().settings;
  openDialog({
    title: s.disconnectTitle(name), body: h('p', null, s.disconnectBody),
    actions: [{ label: t().cancel }, { label: s.disconnect, kind: 'danger', onClick: async () => {
      try { await api(`/accounts/${id}/disconnect`, { method: 'POST' }); st[id].expanded = false; } catch (e) { toast(errText(e), 'red'); }
      refreshAccounts();
    } }],
  });
}

// ---------- sending safety ----------
function stepper(label, value, onMinus, onPlus) {
  const s = t().settings;
  return h('div', { class: 'stepper' },
    h('span', { class: 'caption' }, label),
    h('div', { class: 'stepper-row' },
      h('button', { type: 'button', class: 'step-btn press', 'aria-label': `${s.decrease} ${label}`, onclick: onMinus }, '−'),
      h('strong', { class: 'step-value', 'aria-live': 'polite' }, value),
      h('button', { type: 'button', class: 'step-btn press', 'aria-label': `${s.increase} ${label}`, onclick: onPlus }, '+')));
}

function setAntiBan(patch) {
  const ab = { ...S.settings.antiBan, ...patch };
  ab.customMinSec = Math.min(295, Math.max(10, ab.customMinSec));
  ab.customMaxSec = Math.min(300, Math.max(ab.customMinSec + 5, ab.customMaxSec));
  ab.pauseMin = Math.min(60, Math.max(1, ab.pauseMin));
  ab.batchSize = Math.min(100, Math.max(5, ab.batchSize));
  saveSettings({ antiBan: ab });
  buildSafety();
}

function buildSafety() {
  const s = t().settings;
  const ab = S.settings.antiBan;
  const [a, b] = delayRange(ab);
  const custom = ab.preset === 'CUSTOM';
  const presets = segmented(s.presets, PRESETS.indexOf(ab.preset), (i) => setTimeout(() => setAntiBan({ preset: PRESETS[i] }), 200), { label: s.speedTitle });
  fill(el.safety, 
    h('div', { class: 'pad-row stack-12' },
      h('div', { class: 'row-line' }, tile('shield', 'orange'),
        h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, s.speedTitle), h('span', { class: 'caption' }, s.delayCaption(a, b)))),
      presets,
      custom ? h('div', { class: 'stepper-pair fade-in' },
        stepper(s.customMin, s.secondsShort(ab.customMinSec), () => setAntiBan({ customMinSec: ab.customMinSec - 5 }), () => setAntiBan({ customMinSec: ab.customMinSec + 5 })),
        stepper(s.customMax, s.secondsShort(ab.customMaxSec), () => setAntiBan({ customMaxSec: ab.customMaxSec - 5 }), () => setAntiBan({ customMaxSec: ab.customMaxSec + 5 }))) : null,
      custom && ab.customMinSec < 25 ? h('p', { class: 'alert tone-orange' }, s.customWarning) : null),
    h('hr', { class: 'sep inset-16' }),
    h('div', { class: 'list-row' }, h('span', { class: 'row-text row-title', id: 'typing-label' }, s.showTyping),
      toggle(ab.typingSim, (v) => saveSettings({ antiBan: { typingSim: v } }), s.showTyping)),
    h('hr', { class: 'sep inset-16' }),
    h('button', { type: 'button', class: 'list-row press', 'aria-expanded': String(showBreak), onclick: () => { showBreak = !showBreak; buildSafety(); } },
      h('span', { class: 'row-text' }, h('span', { class: 'row-title' }, s.breakTitle), h('span', { class: 'caption' }, s.breakCaption(ab.pauseMin, ab.batchSize))),
      icon(showBreak ? 'down' : 'right', 20, 'chev')),
    showBreak ? h('div', { class: 'stepper-pair pad-row-bottom fade-in' },
      stepper(s.breakLength, s.minutesShort(ab.pauseMin), () => setAntiBan({ pauseMin: ab.pauseMin - 1 }), () => setAntiBan({ pauseMin: ab.pauseMin + 1 })),
      stepper(s.breakEvery, s.messagesShort(ab.batchSize), () => setAntiBan({ batchSize: ab.batchSize - 5 }), () => setAntiBan({ batchSize: ab.batchSize + 5 }))) : null);
}

async function logout() {
  try { await api('/logout', { method: 'POST' }); } catch { /* cookie may already be gone */ }
  emit('logout');
}
