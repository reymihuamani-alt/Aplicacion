/*
 * Service worker de Pulso: guarda los archivos del juego para que abra rápido
 * y funcione sin conexión (modo Generador, archivos propios y Pulso Cúbico).
 * Primero intenta la red (para recibir actualizaciones) y, si no hay, usa la copia.
 */
const CACHE = 'pulso-v2';
const FILES = [
  './', './index.html', './css/style.css', './js/engine.js', './js/levels.js', './js/audio.js', './js/custom.js', './js/game.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png',
  './aplicaciones/onda/', './aplicaciones/onda/index.html', './aplicaciones/onda/style.css',
  './aplicaciones/onda/js/util.js', './aplicaciones/onda/js/synth.js', './aplicaciones/onda/js/analysis.js',
  './aplicaciones/onda/js/chart.js', './aplicaciones/onda/js/sources.js', './aplicaciones/onda/js/render.js',
  './aplicaciones/onda/js/jam.js', './aplicaciones/onda/js/game.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return; // Spotify, YouTube, PeerJS: siempre por red
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./aplicaciones/onda/index.html')))
  );
});
