// In-memory fake of the /app/api contract, loaded only with ?mock=1 (dev aid, never used in production).
// Options: &n=2000 (contact count), &linked=1 (personal account linked), &auto=1 (skip login),
// &campaign=1 (start with a running campaign), &aifail=1 (AI answers AI_BUSY), &theme=dark|light, &lang=tr,
// &tab=contacts|queue|settings (open that tab, handy for headless screenshots). Password: demo
import { setTransport, setUploadUrl } from './api.js';
import { emit } from './store.js';

const q = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (data) => ({ status: 200, data });
const fail = (status, code) => ({ status, data: { error: code.toLowerCase(), code } });

const FIRST = ['Budi', 'Siti', 'Ahmad', 'Dewi', 'Rina', 'Agus', 'Fitri', 'Hendra', 'Ayşe', 'Mehmet', 'Fatma', 'Ali', 'Zeynep', 'Mustafa', 'Nur', 'Yusuf', 'Rizky', 'Putri', 'Bapak Joko', 'dr. Andi', 'Ibu Sri', 'Emre', 'Elif', 'Hasan'];
const LAST = ['Santoso', 'Rahayu', 'Hidayat', 'Wijaya', 'Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Lestari', 'Saputra', 'Çelik', 'Kurniawan', '(teman kantor)', 'Pratama'];
const TAGS = ['Keluarga', 'Teman', 'Bisnis', 'Pengajian'];

let loggedIn = q.has('auto') || sessionStorage.getItem('kr_mock_login') === '1';
let tries = 0;
let seq = 1;
const contacts = [];
for (let i = 0; i < (Number(q.get('n')) || 120); i++) {
  const name = `${FIRST[(i * 5) % FIRST.length]} ${LAST[(i + Math.floor(i / FIRST.length)) % LAST.length]}`.trim();
  const first = name.replace(/^(bapak|ibu|dr\.)\s+/i, '').split(' ')[0];
  contacts.push({
    id: 'k' + seq++, name, phone: (i % 3 ? '62812' : '90532') + String(1000000 + i * 7919).slice(-7),
    nickname: i % 4 === 0 ? '' : first, company: '', custom1: '',
    tags: i % 5 === 0 ? [TAGS[i % TAGS.length]] : [], selected: i < 8,
  });
}
const sortContacts = () => contacts.sort((a, b) => a.name.localeCompare(b.name));
sortContacts();

const settings = {
  language: 'id', theme: 'system', defaultCountry: '62',
  antiBan: { preset: 'OPTIMAL', customMinSec: 30, customMaxSec: 70, typingSim: true, pauseMin: 5, batchSize: 25 },
  aiTone: 'friendly', defaults: { company: '', custom1: '' },
};
if (q.get('theme')) settings.theme = q.get('theme');
if (q.get('lang')) settings.language = q.get('lang');
let draft = {
  bubbles: ['Assalamualaikum {Nickname} 🙏', 'Insya Allah minggu depan aku berangkat umrah. {Mohon doanya|Minta doanya} ya, semoga lancar.'],
  attachments: [], account: 'personal',
};
const accounts = [
  { id: 'personal', status: q.has('linked') ? 'CONNECTED' : 'DISCONNECTED', phone: q.has('linked') ? '6281234567890' : null },
  { id: 'business', status: 'DISCONNECTED', phone: null },
];
const uploads = new Map();

