// Rede primeiro (sempre o código mais novo); cache só como reserva para abrir o app sem internet.
// Dados nunca são servidos do cache: vendas e pagamentos exigem conexão.
const V = 'estoque-v3';
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(c => c.addAll(['/', '/css/app.css'])).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request).then(r => r || caches.match('/'))));
});
