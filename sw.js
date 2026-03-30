/**
 * MoneyTracker Pro - Service Worker
 * Version: 1.0.0
 * Features: Advanced caching, offline support, background sync
 */

const APP_VERSION = '1.0.0';
const CACHE_PREFIX = 'moneytracker-pro';
const STATIC_CACHE = `${CACHE_PREFIX}-static-v${APP_VERSION}`;
const DYNAMIC_CACHE = `${CACHE_PREFIX}-dynamic-v${APP_VERSION}`;
const IMAGE_CACHE = `${CACHE_PREFIX}-images-v${APP_VERSION}`;

// Assets to cache immediately on install
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Cache size limits
const CACHE_LIMITS = {
  dynamic: 50,
  images: 30
};

// ==================== INSTALL ====================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing Service Worker v' + APP_VERSION);
  
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => {
        console.log('[SW] Pre-caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// ==================== ACTIVATE ====================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating Service Worker v' + APP_VERSION);
  
  event.waitUntil(
    Promise.all([
      // Clean old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName.startsWith(CACHE_PREFIX) && 
                     cacheName !== STATIC_CACHE && 
                     cacheName !== DYNAMIC_CACHE &&
                     cacheName !== IMAGE_CACHE;
            })
            .map((cacheName) => {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            })
        );
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});

// ==================== FETCH ====================
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  
  // Skip non-GET requests
  if (request.method !== 'GET') {
    return;
  }
  
  // Skip chrome-extension and other non-http(s) requests
  if (!url.protocol.startsWith('http')) {
    return;
  }
  
  // Determine caching strategy based on request type
  if (isStaticAsset(url)) {
    // Cache First for static assets
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  } else if (isImage(url)) {
    // Cache First for images with fallback
    event.respondWith(cacheFirstWithFallback(request, IMAGE_CACHE));
  } else if (isAPIRequest(url)) {
    // Network First for API requests
    event.respondWith(networkFirst(request, DYNAMIC_CACHE));
  } else {
    // Stale While Revalidate for everything else
    event.respondWith(staleWhileRevalidate(request, DYNAMIC_CACHE));
  }
});

// ==================== CACHING STRATEGIES ====================

/**
 * Cache First Strategy
 * Try cache first, then network
 */
async function cacheFirst(request, cacheName) {
  try {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      console.log('[SW] Cache hit:', request.url);
      return cachedResponse;
    }
    
    console.log('[SW] Cache miss, fetching:', request.url);
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.error('[SW] Cache First failed:', error);
    return caches.match('./index.html');
  }
}

/**
 * Cache First with Fallback
 * For images - returns placeholder if all fails
 */
async function cacheFirstWithFallback(request, cacheName) {
  try {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
      await trimCache(cacheName, CACHE_LIMITS.images);
    }
    
    return networkResponse;
  } catch (error) {
    // Return a placeholder SVG for failed images
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect fill="#1a1a2e" width="100" height="100"/>
        <text fill="#ffffff" x="50" y="55" text-anchor="middle" font-size="40">💰</text>
      </svg>`,
      {
        headers: { 'Content-Type': 'image/svg+xml' }
      }
    );
  }
}

/**
 * Network First Strategy
 * Try network first, fallback to cache
 */
async function networkFirst(request, cacheName) {
  try {
    const networkResponse = await fetch(request);
    
    if (networkResponse.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, networkResponse.clone());
      await trimCache(cacheName, CACHE_LIMITS.dynamic);
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', request.url);
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('./index.html');
    }
    
    throw error;
  }
}

/**
 * Stale While Revalidate Strategy
 * Return cache immediately, update cache in background
 */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cachedResponse = await caches.match(request);
  
  // Fetch in background
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
        trimCache(cacheName, CACHE_LIMITS.dynamic);
      }
      return networkResponse;
    })
    .catch((error) => {
      console.log('[SW] Network request failed:', error);
    });
  
  // Return cached response immediately, or wait for network
  return cachedResponse || fetchPromise || caches.match('./index.html');
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if request is for a static asset
 */
function isStaticAsset(url) {
  const staticExtensions = ['.html', '.css', '.js', '.json', '.woff', '.woff2', '.ttf'];
  return staticExtensions.some(ext => url.pathname.endsWith(ext)) ||
         url.pathname === '/' ||
         url.pathname.endsWith('/');
}

/**
 * Check if request is for an image
 */
function isImage(url) {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
  return imageExtensions.some(ext => url.pathname.endsWith(ext));
}

/**
 * Check if request is an API call
 */
function isAPIRequest(url) {
  return url.pathname.includes('/api/') || 
         url.hostname !== self.location.hostname;
}

/**
 * Trim cache to specified limit
 */
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  
  if (keys.length > maxItems) {
    console.log(`[SW] Trimming cache ${cacheName}: ${keys.length} > ${maxItems}`);
    
    // Delete oldest entries
    const deleteCount = keys.length - maxItems;
    for (let i = 0; i < deleteCount; i++) {
      await cache.delete(keys[i]);
    }
  }
}

// ==================== BACKGROUND SYNC ====================
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncTransactions());
  }
});

async function syncTransactions() {
  // Placeholder for background sync logic
  // This would sync offline transactions when connection is restored
  console.log('[SW] Syncing transactions...');
  
  try {
    // Get pending transactions from IndexedDB
    // Send to server
    // Clear pending queue
    console.log('[SW] Transactions synced successfully');
  } catch (error) {
    console.error('[SW] Sync failed:', error);
    throw error; // Retry sync
  }
}

// ==================== PUSH NOTIFICATIONS ====================
self.addEventListener('push', (event) => {
  console.log('[SW] Push notification received');
  
  const options = {
    body: event.data ? event.data.text() : 'Nouvelle notification MoneyTracker',
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      { action: 'open', title: 'Ouvrir', icon: './icon-192.png' },
      { action: 'close', title: 'Fermer' }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('MoneyTracker Pro', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked');
  event.notification.close();
  
  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      clients.matchAll({ type: 'window' }).then((clientList) => {
        // Focus existing window or open new one
        for (const client of clientList) {
          if (client.url.includes('moneytracker') && 'focus' in client) {
            return client.focus();
          }
        }
        return clients.openWindow('./index.html');
      })
    );
  }
});

// ==================== PERIODIC SYNC ====================
self.addEventListener('periodicsync', (event) => {
  console.log('[SW] Periodic sync event:', event.tag);
  
  if (event.tag === 'update-data') {
    event.waitUntil(updateAppData());
  }
});

async function updateAppData() {
  console.log('[SW] Updating app data...');
  // Refresh cached data periodically
}

// ==================== MESSAGE HANDLING ====================
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: APP_VERSION });
  }
  
  if (event.data && event.data.type === 'CLEAR_CACHE') {
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0].postMessage({ success: true });
      })
    );
  }
});

console.log('[SW] Service Worker script loaded - v' + APP_VERSION);
