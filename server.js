const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
    delay,
    BufferJSON
} = require('baileys');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || '';
const SESSIONS_DIR = process.env.SESSIONS_DIR || path.join(__dirname, 'sessions');

// Without a key, anyone can read session credentials via /api/nodes/:id/session
if (!API_KEY && process.env.NODE_ENV === 'production') {
    console.error('API_KEY env var is required in production. Refusing to start.');
    process.exit(1);
}

if (!fs.existsSync(SESSIONS_DIR)) {
    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Logger
const logger = pino({ level: process.env.LOG_LEVEL || 'warn' });

app.use(cors());

// Web version (off unless APP_PASSWORD is set). Mounted before the 50 MB body parsers so its
// routes use their own smaller limits; it also serves web/index.html at "/".
if (process.env.APP_PASSWORD) {
    require('./webapp').mount(app, {
        ensureConnected, sendMessage, requestPairing, disconnectNode, nodeStatus, markUnavailable, SESSIONS_DIR, logger
    });
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health & Uptime Ping Endpoints
app.get('/', (req, res) => {
    res.json({
        service: 'Kirimrasa WhatsApp Gateway',
        status: 'UP',
        uptime: process.uptime(),
        activeNodes: nodeMap.size
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

// In-memory active nodes map
// nodeMap: nodeId -> { sock, state, saveCreds, status, phoneNumber, wsClients: Set }
const nodeMap = new Map();

// Message Store to resolve E2EE Signal protocol retry requests ("Waiting for this message")
const messageStore = new Map();

function saveMessageToStore(messageId, messageContent) {
    if (!messageId || !messageContent) return;
    if (messageStore.size > 2000) {
        const iter = messageStore.keys();
        for (let i = 0; i < 500; i++) {
            messageStore.delete(iter.next().value);
        }
    }
    messageStore.set(messageId, messageContent);
}

// Messages this gateway sent are also kept on disk per node. When one of the sender's own
// devices (the main phone) can't decrypt its copy, it asks the gateway to resend it; without
// the original the phone shows "Waiting for this message" forever. The RAM store alone is lost
// on restarts and the request often arrives after the idle close, so keep 7 days on disk.
const SENT_STORE_MAX = 500;
const SENT_STORE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const sentStores = new Map(); // nodeId -> { [messageId]: { m: message, t: sentAt } }

function sentStorePath(nodeId) {
    return path.join(SESSIONS_DIR, `node_${nodeId}`, 'sent-messages.json');
}

function sentStore(nodeId) {
    let store = sentStores.get(nodeId);
    if (!store) {
        try {
            store = JSON.parse(fs.readFileSync(sentStorePath(nodeId), 'utf-8'), BufferJSON.reviver);
        } catch (_) {
            store = {};
        }
        sentStores.set(nodeId, store);
    }
    return store;
}

function rememberSent(nodeId, messageId, message) {
    saveMessageToStore(messageId, message);
    if (!nodeId) return;
    const store = sentStore(nodeId);
    store[messageId] = { m: message, t: Date.now() };
    const cutoff = Date.now() - SENT_STORE_TTL_MS;
    let ids = Object.keys(store).filter((id) => {
        if (store[id].t >= cutoff) return true;
        delete store[id];
        return false;
    });
    if (ids.length > SENT_STORE_MAX) {
        ids.sort((a, b) => store[a].t - store[b].t)
            .slice(0, ids.length - SENT_STORE_MAX)
            .forEach((id) => delete store[id]);
    }
    try {
        const file = sentStorePath(nodeId);
        fs.writeFileSync(file + '.tmp', JSON.stringify(store, BufferJSON.replacer));
        fs.renameSync(file + '.tmp', file);
    } catch (err) {
        logger.warn({ nodeId, err: err.message }, 'Could not save sent-message store');
    }
}

function lookupSent(nodeId, messageId) {
    return messageStore.get(messageId) || sentStore(nodeId)[messageId]?.m || undefined;
}

// Helper: Normalize Indonesian & international phone numbers
function normalizePhone(phone) {
    let clean = phone.replace(/[^0-9]/g, '');
    if (clean.startsWith('0')) {
        clean = '62' + clean.slice(1);
    } else if (clean.startsWith('8')) {
        clean = '62' + clean;
    }
    return clean;
}

// Authentication middleware
function isAuthorized(headers) {
    if (!API_KEY) return true;
    const authHeader = headers['authorization'];
    return !!authHeader && authHeader.replace(/^Bearer\s+/i, '').trim() === API_KEY.trim();
}

function authMiddleware(req, res, next) {
    if (isAuthorized(req.headers)) return next();
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
}

// Helper: Broadcast status to connected WebSockets for this node
function broadcastStatus(nodeId, status) {
    const node = nodeMap.get(nodeId);
    if (!node || !node.wsClients) return;
    const payload = JSON.stringify({ nodeId, status, timestamp: Date.now() });
    for (const ws of node.wsClients) {
        if (ws.readyState === ws.OPEN) {
            ws.send(payload);
        }
    }
}

// Baileys silently drops available/unavailable presence when creds.me.name is empty, which is
// common right after a pairing-code login. The companion then stays "online" and the main phone
// mutes its notifications, so fill the name from what WhatsApp already gave us.
async function markUnavailable(sock) {
    const me = sock?.authState?.creds?.me;
    if (!me) return;
    if (!me.name) {
        me.name = me.notify || me.verifiedName || (me.id || '').split(/[:@]/)[0] || 'Kirimrasa';
    }
    await sock.sendPresenceUpdate('unavailable');
}

// A linked device with an open socket shows as "Active" and the main phone mutes its
// notifications, even with presence unavailable. So the socket only stays open while there is
// work: it closes after IDLE_MS without sends and reopens on the next send ("STANDBY").
const IDLE_MS = parseInt(process.env.IDLE_MS || '120000', 10);
const WAKE_TIMEOUT_MS = 25000;
// After a send, the main phone may ask for a resend while the socket is already idle-closed.
// One short reconnect later lets those requests reach the gateway and get answered.
const CATCHUP_MS = parseInt(process.env.CATCHUP_MS || '600000', 10);

// Noise keys of creds WhatsApp logged out (kept until restart)
const loggedOutCreds = new Set();

function credsKey(creds) {
    const pub = creds?.noiseKey?.public;
    return pub ? Buffer.from(pub).toString('base64') : null;
}

function hasRegisteredCreds(nodeId) {
    try {
        const creds = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, `node_${nodeId}`, 'creds.json'), 'utf-8'));
        return creds?.registered === true;
    } catch (_) {
        return false;
    }
}

function touchActivity(nodeId) {
    const node = nodeMap.get(nodeId);
    if (!node) return;
    clearTimeout(node.idleTimer);
    node.idleTimer = setTimeout(() => {
        if (node.sock && node.status === 'CONNECTED') {
            logger.info({ nodeId }, 'Idle: closing socket so the phone keeps its notifications');
            node.idleClosing = true;
            try { node.sock.end(undefined); } catch (_) {}
            if (node.pendingCatchup) {
                node.pendingCatchup = false;
                clearTimeout(node.catchupTimer);
                node.catchupTimer = setTimeout(() => {
                    logger.info({ nodeId }, 'Catch-up reconnect for resend requests');
                    ensureConnected(nodeId).catch(() => {});
                }, CATCHUP_MS);
            }
        }
    }, IDLE_MS);
}

/** Opens the socket from saved creds if needed and waits until WhatsApp accepts it. */
async function ensureConnected(nodeId) {
    let node = nodeMap.get(nodeId);
    if (node?.sock && node.status === 'CONNECTED') {
        touchActivity(nodeId);
        return node;
    }
    if (!(node?.sock) && !hasRegisteredCreds(nodeId)) return null;
    node = await getOrCreateSocket(nodeId);
    const start = Date.now();
    while (node.status !== 'CONNECTED' && Date.now() - start < WAKE_TIMEOUT_MS) {
        await delay(300);
        node = nodeMap.get(nodeId) || node;
    }
    if (node.status !== 'CONNECTED') return null;
    touchActivity(nodeId);
    return node;
}

// Initialize Baileys Socket for a node
async function getOrCreateSocket(nodeId, phoneNumber = null) {
    let node = nodeMap.get(nodeId);
    // Reuse a live or connecting socket; a second socket on the same creds makes WA kick both (440 loop)
    if (node && node.sock && node.status !== 'DISCONNECTED') {
        return node;
    }

    const sessionPath = path.join(SESSIONS_DIR, `node_${nodeId}`);
    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger,
        printQRInTerminal: false,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        generateHighQualityLinkPreview: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 25000,
        emitOwnEvents: false,
        retryRequestDelayMs: 250,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        getMessage: async (key) => {
            if (key?.id) {
                return lookupSent(nodeId, key.id);
            }
            return undefined;
        }
    });

    if (!node) {
        node = {
            id: nodeId,
            sock,
            state,
            saveCreds,
            status: state.creds?.registered ? 'CONNECTING' : 'DISCONNECTED',
            phoneNumber: phoneNumber || '',
            wsClients: new Set()
        };
        nodeMap.set(nodeId, node);
    } else {
        node.id = nodeId;
        node.sock = sock;
        node.state = state;
        node.saveCreds = saveCreds;
        node.status = state.creds?.registered ? 'CONNECTING' : 'DISCONNECTED';
        if (phoneNumber) node.phoneNumber = phoneNumber;
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
            if (msg.key?.id && msg.message) {
                saveMessageToStore(msg.key.id, msg.message);
            }
        }
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        // Ignore events from a socket that has already been replaced
        if (node.sock !== sock) return;
        if (connection === 'close' && node.idleClosing) {
            node.idleClosing = false;
            node.sock = null;
            node.status = 'STANDBY';
            broadcastStatus(nodeId, 'STANDBY');
            return;
        }
        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            node.status = 'DISCONNECTED';
            broadcastStatus(nodeId, 'DISCONNECTED');
            logger.warn({ nodeId, statusCode }, 'Connection closed');

            if (shouldReconnect) {
                logger.info({ nodeId }, 'Attempting reconnection in 5s...');
                setTimeout(() => {
                    if (nodeMap.get(nodeId) === node && node.sock === sock) {
                        getOrCreateSocket(nodeId, node.phoneNumber).catch(() => {});
                    }
                }, 5000);
            } else {
                logger.warn({ nodeId }, 'Logged out from device, deleting session credentials');
                const deadKey = credsKey(node.state?.creds);
                if (deadKey) loggedOutCreds.add(deadKey);
                try {
                    fs.rmSync(sessionPath, { recursive: true, force: true });
                } catch (_) {}
            }
        } else if (connection === 'open') {
            node.status = 'CONNECTED';
            broadcastStatus(nodeId, 'CONNECTED');
            touchActivity(nodeId);
            logger.info({ nodeId }, 'WhatsApp connection established successfully!');
            // Keep companion presence as unavailable so main phone retains vibrations & notifications
            try {
                await markUnavailable(sock);
            } catch (err) {
                logger.warn({ nodeId, err: err.message }, 'Failed to set presence to unavailable on connect');
            }
        } else if (connection === 'connecting') {
            node.status = 'CONNECTING';
            broadcastStatus(nodeId, 'CONNECTING');
        }
    });

    return node;
}

