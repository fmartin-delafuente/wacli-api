const express = require('express');
const wacli = require('../wacli');

const router = express.Router();

/**
 * GET /api/chats
 * List all chats
 */
router.get('/', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '100');
        const result = await wacli.listChats(limit);

        res.json({
            success: true,
            data: result?.data || []
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
