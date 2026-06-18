require('dotenv').config();
const { startServer } = require('./src/server');
const { setupBot } = require('./src/bot');

const PORT = parseInt(process.env.PORT) || 3000;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN fehlt in .env');
  process.exit(1);
}

startServer(PORT);

const bot = setupBot(TOKEN);
bot.launch().then(() => {
  console.log('Telegram Bot gestartet');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
