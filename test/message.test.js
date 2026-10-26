'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/message');

const seq = values => { let i = 0; return () => values[i++ % values.length]; };

test('spin picks one option per block and keeps variables', () => {
    assert.equal(M.spin('{Halo|Hai} {Nickname}, {apa kabar|gimana}?', seq([0, 0.99])), 'Halo {Nickname}, gimana?');
    assert.equal(M.spin('{a|{b|c}}', seq([0, 0.99])), 'b'); // inner block first, like SpintaxParser
});

test('variables with fallbacks per language', () => {
    assert.equal(M.renderText('Hai {Nickname} dari {Company}{Custom_1}', { nickname: 'Budi', company: 'PT X', custom1: '' }, 'id'), 'Hai Budi dari PT X');
    assert.equal(M.interpolate('Hai {Nickname}', { nickname: '' }, 'id'), 'Hai Kak');
    assert.equal(M.interpolate('Merhaba {Nickname}', { nickname: ' ' }, 'tr'), 'Merhaba efendim');
});

test('buildSendSteps: captions, extra files, separate files, empty bubbles', () => {
    const a = (id, bubbleIndex) => ({ uploadId: id, bubbleIndex });
    assert.deepEqual(M.buildSendSteps(['one', '', 'three'], [a('x', 0), a('y', 0), a('z', -1), a('w', 7), a('v', 1)]), [
        { text: 'one', attachment: a('x', 0) },
        { text: '', attachment: a('y', 0) },
        { text: '', attachment: a('v', 1) },
        { text: 'three', attachment: null },
        { text: '', attachment: a('z', -1) },
        { text: '', attachment: a('w', 7) }
    ]);
    assert.deepEqual(M.buildSendSteps(['hi'], []), [{ text: 'hi', attachment: null }]);
    assert.deepEqual(M.buildSendSteps(['  '], []), []);
});

test('delay ranges per preset and custom clamp', () => {
    assert.deepEqual(M.delayRange({ preset: 'CONSERVATIVE' }), [35, 75]);
    assert.deepEqual(M.delayRange({ preset: 'OPTIMAL' }), [25, 65]);
    assert.deepEqual(M.delayRange({ preset: 'TURBO' }), [15, 30]);
    assert.deepEqual(M.delayRange({ preset: 'CUSTOM', customMinSec: 3, customMaxSec: 4 }), [10, 15]);
    assert.deepEqual(M.delayRange({ preset: 'CUSTOM', customMinSec: 400, customMaxSec: 900 }), [295, 300]);
    assert.deepEqual(M.normalizeAntiBan({ pauseMin: 0, batchSize: 1000 }).batchSize, 100);
});

test('contact delay is the average of two draws, inside the range', () => {
    const ab = { preset: 'OPTIMAL' };
    assert.equal(M.nextContactDelaySec(ab, () => 0), 25);
    assert.equal(M.nextContactDelaySec(ab, () => 0.9999), 65);
    assert.equal(M.nextContactDelaySec(ab, seq([0, 0.9999])), 45);
    for (let i = 0; i < 1000; i++) {
        const d = M.nextContactDelaySec(ab);
        assert.ok(d >= 25 && d <= 65);
        const b = M.nextBubbleDelayMs();
        assert.ok(b >= 3000 && b <= 6000);
    }
});

test('AI output validation', () => {
    const draft = 'Hai {Nickname}, salam dari {Company}';
    assert.deepEqual(M.validateAiBubbles(draft, ['{Halo|Hai} {Nickname}', 'Dari {Company}'], 5), ['{Halo|Hai} {Nickname}', 'Dari {Company}']);
    assert.equal(M.validateAiBubbles(draft, ['Hai {Nickname}'], 5), null); // lost {Company}
    assert.equal(M.validateAiBubbles(draft, ['Hai {Nickname} {Company} {Custom_1}'], 5), null); // invented
    assert.equal(M.validateAiBubbles(draft, ['Hai {Nama} {Nickname} {Company}'], 5), null);
    assert.equal(M.validateAiBubbles(draft, ['{Hai {Nickname}|Halo} {Company}'], 5), null); // nested
    assert.equal(M.validateAiBubbles(draft, ['Hai {Nickname {Company}'], 5), null);
    assert.equal(M.validateAiBubbles(draft, [], 5), null);
    assert.equal(M.validateAiBubbles('x', ['a', 'b', 'c'], 2).length, 2);
});
