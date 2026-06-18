const { Telegraf, Markup } = require('telegraf');
const {
  extractVideoId,
  fetchVideoInfo,
  formatDuration,
  MAX_DURATION_SECONDS,
  addToQueue,
  getQueue,
  getCurrent,
  removeCurrent,
  autoFillFromHistory,
  removeByPosition,
  clearQueue,
  getHistory,
  isInQueue,
  isInHistory,
} = require('./queue');
const { broadcastNewItem, broadcastQueueUpdate } = require('./server');

const ADMIN_ID = parseInt(process.env.ADMIN_TELEGRAM_ID);
const SKIP_VOTES_NEEDED = 2;

function isAdmin(ctx) {
  return ctx.from && ctx.from.id === ADMIN_ID;
}

function deleteAfter(ctx, messageId, seconds = 4) {
  setTimeout(() => {
    ctx.telegram.deleteMessage(ctx.chat.id, messageId).catch(() => {});
  }, seconds * 1000);
}

// In-memory vote state — resets when song changes or skip happens
let skipVote = { videoId: null, voters: new Set(), msgId: null, chatId: null, timeoutId: null };

function resetSkipVote() {
  if (skipVote.timeoutId) clearTimeout(skipVote.timeoutId);
  skipVote = { videoId: null, voters: new Set(), msgId: null, chatId: null, timeoutId: null };
}

function deleteVoteMessage(telegram) {
  if (skipVote.msgId) {
    telegram.deleteMessage(skipVote.chatId, skipVote.msgId).catch(() => {});
  }
}

