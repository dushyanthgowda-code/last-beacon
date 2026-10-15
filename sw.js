/* Cache-first service worker so the app keeps working with zero connectivity. */
const CACHE = 'last-beacon-v1';
const FILES = [
  './', 'index.html', 'manifest.json', 'css/style.css',
  'js/config.js', 'js/util.js', 'js/city.js', 'js/planner.js', 'js/game.js',
  'js/sound.js', 'js/render.js', 'js/ui.js', 'js/main.js'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