/** Returns { code } with a fresh 8-char pairing code, or { alreadyConnected: true }. Throws on failure. */
async function requestPairing(nodeId, cleanPhone) {
    const sessionPath = path.join(SESSIONS_DIR, `node_${nodeId}`);
    // Not logged in yet: drop the old socket and credentials so pairing starts clean
    const existing = nodeMap.get(nodeId);
    if (!existing?.sock && hasRegisteredCreds(nodeId)) {
        return { alreadyConnected: true };
    }
    if (!existing?.sock?.authState?.creds?.registered) {
        if (existing?.sock) {
            const oldSock = existing.sock;
            existing.sock = null;
            existing.status = 'DISCONNECTED';
            try { oldSock.end(undefined); } catch (_) {}
        }
        if (fs.existsSync(sessionPath)) {
            fs.rmSync(sessionPath, { recursive: true, force: true });
        }
    }

    const node = await getOrCreateSocket(nodeId, cleanPhone);
    node.phoneNumber = cleanPhone;

    // Give socket a brief moment to connect to WA WebSocket
    await delay(2000);

    if (node.sock.authState.creds.registered) return { alreadyConnected: true };
    const code = await node.sock.requestPairingCode(cleanPhone);
    logger.info({ nodeId, cleanPhone, code }, 'Pairing code generated');
    return { code };
}

