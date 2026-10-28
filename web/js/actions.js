// Server round trips shared by several screens.
import { api } from './api.js';
import { S, emit } from './store.js';
import { debounce, toast } from './dom.js';
import { t } from './i18n.js';

let pending = {};
const merge = (a, b) => {
  for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge({ ...(a[k] || {}) }, v) : v;
  return a;
};
const flushSettings = debounce(async () => {
  const patch = pending; pending = {};
  try { await api('/settings', { method: 'PUT', body: patch }); } catch (e) { if (e.code !== 'LOGIN_REQUIRED') toast(t().settings.saveFailed, 'red'); }
}, 400);

/** Partial settings update: applied locally at once, sent to the server debounced. */
export function saveSettings(patch) {
  merge(S.settings, patch);
  merge(pending, patch);
  flushSettings();
  emit('settings', patch);
}

let draftWarned = false;
export const saveDraft = debounce(async () => {
  try {
    await api('/draft', { method: 'PUT', body: S.draft });
    draftWarned = false;
  } catch (e) {
    if (e.code !== 'LOGIN_REQUIRED' && !draftWarned) { draftWarned = true; toast(t().compose.draftFailed, 'orange'); }
  }
}, 700);

export async function refreshAccounts() {
  try { S.accounts = await api('/accounts'); emit('accounts'); } catch { /* keep last known */ }
}

export async function refreshUpdate() {
  try { S.update = await api('/update'); emit('update'); } catch { /* try again later */ }
}

export async function refreshCampaign() {
  try {
    const c = await api('/campaign');
    S.campaign = c && c.id ? c : null;
  } catch (e) {
    if (e.status === 404) S.campaign = null; else return;
  }
  emit('campaign');
}

export async function refreshContacts() {
  try { S.contacts = await api('/contacts'); emit('contacts'); } catch { /* keep */ }
}
