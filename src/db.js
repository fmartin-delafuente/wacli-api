const Database = require('better-sqlite3');
const path = require('path');

let db;

function getDb(dbPath) {
    if (!db) {
        db = new Database(dbPath || path.join(__dirname, '..', 'wacli-api.db'));
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        initSchema(db);
    }
    return db;
}

function initSchema(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_jid TEXT NOT NULL,
      chat_name TEXT DEFAULT '',
      msg_id TEXT NOT NULL UNIQUE,
      sender_jid TEXT DEFAULT '',
      from_me INTEGER DEFAULT 0,
      timestamp TEXT NOT NULL,
      text TEXT DEFAULT '',
      display_text TEXT DEFAULT '',
      media_type TEXT DEFAULT '',
      media_path TEXT DEFAULT '',
      raw_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_messages_chat_jid ON messages(chat_jid);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
    CREATE INDEX IF NOT EXISTS idx_messages_msg_id ON messages(msg_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      filename TEXT DEFAULT '',
      mime_type TEXT DEFAULT '',
      file_path TEXT DEFAULT '',
      size INTEGER DEFAULT 0,
      downloaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT OR IGNORE INTO sync_state (key, value) VALUES ('last_sync', '2000-01-01T00:00:00Z');
  `);
}

function closeDb() {
    if (db) {
        db.close();
        db = null;
    }
}

module.exports = { getDb, closeDb };
