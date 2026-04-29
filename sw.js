const CACHE_NAME = 'kyoumei-app-shell-v2';
const MP4_CACHE_NAME = 'kyoumei-mp4-cache-v1';
const MAX_CACHED_VIDEOS = 3;

const APP_SHELL = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/logo.jpg',
  '/kyoumei_logo.png',
  '/mp4logo.png'
];

// Install event: cache app shell
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('Caching app shell');
      return cache.addAll(APP_SHELL);
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(name => {
          if (name !== CACHE_NAME && name !== MP4_CACHE_NAME) {
            console.log('Deleting old cache:', name);
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch event: handle requests
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Handle MP4 videos
  if (url.pathname.endsWith('.mp4')) {
    event.respondWith(handleMp4Request(event.request));
    return;
  }

  // App Shell & other assets: Cache-First strategy
  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then(networkResponse => {
        // Only cache valid responses for same origin or valid assets
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        
        // Optionally cache new assets
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(err => {
        // Offline fallback
        console.warn('Fetch failed, offline mode:', err);
      });
    })
  );
});

// MP4 handling with Range request support and background caching
async function handleMp4Request(request) {
  const cache = await caches.open(MP4_CACHE_NAME);
  const cachedResponse = await cache.match(request.url);

  if (cachedResponse) {
    // If we have it in cache, serve it with range support
    return createRangeResponse(request, cachedResponse);
  }

  // Not in cache. Fetch from network.
  // We trigger a background fetch to cache the full video for offline use,
  // but we immediately serve the network request (which might be a 206 Range request)
  // to prioritize smooth playback.
  fetchAndCacheFullVideo(request.url);
  
  return fetch(request);
}

// Fire-and-forget function to cache the full video
async function fetchAndCacheFullVideo(url) {
  try {
    const cache = await caches.open(MP4_CACHE_NAME);
    const existing = await cache.match(url);
    if (!existing) {
      console.log('Background fetching full MP4 for cache:', url);
      // Fetch without Range header to get the full 200 response
      const fullReq = new Request(url);
      const res = await fetch(fullReq);
      if (res.ok) {
        await cache.put(url, res.clone());
        console.log('Successfully cached full MP4:', url);
        await manageCacheSize(MP4_CACHE_NAME, MAX_CACHED_VIDEOS);
      }
    }
  } catch (err) {
    console.warn('Failed to background cache full video', err);
  }
}

// Convert a full cached response into a 206 Partial Content response
async function createRangeResponse(request, cachedResponse) {
  const rangeHeader = request.headers.get('Range');
  if (!rangeHeader) {
    return cachedResponse;
  }

  const blob = await cachedResponse.blob();
  const size = blob.size;
  const parts = rangeHeader.replace(/bytes=/, "").split("-");
  const start = parseInt(parts[0], 10);
  const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
  const chunk = blob.slice(start, end + 1);

  return new Response(chunk, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunk.size,
      'Content-Type': 'video/mp4'
    }
  });
}

// LRU Cache Eviction Policy for MP4s
async function manageCacheSize(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const requests = await cache.keys();
  
  if (requests.length > maxItems) {
    // Delete the oldest items (at the beginning of the array)
    const itemsToDelete = requests.slice(0, requests.length - maxItems);
    for (const req of itemsToDelete) {
      console.log('Evicting old MP4 from cache:', req.url);
      await cache.delete(req);
    }
  }
}
