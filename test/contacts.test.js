'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, guessNickname, importCsv, exportCsv } = require('../lib/contacts');

test('normalizePhone', () => {
    assert.equal(normalizePhone('0812-3456-789'), '628123456789');
    assert.equal(normalizePhone('0532 123 45 67', '90'), '905321234567');
    assert.equal(normalizePhone('+62 812 3456 789'), '628123456789');
    assert.equal(normalizePhone('0090 532 123 4567'), '905321234567');
    assert.equal(normalizePhone('628123456789'), '628123456789');
    assert.equal(normalizePhone('12345'), null);
    assert.equal(normalizePhone(''), null);
    assert.equal(normalizePhone('abc'), null);
});

test('guessNickname skips titles and numbers', () => {
    assert.equal(guessNickname('Budi Santoso'), 'Budi');
    assert.equal(guessNickname('Pak Budi'), 'Budi');
    assert.equal(guessNickname('dr. Ani Lestari'), 'Ani');
    assert.equal(guessNickname('Bu Hj. Siti'), 'Siti');
    assert.equal(guessNickname('mbak Rina (kantor)'), 'Rina');
    assert.equal(guessNickname('123 Toko Maju'), 'Toko');
    assert.equal(guessNickname('+62 812'), '');
});

const GOOGLE = [
    'First Name,Middle Name,Last Name,Nickname,Organization Name,Labels,Phone 1 - Label,Phone 1 - Value,Phone 2 - Label,Phone 2 - Value',
    'Budi,,Santoso,,PT Maju,* myContacts,Home,021-555-1234 ::: +62 812-1111-2222,,',
    'Pak Andi,,,,,* myContacts,Work,022 7654321,Mobile,0813 3333 4444',
    'Nobody,,,,,,,,,',
    '"Siti, Hj.",,,Sitty,,,Mobile,+62 857 0000 1111,,'
].join('\r\n');

test('Google Contacts CSV import', () => {
    const contacts = [];
    const r = importCsv(contacts, '﻿' + GOOGLE, '62');
    assert.deepEqual(r, { added: 3, updated: 0, skipped: 1 });
    const budi = contacts.find(c => c.name === 'Budi Santoso');
    assert.equal(budi.phone, '6281211112222'); // the mobile-looking one of the ::: pair
    assert.equal(budi.nickname, 'Budi');
    assert.equal(budi.company, 'PT Maju');
    assert.equal(contacts.find(c => c.name === 'Pak Andi').phone, '6281333334444');
    assert.equal(contacts.find(c => c.phone === '6285700001111').nickname, 'Sitty');
});

test('re-import merges by phone and never overwrites nickname or tags', () => {
    const contacts = [];
    importCsv(contacts, 'name,phone,nickname,tags\nBudi,08121111222,,vip', '62');
    contacts[0].nickname = 'Mas Bud';
    const r = importCsv(contacts, 'name,phone,nickname,company,tags\nBudi S,+628121111222,Budiman,ACME,vip;client', '62');
    assert.deepEqual(r, { added: 0, updated: 1, skipped: 0 });
    assert.equal(contacts.length, 1);
    assert.equal(contacts[0].nickname, 'Mas Bud');
    assert.equal(contacts[0].company, 'ACME');
    assert.deepEqual(contacts[0].tags, ['vip', 'client']);
    assert.deepEqual(importCsv(contacts, exportCsv(contacts), '62'), { added: 0, updated: 0, skipped: 1 });
});

test('own export format round-trips', () => {
    const a = [];
    importCsv(a, 'name,phone,nickname,company,custom1,tags\n"Ani, A.",0813999888,Ani,"X, Inc",note,a;b', '62');
    const b = [];
    assert.equal(importCsv(b, exportCsv(a), '62').added, 1);
    const { id: _a, ...ra } = a[0];
    const { id: _b, ...rb } = b[0];
    assert.deepEqual(rb, ra);
});
