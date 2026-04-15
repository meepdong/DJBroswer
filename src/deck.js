/**
 * Deck — Manages a single YouTube player instance with queue, seek, search, and transport controls.
 */
import { searchYouTube, formatDuration } from './search.js';
import { presets } from './presets.js';

// Helper: extract YouTube video ID from various URL formats
export function extractVideoId(input) {
  if (!input) return null;
  input = input.trim();

  // Already a bare ID (11 chars, alphanumeric + _ -)
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;

  try {
    const url = new URL(input);

    // youtu.be/VIDEO_ID
    if (url.hostname === 'youtu.be') return url.pathname.slice(1).split('/')[0] || null;

    // youtube.com/watch?v=VIDEO_ID
    if (url.searchParams.has('v')) return url.searchParams.get('v');

    // youtube.com/embed/VIDEO_ID or /v/VIDEO_ID or /shorts/VIDEO_ID
    const pathMatch = url.pathname.match(/\/(embed|v|shorts)\/([a-zA-Z0-9_-]{11})/);
    if (pathMatch) return pathMatch[2];
  } catch {
    // not a URL
  }

  return null;
}

// Check if input looks like a URL or video ID (vs a search query)
function isUrlOrId(input) {
  if (!input) return false;
  input = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return true;
  try {
    const url = new URL(input);
    return url.hostname.includes('youtube') || url.hostname === 'youtu.be';
  } catch {
    return false;
  }
}

