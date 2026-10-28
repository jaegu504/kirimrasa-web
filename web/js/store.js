// Shared app state + small domain helpers (spintax, delays, phone numbers).
import { t } from './i18n.js';

export const S = {
  me: null,
  settings: null,
  accounts: [],
  contacts: [],
  draft: { bubbles: [''], attachments: [], account: 'personal' },
  campaign: null,
  update: null, // { available, behind, dashboardUrl }
  tab: 'compose',
  aiTone: 'friendly',
};

const listeners = {};
export const on = (ev, fn) => { (listeners[ev] ||= []).push(fn); };
export const emit = (ev, data) => { (listeners[ev] || []).forEach((fn) => fn(data)); };

export const MAX_BUBBLES = 5;
export const MAX_ATTACHMENTS = 5;
export const MAX_UPLOAD = 16 * 1024 * 1024;
export const TONES = ['friendly', 'heartfelt', 'casual', 'polite', 'shorter', 'max_variance'];
export const PRESETS = ['CONSERVATIVE', 'OPTIMAL', 'TURBO', 'CUSTOM'];
const RANGES = { CONSERVATIVE: [35, 75], OPTIMAL: [25, 65], TURBO: [15, 30] };

export const isLinked = (a) => a && (a.status === 'CONNECTED' || a.status === 'STANDBY');
export const account = (id) => S.accounts.find((a) => a.id === id);
export const anyLinked = () => S.accounts.some(isLinked);

export function delayRange(ab = S.settings?.antiBan) {
  if (!ab) return [25, 65];
  return RANGES[ab.preset] || [ab.customMinSec, ab.customMaxSec];
}

/** Same rule as the Android composer: average contact delay, 4.5 s typing per extra bubble, plus cooldowns. */
export function estimateMinutes(contacts, bubbleCount) {
  const ab = S.settings?.antiBan || { batchSize: 25, pauseMin: 5 };
  const [a, b] = delayRange(ab);
  const perContact = (a + b) / 2 + Math.max(0, bubbleCount - 1) * 4.5;
  const cooldowns = Math.floor(Math.max(0, contacts - 1) / ab.batchSize) * ab.pauseMin * 60;
  return Math.max(1, Math.ceil((contacts * perContact + cooldowns) / 60));
}

/** Pick one option of every {a|b|c}, innermost first. */
export function spin(text) {
  const re = /\{([^{}]*\|[^{}]*)\}/;
  let out = text, guard = 0;
  while (re.test(out) && guard++ < 200) {
    out = out.replace(re, (_, body) => { const o = body.split('|'); return o[Math.floor(Math.random() * o.length)]; });
  }
  return out;
}

export function interpolate(text, contact) {
  const d = S.settings?.defaults || {};
  const nick = (contact?.nickname || '').trim() || t().nicknameFallback;
  return text
    .replaceAll('{Nickname}', nick)
    .replaceAll('{Company}', contact?.company || d.company || '')
    .replaceAll('{Custom_1}', contact?.custom1 || d.custom1 || '');
}

/** Digits only; a leading 0 becomes the default country code (same as the server rule). */
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = (S.settings?.defaultCountry || '62') + d.slice(1);
  return d;
}

export const mediaKind = (mime = '') =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';

export function formatSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.0', '') + ' MB';
}

export function initials(name) {
  const w = String(name || '').replace(/\(.*?\)/g, '').trim().split(/\s+/).filter((x) => /\p{L}/u.test(x));
  return (w.slice(0, 2).map((x) => x[0].toUpperCase()).join('') || '#');
}

/** First real word of a name, skipping titles (mirrors ContactRepository.extractSmartNickname). */
export function smartNickname(name) {
  if ((String(name).match(/\p{L}/gu) || []).length < 2) return '';
  const cleaned = String(name).replace(/\(.*?\)/g, '').replace(/^(dr\.|drs\.|ir\.|prof\.?)\s+/i, '').trim();
  const first = cleaned.split(/\s+/)[0] || '';
  return (first.match(/\p{L}/gu) || []).length < 2 ? '' : first;
}

export const selectedCount = () => S.contacts.reduce((n, c) => n + (c.selected ? 1 : 0), 0);
export const campaignActive = (c = S.campaign) => !!c && ['running', 'paused', 'cooling'].includes(c.state);
