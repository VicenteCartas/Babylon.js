const CACHE_NAME = "babylon-sandbox-v1";
const ASSETS_TO_CACHE = ["/", "/index.html", "/index.js", "/babylon.sandbox.js"];

// Install event - cache essential assets
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Fetch event - handle both file sharing and caching
self.addEventListener("fetch", (event) => {
    const url = new URL(event.request.url);

    // Handle POST requests for file sharing (share_target)
    if (event.request.method === "POST" && url.pathname === "/") {
        event.respondWith(
            (async () => {
                const formData = await event.request.formData();
                const file = formData.get("file");

                // Store the file for the client to pick up
                const client = await self.clients.get(event.resultingClientId);
                if (client && file) {
                    client.postMessage({
                        type: "file-handler",
                        file: file,
                    });
                }

                // Return the main page
                const cachedResponse = await caches.match("/");
                return cachedResponse || fetch("/");
            })()
        );
        return;
    }

    // Skip cross-origin requests for caching
    if (!event.request.url.startsWith(self.location.origin)) {
        return;
    }

    // Network first, fallback to cache
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Clone the response before caching
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});

// Handle messages from clients
self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") {
        self.skipWaiting();
    }
});
