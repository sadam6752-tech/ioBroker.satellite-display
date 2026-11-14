/* Service worker of the tablet web app: the app itself comes from the network (it updates with the adapter) and
 * from this cache when the adapter cannot be reached, so the page still opens and shows "Connecting…". */
'use strict';

const CACHE = 'satellite-display-v2';
const SHELL = [
    './',
    'index.html',
    'app.js',
    'icons.js',
    'style.css',
    'manifest.webmanifest',
    'icon-192.png',
    'icon-512.png',
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(CACHE)
            .then(cache => cache.addAll(SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.endsWith('/ws')) {
        return;
    }
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response.ok) {
                    const copy = response.clone();
                    // kept by its path without the query
                    caches.open(CACHE).then(cache => cache.put(url.pathname, copy));
                }
                return response;
            })
            .catch(() => caches.match(url.pathname).then(hit => hit || caches.match('index.html'))),
    );
});
