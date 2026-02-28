require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, closeDb } = require('./db');
const { startPoller, stopPoller } = require('./poller');

const messagesRoutes = require('./routes/messages');
const sendRoutes = require('./routes/send');
const chatsRoutes = require('./routes/chats');

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors());
app.use(express.json());

// API Key authentication (optional)
const API_KEY = process.env.API_KEY;
if (API_KEY) {
    app.use('/api', (req, res, next) => {
        const key = req.headers['x-api-key'] || req.query.api_key;
        if (key !== API_KEY) {
            return res.status(401).json({ success: false, error: 'Invalid or missing API key' });
        }
        next();
    });
    console.log('[Auth] API key authentication enabled');
} else {
    console.log('[Auth] No API key set — API is open');
}

// Routes
app.use('/api/messages', messagesRoutes);
app.use('/api/send', sendRoutes);
app.use('/api/chats', chatsRoutes);

// Health check
app.get('/health', (req, res) => {
    const db = getDb();
    const msgCount = db.prepare('SELECT COUNT(*) as count FROM messages').get();
    const syncState = db.prepare('SELECT value FROM sync_state WHERE key = ?').get('last_sync');

    res.json({
        status: 'ok',
        messages: msgCount.count,
        lastSync: syncState?.value || 'never',
        uptime: process.uptime()
    });
});

// API documentation
app.get('/', (req, res) => {
    res.json({
        name: 'wacli-api',
        version: '1.0.0',
        endpoints: {
            'GET /health': 'Health check',
            'GET /api/chats': 'List all chats',
            'GET /api/messages': 'List messages (?chat, ?after, ?before, ?limit, ?offset)',
            'GET /api/messages/search': 'Search messages (?q, ?limit, ?offset)',
            'GET /api/messages/:id': 'Get message with attachments',
            'GET /api/messages/:id/media': 'Download message media',
            'POST /api/messages/:id/download-media': 'Trigger media download',
            'POST /api/send/text': 'Send text ({ to, message })',
            'POST /api/send/file': 'Send file (multipart: to, file, caption?, filename?)'
        }
    });
});

// Initialize DB
getDb();

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`[wacli-api] Running on http://0.0.0.0:${PORT}`);
    startPoller();
});

// Graceful shutdown
function shutdown() {
    console.log('[wacli-api] Shutting down...');
    stopPoller();
    closeDb();
    server.close(() => {
        console.log('[wacli-api] Server closed');
        process.exit(0);
    });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = app;
