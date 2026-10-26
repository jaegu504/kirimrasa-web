'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Write to a temp file in the same folder, then rename: a crash never leaves a half-written file. */
function writeAtomic(file, data) {
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
}

function createStore(dir) {
    fs.mkdirSync(dir, { recursive: true });
    return {
        read(name, fallback) {
            try {
                return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
            } catch (_) {
                return fallback;
            }
        },
        write(name, value) {
            writeAtomic(path.join(dir, name), JSON.stringify(value));
        }
    };
}

module.exports = { createStore, writeAtomic };
