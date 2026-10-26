'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, toCsv } = require('../lib/csv');

test('quotes, commas, doubled quotes and newlines inside quotes', () => {
    const rows = parseCsv('﻿name,note\r\n"Budi, S.","say ""hi""\nline2"\r\n\r\nAni,x\n');
    assert.deepEqual(rows, [['name', 'note'], ['Budi, S.', 'say "hi"\nline2'], ['Ani', 'x']]);
});

test('semicolon separator when the header uses it', () => {
    assert.deepEqual(parseCsv('name;phone\nBudi;0812'), [['name', 'phone'], ['Budi', '0812']]);
});

test('toCsv round-trips through parseCsv', () => {
    const rows = [['a', 'b,c'], ['"q"', 'x\ny']];
    assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