// REST ROUTES

// 2. Request Pairing Code (8 digits)
app.post('/api/nodes/:nodeId/pair', authMiddleware, async (req, res) => {
    const { nodeId } = req.params;
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
        return res.status(400).json({ error: 'Parameter phoneNumber wajib diisi' });
    }

    const cleanPhone = normalizePhone(phoneNumber);

    try {
        const { code, alreadyConnected } = await requestPairing(nodeId, cleanPhone);
        if (!alreadyConnected) {
            return res.json({
                success: true,
                code: code,
                pairingCode: code,
                phoneNumber: cleanPhone,
                expiresInSeconds: 180
            });
        } else {
            return res.json({
                success: true,
                status: 'ALREADY_CONNECTED',
                message: 'Perangkat sudah terhubung'
            });
        }
    } catch (err) {
        logger.error({ err: err.message }, 'Gagal mendapatkan pairing code');
        return res.status(500).json({
            error: 'Gagal membuat pairing code: ' + (err.message || err)
        });
    }
});

// 3. Node Connection Status
function nodeStatus(nodeId) {
    let node = nodeMap.get(nodeId);

    // Status checks never open the socket (that would keep the device "Active"); a logged-in
    // account without a live socket is STANDBY and wakes on the next send
    const sleeping = !node?.sock && hasRegisteredCreds(nodeId);
    const status = sleeping ? 'STANDBY' : (node ? node.status : 'DISCONNECTED');
    return {
        nodeId,
        status,
        phoneNumber: node?.phoneNumber || '',
        registered: (sleeping || node?.sock?.user || node?.sock?.authState?.creds?.registered) ? true : false
    };
}

