const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const wacli = require('../wacli');

const router = express.Router();

// Configure multer for file uploads
const uploadDir = '/tmp/wacli-api-uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
    dest: uploadDir,
    limits: { fileSize: 64 * 1024 * 1024 } // 64MB max
});

/**
 * POST /api/send/text
 * Send a text message
 * Body: { to: string, message: string }
 */
router.post('/text', async (req, res) => {
    try {
        const { to, message } = req.body;

        if (!to || !message) {
            return res.status(400).json({
                success: false,
                error: 'Both "to" and "message" fields are required'
            });
        }

        const result = await wacli.sendText(to, message);

        res.json({ success: true, data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/send/file
 * Send a file (image, video, audio, document)
 * Multipart form: to, file, caption?, filename?
 */
router.post('/file', upload.single('file'), async (req, res) => {
    try {
        const { to, caption, filename } = req.body;

        if (!to || !req.file) {
            return res.status(400).json({
                success: false,
                error: '"to" field and a "file" upload are required'
            });
        }

        const result = await wacli.sendFile(to, req.file.path, {
            caption,
            filename: filename || req.file.originalname,
            mime: req.file.mimetype
        });

        // Clean up temp file
        fs.unlink(req.file.path, () => { });

        res.json({ success: true, data: result });
    } catch (err) {
        // Clean up temp file on error
        if (req.file) fs.unlink(req.file.path, () => { });
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
