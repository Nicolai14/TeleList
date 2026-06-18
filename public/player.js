const socket = io();
let ytPlayer = null;
let currentVideoId = null;
let playerReady = false;
let pendingVideoId = null;

// YouTube IFrame API
window.onYouTubeIframeAPIReady = function () {
  ytPlayer = new YT.Player('player', {
    height: '100%',
    width: '100%',
    playerVars: { autoplay: 1, controls: 1, rel: 0, modestbranding: 1 },
    events: {
      onReady: () => {
        playerReady = true;
        if (pendingVideoId) loadVideo(pendingVideoId);
      },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.ENDED) {
          socket.emit('skip');
        }
      },
    },
  });
};

const tag = document.createElement('script');
tag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(tag);

function loadVideo(videoId) {
  document.getElementById('empty-state').style.display = 'none';
  if (!playerReady) {
    pendingVideoId = videoId;
    return;
  }
  if (currentVideoId === videoId) return;
  currentVideoId = videoId;
  ytPlayer.loadVideoById(videoId);
}

function clearPlayer() {
  currentVideoId = null;
  pendingVideoId = null;
  if (ytPlayer && playerReady) ytPlayer.stopVideo();
  document.getElementById('empty-state').style.display = 'block';
}

function renderQueue(items) {
  const list = document.getElementById('queue-list');
  const count = document.getElementById('queue-count');
  count.textContent = items.length;

  if (items.length === 0) {
    list.innerHTML = '';
    return;
  }

  list.innerHTML = items.map((item, i) => `
    <div class="queue-item ${i === 0 ? 'current' : ''}">
      <img class="queue-thumb"
        src="https://img.youtube.com/vi/${item.video_id}/mqdefault.jpg"
        alt=""
        onerror="this.style.visibility='hidden'"
      />
      <div class="queue-info">
        <div class="queue-title">${escHtml(item.title || item.video_id)}</div>
        <div class="queue-meta">von ${escHtml(item.added_by || '?')}</div>
      </div>
      <div class="queue-pos">${i === 0 ? '▶' : i + 1}</div>
    </div>
  `).join('');
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

socket.on('connect', () => {
  document.getElementById('status-bar').innerHTML = 'Verbunden — <span>live</span>';
});

socket.on('disconnect', () => {
  document.getElementById('status-bar').textContent = 'Verbindung getrennt…';
});

socket.on('queue-update', (items) => {
  renderQueue(items);
  if (items.length === 0) clearPlayer();
});

socket.on('play', (item) => {
  if (item) {
    loadVideo(item.video_id);
  } else {
    clearPlayer();
  }
});

document.getElementById('btn-skip').addEventListener('click', () => {
  socket.emit('skip');
});

document.getElementById('btn-clear').addEventListener('click', () => {
  if (confirm('Queue wirklich leeren?')) socket.emit('clear');
});
