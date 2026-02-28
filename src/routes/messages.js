const express = require('express');
const path = require('path');
const { getDb } = require('../db');
const wacli = require('../wacli');

const router = express.Router();

/**
 * GET /api/messages
 * List messages with optional filters
 * Query params: chat, after, before, limit, offset
 */
router.get('/', (req, res) => {
    try {
        const db = getDb();
        const { chat, after, before, limit = 50, offset = 0 } = req.query;

        let sql = 'SELECT * FROM messages WHERE 1=1';
        const params = [];

        if (chat) {
            sql += ' AND chat_jid = ?';
            params.push(chat);
        }
        if (after) {
            sql += ' AND timestamp > ?';
            params.push(after);
        }
        if (before) {
            sql += ' AND timestamp < ?';
            params.push(before);
        }

        sql += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const messages = db.prepare(sql).all(...params);

        // Get total count for pagination
        let countSql = 'SELECT COUNT(*) as total FROM messages WHERE 1=1';
        const countParams = [];
        if (chat) { countSql += ' AND chat_jid = ?'; countParams.push(chat); }
        if (after) { countSql += ' AND timestamp > ?'; countParams.push(after); }
        if (before) { countSql += ' AND timestamp < ?'; countParams.push(before); }

        const { total } = db.prepare(countSql).get(...countParams);

        res.json({
            success: true,
            data: messages,
            pagination: { total, limit: parseInt(limit), offset: parseInt(offset) }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/messages/search?q=term
 * Search messages by text
 */
router.get('/search', (req, res) => {
    try {
        const db = getDb();
        const { q, limit = 50, offset = 0 } = req.query;

        if (!q) {
            return res.status(400).json({ success: false, error: 'Query parameter "q" is required' });
        }

        const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE text LIKE ? OR display_text LIKE ?
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(`%${q}%`, `%${q}%`, parseInt(limit), parseInt(offset));

        const { total } = db.prepare(`
      SELECT COUNT(*) as total FROM messages 
      WHERE text LIKE ? OR display_text LIKE ?
    `).get(`%${q}%`, `%${q}%`);

        res.json({
            success: true,
            data: messages,
            pagination: { total, limit: parseInt(limit), offset: parseInt(offset) }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/messages/:id
 * Get a single message with its attachments
 */
router.get('/:id', (req, res) => {
    try {
        const db = getDb();
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);

        if (!message) {
            return res.status(404).json({ success: false, error: 'Message not found' });
        }

        const attachments = db.prepare('SELECT * FROM attachments WHERE message_id = ?').all(message.id);

        res.json({
            success: true,
            data: { ...message, attachments }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/messages/:id/media
 * Download the media attachment for a message
 */
router.get('/:id/media', (req, res) => {
    try {
        const db = getDb();
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);

        if (!message) {
            return res.status(404).json({ success: false, error: 'Message not found' });
        }

        if (!message.media_path) {
            return res.status(404).json({ success: false, error: 'No media for this message' });
        }

        const fs = require('fs');
        if (!fs.existsSync(message.media_path)) {
            return res.status(404).json({ success: false, error: 'Media file not found on disk' });
        }

        res.sendFile(path.resolve(message.media_path));
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/messages/:id/download-media
 * Trigger media download for a specific message (on-demand)
 */
router.post('/:id/download-media', async (req, res) => {
    try {
        const db = getDb();
        const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(req.params.id);

        if (!message) {
            return res.status(404).json({ success: false, error: 'Message not found' });
        }

        if (!message.media_type) {
            return res.status(400).json({ success: false, error: 'Message has no media' });
        }

        const MEDIA_DIR = process.env.MEDIA_DIR || '/root/wacli-api/media';
        const chatDir = path.join(MEDIA_DIR, message.chat_jid.replace(/[^a-zA-Z0-9@._-]/g, '_'));

        const result = await wacli.downloadMedia(message.chat_jid, message.msg_id, chatDir);

        // Find downloaded file
        const fs = require('fs');
        if (!fs.existsSync(chatDir)) {
            return res.status(500).json({ success: false, error: 'Download directory not created' });
        }

        const files = fs.readdirSync(chatDir).filter(f => f.includes(message.msg_id));

        if (files.length > 0) {
            const filePath = path.join(chatDir, files[0]);
            const stats = fs.statSync(filePath);

            db.prepare('UPDATE messages SET media_path = ? WHERE id = ?').run(filePath, message.id);
            db.prepare(`
        INSERT OR REPLACE INTO attachments (message_id, filename, mime_type, file_path, size)
        VALUES (?, ?, ?, ?, ?)
      `).run(message.id, files[0], message.media_type, filePath, stats.size);

            res.json({ success: true, data: { filename: files[0], path: filePath, size: stats.size } });
        } else {
            res.json({ success: true, data: { message: 'Download attempted but no file found', result } });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
