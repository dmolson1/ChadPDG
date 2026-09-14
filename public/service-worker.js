const CACHE_NAME = 'chadpdchee-shell-20260914-adsense-1';
const OFFLINE_PAGE_KEY = '/__chadpdchee_latest_shell__';

self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil((async () => { const keys=await caches.keys(); await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key))); await self.clients.claim(); })()); });
self.addEventListener('message', event => { if(event.data && event.data.type==='SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const req=event.request; if(req.method!=='GET') return; const url=new URL(req.url); if(url.origin!==self.location.origin) return;
  if(url.pathname.startsWith('/wp-json/')||url.pathname.startsWith('/auth/')||url.pathname.startsWith('/chat-')||url.pathname.startsWith('/admin/')||url.pathname.startsWith('/analytics/')) return;
  if(req.mode==='navigate'){ event.respondWith((async()=>{ try{ const fresh=await fetch(req,{cache:'no-store'}); if(fresh&&fresh.ok){ const cache=await caches.open(CACHE_NAME); await cache.put(OFFLINE_PAGE_KEY,fresh.clone()); } return fresh; }catch(_){ const cache=await caches.open(CACHE_NAME); const offline=await cache.match(OFFLINE_PAGE_KEY); if(offline)return offline; return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ChadPDChee Offline</title><body style="font-family:Arial;padding:30px"><h1>Chad is offline.</h1><p>Apparently even Chad needs the internet sometimes. Try again when you have a connection.</p></body>',{headers:{'Content-Type':'text/html; charset=utf-8'},status:503}); } })()); return; }
  if(url.pathname==='/service-worker.js'||url.pathname==='/manifest.webmanifest'){ event.respondWith(fetch(req,{cache:'no-store'})); return; }
  event.respondWith(fetch(req).then(response=>{ if(response&&response.ok){ const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(req,copy)).catch(()=>{}); } return response; }).catch(async()=>{ const cached=await caches.match(req); return cached||Response.error(); }));
});
