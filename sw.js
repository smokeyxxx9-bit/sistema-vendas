/* Service worker: deixa o sistema abrir mesmo sem internet e SEMPRE busca a versão nova do index.html quando há rede.
   Não mexe em nenhuma chamada ao Supabase (dados vão direto para a nuvem, como antes). */
var CACHE = "oficina-v1";
var ESTATICOS = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];
var CDNS = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(ESTATICOS); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e){
  var req = e.request;
  if (req.method!=="GET") return;
  var url = new URL(req.url);
  if (url.hostname.indexOf("supabase.co")!==-1) return;          // nuvem: nunca interceptar

  if (url.origin===self.location.origin){                         // arquivos do sistema: rede primeiro, cache se offline
    e.respondWith(fetch(req).then(function(r){
      var cp = r.clone(); caches.open(CACHE).then(function(c){ c.put(req, cp); }); return r;
    }).catch(function(){ return caches.match(req).then(function(m){ return m || caches.match("./index.html"); }); }));
    return;
  }
  if (CDNS.indexOf(url.hostname)!==-1){                           // bibliotecas/fontes: cache primeiro, atualiza em segundo plano
    e.respondWith(caches.match(req).then(function(m){
      var net = fetch(req).then(function(r){
        if (r && (r.ok || r.type==="opaque")){ var cp = r.clone(); caches.open(CACHE).then(function(c){ c.put(req, cp); }); }
        return r;
      }).catch(function(){ return m; });
      return m || net;
    }));
  }
});
