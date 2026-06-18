const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'queue.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    title TEXT,
    added_by TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    added_at INTEGER DEFAULT (strftime('%s', 'now'))
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    title TEXT,
    added_by TEXT,
    played_at INTEGER DEFAULT (strftime('%s', 'now'))
  );
`);

// Migration: add sort_order if it doesn't exist yet
const cols = db.prepare("PRAGMA table_info(queue)").all().map(c => c.name);
if (!cols.includes('sort_order')) {
  db.exec('ALTER TABLE queue ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0');
  // Renumber existing rows by id
  const rows = db.prepare('SELECT id FROM queue ORDER BY id ASC').all();
  rows.forEach((row, i) => {
    db.prepare('UPDATE queue SET sort_order = ? WHERE id = ?').run(i + 1, row.id);
  });
}

module.exports = db;
