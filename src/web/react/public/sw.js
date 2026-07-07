self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e) {});

self.addEventListener('push', function(event) {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Soporte AloIA', body: event.data ? event.data.text() : '' }; }

  const title = data.title || 'Soporte AloIA';
  const options = {
    body: data.body || '',
    icon: data.icon || '/aloia-icon.png',
    badge: '/aloia-icon.png',
    tag: data.tag || 'aloia-msg',
    renotify: true,
    vibrate: [200, 100, 200],
    data: { phone: data.phone || null, url: '/' }
  };

  // userVisibleOnly=true exige mostrar notificacion siempre; nunca hacer skip
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const phone = event.notification.data && event.notification.data.phone;
  const targetUrl = phone ? '/?chat=' + encodeURIComponent(phone) : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        if ('focus' in c) {
          c.focus();
          if (phone && 'postMessage' in c) c.postMessage({ type: 'open-chat', phone: phone });
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
