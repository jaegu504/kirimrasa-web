'use strict';

// Mirrors domain/spintax/SpintaxParser.kt and engine/queue/{DispatchQueueManager,AntiBanSettings}.kt

const SPINTAX = /\{([^{}]+?\|[^{}]+?)\}/g;
const VARIABLES = ['Nickname', 'Company', 'Custom_1'];
const NICK_FALLBACK = { id: 'Kak', tr: 'efendim' };

const randInt = (n, rnd) => Math.floor(rnd() * n); // 0..n-1

/** Picks one option of every {a|b|c}; variable tokens like {Nickname} have no pipe and stay. */
function spin(template, rnd = Math.random) {
    let out = String(template || '');
    while (out.search(SPINTAX) !== -1) {
        out = out.replace(SPINTAX, (_, body) => {
            const opts = body.split('|').map(s => s.trim());
            return opts[randInt(opts.length, rnd)];
        });
    }
    return out;
}

/** vars: { nickname, company, custom1 } already resolved with defaults; language picks the nickname fallback. */
function interpolate(text, { nickname, company, custom1 }, language = 'id') {
    const nick = String(nickname || '').trim() || NICK_FALLBACK[language] || NICK_FALLBACK.id;
    return text
        .split('{Nickname}').join(nick)
        .split('{Company}').join(company || '')
        .split('{Custom_1}').join(custom1 || '');
}

function renderText(template, vars, language, rnd = Math.random) {
    return interpolate(spin(template, rnd), vars, language);
}

/**
 * One step per bubble; attachments on bubble i go with it (bubble text as caption of the first,
 * the rest without caption). Placement -1 or past the last bubble = alone after the last bubble.
 * Empty bubbles without attachments are skipped. Returns [{ text, attachment|null }].
 */
function buildSendSteps(bubbles, attachments = []) {
    const placement = a => {
        const p = Number.isInteger(a.bubbleIndex) ? a.bubbleIndex : 0;
        return p >= 0 && p < bubbles.length ? p : -1;
    };
    const steps = [];
    bubbles.forEach((text, b) => {
        const media = attachments.filter(a => placement(a) === b);
        if (media.length === 0) {
            if (String(text).trim()) steps.push({ text, attachment: null });
        } else {
            media.forEach((a, k) => steps.push({ text: k === 0 ? text : '', attachment: a }));
        }
    });
    attachments.filter(a => placement(a) === -1).forEach(a => steps.push({ text: '', attachment: a }));
    return steps;
}

const PRESETS = { CONSERVATIVE: [35, 75], OPTIMAL: [25, 65], TURBO: [15, 30] };
const clamp = (v, lo, hi, def) => {
    const n = Number.isFinite(Number(v)) ? Math.round(Number(v)) : def;
    return Math.min(hi, Math.max(lo, n));
};

/** Same limits as AntiBanSettings.normalize. */
function normalizeAntiBan(a = {}) {
    const min = clamp(a.customMinSec, 10, 295, 30);
    return {
        preset: ['CONSERVATIVE', 'OPTIMAL', 'TURBO', 'CUSTOM'].includes(a.preset) ? a.preset : 'OPTIMAL',
        customMinSec: min,
        customMaxSec: clamp(a.customMaxSec, min + 5, 300, 70),
        typingSim: a.typingSim !== false,
        pauseMin: clamp(a.pauseMin, 1, 60, 5),
        batchSize: clamp(a.batchSize, 5, 100, 25)
    };
}

function delayRange(antiBan) {
    const a = normalizeAntiBan(antiBan);
    return a.preset === 'CUSTOM' ? [a.customMinSec, a.customMaxSec] : PRESETS[a.preset];
}

/** Seconds before the next contact: average of two uniform draws in the range (biased to the middle). */
function nextContactDelaySec(antiBan, rnd = Math.random) {
    const [lo, hi] = delayRange(antiBan);
    const span = hi - lo;
    return lo + Math.floor((randInt(span + 1, rnd) + randInt(span + 1, rnd)) / 2);
}

/** Typing pause between bubbles to one contact: 3–6 s. */
function nextBubbleDelayMs(rnd = Math.random) {
    return 3000 + randInt(3001, rnd);
}

/** Braces must be flat and balanced: no "{a{b}}", no stray "{" or "}". */
function bracesBalanced(text) {
    let depth = 0;
    for (const c of text) {
        if (c === '{') { if (++depth > 1) return false; }
        else if (c === '}') { if (--depth < 0) return false; }
    }
    return depth === 0;
}

/**
 * AI output must keep every variable of the draft, add no other {Token}, and keep braces flat.
 * Returns the cleaned bubbles or null when invalid.
 */
function validateAiBubbles(draft, bubbles, maxBubbles) {
    if (!Array.isArray(bubbles)) return null;
    const out = bubbles.filter(b => typeof b === 'string').map(b => b.trim()).filter(Boolean).slice(0, maxBubbles);
    if (out.length === 0) return null;
    const joined = out.join('\n');
    if (!bracesBalanced(joined)) return null;
    const used = VARIABLES.filter(v => draft.includes(`{${v}}`));
    if (!used.every(v => joined.includes(`{${v}}`))) return null;
    for (const [, body] of joined.matchAll(/\{([^{}]*)\}/g)) {
        if (body.includes('|')) continue; // spintax
        if (!used.includes(body)) return null;
    }
    return out;
}

module.exports = {
    spin, interpolate, renderText, buildSendSteps,
    normalizeAntiBan, delayRange, nextContactDelaySec, nextBubbleDelayMs,
    validateAiBubbles, VARIABLES
};
