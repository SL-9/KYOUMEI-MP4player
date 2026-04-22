/* ===================================================
   VIBE — MP4 Music Player | JavaScript Application
   =================================================== */

'use strict';

// ── Track Data (start empty — add your own MP4s!) ─────────────────────────
let TRACKS = [
  {
    id: 1,
    title: '月光のレール、星の海のダイバー',
    artist: 'Kyoumei',
    genre: 'cinematic',
    duration: '--:--',
    video_url: '月光のレール、星の海のダイバー.mp4',
    thumbnail: '月光のレール、星の海のダイバー.mp4',
    color: '#06b6d4',
  }
];

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  currentTrackId: null,
  isPlaying: false,
  isMuted: false,
  isLooping: false,
  isShuffling: false,
  volume: 0.8,
  currentTime: 0,
  duration: 0,
  likedTracks: new Set(),
  activeGenre: 'all',
  isDragging: false,
  waveformPhase: 0,
};

// ── IndexedDB & LocalStorage ──────────────────────────────────────────────────
const DB_NAME = 'VibePlayerDB';
const STORE_NAME = 'tracksStore';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      if (!e.target.result.objectStoreNames.contains(STORE_NAME)) {
        e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveTrackToDB(track, file) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const data = { ...track, fileBlob: file };
      if (typeof data.video_url === 'string' && data.video_url.startsWith('blob:')) delete data.video_url;
      if (typeof data.thumbnail === 'string' && data.thumbnail.startsWith('blob:')) delete data.thumbnail;
      store.put(data);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }).catch(err => console.warn('DB Save Error:', err));
}

function loadTracksFromDB() {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }).catch(err => {
    console.warn('DB Load Error:', err);
    return [];
  });
}

function deleteTrackFromDB(id) {
  return openDB().then(db => {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }).catch(err => console.warn('DB Delete Error:', err));
}

function saveStateToLocal() {
  localStorage.setItem('vibe_likes', JSON.stringify(Array.from(state.likedTracks)));
  localStorage.setItem('vibe_volume', state.volume);
}

function loadStateFromLocal() {
  try {
    const likes = localStorage.getItem('vibe_likes');
    if (likes) state.likedTracks = new Set(JSON.parse(likes));
    const vol = localStorage.getItem('vibe_volume');
    if (vol !== null) state.volume = parseFloat(vol);
  } catch (e) {
    console.warn('Failed to parse local state', e);
  }
}

