# TeleList

A Telegram-based office music queue. Everyone in your Telegram group can throw YouTube links into a shared queue — the music plays in a browser tab, so the whole office listens together.

## How it works

1. Someone drops a YouTube link in the group chat → the bot adds it to the queue
2. Open `http://localhost:4242` on the office speaker machine → music plays automatically
3. The queue is fair: if one person already has a song coming up, the next person's song gets inserted before their second one
4. When the queue runs dry, a random song from the play history kicks in automatically

## Features

- **Shared queue** — anyone in the group can add songs
- **Fair round-robin** — no one can hog the queue; songs interleave between users
- **4-minute limit** — keeps the queue moving, no full albums or hour-long mixes
- **Duplicate protection** — songs already in the queue or recently played are rejected
- **Play history** — last 30 played songs, used for duplicate checks and auto-fill
- **Vote to skip** — 2 votes from any member skips the current song (`/voteskip`)
- **Auto-cleanup** — YouTube links and bot replies disappear after 4 seconds
- **Auto-fill** — empty queue? A random song from history plays automatically

## Setup

**1. Clone and install**
```bash
git clone https://github.com/Nicolai14/TeleList.git
cd TeleList
npm install
```

**2. Create a Telegram bot**
- Open [@BotFather](https://t.me/BotFather) and run `/newbot`
- Copy the bot token
- Go to `Bot Settings → Group Privacy → Turn off` (required so the bot sees all messages)

**3. Get your IDs**
- Your Telegram user ID: message [@userinfobot](https://t.me/userinfobot)
- Your group ID: add the bot to the group, then send a message — the bot will log the chat ID, or use a tool like [@getidsbot](https://t.me/getidsbot)

**4. Configure**
```bash
cp .env.example .env
```
Edit `.env`:
```
TELEGRAM_BOT_TOKEN=your_bot_token_here
ADMIN_TELEGRAM_ID=your_telegram_user_id
GROUP_ID=your_group_id
PORT=4242
```

**5. Make the bot an admin in your group**

The bot needs admin rights with the **"Delete Messages"** permission to clean up links after they're queued.

**6. Run**
```bash
npm start
```

Open `http://localhost:4242` in your browser — that's the player. Leave it open on the machine connected to your speakers.

## Bot commands

| Command | Who | Description |
|---|---|---|
| `/voteskip` | Everyone | Start a skip vote (2 votes needed) |
| `/playlist` | Everyone | Show current queue |
| `/queue` | Everyone | Show current queue |
| `/history` | Everyone | Show last 30 played songs |
| `/help` | Everyone | Show all commands |
| `/skip` | Admin only | Skip current song immediately |
| `/remove <n>` | Admin only | Remove song at position n |
| `/clear` | Admin only | Clear the entire queue |

## Tech stack

- **Node.js** — runtime
- **Telegraf** — Telegram bot framework
- **Express + Socket.io** — web player with real-time queue updates
- **better-sqlite3** — persistent queue and history storage
- **@distube/ytdl-core** — YouTube metadata (title, duration)
- **YouTube IFrame API** — in-browser playback