app.get('/api/nodes/:nodeId/status', authMiddleware, async (req, res) => {
    return res.json(nodeStatus(req.params.nodeId));
});

// Export Session for client-side persistence (survives Render ephemeral restarts)
app.get('/api/nodes/:nodeId/session', authMiddleware, async (req, res) => {
    const { nodeId } = req.params;
    const sessionPath = path.join(SESSIONS_DIR, `node_${nodeId}`);
    const credsPath = path.join(sessionPath, 'creds.json');
    if (!fs.existsSync(sessionPath) || !fs.existsSync(credsPath)) {
        return res.status(404).json({ error: 'No active session credentials found' });
    }
    try {
        const fileNames = fs.readdirSync(sessionPath);
        const files = {};
        for (const fname of fileNames) {
            if (fname.endsWith('.json')) {
                files[fname] = fs.readFileSync(path.join(sessionPath, fname), 'utf-8');
            }
        }
        const node = nodeMap.get(nodeId);
        return res.json({
            success: true,
            nodeId,
            phoneNumber: node?.phoneNumber || '',
            registered: node?.sock?.authState?.creds?.registered || true,
            files
        });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to export session: ' + err.message });
    }
});

// Import Session to restore credentials after server restart
app.post('/api/nodes/:nodeId/session', authMiddleware, async (req, res) => {
    const { nodeId } = req.params;
    const { files, phoneNumber } = req.body;
    if (!files || typeof files !== 'object' || Object.keys(files).length === 0) {
        return res.status(400).json({ error: 'files map is required and cannot be empty' });
    }
    // The app keeps a backup of the creds; once WhatsApp logged them out, restoring them only
    // kills a pairing in progress and gets logged out again
    try {
        const creds = JSON.parse(files['creds.json'] || 'null', BufferJSON.reviver);
        if (loggedOutCreds.has(credsKey(creds))) {
            return res.status(410).json({ error: 'LOGGED_OUT', message: 'Session was logged out on the phone; link again' });
        }
    } catch (_) {}
    const sessionPath = path.join(SESSIONS_DIR, `node_${nodeId}`);
    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }
    try {
        const existingNode = nodeMap.get(nodeId);
        if (existingNode && existingNode.sock) {
            try { existingNode.sock.end(undefined); } catch (_) {}
            nodeMap.delete(nodeId);
        }

        for (const [fname, content] of Object.entries(files)) {
            const safeName = path.basename(fname);
            if (safeName.endsWith('.json')) {
                fs.writeFileSync(path.join(sessionPath, safeName), content, 'utf-8');
            }
        }
        const node = await getOrCreateSocket(nodeId, phoneNumber);
        return res.json({
            success: true,
            status: node.status,
            phoneNumber: node.phoneNumber,
            registered: node.sock?.authState?.creds?.registered || false
        });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to restore session: ' + err.message });
    }
});