// ── DOM References ────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const els = {
  trackGrid:       $('trackGrid'),
  skeletonGrid:    $('skeletonGrid'),
  playerBar:       $('playerBar'),
  playerThumb:     $('playerThumb'),
  playerTitle:     $('playerTitle'),
  playerArtist:    $('playerArtist'),
  playBtn:         $('playBtn'),
  prevBtn:         $('prevBtn'),
  nextBtn:         $('nextBtn'),
  shuffleBtn:      $('shuffleBtn'),
  loopBtn:         $('loopBtn'),
  muteBtn:         $('muteBtn'),
  heartBtn:        $('heartBtn'),
  volumeSlider:    $('volumeSlider'),
  progressTrack:   $('progressTrack'),
  progressFill:    $('progressFill'),
  progressThumb:   $('progressThumb'),
  progressBuffer:  $('progressBuffer'),
  currentTime:     $('currentTime'),
  totalTime:       $('totalTime'),
  waveformCanvas:  $('waveformCanvas'),
  miniViz:         $('miniViz'),
  heroTitle:       $('heroTitle'),
  heroSubtitle:    $('heroSubtitle'),
  heroPlayBtn:     $('heroPlayBtn'),
  heroVideo:       $('heroVideo'),
  heroVisual:      $('heroVisual'),
  trackCount:      $('trackCount'),
  genreTags:       $('genreTags'),
  bgLayer:         $('bgLayer'),
  appHeader:       $('appHeader'),
  particleCanvas:  $('particleCanvas'),
  fullscreenBtn:   $('fullscreenBtn'),
  resetBtn:        $('resetBtn'),
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function formatTime(seconds) {
  if (isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function getTrackById(id) {
  return TRACKS.find(t => t.id === id);
}

function getTrackIndex(id) {
  return TRACKS.findIndex(t => t.id === id);
}

function getFilteredTracks() {
  if (state.activeGenre === 'all') return TRACKS;
  return TRACKS.filter(t => t.genre === state.activeGenre);
}

// ── Gallery Rendering ─────────────────────────────────────────────────────────
function renderGallery(tracks) {
  els.trackGrid.innerHTML = '';
  els.trackCount.textContent = `${tracks.length} track${tracks.length !== 1 ? 's' : ''}`;

  tracks.forEach((track, index) => {
    const card = createTrackCard(track, index + 1);
    els.trackGrid.appendChild(card);
  });

  if (state.currentTrackId) {
    updatePlayingCard(state.currentTrackId);
  }

  // Always append the "add new" card at the end
  els.trackGrid.appendChild(createAddCard());
}

// ── Add New Card ──────────────────────────────────────────────────────────────
function createAddCard() {
  const card = document.createElement('div');
  card.className = 'track-card add-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', '新しいトラックを追加');
  card.title = 'クリックまたはドラッグ&amp;ドロップで追加';

  card.innerHTML = `
    <div class="add-card-inner">
      <div class="add-card-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <p class="add-card-label">新しいトラックを追加</p>
      <p class="add-card-sub">クリック、またはドラッグ&amp;ドロップ</p>
      <p class="add-card-sub">MP4 / 動画ファイル対応 ・ 複数同時追加可</p>
    </div>
    <div class="add-card-drop-hint">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
        <polyline points="8 17 12 21 16 17"/>
        <line x1="12" y1="12" x2="12" y2="21"/>
        <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
      </svg>
      <span>ここにドロップ</span>
    </div>
    <div class="card-upload-overlay add-loading">
      <div class="card-upload-spinner"></div>
      <span class="card-upload-label">読み込み中…</span>
    </div>
  `;

  const overlay  = card.querySelector('.add-loading');
  const dropHint = card.querySelector('.add-card-drop-hint');

  // ── File processing (shared between click & drop) ──
  function processFiles(files) {
    if (!files || !files.length) return;
    const videoFiles = Array.from(files).filter(f => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name));
    if (!videoFiles.length) {
      showToast('動画ファイルを選択してください', 'error');
      return;
    }
    overlay.classList.add('active');
    setTimeout(() => {
      videoFiles.forEach(file => addNewTrack(file));
      overlay.classList.remove('active');
      renderGenreTags();
      renderGallery(getFilteredTracks());
      showToast(`${videoFiles.length}件のトラックを追加しました`, 'success');
    }, 80);
  }

  // ── Click to open file picker ──
  function triggerFilePicker() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/mp4,video/*';
    input.multiple = true;
    // iOSでfile inputがGCされないようbodyに追加してから削除
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', () => {
      processFiles(input.files);
      // 少し遅延させてからDOMを削除（iOSで安全に）
      setTimeout(() => {
        if (input.parentNode) input.parentNode.removeChild(input);
      }, 1000);
    });
    // タップイベント後すぐにクリックを発火
    requestAnimationFrame(() => input.click());
  }

  card.addEventListener('click',  triggerFilePicker);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); triggerFilePicker(); }
  });

  // ── Drag & Drop on the card itself ──
  card.addEventListener('dragover', e => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.add('drag-over');
  });

  card.addEventListener('dragleave', e => {
    // Only remove if leaving the card entirely (not into a child)
    if (!card.contains(e.relatedTarget)) {
      card.classList.remove('drag-over');
    }
  });

  card.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    card.classList.remove('drag-over');
    processFiles(e.dataTransfer.files);
  });

  return card;
}

function addNewTrack(file) {
  const blobUrl  = URL.createObjectURL(file);
  const rawName  = file.name.replace(/\.[^/.]+$/, '');
  const title    = rawName.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const newId    = Date.now() + Math.floor(Math.random() * 1000);

  const GENRES   = ['electronic', 'ambient', 'cinematic', 'lofi', 'synthwave'];
  const COLORS   = ['#8b5cf6', '#06b6d4', '#ec4899', '#10b981', '#f59e0b', '#a78bfa', '#38bdf8'];

  const newTrack = {
    id:        newId,
    title:     title,
    artist:    'Unknown Artist',
    genre:     GENRES[Math.floor(Math.random() * GENRES.length)],
    duration:  '--:--',
    video_url: blobUrl,
    thumbnail: blobUrl,
    color:     COLORS[Math.floor(Math.random() * COLORS.length)],
  };

  TRACKS.push(newTrack);
  saveTrackToDB(newTrack, file);
}

function createTrackCard(track, num) {
  const card = document.createElement('div');
  card.className = `track-card${track.id === state.currentTrackId ? ' playing' : ''}`;
  card.dataset.id = track.id;
  card.setAttribute('role', 'article');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${track.title} by ${track.artist}`);
  card.style.animationDelay = `${(num - 1) * 0.05}s`;

  card.innerHTML = `
    <div class="track-card-video-wrap">
      <video
        data-src="${track.video_url}"
        muted
        loop
        playsinline
        webkit-playsinline
        preload="none"
        tabindex="-1"
      ></video>
      <div class="track-card-overlay"></div>
      <div class="track-card-play-btn">
        ${track.id === state.currentTrackId && state.isPlaying
          ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
          : `<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>`
        }
      </div>
      <div class="track-card-badge">${track.id === state.currentTrackId ? '▶ Playing' : ''}</div>
      <div class="track-card-number">${String(num).padStart(2, '0')}</div>

      <!-- ⋯ Menu -->
      <button class="card-menu-btn" aria-label="Track options" title="Options">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5"  r="2"/>
          <circle cx="12" cy="12" r="2"/>
          <circle cx="12" cy="19" r="2"/>
        </svg>
      </button>

      <!-- Dropdown -->
      <div class="card-dropdown" role="menu">
        <button class="card-dropdown-item" data-action="upload" role="menuitem">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          MP4をアップロード
        </button>
        <div class="card-dropdown-divider"></div>
        <button class="card-dropdown-item danger" data-action="delete" role="menuitem">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
          このカードを削除
        </button>
      </div>

      <!-- Upload progress overlay -->
      <div class="card-upload-overlay">
        <div class="card-upload-spinner"></div>
        <span class="card-upload-label">読み込み中…</span>
      </div>
    </div>
    <div class="track-card-info">
      <div class="track-card-title">${escapeHtml(track.title)}</div>
      <div class="track-card-artist">${escapeHtml(track.artist)}</div>
      <div class="track-card-footer">
        <span class="track-card-genre">${track.genre}</span>
        <div style="display:flex;align-items:center;gap:10px;">
          ${track.id === state.currentTrackId && state.isPlaying
            ? `<div class="card-eq"><span></span><span></span><span></span><span></span><span></span></div>`
            : `<span class="track-card-duration">${track.duration}</span>`
          }
        </div>
      </div>
    </div>
  `;

  // ── DOM refs within card ────────────────────────
  const vid            = card.querySelector('video');
  const menuBtn        = card.querySelector('.card-menu-btn');
  const dropdown       = card.querySelector('.card-dropdown');
  const uploadOverlay  = card.querySelector('.card-upload-overlay');

  // ── Intersection Observer: ビューポート内でload() ──
  const observer = new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const dataSrc = vid.dataset.src;
        if (dataSrc && !vid.src) {
          vid.src = dataSrc;
          vid.load();
        }
        obs.unobserve(vid);
      }
    });
  }, { rootMargin: '200px' });
  observer.observe(vid);

  // ── Dropdown open/close ─────────────────────────
  let dropdownOpen = false;

  function openDropdown(e) {
    e.stopPropagation();
    // 他のドロップダウンを先に閉じる
    document.querySelectorAll('.card-dropdown.open').forEach(d => {
      d.classList.remove('open');
    });
    dropdownOpen = true;
    dropdown.classList.add('open');
  }

  function closeDropdown() {
    dropdownOpen = false;
    dropdown.classList.remove('open');
  }

  menuBtn.addEventListener('click', e => {
    if (dropdownOpen) { closeDropdown(); } else { openDropdown(e); }
  });

  // Close on outside click
  document.addEventListener('click', e => {
    if (dropdownOpen && !dropdown.contains(e.target) && e.target !== menuBtn) {
      closeDropdown();
    }
  });


  // ── Dropdown action items ───────────────────────
  dropdown.querySelectorAll('.card-dropdown-item').forEach(item => {
    item.addEventListener('click', e => {
      e.stopPropagation();
      closeDropdown();
      const action = item.dataset.action;
      if (action === 'delete') {
        deleteTrack(track.id);
      } else if (action === 'upload') {
        triggerUpload(track.id, uploadOverlay, vid);
      }
    });
  });

  // ── Hover: play video preview ───────────────────
  card.addEventListener('mouseenter', () => {
    if (track.id !== state.currentTrackId) {
      vid.play().catch(() => {});
    }
  });

  card.addEventListener('mouseleave', () => {
    if (track.id !== state.currentTrackId) {
      vid.pause();
      vid.currentTime = 0;
    }
  });

  // ── Click: select track (ignore menu clicks) ────
  card.addEventListener('click', e => {
    if (e.target.closest('.card-menu-btn') || e.target.closest('.card-dropdown')) return;
    playTrack(track.id);
  });

  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (document.activeElement === card) {
        e.preventDefault();
        playTrack(track.id);
      }
    }
  });

  return card;
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function updatePlayingCard(id) {
  document.querySelectorAll('.track-card').forEach(card => {
    const isPlaying = parseInt(card.dataset.id) === id;
    card.classList.toggle('playing', isPlaying);
  });
}

// ── Delete Track ──────────────────────────────────────────────────────────────
function deleteTrack(id) {
  const idx = TRACKS.findIndex(t => t.id === id);
  if (idx === -1) return;

  const wasPlaying = state.currentTrackId === id;

  // Revoke blob URL to free memory
  if (TRACKS[idx].video_url && TRACKS[idx].video_url.startsWith('blob:')) {
    URL.revokeObjectURL(TRACKS[idx].video_url);
  }

  TRACKS.splice(idx, 1);
  deleteTrackFromDB(id);

  // If the deleted track was playing, stop everything
  if (wasPlaying) {
    els.heroVideo.pause();
    els.heroVideo.src = '';
    els.playerThumb.src = '';
    els.heroVideo.src = '';
    state.currentTrackId = null;
    state.isPlaying = false;
    updatePlayIcon(false);
    els.playerBar.classList.remove('visible');
    els.miniViz.classList.remove('active');
  }

  renderGenreTags();
  renderGallery(getFilteredTracks());
  showToast('トラックを削除しました', 'success');
}

// ── Upload / Replace Track MP4 ────────────────────────────────────────────────
function triggerUpload(trackId, overlayEl, cardVideoEl) {
  // Create a hidden file input and trigger it
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/*';
  // iOSでGCされないようbodyに追加
  input.style.display = 'none';
  document.body.appendChild(input);

  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;

    // Show loading overlay
    overlayEl.classList.add('active');

    // Small timeout to let the browser render the overlay first
    setTimeout(() => {
      // Revoke old blob URL if any
      const track = getTrackById(trackId);
      if (!track) { overlayEl.classList.remove('active'); return; }

      if (track.video_url && track.video_url.startsWith('blob:')) {
        URL.revokeObjectURL(track.video_url);
      }

      const blobUrl = URL.createObjectURL(file);

      // Extract filename without extension as new title
      const rawName = file.name.replace(/\.[^/.]+$/, '');
      const cleanName = rawName.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      // Update track data
      track.video_url  = blobUrl;
      track.thumbnail  = blobUrl;
      track.title      = cleanName;
      // Keep artist, genre, color as-is

      saveTrackToDB(track, file);

      // Update card video element immediately
      cardVideoEl.src = blobUrl;
      cardVideoEl.load();

      // If this track is currently playing, update the player
      if (state.currentTrackId === trackId) {
        const curTime = els.heroVideo.currentTime;
        els.heroVideo.src = blobUrl;
        els.heroVideo.currentTime = 0;
        els.playerThumb.src = blobUrl;
        els.heroVideo.src = blobUrl;
        els.playerTitle.textContent = track.title;
        if (state.isPlaying) els.heroVideo.play().catch(() => {});
      }

      // Hide overlay and refresh gallery
      overlayEl.classList.remove('active');
      renderGallery(getFilteredTracks());
      showToast(`「${cleanName}」を読み込みました`, 'success');
    }, 80);
  });

  requestAnimationFrame(() => input.click());
  setTimeout(() => {
    if (input.parentNode) input.parentNode.removeChild(input);
  }, 60000);
}

// ── Toast Notification ────────────────────────────────────────────────────────
let toastTimer = null;

function showToast(msg, type = '') {
  let toast = document.getElementById('appToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'appToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  // Clear previous type classes
  toast.classList.remove('success', 'error');
  if (type) toast.classList.add(type);

  toast.textContent = msg;

  // Animate in
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-dismiss
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

// ── Playback ──────────────────────────────────────────────────────────────────
function playTrack(id) {
  const track = getTrackById(id);
  if (!track) return;

  const wasPlaying = state.currentTrackId === id;

  if (wasPlaying) {
    togglePlayPause();
    return;
  }

  state.currentTrackId = id;
  state.isPlaying = true;

  // Update hero video (main playback)
  els.heroVideo.src = track.video_url;
  els.heroVideo.volume = state.volume;
  els.heroVideo.muted = state.isMuted;
  els.heroVideo.loop = state.isLooping;
  // iOSインライン再生を強制（動的に属性を付与）
  els.heroVideo.setAttribute('playsinline', '');
  els.heroVideo.setAttribute('webkit-playsinline', '');

  // Update player thumb
  els.playerThumb.src = track.video_url;
  els.playerThumb.muted = true;
  els.playerThumb.loop = true;
  els.playerThumb.setAttribute('playsinline', '');
  els.playerThumb.setAttribute('webkit-playsinline', '');

  // Smooth fade in player
  els.playerBar.classList.add('visible');

  // Update player metadata
  els.playerTitle.textContent = track.title;
  els.playerArtist.textContent = track.artist;
  els.heroTitle.innerHTML = `${escapeHtml(track.title)}<br/><span class="gradient-text">${escapeHtml(track.artist)}</span>`;
  els.heroSubtitle.textContent = `Genre: ${track.genre.charAt(0).toUpperCase() + track.genre.slice(1)}`;

  // Mini visualizer
  els.miniViz.classList.add('active');

  // Update gallery
  renderGallery(getFilteredTracks());

  // Play
  els.heroVideo.play().then(() => {
    els.playerThumb.play().catch(() => {});
    updatePlayIcon(true);
    updateHeartButton();
  }).catch(err => {
    console.warn('Autoplay blocked:', err);
    state.isPlaying = false;
    updatePlayIcon(false);
  });

  // Accent color from track
  updateAccentColor('#38bdf8');
}

function togglePlayPause() {
  if (!state.currentTrackId) return;

  if (state.isPlaying) {
    els.heroVideo.pause();
    els.playerThumb.pause();
    state.isPlaying = false;
    els.miniViz.classList.remove('active');
    updatePlayIcon(false);
  } else {
    els.heroVideo.play().then(() => {
      els.playerThumb.play().catch(() => {});
      state.isPlaying = true;
      els.miniViz.classList.add('active');
      updatePlayIcon(true);
    }).catch(() => {});
  }

  // スクロール位置リセットを防ぐため、全再描画ではなくカードアイコンのみ更新
  updateCardPlayState();
}

// ── カードのプレイ状態アイコンを軽量更新（スクロール維持）────────────────
function updateCardPlayState() {
  document.querySelectorAll('.track-card[data-id]').forEach(card => {
    const id = parseInt(card.dataset.id);
    const isCurrent = id === state.currentTrackId;
    card.classList.toggle('playing', isCurrent);

    const playBtn = card.querySelector('.track-card-play-btn');
    if (playBtn) {
      if (isCurrent && state.isPlaying) {
        playBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
      } else {
        playBtn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M5 3l14 9-14 9V3z"/></svg>`;
      }
    }

    const badge = card.querySelector('.track-card-badge');
    if (badge) badge.textContent = isCurrent ? '▶ Playing' : '';

    const footer = card.querySelector('.track-card-footer > div');
    if (footer && isCurrent) {
      if (state.isPlaying) {
        footer.innerHTML = `<div class="card-eq"><span></span><span></span><span></span><span></span><span></span></div>`;
      } else {
        const track = getTrackById(id);
        footer.innerHTML = `<span class="track-card-duration">${track ? track.duration : '--:--'}</span>`;
      }
    } else if (footer && !isCurrent) {
      const track = getTrackById(id);
      footer.innerHTML = `<span class="track-card-duration">${track ? track.duration : '--:--'}</span>`;
    }
  });
}

function updatePlayIcon(playing) {
  const iconPlay  = els.playBtn.querySelector('.icon-play');
  const iconPause = els.playBtn.querySelector('.icon-pause');
  if (playing) {
    iconPlay.style.display = 'none';
    iconPause.style.display = 'block';
  } else {
    iconPlay.style.display = 'block';
    iconPause.style.display = 'none';
  }
}

function playNext() {
  const filtered = getFilteredTracks();
  if (!filtered.length) return;

  if (state.isShuffling) {
    let randomId;
    do { randomId = filtered[Math.floor(Math.random() * filtered.length)].id; }
    while (randomId === state.currentTrackId && filtered.length > 1);
    playTrack(randomId);
    return;
  }

  const idx = filtered.findIndex(t => t.id === state.currentTrackId);
  const nextIdx = (idx + 1) % filtered.length;
  playTrack(filtered[nextIdx].id);
}

function playPrev() {
  const filtered = getFilteredTracks();
  if (!filtered.length) return;

  // If past 3 seconds, restart current
  if (els.heroVideo.currentTime > 3) {
    els.heroVideo.currentTime = 0;
    return;
  }

  const idx = filtered.findIndex(t => t.id === state.currentTrackId);
  const prevIdx = (idx - 1 + filtered.length) % filtered.length;
  playTrack(filtered[prevIdx].id);
}

// ── Progress & Time ───────────────────────────────────────────────────────────
function updateProgress() {
  const vid = els.heroVideo;
  if (!vid.duration || isNaN(vid.duration)) return;

  const pct = (vid.currentTime / vid.duration) * 100;
  state.currentTime = vid.currentTime;
  state.duration = vid.duration;

  els.progressFill.style.width = pct + '%';
  els.progressThumb.style.left = pct + '%';
  els.currentTime.textContent = formatTime(vid.currentTime);
  els.totalTime.textContent = formatTime(vid.duration);

  // Buffer
  if (vid.buffered.length > 0) {
    const bufPct = (vid.buffered.end(vid.buffered.length - 1) / vid.duration) * 100;
    els.progressBuffer.style.width = bufPct + '%';
  }

  // Update ARIA
  els.progressTrack.setAttribute('aria-valuenow', Math.round(pct));
}

function seekTo(e) {
  const rect = els.progressTrack.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
  const pct = x / rect.width;
  if (els.heroVideo.duration) {
    els.heroVideo.currentTime = pct * els.heroVideo.duration;
  }
}

// ── Volume ────────────────────────────────────────────────────────────────────
function updateVolume(val) {
  state.volume = val / 100;
  els.heroVideo.volume = state.volume;
  els.volumeSlider.value = val;

  // Volume slider gradient
  const pct = val;
  els.volumeSlider.style.background = `linear-gradient(to right, #8b5cf6 ${pct}%, rgba(255,255,255,0.12) ${pct}%)`;

  saveStateToLocal();
}

function toggleMute() {
  state.isMuted = !state.isMuted;
  els.heroVideo.muted = state.isMuted;

  const iconVol  = els.muteBtn.querySelector('.icon-vol');
  const iconMute = els.muteBtn.querySelector('.icon-mute');

  if (state.isMuted) {
    iconVol.style.display = 'none';
    iconMute.style.display = 'block';
    els.muteBtn.style.color = 'var(--accent-pink)';
  } else {
    iconVol.style.display = 'block';
    iconMute.style.display = 'none';
    els.muteBtn.style.color = '';
  }
}

// ── Accent Color ──────────────────────────────────────────────────────────────
function updateAccentColor(color) {
  // Convert hex to rgb
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);

  document.documentElement.style.setProperty('--accent-purple', color);
  document.documentElement.style.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);

  // Animate bg layer color
  const bgLayer = els.bgLayer;
  bgLayer.style.transition = 'filter 1.5s ease, opacity 1.5s ease';
  bgLayer.style.opacity = '0.22';
}

// ── Like / Heart ──────────────────────────────────────────────────────────────
function updateHeartButton() {
  if (!state.currentTrackId) return;
  const liked = state.likedTracks.has(state.currentTrackId);
  els.heartBtn.classList.toggle('liked', liked);
}

function toggleLike() {
  if (!state.currentTrackId) return;
  if (state.likedTracks.has(state.currentTrackId)) {
    state.likedTracks.delete(state.currentTrackId);
  } else {
    state.likedTracks.add(state.currentTrackId);

    // Heart animation
    els.heartBtn.style.transform = 'scale(1.4)';
    setTimeout(() => { els.heartBtn.style.transform = ''; }, 300);
  }
  updateHeartButton();
  saveStateToLocal();
}

// ── Waveform Visualizer Canvas ────────────────────────────────────────────────
function initWaveformCanvas() {
  const canvas = els.waveformCanvas;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width  = canvas.offsetWidth  * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  resize();
  window.addEventListener('resize', resize);

  const BARS = 80;

  function drawWaveform() {
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    ctx.clearRect(0, 0, w, h);

    if (!state.isPlaying) {
      requestAnimationFrame(drawWaveform);
      return;
    }

    state.waveformPhase += 0.04;

    const barW = w / BARS;
    const mid  = h / 2;

    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0,   'rgba(139, 92, 246, 0.8)');
    gradient.addColorStop(0.5, 'rgba(6, 182, 212, 0.8)');
    gradient.addColorStop(1,   'rgba(236, 72, 153, 0.8)');

    ctx.fillStyle = gradient;

    for (let i = 0; i < BARS; i++) {
      const x = i * barW;
      const freq = Math.sin(i * 0.2 + state.waveformPhase) * 0.5
                 + Math.sin(i * 0.05 + state.waveformPhase * 0.7) * 0.3
                 + Math.sin(i * 0.4 + state.waveformPhase * 1.3) * 0.2;

      const amplitudeBase = 0.35 + 0.65 * Math.abs(freq);
      const amplitude = mid * amplitudeBase * 0.85;

      ctx.beginPath();
      ctx.roundRect(x + 0.5, mid - amplitude, barW - 1.5, amplitude * 2, 2);
      ctx.fill();
    }

    requestAnimationFrame(drawWaveform);
  }

  drawWaveform();
}

// ── Particle Canvas ────────────────────────────────────────────────────────────
function initParticles() {
  const canvas = els.particleCanvas;
  const ctx = canvas.getContext('2d');

  let particles = [];
  const PARTICLE_COUNT = 55;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  resize();
  window.addEventListener('resize', resize);

  class Particle {
    constructor() { this.reset(); }
    reset() {
      this.x = Math.random() * canvas.width;
      this.y = Math.random() * canvas.height;
      this.size = Math.random() * 2.5 + 0.5;
      this.speedX = (Math.random() - 0.5) * 0.3;
      this.speedY = -(Math.random() * 0.4 + 0.1);
      this.life = 0;
      this.maxLife = Math.random() * 200 + 100;
      this.color = ['#8b5cf6', '#06b6d4', '#ec4899', '#a78bfa', '#38bdf8'][Math.floor(Math.random() * 5)];
    }
    update() {
      this.x += this.speedX + (state.isPlaying ? (Math.random() - 0.5) * 0.2 : 0);
      this.y += this.speedY;
      this.life++;
      if (this.life >= this.maxLife || this.y < -10) this.reset();
    }
    draw() {
      const alpha = Math.sin((this.life / this.maxLife) * Math.PI) * 0.55;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
      ctx.fillStyle = this.color + Math.floor(alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();
    }
  }

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const p = new Particle();
    p.life = Math.floor(Math.random() * p.maxLife);
    particles.push(p);
  }

  function animateParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => { p.update(); p.draw(); });
    requestAnimationFrame(animateParticles);
  }

  animateParticles();
}

// ── Genre Filter ──────────────────────────────────────────────────────────────
function renderGenreTags() {
  const allGenres = new Set(TRACKS.map(t => t.genre));
  
  if (state.activeGenre !== 'all' && !allGenres.has(state.activeGenre)) {
    state.activeGenre = 'all';
  }
  
  let html = `<button class="genre-tag ${state.activeGenre === 'all' ? 'active' : ''}" data-genre="all" role="listitem">All</button>`;
  
  const uniqueGenres = Array.from(allGenres).sort();
  for (const genre of uniqueGenres) {
    const isActive = state.activeGenre === genre ? 'active' : '';
    const label = genre.charAt(0).toUpperCase() + genre.slice(1);
    html += `<button class="genre-tag ${isActive}" data-genre="${genre}" role="listitem">${label}</button>`;
  }
  
  els.genreTags.innerHTML = html;
}

function initGenreFilter() {
  els.genreTags.addEventListener('click', e => {
    const btn = e.target.closest('.genre-tag');
    if (!btn) return;
    
    els.genreTags.querySelectorAll('.genre-tag').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    state.activeGenre = btn.dataset.genre;
    renderGallery(getFilteredTracks());
  });
  renderGenreTags();
}

// ── Search ─────────────────────────────────────────────────────────────────────
function initSearch() {
  const input = $('searchInput');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      renderGallery(getFilteredTracks());
      return;
    }
    const results = TRACKS.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.artist.toLowerCase().includes(q) ||
      t.genre.toLowerCase().includes(q)
    );
    els.trackGrid.innerHTML = '';
    els.trackCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;
    results.forEach((track, i) => {
      const card = createTrackCard(track, i + 1);
      els.trackGrid.appendChild(card);
    });
  });
}

// ── Scroll Header ─────────────────────────────────────────────────────────────
function initScrollHeader() {
  window.addEventListener('scroll', () => {
    els.appHeader.classList.toggle('scrolled', window.scrollY > 24);
  });
}

// ── Fullscreen Modal ──────────────────────────────────────────────────────────


// ── Progress Drag ─────────────────────────────────────────────────────────────
function initProgressDrag() {
  const track = els.progressTrack;

  track.addEventListener('mousedown', e => {
    state.isDragging = true;
    seekTo(e);
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (state.isDragging) seekTo(e);
  });

  document.addEventListener('mouseup', () => {
    state.isDragging = false;
  });

  // Touch support
  track.addEventListener('touchstart', e => {
    state.isDragging = true;
    seekTo(e.touches[0]);
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (state.isDragging) seekTo(e.touches[0]);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    state.isDragging = false;
  });

  // Keyboard seek
  track.addEventListener('keydown', e => {
    const dur = els.heroVideo.duration;
    if (!dur) return;
    if (e.key === 'ArrowLeft')  els.heroVideo.currentTime = Math.max(0, els.heroVideo.currentTime - 5);
    if (e.key === 'ArrowRight') els.heroVideo.currentTime = Math.min(dur, els.heroVideo.currentTime + 5);
  });
}

// ── Keyboard Shortcuts ─────────────────────────────────────────────────────────
function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const tag = document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (els.heroVideo.duration) els.heroVideo.currentTime = Math.min(els.heroVideo.duration, els.heroVideo.currentTime + 10);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        els.heroVideo.currentTime = Math.max(0, els.heroVideo.currentTime - 10);
        break;
      case 'ArrowUp':
        e.preventDefault();
        updateVolume(Math.min(100, state.volume * 100 + 10));
        break;
      case 'ArrowDown':
        e.preventDefault();
        updateVolume(Math.max(0, state.volume * 100 - 10));
        break;
      case 'KeyN':
        playNext();
        break;
      case 'KeyM':
        toggleMute();
        break;
      case 'KeyF':
        window.toggleHeroFullscreen();
        break;
      
    }
  });
}

// ── Init App ───────────────────────────────────────────────────────────────────
async function initApp() {
  loadStateFromLocal();

  try {
    const isInit = localStorage.getItem('vibe_db_init');
    if (!isInit) {
      for (const t of TRACKS) await saveTrackToDB(t, null);
      localStorage.setItem('vibe_db_init', 'true');
    } else {
      const savedTracks = await loadTracksFromDB();
      if (savedTracks && savedTracks.length > 0) {
        TRACKS = savedTracks.map(t => {
          if (t.fileBlob) {
            const blobUrl = URL.createObjectURL(t.fileBlob);
            return { ...t, video_url: blobUrl, thumbnail: blobUrl };
          }
          return t;
        });
      }
    }
  } catch (err) {
    console.warn("Could not load from DB", err);
  }

  // Show skeleton briefly then render
  setTimeout(() => {
    els.skeletonGrid.style.display = 'none';
    renderGallery(TRACKS);
  }, 0);

  // Setup hero
  els.heroPlayBtn.addEventListener('click', () => {
    if (state.currentTrackId) {
      togglePlayPause();
    } else {
      playTrack(TRACKS[0].id);
    }
  });

  // Playback controls
  els.playBtn.addEventListener('click',    togglePlayPause);
  els.prevBtn.addEventListener('click',    playPrev);
  els.nextBtn.addEventListener('click',    playNext);
  els.heartBtn.addEventListener('click',   toggleLike);
  els.muteBtn.addEventListener('click',    toggleMute);
  
  // Fullscreen modal backdrop close
  
  // Loop button
  els.loopBtn.addEventListener('click', () => {
    state.isLooping = !state.isLooping;
    els.heroVideo.loop = state.isLooping;
    els.loopBtn.classList.toggle('active', state.isLooping);
  });

  // Shuffle button
  els.shuffleBtn.addEventListener('click', () => {
    state.isShuffling = !state.isShuffling;
    els.shuffleBtn.classList.toggle('active', state.isShuffling);
  });

  // Volume
  els.volumeSlider.addEventListener('input', e => updateVolume(parseInt(e.target.value)));

  // Reset button
  if (els.resetBtn) {
    els.resetBtn.addEventListener('click', resetToDefault);
  }

  // Initialize volume display
  updateVolume(Math.round(state.volume * 100));

  // Video events
  const vid = els.heroVideo;

  vid.addEventListener('timeupdate',  updateProgress);
  vid.addEventListener('loadedmetadata', () => {
    els.totalTime.textContent = formatTime(vid.duration);
    state.duration = vid.duration;
  });

  vid.addEventListener('ended', () => {
    if (!state.isLooping) {
      playNext();
    }
  });

  vid.addEventListener('play', () => {
    state.isPlaying = true;
    updatePlayIcon(true);
    els.miniViz.classList.add('active');
  });

  vid.addEventListener('pause', () => {
    // フルスクリーン操作中のpauseイベントは無視する
    // （iOS/Androidでフルスクリーン解除時に一時的にpauseが発火するため）
    if (state._fullscreenTransition) return;
    state.isPlaying = false;
    updatePlayIcon(false);
    els.miniViz.classList.remove('active');
  });

  vid.addEventListener('error', () => {
    console.warn('Video error, skipping to next...');
    setTimeout(playNext, 1000);
  });

  // Init subsystems
  initProgressDrag();
  initGenreFilter();
  initSearch();
  initScrollHeader();
  initKeyboardShortcuts();
  initWaveformCanvas();
  initParticles();
  initPageDrop();
  initAspectSwitcher();
  initHeroFullscreen();



  // Initial volume gradient
  updateVolume(Math.round(state.volume * 100));

  console.log('🎵 VIBE Player ready — %c press Space to play', 'color: #8b5cf6; font-weight: bold');
}

// Start
document.addEventListener('DOMContentLoaded', initApp);

// ── Reset to Default ──────────────────────────────────────────────────────
async function resetToDefault() {
  const confirmed = confirm(
    '\u30e9イブラリをデフォルトに戻しますか？\n\n• 追加したすべてのトラックが削除されます\n• デフォルトのトラック 1 件のみの状態に戻ります'
  );
  if (!confirmed) return;

  try {
    // IndexedDB のトラックストアを全クリア
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('DB clear error:', e);
  }

  // LocalStorage のリセット（初期化フラグも削除することでデフォルトトラックが再登録される）
  localStorage.removeItem('vibe_db_init');
  localStorage.removeItem('vibe_likes');
  localStorage.removeItem('vibe_volume');

  // ページをリロードしてデフォルト状態で起動
  location.reload();
}

// ── Aspect Ratio Switcher ──────────────────────────────────────────────────────
function initAspectSwitcher() {
  const heroVisual = els.heroVisual;
  const heroVideoWrapper = document.getElementById('heroVideoWrapper');
  const buttons = document.querySelectorAll('.aspect-btn');

  const ASPECT_CLASSES = ['aspect-landscape', 'aspect-square', 'aspect-portrait'];

  // Initialize wrapper with the active aspect
  const activeBtn = document.querySelector('.aspect-btn.active');
  if (activeBtn && heroVideoWrapper) {
    heroVideoWrapper.classList.add(`aspect-${activeBtn.dataset.aspect}`);
  }

  function setAspect(aspect) {
    // Remove all aspect classes
    ASPECT_CLASSES.forEach(cls => {
      heroVisual.classList.remove(cls);
      if (heroVideoWrapper) heroVideoWrapper.classList.remove(cls);
    });

    // Add the selected class
    heroVisual.classList.add(`aspect-${aspect}`);
    if (heroVideoWrapper) heroVideoWrapper.classList.add(`aspect-${aspect}`);

    // Update button states
    buttons.forEach(btn => {
      const isActive = btn.dataset.aspect === aspect;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => setAspect(btn.dataset.aspect));
  });
}


// ── Hero Video Fullscreen ──────────────────────────────────────────────────────
function initHeroFullscreen() {
  const wrapper  = document.getElementById('heroVideoWrapper');
  const fsBtn    = document.getElementById('heroFsBtn');
  const heroVid  = document.getElementById('heroVideo');
  if (!wrapper || !fsBtn) return;

  const iconExpand   = fsBtn.querySelector('.hero-fs-icon-expand');
  const iconCompress = fsBtn.querySelector('.hero-fs-icon-compress');

  // iOSかどうかを判定
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // ── フルスクリーン ON/OFF トグル ──
  window.toggleHeroFullscreen = function() {
    const fsEl = document.fullscreenElement
               || document.webkitFullscreenElement
               || document.mozFullScreenElement
               || document.msFullscreenElement;

    if (!fsEl) {
      // iOS Safari: divへのfullscreenAPIは非対応のため video.webkitEnterFullscreen() を使う
      if (isIOS && heroVid && heroVid.webkitEnterFullscreen) {
        heroVid.webkitEnterFullscreen();
        return;
      }

      // フルスクリーンに入る（その他ブラウザ）
      const req = wrapper.requestFullscreen
               || wrapper.webkitRequestFullscreen
               || wrapper.mozRequestFullScreen
               || wrapper.msRequestFullscreen;
      if (req) {
        req.call(wrapper).catch(err => {
          // フォールバック: video 要素で試みる
          if (heroVid && heroVid.webkitEnterFullscreen) {
            heroVid.webkitEnterFullscreen();
          } else {
            console.warn('Fullscreen request failed:', err);
          }
        });
      } else if (heroVid && heroVid.webkitEnterFullscreen) {
        // APIが存在しない場合のフォールバック
        heroVid.webkitEnterFullscreen();
      }
    } else {
      // フルスクリーンを終了
      const exit = document.exitFullscreen
                || document.webkitExitFullscreen
                || document.mozCancelFullScreen
                || document.msExitFullscreen;
      if (exit) exit.call(document);
    }
  };

  // ── アイコン切り替え ──
  function updateFsIcon(isFs) {
    if (isFs) {
      iconExpand.style.display   = 'none';
      iconCompress.style.display = 'block';
      fsBtn.setAttribute('aria-label', 'フルスクリーンを終了');
      fsBtn.title = 'フルスクリーンを終了 (Esc)';
    } else {
      iconExpand.style.display   = 'block';
      iconCompress.style.display = 'none';
      fsBtn.setAttribute('aria-label', 'フルスクリーン表示');
      fsBtn.title = 'フルスクリーン (F)';
    }
  }

  // ── イベント: ボタンクリック ──
  fsBtn.addEventListener('click', e => {
    e.stopPropagation();
    window.toggleHeroFullscreen();
  });

  // ── イベント: ボトムバーのフルスクリーンボタン ──
  if (els.fullscreenBtn) {
    els.fullscreenBtn.addEventListener('click', e => {
      e.stopPropagation();
      window.toggleHeroFullscreen();
    });
  }

  // ── イベント: ダブルタップ/クリックでもフルスクリーン ──
  wrapper.addEventListener('dblclick', window.toggleHeroFullscreen);

  // ── iOS: video.webkitEnterFullscreen() 時のイベント ──
  if (heroVid) {
    heroVid.addEventListener('webkitbeginfullscreen', () => {
      updateFsIcon(true);
      wrapper.classList.add('is-fullscreen');
      // フルスクリーン移行中フラグをセット
      state._fullscreenTransition = true;
    });
    heroVid.addEventListener('webkitendfullscreen', () => {
      updateFsIcon(false);
      wrapper.classList.remove('is-fullscreen');
      // フルスクリーン解除後に再生を継続する
      // （iOSはフルスクリーン解除時にvideoをpauseすることがある）
      const wasPlaying = state.isPlaying;
      state._fullscreenTransition = true;
      setTimeout(() => {
        state._fullscreenTransition = false;
        if (wasPlaying && heroVid.paused && state.currentTrackId) {
          heroVid.play().catch(() => {});
        }
      }, 300);
    });
  }

  // ── イベント: フルスクリーン状態変化を検知（非iOS） ──
  const fsChangeEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
  fsChangeEvents.forEach(ev => {
    document.addEventListener(ev, () => {
      const isFs = !!(
        document.fullscreenElement
        || document.webkitFullscreenElement
        || document.mozFullScreenElement
        || document.msFullscreenElement
      );
      updateFsIcon(isFs);
      if (isFs) {
        wrapper.classList.add('is-fullscreen');
        state._fullscreenTransition = true;
      } else {
        wrapper.classList.remove('is-fullscreen');
        // フルスクリーン解除後に再生を継続する
        const wasPlaying = state.isPlaying;
        state._fullscreenTransition = true;
        setTimeout(() => {
          state._fullscreenTransition = false;
          if (wasPlaying && heroVid.paused && state.currentTrackId) {
            heroVid.play().catch(() => {});
          }
        }, 300);
      }
    });
  });

  wrapper.addEventListener('mouseenter', () => { wrapper._hovered = true;  });
  wrapper.addEventListener('mouseleave', () => { wrapper._hovered = false; });
}

// ── Page-level Drag & Drop Zone ────────────────────────────────────────────────────

function initPageDrop() {
  // Create full-page drop overlay
  const overlay = document.createElement('div');
  overlay.id = 'pageDrop';
  overlay.className = 'page-drop-overlay';
  overlay.innerHTML = `
    <div class="page-drop-inner">
      <div class="page-drop-icon">
        <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round">
          <polyline points="8 17 12 21 16 17"/>
          <line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>
        </svg>
      </div>
      <p class="page-drop-label">ドロップしてトラックを追加</p>
      <p class="page-drop-sub">MP4 / WebM / MOV 対応 ・ 複数同時追加可</p>
    </div>
  `;
  document.body.appendChild(overlay);

  let dragCounter = 0;  // track enter/leave across child elements

  function hasVideoFile(e) {
    if (!e.dataTransfer) return false;
    const types = Array.from(e.dataTransfer.types || []);
    return types.includes('Files');
  }

  // Show overlay when dragging files over the page
  document.addEventListener('dragenter', e => {
    if (!hasVideoFile(e)) return;
    dragCounter++;
    overlay.classList.add('visible');
  });

  document.addEventListener('dragleave', e => {
    if (!hasVideoFile(e)) return;
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      overlay.classList.remove('visible');
    }
  });

  document.addEventListener('dragover', e => {
    if (hasVideoFile(e)) e.preventDefault();
  });

  document.addEventListener('drop', e => {
    dragCounter = 0;
    overlay.classList.remove('visible');

    // Ignore drops that happened on the add-card itself (already handled there)
    if (e.target.closest('.add-card')) return;

    e.preventDefault();
    const files = e.dataTransfer.files;
    if (!files.length) return;

    const videoFiles = Array.from(files).filter(
      f => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|mkv)$/i.test(f.name)
    );
    if (!videoFiles.length) {
      showToast('動画ファイルをドロップしてください', 'error');
      return;
    }

    videoFiles.forEach(file => addNewTrack(file));
    renderGenreTags();
    renderGallery(getFilteredTracks());
    showToast(`${videoFiles.length}件のトラックを追加しました`, 'success');
  });
}
