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

test('importCsv reads vCard files (3.0 and 2.1 quoted-printable)', () => {
    const vcf = [
        'BEGIN:VCARD', 'VERSION:3.0', 'FN:Budi Santoso', 'NICKNAME:Bud', 'ORG:Acme;Sales',
        'CATEGORIES:keluarga,vip', 'item1.TEL;TYPE=HOME:021-555 1234', 'TEL;TYPE=CELL:+62 812-3456-7890', 'END:VCARD',
        'BEGIN:VCARD', 'VERSION:2.1', 'FN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:=C3=87a=C4=9Flar Y=C4=B1lmaz=',
        '=20Bey', 'TEL;CELL:0532 111 22 33', 'END:VCARD',
        'BEGIN:VCARD', 'N:Rahman;Siti;;;', 'TEL:+90 555', ' 123 4567', 'END:VCARD',
        'BEGIN:VCARD', 'FN:No Number', 'END:VCARD'
    ].join('\r\n');
    const contacts = [];
    assert.deepEqual(importCsv(contacts, vcf, '90'), { added: 3, updated: 0, skipped: 1 });
    assert.equal(contacts[0].name, 'Budi Santoso');
    assert.equal(contacts[0].phone, '6281234567890');
    assert.equal(contacts[0].nickname, 'Bud');
    assert.equal(contacts[0].company, 'Acme');
    assert.deepEqual(contacts[0].tags, ['keluarga', 'vip']);
    assert.equal(contacts[1].name, 'Çağlar Yılmaz Bey');
    assert.equal(contacts[1].phone, '905321112233');
    assert.equal(contacts[2].name, 'Siti Rahman');
    assert.equal(contacts[2].phone, '905551234567');
});