/** Sends text, or media ({ buffer, mimeType, fileName }) with the text as caption, to clean digits. */
async function sendOnNode(node, cleanPhone, message, media) {
    const jid = `${cleanPhone}@s.whatsapp.net`;
    let sentMessage;
    if (media) {
        const { buffer: mediaBuffer, mimeType, fileName } = media;
        const isImage = mimeType.startsWith('image/') || /\.(jpe?g|png|webp|gif)$/i.test(fileName);
        const isVideo = mimeType.startsWith('video/') || /\.(mp4|mov|avi|mkv|3gp)$/i.test(fileName);
        const isAudio = mimeType.startsWith('audio/') || /\.(mp3|ogg|wav|m4a|aac)$/i.test(fileName);

        if (isImage) {
            sentMessage = await node.sock.sendMessage(jid, {
                image: mediaBuffer,
                caption: message || undefined,
                mimetype: mimeType
            });
        } else if (isVideo) {
            sentMessage = await node.sock.sendMessage(jid, {
                video: mediaBuffer,
                caption: message || undefined,
                mimetype: mimeType
            });
        } else if (isAudio) {
            sentMessage = await node.sock.sendMessage(jid, {
                audio: mediaBuffer,
                mimetype: mimeType,
                ptt: false
            });
        } else {
            sentMessage = await node.sock.sendMessage(jid, {
                document: mediaBuffer,
                mimetype: mimeType,
                fileName: fileName,
                caption: message || undefined
            });
        }
    }

    // If no media was sent, send as text
    if (!sentMessage) {
        sentMessage = await node.sock.sendMessage(jid, { text: message || '' });
    }

    if (sentMessage?.key?.id && sentMessage?.message) {
        rememberSent(node.id, sentMessage.key.id, sentMessage.message);
        node.pendingCatchup = true;
    }

    // Return to background presence so phone notification vibrations aren't muted
    try {
        await markUnavailable(node.sock);
    } catch (_) {}
    return sentMessage;
}

/** Wakes the node if needed and sends; throws an Error with code NOT_CONNECTED when it can't. */
async function sendMessage(nodeId, cleanPhone, text, media) {
    const node = await ensureConnected(nodeId).catch(() => null);
    if (!node || !node.sock || node.status !== 'CONNECTED') {
        throw Object.assign(new Error('NOT_CONNECTED'), { code: 'NOT_CONNECTED' });
    }
    return sendOnNode(node, cleanPhone, text, media);
}

// 4. Send Message (Split Message Text or Media)
app.post('/api/nodes/:nodeId/send', authMiddleware, async (req, res) => {
    const { nodeId } = req.params;
    const { recipient, message, media } = req.body;

    if (!recipient) {
        return res.status(400).json({ error: 'recipient phone number is required' });
    }

    const node = await ensureConnected(nodeId).catch(() => null);
    if (!node || !node.sock || node.status !== 'CONNECTED') {
        return res.status(400).json({
            error: `Node ${nodeId} belum terhubung ke WhatsApp. Silakan hubungkan dulu.`,
            code: 'NOT_CONNECTED'
        });
    }

    const cleanPhone = normalizePhone(recipient);

    try {
        let media = null;

        // Check if media is present
        const mediaList = Array.isArray(media) ? media.filter(m => m && (typeof m === 'object' || !m.startsWith('dummy://'))) : [];

        if (mediaList.length > 0) {
            const firstMedia = mediaList[0];
            let mediaBuffer = null;
            let mimeType = 'application/octet-stream';
            let fileName = 'file_' + Date.now();

            if (typeof firstMedia === 'string') {
                if (firstMedia.startsWith('http://') || firstMedia.startsWith('https://')) {
                    const fetchRes = await fetch(firstMedia);
                    mediaBuffer = Buffer.from(await fetchRes.arrayBuffer());
                    mimeType = fetchRes.headers.get('content-type') || mimeType;
                    try {
                        const parsedUrl = new URL(firstMedia);
                        fileName = path.basename(parsedUrl.pathname) || fileName;
                    } catch (_) {}
                } else if (firstMedia.startsWith('data:')) {
                    const commaIdx = firstMedia.indexOf(',');
                    if (commaIdx !== -1) {
                        const metaPart = firstMedia.substring(5, commaIdx);
                        const base64Data = firstMedia.substring(commaIdx + 1);
                        mediaBuffer = Buffer.from(base64Data, 'base64');

                        const metaTokens = metaPart.split(';');
                        if (metaTokens[0] && !metaTokens[0].includes('=')) {
                            mimeType = metaTokens[0].trim();
                        }
                        for (const tok of metaTokens) {
                            if (tok.startsWith('name=')) {
                                try {
                                    fileName = decodeURIComponent(tok.substring(5));
                                } catch (_) {
                                    fileName = tok.substring(5);
                                }
                            }
                        }
                    }
                } else if (fs.existsSync(firstMedia)) {
                    mediaBuffer = fs.readFileSync(firstMedia);
                    fileName = path.basename(firstMedia);
                }
            } else if (typeof firstMedia === 'object' && firstMedia !== null) {
                const rawB64 = (firstMedia.data || firstMedia.base64 || '').replace(/^data:.*?;base64,/, '');
                if (rawB64) {
                    mediaBuffer = Buffer.from(rawB64, 'base64');
                }
                if (firstMedia.mimetype) mimeType = firstMedia.mimetype;
                if (firstMedia.fileName || firstMedia.name) fileName = firstMedia.fileName || firstMedia.name;
            }

            if (mediaBuffer && mediaBuffer.length > 0) {
                media = { buffer: mediaBuffer, mimeType, fileName };
            }
        }

        const sentMessage = await sendOnNode(node, cleanPhone, message, media);

        return res.json({
            success: true,
            messageId: sentMessage?.key?.id || `msg-${Date.now()}`,
            timestamp: Date.now()
        });
    } catch (err) {
        logger.error({ err: err.message, recipient }, 'Gagal mengirim pesan');
        return res.status(500).json({
            error: 'Gagal mengirim pesan: ' + (err.message || err)
        });
    }
});

