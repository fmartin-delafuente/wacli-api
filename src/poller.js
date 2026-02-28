const { getDb } = require('./db');
const wacli = require('./wacli');
const path = require('path');
const fs = require('fs');

const MEDIA_DIR = process.env.MEDIA_DIR || '/root/wacli-api/media';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || '30000', 10);

let pollTimer = null;

/**
 * Start the polling loop
 */
function startPoller() {
    console.log(`[Poller] Starting with interval ${POLL_INTERVAL}ms`);

    // Ensure media directory exists
    if (!fs.existsSync(MEDIA_DIR)) {
        fs.mkdirSync(MEDIA_DIR, { recursive: true });
    }

    // Run first poll after a short delay (let server start first)
    pollTimer = setTimeout(async () => {
        await poll();
        schedulePoll();
    }, 3000);
}

function schedulePoll() {
    pollTimer = setTimeout(async () => {
        await poll();
        schedulePoll();
    }, POLL_INTERVAL);
}

function stopPoller() {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
    console.log('[Poller] Stopped');
}

/**
 * Main poll function: fetch new messages from wacli and store them
 */
async function poll() {
    const db = getDb();

    try {
        // Get last sync timestamp
        const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('last_sync');
        const lastSync = row ? row.value : '2000-01-01T00:00:00Z';

        console.log(`[Poller] Fetching messages after ${lastSync}`);

        // Fetch new messages from wacli
        const result = await wacli.listMessages({ after: lastSync, limit: 500 });

        const messages = result?.data?.messages || result?.data || [];

        if (!Array.isArray(messages) || messages.length === 0) {
            console.log('[Poller] No new messages');
            return;
        }

        console.log(`[Poller] Found ${messages.length} new messages`);

        // Insert messages into our DB
        const insertMsg = db.prepare(`
      INSERT OR IGNORE INTO messages (chat_jid, chat_name, msg_id, sender_jid, from_me, timestamp, text, display_text, media_type, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

        const insertMany = db.transaction((msgs) => {
            let inserted = 0;
            let latestTs = lastSync;

            for (const msg of msgs) {
                const changes = insertMsg.run(
                    msg.ChatJID || '',
                    msg.ChatName || '',
                    msg.MsgID || '',
                    msg.SenderJID || '',
                    msg.FromMe ? 1 : 0,
                    msg.Timestamp || '',
                    msg.Text || '',
                    msg.DisplayText || '',
                    msg.MediaType || '',
                    JSON.stringify(msg)
                );

                if (changes.changes > 0) {
                    inserted++;

                    // Track latest timestamp
                    if (msg.Timestamp && msg.Timestamp > latestTs) {
                        latestTs = msg.Timestamp;
                    }

                    // Queue media download if this message has media
                    if (msg.MediaType && msg.ChatJID && msg.MsgID) {
                        downloadMediaForMessage(db, msg, changes.lastInsertRowid);
                    }
                }
            }

            // Update last sync timestamp
            if (latestTs > lastSync) {
                db.prepare('UPDATE sync_state SET value = ? WHERE key = ?').run(latestTs, 'last_sync');
            }

            return inserted;
        });

        const inserted = insertMany(messages);
        console.log(`[Poller] Inserted ${inserted} new messages`);
    } catch (err) {
        console.error('[Poller] Error:', err.message);
    }
}

/**
 * Download media for a message (async, fire-and-forget)
 */
async function downloadMediaForMessage(db, msg, messageId) {
    try {
        const chatDir = path.join(MEDIA_DIR, msg.ChatJID.replace(/[^a-zA-Z0-9@._-]/g, '_'));
        if (!fs.existsSync(chatDir)) {
            fs.mkdirSync(chatDir, { recursive: true });
        }

        const result = await wacli.downloadMedia(msg.ChatJID, msg.MsgID, chatDir);

        // Try to find the downloaded file
        const files = fs.readdirSync(chatDir).filter(f => f.includes(msg.MsgID));

        if (files.length > 0) {
            const filePath = path.join(chatDir, files[0]);
            const stats = fs.statSync(filePath);

            db.prepare(`
        INSERT INTO attachments (message_id, filename, mime_type, file_path, size)
        VALUES (?, ?, ?, ?, ?)
      `).run(messageId, files[0], msg.MediaType || '', filePath, stats.size);

            // Update message with media path
            db.prepare('UPDATE messages SET media_path = ? WHERE id = ?').run(filePath, messageId);

            console.log(`[Poller] Downloaded media: ${files[0]}`);
        }
    } catch (err) {
        console.error(`[Poller] Media download failed for ${msg.MsgID}:`, err.message);
    }
}

module.exports = { startPoller, stopPoller, poll };
