// Service worker: app funciona offline e guarda os pedaços de mapa já visualizados.
var APP_CACHE = 'halo-app-v5';
var TILE_CACHE = 'halo-tiles-v1';
var MAX_TILES = 3000;
var APP_FILES = [
  './',
  'index.html',
  'css/app.css',
  'js/calc.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png',
  'vendor/leaflet/images/layers-2x.png',
  'vendor/leaflet/images/marker-icon.png',
  'vendor/leaflet/images/marker-icon-2x.png',
  'vendor/leaflet/images/marker-shadow.png'
];
var TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(APP_CACHE).then(function (c) { return c.addAll(APP_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== APP_CACHE && k !== TILE_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function trimTiles() {
  return caches.open(TILE_CACHE).then(function (c) {
    return c.keys().then(function (keys) {
      var extra = keys.length - MAX_TILES;
      if (extra <= 0) return;
      return Promise.all(keys.slice(0, extra).map(function (k) { return c.delete(k); }));
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Mapa: usa o que já está guardado; se não tiver, busca e guarda.
  if (TILE_HOSTS.indexOf(url.hostname) !== -1) {
    e.respondWith(caches.open(TILE_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.05) trimTiles(); }
          return res;
        });
      });
    }));
    return;
  }

  // Arquivos do app: responde do cache e atualiza em segundo plano.
  if (url.origin === self.location.origin) {
    e.respondWith(caches.open(APP_CACHE).then(function (c) {
      return c.match(req, { ignoreSearch: true }).then(function (hit) {
        var net = fetch(req).then(function (res) {
          if (res.ok) c.put(req, res.clone());
          return res;
        }).catch(function () { return hit || c.match('index.html'); });
        return hit || net;
      });
    }));
  }
});
