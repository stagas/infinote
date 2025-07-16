const CACHE_NAME = 'infinote-v3'
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/script.js',
  '/manifest.json'
]

// Install event - cache resources immediately and take control
self.addEventListener('install', function (event) {
  console.log('Service Worker installing...')
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) {
        console.log('Caching app shell')
        return cache.addAll(urlsToCache)
      })
      .then(function () {
        console.log('All resources cached successfully')
        return self.skipWaiting()
      })
      .catch(function (error) {
        console.error('Cache installation failed:', error)
      })
  )
})

// Activate event - clean up old caches and claim clients
self.addEventListener('activate', function (event) {
  console.log('Service Worker activating...')
  event.waitUntil(
    caches.keys()
      .then(function (cacheNames) {
        return Promise.all(
          cacheNames.map(function (cacheName) {
            if (cacheName !== CACHE_NAME) {
              console.log('Deleting old cache:', cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      })
      .then(function () {
        console.log('Service Worker activated')
        return self.clients.claim()
      })
  )
})

// Fetch event - network first for HTML, stale-while-revalidate for assets
self.addEventListener('fetch', function (event) {
  // Skip non-GET requests and external requests
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return
  }

  const url = new URL(event.request.url)
  const isHtmlRequest = event.request.mode === 'navigate' ||
    event.request.headers.get('accept')?.includes('text/html') ||
    url.pathname === '/' || url.pathname.endsWith('.html')

  // Check for hard refresh (Ctrl+F5 or similar)
  const isHardRefresh = event.request.cache === 'reload'

  if (isHtmlRequest || isHardRefresh) {
    // Network first strategy for HTML and hard refresh
    event.respondWith(
      fetch(event.request)
        .then(function (response) {
          // If we got a good response, cache it
          if (response && response.status === 200 && response.type === 'basic') {
            const responseToCache = response.clone()
            caches.open(CACHE_NAME)
              .then(function (cache) {
                cache.put(event.request, responseToCache)
                console.log('Updated cache for:', event.request.url)
              })
          }
          return response
        })
        .catch(function (error) {
          console.log('Network fetch failed, trying cache:', error)
          // Fallback to cache if network fails
          return caches.match(event.request)
            .then(function (cachedResponse) {
              if (cachedResponse) {
                console.log('Serving from cache (offline):', event.request.url)
                return cachedResponse
              }
              // For navigation, return cached index.html as fallback
              if (isHtmlRequest) {
                return caches.match('/index.html')
              }
              throw error
            })
        })
    )
  } else {
    // Stale-while-revalidate strategy for other assets
    event.respondWith(
      caches.match(event.request)
        .then(function (cachedResponse) {
          // Start a background fetch to update the cache
          const fetchPromise = fetch(event.request)
            .then(function (response) {
              if (response && response.status === 200 && response.type === 'basic') {
                const responseToCache = response.clone()
                caches.open(CACHE_NAME)
                  .then(function (cache) {
                    cache.put(event.request, responseToCache)
                    console.log('Background updated cache for:', event.request.url)
                  })
              }
              return response
            })
            .catch(function (error) {
              console.log('Background fetch failed:', error)
              return null
            })

          // Return cached version immediately, or wait for network if no cache
          if (cachedResponse) {
            console.log('Serving from cache (stale-while-revalidate):', event.request.url)
            return cachedResponse
          } else {
            return fetchPromise
          }
        })
    )
  }
})

// Message event - handle cache updates from the main thread
self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})