// Format seconds to m:ss or h:mm:ss
function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  seconds = Math.floor(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class Deck {
  /**
   * @param {string} id - 'a' or 'b'
   * @param {Function} onVolumeRequest - callback that returns the volume (0-100) this deck should play at
   */
  constructor(id, onVolumeRequest) {
    this.id = id;
    this.onVolumeRequest = onVolumeRequest;
    this.player = null;
    this.ready = false;
    this.queue = [];
    this.currentIndex = -1;
    this.isSeeking = false;
    this.animFrameId = null;
    this.searchDebounceTimer = null;

    // DOM refs
    this.urlInput = document.getElementById(`url-input-${id}`);
    this.searchBtn = document.getElementById(`search-btn-${id}`);
    this.presetSelect = document.getElementById(`preset-select-${id}`);
    this.loadBtn = document.getElementById(`load-btn-${id}`);
    this.queueBtn = document.getElementById(`queue-btn-${id}`);
    this.searchResults = document.getElementById(`search-results-${id}`);
    this.seekSlider = document.getElementById(`seek-${id}`);
    this.timeCurrent = document.getElementById(`time-current-${id}`);
    this.timeDuration = document.getElementById(`time-duration-${id}`);
    this.playBtn = document.getElementById(`play-btn-${id}`);
    this.prevBtn = document.getElementById(`prev-btn-${id}`);
    this.nextBtn = document.getElementById(`next-btn-${id}`);
    this.queueList = document.getElementById(`queue-list-${id}`);
    this.nowPlaying = document.getElementById(`deck-${id}-now-playing`);

    this._bindEvents();
  }

  /** Initialize the YouTube player */
  initPlayer() {
    this.player = new YT.Player(`player-${this.id}`, {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 0,
        controls: 1,
        modestbranding: 1,
        rel: 0,
        fs: 1,
        playsinline: 1,
      },
      events: {
        onReady: (e) => this._onReady(e),
        onStateChange: (e) => this._onStateChange(e),
      },
    });
  }

  _onReady() {
    this.ready = true;
    this._applyVolume();
    this._startSeekLoop();
  }

  _onStateChange(event) {
    // Update play button icon
    if (event.data === YT.PlayerState.PLAYING) {
      this.playBtn.textContent = '⏸';
    } else {
      this.playBtn.textContent = '▶';
    }

    // Update now playing title
    this._updateNowPlaying();

    // Auto-advance when video ends
    if (event.data === YT.PlayerState.ENDED) {
      this.next();
    }
  }

  _bindEvents() {
    // Load button — direct load by URL/ID
    this.loadBtn.addEventListener('click', () => {
      const input = this.urlInput.value.trim();
      const videoId = extractVideoId(input);
      if (videoId) {
        this._addToQueue(videoId);
        this._playIndex(this.queue.length - 1);
        this.urlInput.value = '';
        this._hideSearchResults();
      }
    });

    // Search button
    this.searchBtn.addEventListener('click', () => {
      this._performSearch();
    });

    // Enter key — search if text looks like a query, load if it looks like a URL
    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const input = this.urlInput.value.trim();
        if (isUrlOrId(input)) {
          this.loadBtn.click();
        } else {
          this._performSearch();
        }
      } else if (e.key === 'Escape') {
        this._hideSearchResults();
      }
    });

    // Queue button
    this.queueBtn.addEventListener('click', () => {
      const videoId = extractVideoId(this.urlInput.value);
      if (videoId) {
        this._addToQueue(videoId);
        this.urlInput.value = '';
        this._hideSearchResults();
      }
    });

    // Preset loader dropdown
    if (this.presetSelect) {
      this.presetSelect.addEventListener('change', (e) => {
        const theme = e.target.value;
        if (!theme || !presets[theme]) return;
        
        const playlist = presets[theme];
        const wasEmpty = this.queue.length === 0;
        
        playlist.forEach(song => {
          this.queue.push({ videoId: song.videoId, title: song.title || 'Loading…' });
        });
        this._renderQueue();
        
        // If the queue was empty, instantly start playing the first track of the newly loaded preset
        if (wasEmpty && this.queue.length > 0) {
          this._playIndex(0);
        }
        
        // Reset the dropdown
        this.presetSelect.value = '';
      });
    }

    // Close search results when clicking outside
    document.addEventListener('click', (e) => {
      const wrapper = this.urlInput.closest('.search-wrapper');
      if (wrapper && !wrapper.contains(e.target)) {
        this._hideSearchResults();
      }
    });

    // Transport
    this.playBtn.addEventListener('click', () => this.togglePlay());
    this.prevBtn.addEventListener('click', () => this.prev());
    this.nextBtn.addEventListener('click', () => this.next());

    // Seek slider — start seeking
    this.seekSlider.addEventListener('mousedown', () => { this.isSeeking = true; });
    this.seekSlider.addEventListener('touchstart', () => { this.isSeeking = true; }, { passive: true });

    // Seek slider — commit seek
    this.seekSlider.addEventListener('mouseup', () => { this._commitSeek(); });
    this.seekSlider.addEventListener('touchend', () => { this._commitSeek(); });
    this.seekSlider.addEventListener('change', () => { this._commitSeek(); });
  }

  // ——— Search ———

  async _performSearch() {
    const query = this.urlInput.value.trim();
    if (!query) return;

    // If it's a URL, just load it directly
    if (isUrlOrId(query)) {
      this.loadBtn.click();
      return;
    }

    // Show loading state
    this.searchBtn.classList.add('loading');

    try {
      const results = await searchYouTube(query);
      this._renderSearchResults(results);
    } catch {
      this._renderSearchResults([]);
    } finally {
      this.searchBtn.classList.remove('loading');
    }
  }

  _renderSearchResults(results) {
    this.searchResults.innerHTML = '';

    if (results.length === 0) {
      const noResults = document.createElement('div');
      noResults.className = 'search-no-results';
      noResults.textContent = 'No results found. Try a different search.';
      this.searchResults.appendChild(noResults);
      this.searchResults.classList.add('visible');
      return;
    }

    results.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'search-result-item';

      const thumb = document.createElement('img');
      thumb.className = 'search-result-thumb';
      thumb.src = item.thumbnail;
      thumb.alt = item.title;
      thumb.loading = 'lazy';

      const info = document.createElement('div');
      info.className = 'search-result-info';

      const title = document.createElement('div');
      title.className = 'search-result-title';
      title.textContent = item.title;
      title.title = item.title;

      const meta = document.createElement('div');
      meta.className = 'search-result-meta';
      const durationStr = formatDuration(item.duration);
      meta.textContent = `${item.uploaderName}${durationStr ? ' • ' + durationStr : ''}`;

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'search-result-actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-load';
      loadBtn.textContent = '▶ Play';
      loadBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._addToQueue(item.videoId, item.title);
        this._playIndex(this.queue.length - 1);
        this._hideSearchResults();
        this.urlInput.value = '';
      });

      const queueBtn = document.createElement('button');
      queueBtn.className = 'btn btn-queue';
      queueBtn.textContent = '+ Queue';
      queueBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._addToQueue(item.videoId, item.title);
      });

      actions.appendChild(loadBtn);
      actions.appendChild(queueBtn);

      // Click entire row to play
      row.addEventListener('click', () => {
        this._addToQueue(item.videoId, item.title);
        this._playIndex(this.queue.length - 1);
        this._hideSearchResults();
        this.urlInput.value = '';
      });

      row.appendChild(thumb);
      row.appendChild(info);
      row.appendChild(actions);
      this.searchResults.appendChild(row);
    });

    this.searchResults.classList.add('visible');
  }

  _hideSearchResults() {
    this.searchResults.classList.remove('visible');
  }

  _commitSeek() {
    if (!this.ready || !this.player) return;
    const duration = this.player.getDuration() || 0;
    const targetTime = (this.seekSlider.value / 100) * duration;
    this.player.seekTo(targetTime, true);
    this.isSeeking = false;
  }

  /** Continuously update seek slider & time displays */
  _startSeekLoop() {
    const update = () => {
      if (this.ready && this.player && !this.isSeeking) {
        try {
          const current = this.player.getCurrentTime() || 0;
          const duration = this.player.getDuration() || 0;
          if (duration > 0) {
            this.seekSlider.value = (current / duration) * 100;
          }
          this.timeCurrent.textContent = formatTime(current);
          this.timeDuration.textContent = formatTime(duration);
        } catch { /* player might not be ready */ }
      }
      this.animFrameId = requestAnimationFrame(update);
    };
    update();
  }

  /** Apply the volume derived from the crossfader */
  _applyVolume() {
    if (!this.ready || !this.player) return;
    const vol = this.onVolumeRequest();
    this.player.setVolume(vol);
  }

  /** Call this externally whenever the crossfader changes */
  updateVolume() {
    this._applyVolume();
  }

  /** Update the "Now Playing" label */
  _updateNowPlaying() {
    if (!this.ready || !this.player) return;
    try {
      const data = this.player.getVideoData();
      if (data && data.title) {
        this.nowPlaying.textContent = data.title;
      }
    } catch { /* ignore */ }
  }

  // ——— Queue Management ———

  _addToQueue(videoId, title) {
    const index = this.queue.length;
    this.queue.push({ videoId, title: title || 'Loading…' });
    this._renderQueue();

    // If no title was provided, fetch it from YouTube oEmbed
    if (!title) {
      this._fetchVideoTitle(videoId).then((fetchedTitle) => {
        if (fetchedTitle && this.queue[index] && this.queue[index].videoId === videoId) {
          this.queue[index].title = fetchedTitle;
          this._renderQueue();
        }
      });
    }
  }

  /** Fetch video title from YouTube oEmbed (no API key needed) */
  async _fetchVideoTitle(videoId) {
    try {
      const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data.title || null;
    } catch {
      return null;
    }
  }

  _removeFromQueue(index) {
    if (index === this.currentIndex) return; // can't remove currently playing
    this.queue.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    this._renderQueue();
  }

  _playIndex(index) {
    if (index < 0 || index >= this.queue.length) return;
    this.currentIndex = index;
    const { videoId } = this.queue[index];
    if (this.ready && this.player) {
      this.player.loadVideoById(videoId);
      this._applyVolume();
    }
    this._renderQueue();

    // Update title after a short delay (YouTube needs time to load metadata)
    setTimeout(() => {
      this._updateNowPlaying();
      try {
        const data = this.player.getVideoData();
        if (data && data.title && this.queue[index]) {
          this.queue[index].title = data.title;
          this._renderQueue();
        }
      } catch { /* ignore */ }
    }, 1500);
  }

  _renderQueue() {
    this.queueList.innerHTML = '';
    if (this.queue.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'queue-empty';
      empty.textContent = 'Queue is empty — search or paste a URL above';
      this.queueList.appendChild(empty);
      return;
    }

    this.queue.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'queue-item' + (i === this.currentIndex ? ' active' : '');

      const indexSpan = document.createElement('span');
      indexSpan.className = 'queue-item-index';
      indexSpan.textContent = `${i + 1}.`;

      const titleSpan = document.createElement('span');
      titleSpan.className = 'queue-item-title';
      titleSpan.textContent = item.title;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-item-remove';
      removeBtn.textContent = '✕';
      removeBtn.title = 'Remove from queue';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._removeFromQueue(i);
      });

      li.addEventListener('click', () => this._playIndex(i));
      li.appendChild(indexSpan);
      li.appendChild(titleSpan);
      if (i !== this.currentIndex) li.appendChild(removeBtn);
      this.queueList.appendChild(li);
    });
  }

  // ——— Transport ———

  togglePlay() {
    if (!this.ready || !this.player) return;
    const state = this.player.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      this.player.pauseVideo();
    } else {
      this.player.playVideo();
    }
  }

  next() {
    if (this.currentIndex < this.queue.length - 1) {
      this._playIndex(this.currentIndex + 1);
    }
  }

  prev() {
    if (this.currentIndex > 0) {
      this._playIndex(this.currentIndex - 1);
    }
  }
}
