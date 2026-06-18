const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getQueue, getCurrent, removeCurrent, clearQueue } = require('./queue');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/queue', (req, res) => {
  res.json(getQueue());
});

io.on('connection', (socket) => {
  socket.emit('queue-update', getQueue());

  socket.on('skip', () => {
    const next = removeCurrent();
    io.emit('queue-update', getQueue());
    if (next) {
      io.emit('play', next);
    } else {
      io.emit('play', null);
    }
  });

  socket.on('clear', () => {
    clearQueue();
    io.emit('queue-update', []);
    io.emit('play', null);
  });
});

function broadcastQueueUpdate() {
  io.emit('queue-update', getQueue());
  const current = getCurrent();
  if (current) {
    io.emit('play', current);
  }
}

function broadcastNewItem() {
  const queue = getQueue();
  io.emit('queue-update', queue);
  if (queue.length === 1) {
    io.emit('play', queue[0]);
  }
}

function startServer(port) {
  httpServer.listen(port, () => {
    console.log(`Player läuft auf http://localhost:${port}`);
  });
}

module.exports = { startServer, broadcastQueueUpdate, broadcastNewItem };
