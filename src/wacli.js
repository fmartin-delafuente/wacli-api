const { execFile } = require('child_process');
const path = require('path');

const WACLI_BIN = process.env.WACLI_BIN || 'wacli';
const WACLI_STORE = process.env.WACLI_STORE || '/root/.wacli';

// Mutex for serializing wacli operations that require lock
let lockQueue = Promise.resolve();

/**
 * Execute a wacli command with --json output
 */
function execWacli(args, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        const fullArgs = ['--json', '--store', WACLI_STORE, ...args];

        execFile(WACLI_BIN, fullArgs, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err && !stdout) {
                return reject(new Error(`wacli error: ${err.message} | stderr: ${stderr}`));
            }

            try {
                const parsed = JSON.parse(stdout);
                if (parsed.error) {
                    return reject(new Error(`wacli: ${parsed.error}`));
                }
                resolve(parsed);
            } catch (parseErr) {
                // Some commands might return non-JSON on success
                resolve({ success: true, raw: stdout.trim() });
            }
        });
    });
}

/**
 * Execute pm2 commands to stop/start wacli-sync
 */
function pm2(action) {
    return new Promise((resolve, reject) => {
        execFile('pm2', [action, 'wacli-sync'], { timeout: 10000 }, (err, stdout, stderr) => {
            if (err) {
                console.error(`pm2 ${action} error:`, stderr);
                // Don't reject — best effort
            }
            resolve();
        });
    });
}

/**
 * Run a function that requires exclusive wacli access.
 * Stops pm2 sync → runs fn → restarts pm2 sync.
 * Serialized via a promise queue (mutex).
 */
function withWacliLock(fn) {
    lockQueue = lockQueue.then(async () => {
        try {
            await pm2('stop');
            // Small delay to let wacli release the lock file
            await new Promise(r => setTimeout(r, 500));
            const result = await fn();
            return result;
        } finally {
            await pm2('start');
        }
    }).catch(err => {
        // Ensure pm2 restarts even on errors
        pm2('start');
        throw err;
    });

    return lockQueue;
}

/**
 * List chats
 */
async function listChats(limit = 100) {
    return withWacliLock(() => execWacli(['chats', 'list', '--limit', String(limit)]));
}

/**
 * List messages with optional filters
 */
async function listMessages({ chat, after, before, limit = 50 } = {}) {
    const args = ['messages', 'list', '--limit', String(limit)];
    if (chat) args.push('--chat', chat);
    if (after) args.push('--after', after);
    if (before) args.push('--before', before);

    return withWacliLock(() => execWacli(args));
}

/**
 * Search messages
 */
async function searchMessages(query, limit = 50) {
    return withWacliLock(() => execWacli(['messages', 'search', query, '--limit', String(limit)]));
}

/**
 * Show a single message
 */
async function showMessage(chatJid, msgId) {
    return withWacliLock(() => execWacli(['messages', 'show', '--chat', chatJid, '--id', msgId]));
}

/**
 * Download media for a message
 */
async function downloadMedia(chatJid, msgId, outputDir) {
    const args = ['media', 'download', '--chat', chatJid, '--id', msgId];
    if (outputDir) args.push('--output', outputDir);

    return withWacliLock(() => execWacli(args, 60000));
}

/**
 * Send a text message
 */
async function sendText(to, message) {
    return withWacliLock(() => execWacli(['send', 'text', '--to', to, '--message', message]));
}

/**
 * Send a file
 */
async function sendFile(to, filePath, { caption, filename, mime } = {}) {
    const args = ['send', 'file', '--to', to, '--file', filePath];
    if (caption) args.push('--caption', caption);
    if (filename) args.push('--filename', filename);
    if (mime) args.push('--mime', mime);

    return withWacliLock(() => execWacli(args, 120000));
}

module.exports = {
    execWacli,
    withWacliLock,
    listChats,
    listMessages,
    searchMessages,
    showMessage,
    downloadMedia,
    sendText,
    sendFile,
};