// ---------- fake campaign (delays shortened ~10x so it can be watched) ----------
let camp = null;
let simT = null;
let processed = 0;
let cooled = false;
const schedule = (fn, ms) => { clearTimeout(simT); camp.nextAt = Date.now() + ms; simT = setTimeout(fn, ms); };
function nextContact() {
  if (!camp || camp.state !== 'running') return;
  const it = camp.items.find((i) => i.status === 'pending');
  if (!it) { Object.assign(camp, { state: 'done', phase: null, current: null, nextAt: null }); return; }
  if (processed > 0 && processed % 10 === 0 && !cooled) {
    cooled = true;
    Object.assign(camp, { state: 'cooling', phase: 'cooldown', current: null });
    schedule(() => { camp.state = 'running'; nextContact(); }, 9000);
    return;
  }
  cooled = false;
  Object.assign(camp, { phase: 'waiting', current: null });
  schedule(() => {
    it.status = 'typing';
    Object.assign(camp, { phase: 'typing', current: it.name });
    schedule(() => {
      if (it.phone.endsWith('3')) Object.assign(it, { status: 'failed', error: 'INVALID_PHONE' });
      else Object.assign(it, { status: 'sent', sentAt: Date.now() });
      processed++;
      nextContact();
    }, 2200);
  }, processed === 0 ? 400 : 2500 + Math.random() * 2500);
}
function startCampaign(list, account) {
  processed = 0; cooled = false;
  const d = new Date();
  camp = {
    id: 'c_' + Date.now(), title: `Broadcast ${d.getDate()} ${d.toLocaleString('id-ID', { month: 'short' })} ${d.toTimeString().slice(0, 5)}`,
    state: 'running', total: list.length, sent: 0, failed: 0, current: null, phase: 'waiting', nextAt: null,
    items: list.map((c, i) => ({ id: 'i' + i, contactId: c.id, name: c.nickname || c.name, phone: c.phone, status: 'pending', error: null, sentAt: null, account: account === 'dual' ? (i % 2 ? 'business' : 'personal') : account })),
  };
  nextContact();
}
const snapshot = () => {
  if (!camp) return { state: 'idle' };
  camp.sent = camp.items.filter((i) => i.status === 'sent').length;
  camp.failed = camp.items.filter((i) => i.status === 'failed').length;
  return structuredClone(camp);
};
if (q.has('campaign')) startCampaign(contacts.slice(0, 40), 'personal');

function parseCsv(text) {
  const rows = text.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split(',').map((x) => x.replace(/^"|"$/g, '').trim()));
  const head = (rows.shift() || []).map((x) => x.toLowerCase());
  const col = (...names) => head.findIndex((x) => names.includes(x));
  const iName = col('name', 'nama'), iFirst = col('first name'), iLast = col('last name'), iPhone = col('phone', 'phone 1 - value', 'no hp');
  let added = 0, updated = 0, skipped = 0;
  for (const r of rows) {
    const name = iName >= 0 ? r[iName] : [r[iFirst], r[iLast]].filter(Boolean).join(' ');
    let phone = (r[iPhone] || '').split(' ::: ')[0].replace(/\D/g, '');
    if (phone.startsWith('0')) phone = settings.defaultCountry + phone.slice(1);
    if (!name || phone.length < 8) { skipped++; continue; }
    const ex = contacts.find((c) => c.phone === phone);
    if (ex) { ex.name = name; updated++; continue; }
    contacts.push({ id: 'k' + seq++, name, phone, nickname: name.split(' ')[0], company: '', custom1: '', tags: [], selected: false });
    added++;
  }
  sortContacts();
  return { added, updated, skipped };
}