// 5. Send Typing Presence
app.post('/api/nodes/:nodeId/presence', authMiddleware, async (req, res) => {
    const { nodeId } = req.params;
    const { recipient, durationMs } = req.body;

    const node = await ensureConnected(nodeId).catch(() => null);
    if (!node || !node.sock || node.status !== 'CONNECTED') {
        return res.json({ success: true, warning: 'Node not connected, presence skipped' });
    }

    try {
        const cleanPhone = normalizePhone(recipient || '');
        const jid = `${cleanPhone}@s.whatsapp.net`;
        await node.sock.sendPresenceUpdate('composing', jid);
        if (durationMs && durationMs > 0) {
            await delay(Math.min(durationMs, 8000));
            await node.sock.sendPresenceUpdate('paused', jid);
        }
        await markUnavailable(node.sock);
        return res.json({ success: true });
    } catch (_) {
        return res.json({ success: true });
    }
});

// 6. Disconnect / Logout
app.post('/api/nodes/:nodeId/disconnect', authMiddleware, async (req, res) => {
    const { nodeId } = req.params;
    await disconnectNode(nodeId);
    return res.json({ success: true, message: `Node ${nodeId} diputuskan dan sesi dihapus` });
});

/** Logs out, deletes the session and tells WebSocket listeners. */
async function disconnectNode(nodeId) {
    const node = await ensureConnected(nodeId).catch(() => null) || nodeMap.get(nodeId);
    if (node) clearTimeout(node.idleTimer);

    try {
        if (node?.sock) {
            await node.sock.logout().catch(() => {});
            node.sock.end(new Error('Manual disconnect'));
        }
    } catch (_) {}

    const sessionPath = path.join(SESSIONS_DIR, `node_${nodeId}`);
    try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
    } catch (_) {}

    nodeMap.delete(nodeId);
    broadcastStatus(nodeId, 'DISCONNECTED');
}

// WebSocket Server for real-time status updates
server.on('upgrade', (request, socket, head) => {
    const pathname = request.url ? new URL(request.url, `http://${request.headers.host}`).pathname : '';
    const match = pathname.match(/^\/ws\/nodes\/([a-zA-Z0-9_\-]+)$/);

    if (match && !isAuthorized(request.headers)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
    } else if (match) {
        const nodeId = match[1];
        wss.handleUpgrade(request, socket, head, (ws) => {
            let node = nodeMap.get(nodeId);
            if (!node) {
                node = { wsClients: new Set(), status: hasRegisteredCreds(nodeId) ? 'STANDBY' : 'DISCONNECTED' };
                nodeMap.set(nodeId, node);
            }
            node.wsClients.add(ws);

            // Send current status immediately on connect
            ws.send(JSON.stringify({ nodeId, status: node.status, timestamp: Date.now() }));

            ws.on('close', () => {
                node.wsClients.delete(ws);
            });
        });
    } else {
        socket.destroy();
    }
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
    console.log(`=================================================`);
    console.log(`🚀 WA Bulk Gateway running on port ${PORT}`);
    console.log(`📡 Health Check: http://localhost:${PORT}/`);
    console.log(`⚡ API Authentication: ${API_KEY ? 'Active' : 'Disabled (Open)'}`);
    console.log(`=================================================`);
});
