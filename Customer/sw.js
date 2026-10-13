// Customer app installation support. Live ordering always uses the network.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
    if(event.request.method!=='GET' || event.request.mode!=='navigate' || new URL(event.request.url).origin!==self.location.origin)return;
    event.respondWith(fetch(event.request).catch(()=>new Response(
        '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TAKODEÁL · Connect to continue</title><style>body{margin:0;padding:40px 24px;font:16px/1.7 system-ui;background:#f7f8f4;color:#173f35}main{max-width:440px;margin:auto}a{display:inline-block;padding:12px 18px;background:#173f35;color:white;border-radius:9px;text-decoration:none}</style></head><body><main><h1>Connect to keep ordering</h1><p>TAKODEÁL needs an internet connection to check branch availability and submit your order.</p><p>Reconnect, then reopen the app. No order was submitted from this screen.</p><a href="./">Try again</a></main></body></html>',
        {status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}}
    )));
});
