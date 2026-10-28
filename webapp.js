'use strict';

// Kirimrasa web version: static UI from web/ and the cookie-authenticated JSON API under
// /app/api (contract: WEB_API.md). Mounted by server.js only when APP_PASSWORD is set.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createStore, writeAtomic } = require('./lib/store');
const C = require('./lib/contacts');
const M = require('./lib/message');
const { version } = require('./package.json');

const ACCOUNTS = ['personal', 'business'];
const TONES = ['friendly', 'heartfelt', 'casual', 'polite', 'shorter', 'max_variance'];
const COOKIE = 'kr_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const ACTIVE = ['running', 'paused', 'cooling'];
const UPLOAD_ID = /^[a-f0-9]{32}$/;
const MAX_FAILS = 5;

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const fail = (res, status, code) => res.status(status).json({ error: code, code });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function mount(app, gw) {
    const PASSWORD = process.env.APP_PASSWORD;
    const SECRET = crypto.createHash('sha256').update(`${process.env.API_KEY || ''}\0${PASSWORD}`).digest();
    const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
    const UPLOADS = path.join(DATA_DIR, 'uploads');
    const AI_URL = process.env.AI_URL || 'https://kirimrasa.jaegu108.workers.dev';
    fs.mkdirSync(UPLOADS, { recursive: true });
    const db = createStore(DATA_DIR);

    // Render terminates TLS one hop in front: req.secure / req.ip come from X-Forwarded-*
    app.set('trust proxy', 1);

    // ---------- state ----------
    const DEFAULT_SETTINGS = {
        language: 'id',
        theme: 'system',
        defaultCountry: process.env.DEFAULT_COUNTRY === '90' ? '90' : '62',
        antiBan: M.normalizeAntiBan({}),
        aiTone: 'friendly',
        defaults: { company: '', custom1: '' }
    };
    const sanitizeSettings = s => ({
        language: s.language === 'tr' ? 'tr' : 'id',
        theme: ['system', 'light', 'dark'].includes(s.theme) ? s.theme : 'system',
        defaultCountry: ['62', '90'].includes(String(s.defaultCountry)) ? String(s.defaultCountry) : DEFAULT_SETTINGS.defaultCountry,
        antiBan: M.normalizeAntiBan(isObj(s.antiBan) ? s.antiBan : {}),
        aiTone: TONES.includes(s.aiTone) ? s.aiTone : 'friendly',
        defaults: { company: str(s.defaults?.company), custom1: str(s.defaults?.custom1) }
    });
    const sanitizeDraft = d => {
        const bubbles = (Array.isArray(d.bubbles) ? d.bubbles : []).slice(0, 5).map(b => str(b, 4096));
        const attachments = (Array.isArray(d.attachments) ? d.attachments : []).slice(0, 20)
            .filter(a => isObj(a) && UPLOAD_ID.test(a.uploadId))
            .map(a => ({
                uploadId: a.uploadId,
                name: str(a.name),
                mime: str(a.mime, 100),
                size: Number(a.size) || 0,
                bubbleIndex: Number.isInteger(a.bubbleIndex) && a.bubbleIndex >= -1 ? a.bubbleIndex : 0
            }));
        const account = ['personal', 'business', 'dual'].includes(d.account) ? d.account : 'personal';
        return { bubbles: bubbles.length ? bubbles : [''], attachments, account };
    };

    let settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...db.read('settings.json', {}) });
    let contacts = db.read('contacts.json', []);
    let draft = sanitizeDraft(db.read('draft.json', {}));
    let campaign = db.read('campaign.json', null);
    let rt = null; // runtime of the active campaign: { paused, stopped, wake, onResume }
    if (campaign && ACTIVE.includes(campaign.state)) {
        // A restart shows the last state but does not resume sending
        campaign.state = 'stopped';
        Object.assign(campaign, { phase: null, current: null, nextAt: null });
        campaign.items.forEach(i => { if (i.status === 'typing') i.status = 'pending'; });
        db.write('campaign.json', campaign);
    }

    const saveContacts = () => db.write('contacts.json', contacts);
    const sortedContacts = () => [...contacts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    // ---------- auth ----------
    const sign = payload => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
    const sameSecret = (a, b) => crypto.timingSafeEqual(
        crypto.createHash('sha256').update(String(a)).digest(),
        crypto.createHash('sha256').update(String(b)).digest()
    );
    const readCookie = req => {
        for (const part of (req.headers.cookie || '').split(';')) {
            const [k, ...v] = part.trim().split('=');
            if (k === COOKIE) return v.join('=');
        }
        return '';
    };
    const loggedIn = req => {
        const [exp, sig] = readCookie(req).split('.');
        return !!exp && !!sig && sameSecret(sig, sign(exp)) && Number(exp) > Date.now();
    };
    const fails = new Map(); // ip -> failed login timestamps within the last minute

    // ---------- router ----------
    const api = express.Router();
    const json = express.json({ limit: '256kb' });
    api.use((req, res, next) => (req.path === '/uploads' || req.path === '/contacts/import' ? next() : json(req, res, next)));

    api.post('/login', (req, res) => {
        const now = Date.now();
        const ip = req.ip || '';
        const recent = (fails.get(ip) || []).filter(t => now - t < 60000);
        if (recent.length >= MAX_FAILS) return fail(res, 429, 'TOO_MANY_TRIES');
        if (!sameSecret(str(req.body?.password, 1000), PASSWORD)) {
            if (fails.size > 10000) fails.clear();
            fails.set(ip, [...recent, now]);
            return fail(res, 401, 'BAD_PASSWORD');
        }
        fails.delete(ip);
        const exp = String(now + SESSION_MS);
        res.cookie(COOKIE, `${exp}.${sign(exp)}`, {
            httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: SESSION_MS, path: '/'
        });
        res.json({ ok: true });
    });

    api.post('/logout', (req, res) => {
        res.clearCookie(COOKIE, { httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/' });
        res.json({ ok: true });
    });

    api.use((req, res, next) => (loggedIn(req) ? next() : fail(res, 401, 'LOGIN_REQUIRED')));

    api.get('/me', (req, res) => res.json({ ok: true, version }));

    // ---------- update check ----------
    // Render tells the server which commit it runs; GitHub says how far that is behind main.
    // Cached for an hour (GitHub allows 60 unauthenticated calls per hour per IP).
    const UPDATE_REPO = process.env.UPDATE_REPO || 'jaegu504/kirimrasa-web';
    let updateCache = { at: 0, data: null };
    api.get('/update', wrap(async (req, res) => {
        const commit = process.env.RENDER_GIT_COMMIT;
        const service = process.env.RENDER_SERVICE_ID;
        const dashboardUrl = service ? `https://dashboard.render.com/web/${service}` : 'https://dashboard.render.com';
        if (!commit) return res.json({ available: false, behind: 0, dashboardUrl });
        if (!updateCache.data || Date.now() - updateCache.at > 60 * 60 * 1000) {
            try {
                const r = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/compare/${commit}...main`, {
                    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kirimrasa-web' },
                    signal: AbortSignal.timeout(8000)
                });
                if (!r.ok) throw new Error('GitHub ' + r.status);
                const j = await r.json();
                updateCache = { at: Date.now(), data: { behind: j.ahead_by || 0 } };
            } catch (err) {
                gw.logger.warn({ err: err.message }, 'Update check failed');
                if (!updateCache.data) return res.json({ available: false, behind: 0, dashboardUrl });
            }
        }
        const behind = updateCache.data.behind;
        res.json({ available: behind > 0, behind, dashboardUrl });
    }));

    // ---------- accounts ----------
    const linked = id => gw.nodeStatus(id).registered;
    const credsPhone = id => {
        try {
            const creds = JSON.parse(fs.readFileSync(path.join(gw.SESSIONS_DIR, `node_${id}`, 'creds.json'), 'utf8'));
            return (creds?.me?.id || '').split(/[:@]/)[0] || null;
        } catch (_) {
            return null;
        }
    };
    const checkAccount = (req, res, next) => (ACCOUNTS.includes(req.params.id) ? next() : fail(res, 404, 'UNKNOWN_ACCOUNT'));

    api.get('/accounts', (req, res) => {
        res.json(ACCOUNTS.map(id => {
            const s = gw.nodeStatus(id);
            const status = !s.registered && s.status === 'CONNECTING' ? 'PAIRING' : s.status;
            return { id, status, phone: s.phoneNumber || (s.registered ? credsPhone(id) : null) || null };
        }));
    });

    api.post('/accounts/:id/pair', checkAccount, wrap(async (req, res) => {
        const phone = C.normalizePhone(req.body?.phone, settings.defaultCountry);
        if (!phone) return fail(res, 400, 'INVALID_PHONE');
        if (linked(req.params.id)) return fail(res, 409, 'ALREADY_CONNECTED');
        let result;
        try {
            result = await gw.requestPairing(req.params.id, phone);
        } catch (err) {
            gw.logger.error({ err: err.message }, 'Web pairing failed');
            return fail(res, 500, 'PAIR_FAILED');
        }
        if (result.alreadyConnected) return fail(res, 409, 'ALREADY_CONNECTED');
        res.json({ code: result.code });
    }));

    api.post('/accounts/:id/check', checkAccount, wrap(async (req, res) => {
        // No saved login: nothing to wake, and opening a socket here would end a pairing in progress
        if (!linked(req.params.id)) return res.json({ ready: false });
        const node = await gw.ensureConnected(req.params.id).catch(() => null);
        res.json({ ready: !!node });
    }));

    api.post('/accounts/:id/disconnect', checkAccount, wrap(async (req, res) => {
        await gw.disconnectNode(req.params.id);
        res.json({ ok: true });
    }));

    // ---------- contacts ----------
    const findContact = (req, res, next) => {
        req.contact = contacts.find(c => c.id === req.params.id);
        return req.contact ? next() : fail(res, 404, 'NOT_FOUND');
    };

    api.get('/contacts', (req, res) => res.json(sortedContacts()));

    api.get('/contacts/export', (req, res) => {
        res.type('text/csv; charset=utf-8');
        res.set('Content-Disposition', 'attachment; filename="kirimrasa-contacts.csv"');
        res.send('﻿' + C.exportCsv(sortedContacts())); // BOM so Excel reads UTF-8
    });

    api.post('/contacts/import', express.text({ type: () => true, limit: '2mb' }), (req, res) => {
        if (typeof req.body !== 'string' || !req.body.trim()) return fail(res, 400, 'EMPTY_FILE');
        const result = C.importCsv(contacts, req.body, settings.defaultCountry);
        saveContacts();
        res.json(result);
    });

    api.post('/contacts', (req, res) => {
        const phone = C.normalizePhone(req.body?.phone, settings.defaultCountry);
        if (!phone) return fail(res, 400, 'INVALID_PHONE');
        const name = str(req.body?.name).trim();
        const nickname = str(req.body?.nickname).trim();
        const existing = contacts.find(c => c.phone === phone);
        if (existing) { // merged by phone, never overwriting what the user set
            if (!existing.nickname && nickname) existing.nickname = nickname;
            if ((!existing.name || existing.name === existing.phone) && name) existing.name = name;
            saveContacts();
            return res.json(existing);
        }
        const contact = C.makeContact({ name, phone, nickname });
        contacts.push(contact);
        saveContacts();
        res.json(contact);
    });

    api.post('/contacts/select', (req, res) => {
        const { ids, tag } = req.body || {};
        const targets = Array.isArray(ids) ? contacts.filter(c => ids.includes(c.id))
            : typeof tag === 'string' ? contacts.filter(c => c.tags.includes(tag))
                : contacts;
        targets.forEach(c => { c.selected = req.body?.selected === true; });
        saveContacts();
        res.json({ count: targets.length });
    });

    api.patch('/contacts/:id', findContact, (req, res) => {
        const b = req.body || {};
        const c = req.contact;
        for (const k of ['nickname', 'company', 'custom1']) if (typeof b[k] === 'string') c[k] = str(b[k]).trim();
        if (Array.isArray(b.tags)) c.tags = [...new Set(b.tags.map(t => str(t, 50).trim()).filter(Boolean))].slice(0, 50);
        if (typeof b.selected === 'boolean') c.selected = b.selected;
        saveContacts();
        res.json(c);
    });

    api.delete('/contacts/:id', findContact, (req, res) => {
        contacts = contacts.filter(c => c !== req.contact);
        saveContacts();
        res.json({ ok: true });
    });

    api.delete('/contacts', (req, res) => {
        contacts = [];
        saveContacts();
        res.json({ ok: true });
    });

    // ---------- uploads ----------
    const uploadPath = id => path.join(UPLOADS, id); // callers check UPLOAD_ID first, so no traversal
    const readMeta = id => {
        try { return JSON.parse(fs.readFileSync(uploadPath(id) + '.json', 'utf8')); } catch (_) { return null; }
    };
    const checkUpload = (req, res, next) => {
        req.meta = UPLOAD_ID.test(req.params.id) ? readMeta(req.params.id) : null;
        return req.meta ? next() : fail(res, 404, 'NOT_FOUND');
    };

    api.post('/uploads', express.raw({ type: () => true, limit: '16mb' }), (req, res) => {
        if (!Buffer.isBuffer(req.body) || req.body.length === 0) return fail(res, 400, 'EMPTY_FILE');
        const id = crypto.randomBytes(16).toString('hex');
        const name = path.basename(str(req.query.name, 300)).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'file';
        const type = (req.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const meta = { id, name, mime: /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream', size: req.body.length };
        writeAtomic(uploadPath(id), req.body);
        writeAtomic(uploadPath(id) + '.json', JSON.stringify(meta));
        res.json(meta);
    });

    api.get('/uploads/:id', checkUpload, (req, res) => {
        const { mime, name } = req.meta;
        const inline = /^(image|video|audio)\//.test(mime) || mime === 'application/pdf';
        res.set({
            'Content-Type': mime,
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': 'sandbox', // an uploaded HTML/SVG file can't run script on our origin
            'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`
        });
        res.sendFile(uploadPath(req.params.id));
    });

    api.delete('/uploads/:id', checkUpload, (req, res) => {
        fs.rmSync(uploadPath(req.params.id), { force: true });
        fs.rmSync(uploadPath(req.params.id) + '.json', { force: true });
        res.json({ ok: true });
    });

    // ---------- AI ----------
    api.post('/ai/rewrite', wrap(async (req, res) => {
        const message = str(req.body?.message, 4000);
        if (!message.trim()) return fail(res, 400, 'EMPTY_MESSAGE');
        const tone = TONES.includes(req.body?.tone) ? req.body.tone : settings.aiTone;
        const maxBubbles = Math.min(5, Math.max(1, parseInt(req.body?.maxBubbles, 10) || 3));
        let data;
        try {
            const r = await fetch(AI_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message, prompt: message, tone, maxBubbles, language: settings.language === 'tr' ? 'TR' : 'ID' }),
                signal: AbortSignal.timeout(45000)
            });
            if (!r.ok) return fail(res, 503, 'AI_BUSY');
            data = await r.json().catch(() => null);
        } catch (_) {
            return fail(res, 503, 'AI_BUSY');
        }
        const bubbles = M.validateAiBubbles(message, data?.bubbles, maxBubbles);
        return bubbles ? res.json({ bubbles }) : fail(res, 502, 'AI_INVALID');
    }));

    // ---------- settings & draft ----------
    api.get('/settings', (req, res) => res.json(settings));
    api.put('/settings', (req, res) => {
        const b = isObj(req.body) ? req.body : {};
        settings = sanitizeSettings({
            ...settings,
            ...b,
            antiBan: { ...settings.antiBan, ...(isObj(b.antiBan) ? b.antiBan : {}) },
            defaults: { ...settings.defaults, ...(isObj(b.defaults) ? b.defaults : {}) }
        });
        db.write('settings.json', settings);
        res.json(settings);
    });

    api.get('/draft', (req, res) => res.json(draft));
    api.put('/draft', (req, res) => {
        draft = sanitizeDraft(isObj(req.body) ? req.body : {});
        db.write('draft.json', draft);
        res.json(draft);
    });

    // ---------- campaign ----------
    const view = () => {
        if (!campaign) {
            return { id: null, title: null, state: 'idle', total: 0, sent: 0, failed: 0, current: null, phase: null, nextAt: null, items: [] };
        }
        const { spec, ...pub } = campaign;
        return pub;
    };
    const persist = () => {
        campaign.total = campaign.items.length;
        campaign.sent = campaign.items.filter(i => i.status === 'sent').length;
        campaign.failed = campaign.items.filter(i => i.status === 'failed').length;
        db.write('campaign.json', campaign);
    };
    const title = () => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat(settings.language === 'tr' ? 'tr-TR' : 'id-ID', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
            timeZone: process.env.TZ || (settings.defaultCountry === '90' ? 'Europe/Istanbul' : 'Asia/Jakarta')
        }).formatToParts(new Date()).map(p => [p.type, p.value]));
        return `Broadcast ${parts.day} ${parts.month.replace('.', '')} ${parts.hour}:${parts.minute}`;
    };

    api.get('/campaign', (req, res) => res.json(view()));

    api.post('/campaign', (req, res) => {
        if (campaign && ACTIVE.includes(campaign.state)) return fail(res, 409, 'CAMPAIGN_RUNNING');
        const spec = sanitizeDraft(isObj(req.body) ? req.body : {});
        if (spec.bubbles.every(b => !b.trim()) && spec.attachments.length === 0) return fail(res, 400, 'EMPTY_MESSAGE');
        if (spec.attachments.some(a => !readMeta(a.uploadId))) return fail(res, 400, 'UPLOAD_MISSING');
        const ids = req.body?.contactIds;
        const all = sortedContacts();
        const selected = all.filter(c => c.selected);
        const targets = Array.isArray(ids) ? all.filter(c => ids.includes(c.id)) : (selected.length ? selected : all);
        if (targets.length === 0) return fail(res, 400, 'NO_CONTACTS');
        const usable = spec.account === 'dual' ? ACCOUNTS.some(linked) : linked(spec.account);
        if (!usable) return fail(res, 400, 'NOT_CONNECTED');

        draft = spec; // kept as "last sent" so the composer reopens with it
        db.write('draft.json', draft);
        campaign = {
            id: 'c_' + crypto.randomBytes(6).toString('hex'),
            title: title(),
            state: 'running', total: 0, sent: 0, failed: 0, current: null, phase: null, nextAt: null,
            items: targets.map((c, idx) => ({
                id: `i_${idx}`,
                contactId: c.id,
                name: c.name.replace(/\(.*?\)/g, '').trim() || c.phone,
                phone: c.phone,
                status: 'pending', error: null, sentAt: null,
                account: spec.account === 'dual' ? ACCOUNTS[idx % 2] : spec.account
            })),
            spec
        };
        persist();
        startRun();
        res.json({ id: campaign.id });
    });

    api.post('/campaign/pause', (req, res) => {
        if (!campaign) return fail(res, 404, 'NO_CAMPAIGN');
        if (rt && ['running', 'cooling'].includes(campaign.state)) {
            rt.paused = true;
            campaign.state = 'paused';
            campaign.nextAt = null;
            if (rt.wake) rt.wake();
            persist();
        }
        res.json(view());
    });

    api.post('/campaign/resume', (req, res) => {
        if (!campaign) return fail(res, 404, 'NO_CAMPAIGN');
        if (rt && campaign.state === 'paused') resume();
        res.json(view());
    });

    api.post('/campaign/stop', (req, res) => {
        if (!campaign) return fail(res, 404, 'NO_CAMPAIGN');
        if (rt && ACTIVE.includes(campaign.state)) {
            rt.stopped = true;
            Object.assign(campaign, { state: 'stopped', phase: null, current: null, nextAt: null });
            if (rt.wake) rt.wake();
            if (rt.onResume) rt.onResume();
            persist();
        }
        res.json(view());
    });

    api.post('/campaign/retry-failed', (req, res) => {
        if (!campaign) return fail(res, 404, 'NO_CAMPAIGN');
        campaign.items.forEach(i => { if (i.status === 'failed') Object.assign(i, { status: 'pending', error: null }); });
        if (rt && ACTIVE.includes(campaign.state)) {
            if (rt.paused) resume();
        } else {
            campaign.state = 'running';
            startRun();
        }
        persist();
        res.json(view());
    });

    function resume() {
        rt.paused = false;
        campaign.state = campaign.phase === 'cooldown' ? 'cooling' : 'running';
        if (rt.onResume) rt.onResume();
        persist();
    }

    function startRun() {
        const c = campaign;
        const r = { paused: false, stopped: false, wake: null, onResume: null };
        rt = r;
        runCampaign(c, r).catch(err => {
            gw.logger.error({ err: err.message }, 'Web campaign crashed');
            if (rt === r) Object.assign(c, { state: 'stopped', phase: null, current: null, nextAt: null });
            persist();
        });
    }

    // ---------- sending loop (mirrors DispatchQueueManager) ----------
    async function runCampaign(c, r) {
        const waitResume = () => new Promise(resolve => { r.onResume = resolve; });
        // Sleeps ms; pause freezes the countdown, stop ends it at once. false = stopped.
        const hold = async ms => {
            let left = ms;
            for (;;) {
                if (r.stopped) return false;
                if (r.paused) { await waitResume(); continue; }
                const start = Date.now();
                c.nextAt = start + left;
                persist();
                let timer;
                const done = await new Promise(resolve => {
                    r.wake = () => resolve(false);
                    timer = setTimeout(() => resolve(true), left);
                });
                clearTimeout(timer);
                r.wake = null;
                if (done) { c.nextAt = null; return true; }
                left = Math.max(0, left - (Date.now() - start));
            }
        };
        const setPhase = phase => {
            c.phase = phase;
            if (!r.paused && !r.stopped) c.state = phase === 'cooldown' ? 'cooling' : 'running';
            persist();
        };
        const typing = async (account, phone, ms, presence) => {
            const node = presence ? await gw.ensureConnected(account).catch(() => null) : null;
            const jid = `${phone}@s.whatsapp.net`;
            try { if (node?.sock) await node.sock.sendPresenceUpdate('composing', jid); } catch (_) {}
            const ok = await hold(ms);
            try {
                if (node?.sock) {
                    await node.sock.sendPresenceUpdate('paused', jid);
                    await gw.markUnavailable(node.sock);
                }
            } catch (_) {}
            return ok;
        };
        const sendStep = async (account, phone, step) => {
            let media = null;
            if (step.attachment) {
                const meta = readMeta(step.attachment.uploadId);
                if (!meta) throw Object.assign(new Error('UPLOAD_MISSING'), { code: 'UPLOAD_MISSING' });
                media = { buffer: fs.readFileSync(uploadPath(meta.id)), mimeType: meta.mime, fileName: meta.name };
            }
            // Audio carries no caption on WhatsApp: send the bubble text first so it isn't lost
            if (media && step.text.trim() && (/^audio\//.test(media.mimeType) || /\.(mp3|ogg|wav|m4a|aac)$/i.test(media.fileName))) {
                await gw.sendMessage(account, phone, step.text, null);
                return gw.sendMessage(account, phone, '', media);
            }
            return gw.sendMessage(account, phone, step.text, media);
        };

        while (!r.stopped) {
            if (r.paused) { await waitResume(); continue; }
            const item = c.items.find(i => i.status === 'pending');
            if (!item) {
                Object.assign(c, { state: 'done', phase: null, current: null, nextAt: null });
                persist();
                return;
            }
            const ab = M.normalizeAntiBan(settings.antiBan); // live, like the app reads AntiBanSettings each round
            const processed = c.items.filter(i => i.status === 'sent' || i.status === 'failed').length;
            if (processed > 0) {
                const cooling = processed % ab.batchSize === 0;
                setPhase(cooling ? 'cooldown' : 'waiting');
                if (!(await hold(cooling ? ab.pauseMin * 60000 : M.nextContactDelaySec(ab) * 1000))) break;
            }

            c.current = item.name;
            item.status = 'typing';
            setPhase('typing');
            const finish = (status, error) => {
                Object.assign(item, { status, error: error || null, sentAt: status === 'sent' ? Date.now() : null });
                c.current = null;
                persist();
            };
            if (!/^\d{8,15}$/.test(item.phone)) { finish('failed', 'INVALID_PHONE'); continue; }

            // Dual: use the other account when the chosen one is not linked but the other is
            const other = ACCOUNTS.find(a => a !== item.account);
            if (c.spec.account === 'dual' && !linked(item.account) && linked(other)) item.account = other;

            const contact = contacts.find(x => x.id === item.contactId) || { name: item.name };
            const vars = {
                nickname: contact.nickname || C.guessNickname(contact.name),
                company: contact.company || settings.defaults.company,
                custom1: contact.custom1 || settings.defaults.custom1
            };
            const bubbles = c.spec.bubbles.map(b => M.renderText(b, vars, settings.language));
            const steps = M.buildSendSteps(bubbles, c.spec.attachments);
            if (steps.length === 0) { finish('failed', 'EMPTY_MESSAGE'); continue; }

            let error = null;
            let sentAny = false;
            for (let k = 0; k < steps.length; k++) {
                // 3–6 s before every bubble after the first; before the first too when typing is simulated
                if (k > 0 || ab.typingSim) {
                    setPhase('typing');
                    if (!(await typing(item.account, item.phone, M.nextBubbleDelayMs(), ab.typingSim))) break;
                }
                if (r.paused) { await waitResume(); }
                if (r.stopped) break;
                setPhase('sending');
                try {
                    await sendStep(item.account, item.phone, steps[k]);
                    sentAny = true;
                } catch (err) {
                    error = err.code || err.message || 'SEND_FAILED';
                }
            }
            if (r.stopped) {
                // Stopped mid-contact: untouched contacts go back to pending, half-sent ones are marked
                if (sentAny) finish('failed', 'STOPPED');
                else { item.status = 'pending'; persist(); }
                break;
            }
            finish(error ? 'failed' : 'sent', error);
        }
    }

    // ---------- errors ----------
    api.use((req, res) => fail(res, 404, 'NOT_FOUND'));
    // eslint-disable-next-line no-unused-vars
    api.use((err, req, res, next) => {
        if (err.type === 'entity.too.large') return fail(res, 413, req.path === '/uploads' ? 'FILE_TOO_LARGE' : 'BODY_TOO_LARGE');
        if (err.type === 'entity.parse.failed') return fail(res, 400, 'BAD_JSON');
        gw.logger.error({ err: err.message, path: req.path }, 'Web API error');
        return fail(res, 500, 'SERVER_ERROR');
    });

    app.use(express.static(path.join(__dirname, 'web')));
    app.use('/app/api', api);
}

module.exports = { mount };