function setupBot(token) {
  const bot = new Telegraf(token);

  // Only handle non-command messages for YouTube link detection
  bot.on('message', async (ctx, next) => {
    const text = ctx.message.text || ctx.message.caption || '';
    if (text.startsWith('/')) return next();

    const urls = text.match(/https?:\/\/[^\s]+/g) || [];
    const originalMsgId = ctx.message.message_id;

    for (const url of urls) {
      const videoId = extractVideoId(url);
      if (!videoId) continue;

      const addedBy = ctx.from.username
        ? `@${ctx.from.username}`
        : ctx.from.first_name;

      if (isInQueue(videoId)) {
        const msg = await ctx.reply('❌ Dieses Video ist bereits in der Queue.', {
          reply_to_message_id: originalMsgId,
        });
        deleteAfter(ctx, msg.message_id);
        deleteAfter(ctx, originalMsgId);
        continue;
      }

      const historyEntry = isInHistory(videoId);
      if (historyEntry) {
        const minutesAgo = Math.round((Date.now() / 1000 - historyEntry.played_at) / 60);
        const timeStr = minutesAgo < 60
          ? `vor ${minutesAgo} Minute${minutesAgo !== 1 ? 'n' : ''}`
          : `vor ${Math.round(minutesAgo / 60)} Stunde${Math.round(minutesAgo / 60) !== 1 ? 'n' : ''}`;
        const msg = await ctx.reply(
          `❌ "${historyEntry.title || videoId}" wurde bereits gespielt (${timeStr}).`,
          { reply_to_message_id: originalMsgId }
        );
        deleteAfter(ctx, msg.message_id);
        deleteAfter(ctx, originalMsgId);
        continue;
      }

      const waitMsg = await ctx.reply('🔍 Analysiere...', {
        reply_to_message_id: originalMsgId,
      });

      let info;
      try {
        info = await fetchVideoInfo(videoId);
      } catch {
        await ctx.telegram.editMessageText(
          ctx.chat.id, waitMsg.message_id, null,
          '❌ Video konnte nicht geladen werden. Ungültiger Link?'
        );
        deleteAfter(ctx, waitMsg.message_id);
        deleteAfter(ctx, originalMsgId);
        continue;
      }

      if (info.duration > MAX_DURATION_SECONDS) {
        await ctx.telegram.editMessageText(
          ctx.chat.id, waitMsg.message_id, null,
          `❌ Video zu lang (${formatDuration(info.duration)}). Maximal 4 Minuten erlaubt.`
        );
        deleteAfter(ctx, waitMsg.message_id);
        deleteAfter(ctx, originalMsgId);
        continue;
      }

      const insertIdx = addToQueue(videoId, info.title, addedBy);
      broadcastNewItem();

      const pos = insertIdx + 1;
      const displayPos = pos === 1 ? 'wird jetzt abgespielt' : `Position ${pos}`;

      await ctx.telegram.editMessageText(
        ctx.chat.id, waitMsg.message_id, null,
        `✅ "${info.title}" hinzugefügt (${displayPos}, ${formatDuration(info.duration)})`
      );
      deleteAfter(ctx, waitMsg.message_id);
      deleteAfter(ctx, originalMsgId);
    }

    return next();
  });

  // Vote skip handler — used by both /voteskip command and inline button
  async function handleVoteSkip(ctx) {
    const userId = ctx.from.id;
    const current = getCurrent();

    if (!current) {
      if (ctx.callbackQuery) return ctx.answerCbQuery('Gerade spielt nichts.');
      return ctx.reply('Gerade spielt nichts.');
    }

    // Reset vote state if the song changed
    if (skipVote.videoId !== current.video_id) {
      resetSkipVote();
      skipVote.videoId = current.video_id;
    }

    if (skipVote.voters.has(userId)) {
      if (ctx.callbackQuery) return ctx.answerCbQuery('Du hast bereits abgestimmt.');
      return;
    }

    skipVote.voters.add(userId);
    const count = skipVote.voters.size;

    if (ctx.callbackQuery) ctx.answerCbQuery('Stimme gezählt! 👍');

    if (count >= SKIP_VOTES_NEEDED) {
      const savedMsgId = skipVote.msgId;
      const savedChatId = skipVote.chatId;

      removeCurrent();
      const next = getCurrent() || autoFillFromHistory();
      broadcastQueueUpdate();
      resetSkipVote();

      if (savedMsgId) {
        ctx.telegram.deleteMessage(savedChatId, savedMsgId).catch(() => {});
      }

      ctx.reply(
        next
          ? `⏭ Übersprungen! (${SKIP_VOTES_NEEDED} Stimmen)\nWeiter: "${next.title || next.video_id}"`
          : `⏭ Übersprungen! (${SKIP_VOTES_NEEDED} Stimmen)\nQueue ist leer.`
      );
      return;
    }

    const voteText =
      `⏭ Skip-Abstimmung für "${current.title || current.video_id}"\n` +
      `👍 ${count}/${SKIP_VOTES_NEEDED} Stimmen`;
    const keyboard = Markup.inlineKeyboard([
      Markup.button.callback('👍 Überspringen', 'vote_skip'),
    ]);

    if (skipVote.msgId) {
      await ctx.telegram
        .editMessageText(skipVote.chatId, skipVote.msgId, null, voteText, keyboard)
        .catch(() => {});
    } else {
      const msg = await ctx.reply(voteText, keyboard);
      skipVote.msgId = msg.message_id;
      skipVote.chatId = ctx.chat.id;

      // Auto-expire: delete vote message and reset after 20s
      skipVote.timeoutId = setTimeout(() => {
        if (skipVote.msgId) {
          bot.telegram.deleteMessage(skipVote.chatId, skipVote.msgId).catch(() => {});
        }
        resetSkipVote();
      }, 20_000);
    }
  }

  bot.command('voteskip', (ctx) => handleVoteSkip(ctx));
  bot.action('vote_skip', (ctx) => handleVoteSkip(ctx));

  function buildPlaylistText(items) {
    if (items.length === 0) return 'Die Queue ist leer.';
    const lines = items.map((item, i) => {
      const prefix = i === 0 ? '▶️' : `${i + 1}.`;
      return `${prefix} ${item.title || item.video_id} — ${item.added_by || '?'}`;
    });
    return `Queue (${items.length} Videos):\n\n${lines.join('\n')}`;
  }

  bot.command('help', (ctx) => {
    ctx.reply(
      'TeleList – Befehle:\n\n' +
      '📋 Queue\n' +
      '/playlist – aktuelle Queue anzeigen\n' +
      '/queue – aktuelle Queue anzeigen\n' +
      '/history – letzte 30 gespielte Songs\n\n' +
      '🎬 Hinzufügen\n' +
      'Einfach einen YouTube-Link schicken (max. 4 Min.).\n' +
      'Kein Duplikat aus Queue oder History erlaubt.\n' +
      'Queue ist fair: jeder User wechselt sich ab.\n\n' +
      '⏭ Abstimmung\n' +
      `/voteskip – Skip-Abstimmung starten (${SKIP_VOTES_NEEDED} Stimmen nötig)\n\n` +
      '⚙️ Admin\n' +
      '/skip – aktuelles Video sofort überspringen\n' +
      '/remove <nr> – Video an Position Nr. entfernen\n' +
      '/clear – gesamte Queue leeren'
    );
  });

  bot.command('queue', (ctx) => {
    ctx.reply(buildPlaylistText(getQueue()));
  });

  bot.command('playlist', (ctx) => {
    ctx.reply(buildPlaylistText(getQueue()));
  });

  bot.command('history', (ctx) => {
    const items = getHistory();
    if (items.length === 0) return ctx.reply('Noch keine Songs gespielt.');
    const lines = items.map((item, i) => `${i + 1}. ${item.title || item.video_id} — ${item.added_by || '?'}`);
    ctx.reply(`Letzte ${items.length} gespielte Songs:\n\n${lines.join('\n')}`);
  });

  bot.command('skip', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Nur der Admin kann direkt skippen. Nutze /voteskip.');
    deleteVoteMessage(ctx.telegram);
    resetSkipVote();
    removeCurrent();
    const next = getCurrent() || autoFillFromHistory();
    broadcastQueueUpdate();
    ctx.reply(next ? `⏭ Übersprungen. Jetzt: ${next.title || next.video_id}` : '⏭ Queue ist jetzt leer.');
  });

  bot.command('clear', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Nur der Admin kann die Queue leeren.');
    deleteVoteMessage(ctx.telegram);
    resetSkipVote();
    clearQueue();
    broadcastQueueUpdate();
    ctx.reply('🗑 Queue geleert.');
  });

  bot.command('remove', (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('Nur der Admin kann Videos entfernen.');
    const pos = parseInt((ctx.message.text.split(' ')[1] || ''));
    if (isNaN(pos) || pos < 1) return ctx.reply('Verwendung: /remove <position>');
    if (removeByPosition(pos)) {
      // If current song (pos 1) was removed, reset vote
      if (pos === 1) { deleteVoteMessage(ctx.telegram); resetSkipVote(); }
      broadcastQueueUpdate();
      ctx.reply(`🗑 Video an Position ${pos} entfernt.`);
    } else {
      ctx.reply(`Position ${pos} existiert nicht.`);
    }
  });

  bot.command('start', (ctx) => {
    ctx.reply('TeleList Bot aktiv! Schicke einen YouTube-Link (max. 4 Min.).\n\n/help – alle Befehle anzeigen');
  });

  return bot;
}

module.exports = { setupBot };