async function handle(method, fullPath, body, type, onProgress) {
  await wait(120);
  const [path, query] = fullPath.split('?');
  const seg = path.split('/').filter(Boolean);
  const key = method + ' /' + seg[0];

  if (key === 'POST /login') {
    if (++tries > 5) return fail(429, 'TOO_MANY_TRIES');
    if (body?.password !== 'demo') return fail(401, 'BAD_PASSWORD');
    tries = 0; loggedIn = true; sessionStorage.setItem('kr_mock_login', '1');
    return ok({ ok: true });
  }
  if (!loggedIn) return fail(401, 'LOGIN_REQUIRED');

  switch (key) {
    case 'POST /logout': loggedIn = false; sessionStorage.removeItem('kr_mock_login'); return ok({ ok: true });
    case 'GET /me': return ok({ ok: true, version: '1.0.0-mock' });
    case 'GET /settings': return ok(structuredClone(settings));
    case 'PUT /settings':
      for (const [k, v] of Object.entries(body)) settings[k] = v && typeof v === 'object' ? { ...settings[k], ...v } : v;
      return ok(structuredClone(settings));
    case 'GET /draft': return ok(structuredClone(draft));
    case 'PUT /draft': draft = structuredClone(body); return ok({ ok: true });
    case 'GET /accounts': return ok(structuredClone(accounts));
    case 'POST /accounts': {
      const a = accounts.find((x) => x.id === seg[1]);
      if (seg[2] === 'disconnect') { Object.assign(a, { status: 'DISCONNECTED', phone: null }); return ok({ ok: true }); }
      if (seg[2] === 'check') { await wait(1200); return ok({ ready: a.status === 'CONNECTED' }); }
      if (a.status === 'CONNECTED') return fail(409, 'ALREADY_CONNECTED');
      a.status = 'PAIRING';
      setTimeout(() => Object.assign(a, { status: 'CONNECTED', phone: body.phone }), 7000);
      return ok({ code: 'K7QM2XRA' });
    }
    case 'GET /contacts':
      if (seg[1] === 'export') {
        return ok(['name,phone,nickname,company,custom1,tags', ...contacts.map((c) => [c.name, c.phone, c.nickname, c.company, c.custom1, c.tags.join(';')].join(','))].join('\n'));
      }
      return ok(structuredClone(contacts));
    case 'POST /contacts':
      if (seg[1] === 'import') return ok(parseCsv(body));
      if (seg[1] === 'select') {
        const set = body.ids ? new Set(body.ids) : null;
        let count = 0;
        for (const c of contacts) {
          if ((set && !set.has(c.id)) || (body.tag && !c.tags.includes(body.tag))) continue;
          c.selected = body.selected; count++;
        }
        return ok({ count });
      } else {
        const c = { id: 'k' + seq++, name: body.name, phone: body.phone, nickname: body.nickname || body.name.split(' ')[0], company: '', custom1: '', tags: [], selected: false };
        contacts.push(c); sortContacts();
        return ok(c);
      }
    case 'PATCH /contacts': {
      const c = contacts.find((x) => x.id === seg[1]);
      if (!c) return fail(404, 'NOT_FOUND');
      Object.assign(c, body);
      return ok(structuredClone(c));
    }
    case 'DELETE /contacts': {
      const i = contacts.findIndex((x) => x.id === seg[1]);
      if (i >= 0) contacts.splice(i, 1);
      return ok({ ok: true });
    }
    case 'POST /uploads': {
      if (body.size > 16 * 1024 * 1024) return fail(413, 'FILE_TOO_LARGE');
      for (let p = 10; p <= 100; p += 10) { await wait(80); onProgress?.(p); }
      const id = 'u' + seq++;
      uploads.set(id, URL.createObjectURL(body));
      return ok({ id, name: new URLSearchParams(query).get('name'), mime: type || body.type, size: body.size });
    }
    case 'DELETE /uploads': uploads.delete(seg[1]); return ok({ ok: true });
    case 'POST /ai': {
      await wait(1400);
      if (q.has('aifail')) return fail(503, 'AI_BUSY');
      const parts = body.message.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
      const out = parts.map((s, i) => (i === 0 && !s.includes('|') ? s.replace(/^(Assalamualaikum|Halo|Hai)/i, '{Assalamualaikum|Halo}') : s));
      return ok({ bubbles: body.tone === 'shorter' ? [out.join(' ')] : out.slice(0, body.maxBubbles) });
    }
    case 'GET /campaign': return ok(snapshot());
    case 'POST /campaign': {
      if (!seg[1]) {
        if (camp && ['running', 'paused', 'cooling'].includes(camp.state)) return fail(409, 'CAMPAIGN_RUNNING');
        if (!body.bubbles.some((b) => b.trim()) && !body.attachments.length) return fail(400, 'EMPTY_MESSAGE');
        if (!accounts.some((a) => a.status === 'CONNECTED')) return fail(400, 'NOT_CONNECTED');
        const sel = contacts.filter((c) => c.selected);
        const list = sel.length ? sel : contacts;
        if (!list.length) return fail(400, 'NO_CONTACTS');
        startCampaign(list, body.account);
        return ok({ id: camp.id });
      }
      if (!camp) return fail(404, 'NO_CAMPAIGN');
      if (seg[1] === 'pause') { clearTimeout(simT); camp.state = 'paused'; camp.nextAt = null; }
      if (seg[1] === 'resume' && camp.state === 'paused') { camp.state = 'running'; nextContact(); }
      if (seg[1] === 'stop') {
        clearTimeout(simT);
        camp.items.forEach((i) => { if (i.status === 'typing') i.status = 'pending'; });
        Object.assign(camp, { state: 'stopped', phase: null, current: null, nextAt: null });
      }
      if (seg[1] === 'retry-failed') {
        camp.items.forEach((i) => { if (i.status === 'failed') Object.assign(i, { status: 'pending', error: null, phone: i.phone.slice(0, -1) + '4' }); });
        camp.state = 'running'; nextContact();
      }
      return ok(snapshot());
    }
    default: return fail(404, 'NOT_FOUND');
  }
}

export function install() {
  setTransport(handle);
  setUploadUrl((id) => uploads.get(id) || 'icons/icon-192.png');
  console.info('[Kirimrasa] mock API on — password: demo');
  if (q.get('tab')) setTimeout(() => emit('go', { tab: q.get('tab') }), 600);
}
