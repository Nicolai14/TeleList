const { Telegraf } = require('telegraf');
const {
  extractVideoId,
  fetchVideoInfo,
  formatDuration,
  MAX_DURATION_SECONDS,
  addToQueue,
  getQueue,
  removeCurrent,
  removeByPosition,
  clearQueue,
  getLength,
  getHistory,
  isInQueue,
  isInHistory,
} = require('./queue');
const { broadcastNewItem, broadcastQueueUpdate } = require('./server');

const ADMIN_ID = parseInt(process.env.ADMIN_TELEGRAM_ID);

function isAdmin(ctx) {
  return ctx.from && ctx.from.id === ADMIN_ID;
}

function setupBot(token) {
  const bot = new Telegraf(token);

  bot.on('message', async (ctx) => {
    const text = ctx.message.text || ctx.message.caption || '';
    const urls = text.match(/https?:\/\/[^\s]+/g) || [];

    for (const url of urls) {
      const videoId = extractVideoId(url);
      if (!videoId) continue;

      const addedBy = ctx.from.username
        ? `@${ctx.from.username}`
        : ctx.from.first_name;

      // Duplicate check before fetching info
      if (isInQueue(videoId)) {
        await ctx.reply('❌ Dieses Video ist bereits in der Queue.', {
          reply_to_message_id: ctx.message.message_id,
        });
        continue;
      }

      const historyEntry = isInHistory(videoId);
      if (historyEntry) {
        const minutesAgo = Math.round((Date.now() / 1000 - historyEntry.played_at) / 60);
        const timeStr = minutesAgo < 60
          ? `vor ${minutesAgo} Minute${minutesAgo !== 1 ? 'n' : ''}`
          : `vor ${Math.round(minutesAgo / 60)} Stunde${Math.round(minutesAgo / 60) !== 1 ? 'n' : ''}`;
        await ctx.reply(
          `❌ "${historyEntry.title || videoId}" wurde bereits gespielt (${timeStr}).`,
          { reply_to_message_id: ctx.message.message_id }
        );
        continue;
      }

      const waitMsg = await ctx.reply('🔍 Analysiere...', {
        reply_to_message_id: ctx.message.message_id,
      });

      let info;
      try {
        info = await fetchVideoInfo(videoId);
      } catch {
        await ctx.telegram.editMessageText(
          ctx.chat.id, waitMsg.message_id, null,
          '❌ Video konnte nicht geladen werden. Ungültiger Link?'
        );
        continue;
      }

      if (info.duration > MAX_DURATION_SECONDS) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, waitMsg.message_id, null,
          `❌ Video zu lang (${formatDuration(info.duration)}). Maximal 4 Minuten erlaubt.`
        );
        continue;
      }

      const insertIdx = addToQueue(videoId, info.title, addedBy);
      broadcastNewItem();

      const pos = insertIdx + 1; // 1-based position in queue (1 = currently playing)
      const displayPos = pos === 1 ? 'wird jetzt abgespielt' : `Position ${pos}`;

      await ctx.telegram.editMessageText(
        ctx.chat.id, waitMsg.message_id, null,
        `✅ "${info.title}" hinzugefügt (${displayPos}, ${formatDuration(info.duration)})`
      );
    }
  });

  function buildPlaylistText(items) {
    if (items.length === 0) return 'Die Queue ist leer.';
    const lines = items.map((item, i) => {
      const prefix = i === 0 ? '▶️' : `${i + 1}.`;
      return `${prefix} ${item.title || item.video_id} — ${item.added_by || '?'}`;
    });
    return `Queue (${items.length} Videos):\n\n${lines.join('\n')}`;
  }

  bot.command('queue', async (ctx) => {
    ctx.reply(buildPlaylistText(getQueue()));
  });

  bot.command('playlist', async (ctx) => {
    ctx.reply(buildPlaylistText(getQueue()));
  });

  bot.command('history', async (ctx) => {
    const items = getHistory();
    if (items.length === 0) return ctx.reply('Noch keine Songs gespielt.');
    const lines = items.map((item, i) => `${i + 1}. ${item.title || item.video_id} — ${item.added_by || '?'}`);
    ctx.reply(`Letzte ${items.length} gespielte Songs:\n\n${lines.join('\n')}`);
  });

  bot.command('skip', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Nur der Admin kann skippen.');
    const next = removeCurrent();
    broadcastQueueUpdate();
    ctx.reply(next ? `⏭ Übersprungen. Jetzt: ${next.title || next.video_id}` : '⏭ Queue ist jetzt leer.');
  });

  bot.command('clear', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Nur der Admin kann die Queue leeren.');
    clearQueue();
    broadcastQueueUpdate();
    ctx.reply('🗑 Queue geleert.');
  });

  bot.command('remove', async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Nur der Admin kann Videos entfernen.');
    const pos = parseInt((ctx.message.text.split(' ')[1] || ''));
    if (isNaN(pos) || pos < 1) return ctx.reply('Verwendung: /remove <position>');
    if (removeByPosition(pos)) {
      broadcastQueueUpdate();
      ctx.reply(`🗑 Video an Position ${pos} entfernt.`);
    } else {
      ctx.reply(`Position ${pos} existiert nicht.`);
    }
  });

  bot.command('start', (ctx) => {
    ctx.reply(
      'TeleList Bot aktiv!\n\nSchicke einen YouTube-Link (max. 4 Min.) um ihn zur Queue hinzuzufügen.\n\n' +
      '/playlist — aktuelle Queue anzeigen\n' +
      '/queue — aktuelle Queue anzeigen\n' +
      '/history — letzte 30 gespielte Songs\n' +
      '/skip — Überspringen (Admin)\n' +
      '/clear — Queue leeren (Admin)\n' +
      '/remove <pos> — Video entfernen (Admin)'
    );
  });

  return bot;
}

module.exports = { setupBot };
