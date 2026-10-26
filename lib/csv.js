'use strict';

/**
 * Parses CSV text into rows of strings. Handles a UTF-8 BOM, quoted fields with commas,
 * doubled quotes and newlines inside quotes, CRLF/LF, and ';' as separator when the header
 * line uses it (Excel in Indonesian/Turkish locales). Blank lines are dropped.
 */
function parseCsv(text) {
    const s = String(text || '').replace(/^﻿/, '');
    const firstLine = s.slice(0, s.search(/\r?\n|$/));
    const sep = count(firstLine, ';') > count(firstLine, ',') ? ';' : ',';
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (quoted) {
            if (c === '"') {
                if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += c;
        } else if (c === '"') {
            quoted = true;
        } else if (c === sep) {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && s[i + 1] === '\n') i++;
            row.push(field); field = '';
            if (row.some(f => f !== '')) rows.push(row);
            row = [];
        } else field += c;
    }
    row.push(field);
    if (row.some(f => f !== '')) rows.push(row);
    return rows;
}

function count(str, ch) {
    return str.split(ch).length - 1;
}

function csvField(v) {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows) {
    return rows.map(r => r.map(csvField).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parseCsv, toCsv };
