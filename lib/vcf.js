'use strict';

/** True when the text is a vCard file (.vcf) rather than CSV. */
function isVcf(text) {
    return /^﻿?\s*BEGIN:VCARD/i.test(text);
}

/** Joins folded lines; quoted-printable soft breaks ("=" at line end) continue on the next line. */
function unfold(text) {
    const out = [];
    for (const raw of text.replace(/^﻿/, '').split(/\r\n|\n|\r/)) {
        const last = out[out.length - 1];
        if (last != null && last.endsWith('=') && /QUOTED-PRINTABLE/i.test(last.split(':')[0])) {
            out[out.length - 1] = last.slice(0, -1) + raw.trimStart();
        } else if (last != null && /^[ \t]/.test(raw)) {
            out[out.length - 1] = last + raw.slice(1);
        } else if (raw.trim()) {
            out.push(raw.trim());
        }
    }
    return out;
}

function decodeQp(value) {
    const bytes = [];
    for (let i = 0; i < value.length; i++) {
        const hex = value[i] === '=' ? value.slice(i + 1, i + 3) : '';
        if (/^[0-9a-f]{2}$/i.test(hex)) {
            bytes.push(parseInt(hex, 16));
            i += 2;
        } else {
            bytes.push(...Buffer.from(value[i], 'utf-8'));
        }
    }
    return Buffer.from(bytes).toString('utf-8');
}

const unescape = (v) => v.replace(/\\[nN]/g, ' ').replace(/\\([,;\\])/g, '$1').trim();

/** Maps vCard text to the same records as csv rowsToRecords: { name, phones: [{value,label}], nickname, company, custom1, tags }. */
function vcfToRecords(text) {
    const records = [];
    let card = null;
    for (const line of unfold(text)) {
        if (/^BEGIN:VCARD$/i.test(line)) { card = { fn: '', n: '', phones: [], nickname: '', company: '', tags: [] }; continue; }
        if (/^END:VCARD$/i.test(line)) {
            if (card) records.push({ name: card.fn || card.n, phones: card.phones, nickname: card.nickname, company: card.company, custom1: '', tags: card.tags });
            card = null;
            continue;
        }
        const colon = line.indexOf(':');
        if (!card || colon <= 0) continue;
        // "item1.TEL;TYPE=CELL" -> name TEL, params TYPE=CELL
        const [rawName, ...params] = line.slice(0, colon).split(';');
        const name = rawName.split('.').pop().toUpperCase();
        const paramText = params.join(';');
        let value = line.slice(colon + 1);
        if (/QUOTED-PRINTABLE/i.test(paramText)) value = decodeQp(value);
        if (name === 'FN') card.fn = unescape(value);
        else if (name === 'N') {
            const n = value.split(';');
            card.n = [n[1], n[2], n[0]].map(x => unescape(x || '')).filter(Boolean).join(' ');
        } else if (name === 'NICKNAME') card.nickname = unescape(value.split(',')[0]);
        else if (name === 'ORG') card.company = unescape(value.split(';')[0]);
        else if (name === 'CATEGORIES') card.tags = value.split(',').map(unescape).filter(Boolean);
        else if (name === 'TEL') card.phones.push({ value: value.replace(/^tel:/i, ''), label: paramText });
    }
    return records;
}

module.exports = { isVcf, vcfToRecords };
