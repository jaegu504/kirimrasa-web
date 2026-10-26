'use strict';

const crypto = require('crypto');
const { parseCsv, toCsv } = require('./csv');

/** Digits with country code, or null. Leading 0 → country code, leading + / 00 stripped. */
function normalizePhone(raw, defaultCountry = '62') {
    const s = String(raw || '').trim();
    let d = s.replace(/\D/g, '');
    if (!d) return null;
    if (!s.startsWith('+')) {
        if (d.startsWith('00')) d = d.slice(2);
        else if (d.startsWith('0')) d = String(defaultCountry) + d.slice(1);
    }
    return d.length >= 8 && d.length <= 15 ? d : null;
}

const TITLES = new Set(['dr', 'drs', 'dra', 'ir', 'prof', 'h', 'hj', 'pak', 'bu', 'bapak', 'ibu', 'mas', 'mbak', 'kak', 'bang', 'bay', 'bayan', 'sn']);

/** First real word of a name, skipping numbers and titles like "Pak" or "dr."; "" if none. */
function guessNickname(name) {
    const words = String(name || '').replace(/\(.*?\)/g, ' ').split(/\s+/);
    for (const w of words) {
        const word = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
        if ((word.match(/\p{L}/gu) || []).length < 2) continue;
        if (TITLES.has(word.toLowerCase())) continue;
        return word;
    }
    return '';
}

const ALIASES = {
    name: ['name', 'nama', 'full name', 'display name', 'isim', 'ad soyad'],
    first: ['first name', 'given name'],
    middle: ['middle name', 'additional name'],
    last: ['last name', 'family name'],
    phone: ['phone', 'phone number', 'mobile', 'mobile phone', 'telepon', 'no hp', 'nomor', 'whatsapp', 'telefon'],
    nickname: ['nickname', 'panggilan'],
    company: ['company', 'organization name', 'organization 1 - name', 'perusahaan', 'şirket'],
    custom1: ['custom1', 'custom_1'],
    tags: ['tags']
};

const MOBILE_LABEL = /mobile|cell|ponsel|hp|cep/i;

/** Maps one parsed CSV (header row first) to [{ name, phones: [{value,label}], nickname, company, custom1, tags }]. */
function rowsToRecords(rows) {
    if (rows.length < 2) return [];
    const header = rows[0].map(h => h.trim().toLowerCase());
    const col = {};
    for (const [key, names] of Object.entries(ALIASES)) {
        col[key] = header.findIndex(h => names.includes(h));
    }
    // Google: "Phone 1 - Value" with "Phone 1 - Label" (new) or "Phone 1 - Type" (old)
    const googlePhones = [];
    header.forEach((h, i) => {
        const m = h.match(/^phone (\d+) - value$/);
        if (m) googlePhones.push({ value: i, label: header.findIndex(x => x === `phone ${m[1]} - label` || x === `phone ${m[1]} - type`) });
    });
    const get = (row, i) => (i >= 0 && row[i] != null ? row[i].trim() : '');

    return rows.slice(1).map(row => {
        const phones = [];
        if (col.phone >= 0) phones.push({ value: get(row, col.phone), label: '' });
        for (const g of googlePhones) {
            for (const v of get(row, g.value).split(':::')) phones.push({ value: v.trim(), label: get(row, g.label) });
        }
        const name = get(row, col.name) ||
            [get(row, col.first), get(row, col.middle), get(row, col.last)].filter(Boolean).join(' ');
        return {
            name,
            phones,
            nickname: get(row, col.nickname),
            company: get(row, col.company),
            custom1: get(row, col.custom1),
            tags: get(row, col.tags).split(';').map(t => t.trim()).filter(Boolean)
        };
    });
}

/** First mobile-looking valid number (by label, or 628…/905… prefix), else the first valid one. */
function pickPhone(phones, defaultCountry) {
    const valid = phones
        .map(p => ({ ...p, phone: normalizePhone(p.value, defaultCountry) }))
        .filter(p => p.phone);
    const mobile = valid.find(p => MOBILE_LABEL.test(p.label) || /^(628|905)/.test(p.phone));
    return (mobile || valid[0] || {}).phone || null;
}

function newContactId() {
    return 'k_' + crypto.randomBytes(8).toString('hex');
}

function makeContact({ name, phone, nickname, company, custom1, tags }) {
    return {
        id: newContactId(),
        name: name || phone,
        phone,
        nickname: nickname || guessNickname(name),
        company: company || '',
        custom1: custom1 || '',
        tags: tags || [],
        selected: false
    };
}

/**
 * Merges CSV text into `contacts` (mutated) by phone. Never overwrites a nickname, company,
 * custom1 or tags the user already has; only fills blanks and adds tags.
 * skipped = rows without a valid phone plus rows that changed nothing.
 */
function importCsv(contacts, text, defaultCountry = '62') {
    const byPhone = new Map(contacts.map(c => [c.phone, c]));
    let added = 0, updated = 0, skipped = 0;
    for (const r of rowsToRecords(parseCsv(text))) {
        const phone = pickPhone(r.phones, defaultCountry);
        if (!phone) { skipped++; continue; }
        const existing = byPhone.get(phone);
        if (!existing) {
            const c = makeContact({ ...r, phone });
            contacts.push(c);
            byPhone.set(phone, c);
            added++;
            continue;
        }
        const before = JSON.stringify(existing);
        if (r.name && (!existing.name || existing.name === existing.phone)) existing.name = r.name;
        for (const k of ['nickname', 'company', 'custom1']) {
            if (r[k] && !existing[k]) existing[k] = r[k];
        }
        for (const t of r.tags) if (!existing.tags.includes(t)) existing.tags.push(t);
        if (JSON.stringify(existing) !== before) updated++; else skipped++;
    }
    return { added, updated, skipped };
}

function exportCsv(contacts) {
    return toCsv([
        ['name', 'phone', 'nickname', 'company', 'custom1', 'tags'],
        ...contacts.map(c => [c.name, c.phone, c.nickname, c.company, c.custom1, (c.tags || []).join(';')])
    ]);
}

module.exports = { normalizePhone, guessNickname, importCsv, exportCsv, makeContact, pickPhone };
