const db = require('./db');
const ytdl = require('@distube/ytdl-core');

const MAX_DURATION_SECONDS = 4 * 60; // 4 minutes

function extractVideoId(url) {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchVideoInfo(videoId) {
  const info = await ytdl.getBasicInfo(`https://www.youtube.com/watch?v=${videoId}`);
  const details = info.videoDetails;
  return {
    title: details.title,
    duration: parseInt(details.lengthSeconds, 10),
  };
}

function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Round-robin fair insertion: finds the index (in the full queue array)
// where a new item from `newUser` should be inserted.
// queue[0] = currently playing (counts as that user's round-1 slot).
function findInsertIndex(queue, newUser) {
  if (queue.length === 0) return 0;
  if (queue.length === 1) return 1;

  // Pre-seed the currently-playing user so their second queued song triggers a new round
  const roundUsers = new Set([queue[0].added_by]);
  const pending = queue.slice(1);

  for (let i = 0; i < pending.length; i++) {
    const user = pending[i].added_by;

    if (roundUsers.has(user)) {
      // New round starts here — if newUser has no slot in the completed round, insert here
      if (!roundUsers.has(newUser)) {
        return i + 1; // convert pending index to full-queue index
      }
      roundUsers.clear();
    }

    roundUsers.add(user);
  }

  return queue.length; // append to end
}

function addToQueue(videoId, title, addedBy) {
  const items = getQueue();
  const insertIdx = findInsertIndex(items, addedBy);

  db.transaction(() => {
    // Renumber existing items to make room at insertIdx
    const rows = db.prepare('SELECT id FROM queue ORDER BY sort_order ASC, id ASC').all();
    const update = db.prepare('UPDATE queue SET sort_order = ? WHERE id = ?');
    rows.forEach((row, i) => {
      update.run(i < insertIdx ? i + 1 : i + 2, row.id);
    });
    db.prepare(
      'INSERT INTO queue (video_id, title, added_by, sort_order) VALUES (?, ?, ?, ?)'
    ).run(videoId, title || videoId, addedBy, insertIdx + 1);
  })();

  return insertIdx;
}

function getQueue() {
  return db.prepare('SELECT * FROM queue ORDER BY sort_order ASC, id ASC').all();
}

function getCurrent() {
  return db.prepare('SELECT * FROM queue ORDER BY sort_order ASC, id ASC LIMIT 1').get();
}

function removeCurrent() {
  const current = getCurrent();
  if (!current) return null;
  db.prepare('DELETE FROM queue WHERE id = ?').run(current.id);
  return getCurrent();
}

function removeByPosition(position) {
  const items = getQueue();
  const item = items[position - 1];
  if (!item) return false;
  db.prepare('DELETE FROM queue WHERE id = ?').run(item.id);
  return true;
}

function clearQueue() {
  db.prepare('DELETE FROM queue').run();
}

function getLength() {
  return db.prepare('SELECT COUNT(*) as count FROM queue').get().count;
}

module.exports = {
  extractVideoId,
  fetchVideoInfo,
  formatDuration,
  MAX_DURATION_SECONDS,
  addToQueue,
  getQueue,
  getCurrent,
  removeCurrent,
  removeByPosition,
  clearQueue,
  getLength,
};
