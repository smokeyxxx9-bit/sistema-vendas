/* Service worker do Painel de Vendas.
   - Só cuida dos arquivos do próprio site (nunca toca nas chamadas ao Supabase).
   - "Rede primeiro": sempre busca a versão nova; se estiver sem internet, abre a última guardada.
   Para forçar todo mundo a atualizar depois de uma mudança grande, troque o número da versão abaixo. */
var VERSAO = "bigua-v1";
var BASICO = ["./", "index.html", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(VERSAO).then(function(c){ return c.addAll(BASICO); }).then(function(){ return self.skipWaiting(); }));
});
self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.filter(function(k){ return k!==VERSAO; }).map(function(k){ return caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});
self.addEventListener("fetch", function(e){
  var r = e.request;
  if (r.method!=="GET") return;
  var u = new URL(r.url);
  if (u.origin!==location.origin) return;           // Supabase, CDNs etc.: direto, sem cache aqui
  e.respondWith(
    fetch(r).then(function(res){
      if (res && res.ok){ var copia = res.clone(); caches.open(VERSAO).then(function(c){ c.put(r, copia); }); }
      return res;
    }).catch(function(){
      return caches.match(r).then(function(m){
        return m || (r.mode==="navigate" ? caches.match("index.html") : Response.error());
      });
    })
  );
});
