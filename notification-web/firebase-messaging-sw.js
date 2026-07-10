// Service Worker — nhận thông báo khi tab bị đóng / background
// File này phải nằm ở root của server (cùng cấp với index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Config phải GIỐNG index.html (Firebase Console → Project Settings → Web app)
firebase.initializeApp({
  apiKey: "AIzaSyCUaUnwE20Gi9V35CX9CkcDmqwwxFYZiNI",
  authDomain: "smartfarmai-f1426.firebaseapp.com",
  projectId: "smartfarmai-f1426",
  messagingSenderId: "1071313553757",
  appId: "1:1071313553757:web:d9ad58188bcde720ca80b4",
});

const messaging = firebase.messaging();

// Bản SW mới có hiệu lực ngay, không chờ đóng hết tab
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

messaging.onBackgroundMessage((payload) => {
  // Message có field `notification` → FCM SDK/Chrome TỰ hiển thị rồi.
  // Tự show thêm ở đây sẽ bị NHÂN ĐÔI thông báo — chỉ show cho data-only message.
  if (payload.notification) return;
  const { title, body } = payload.data || {};
  self.registration.showNotification(title || 'Thông báo SmartFarm', {
    body:  body || '',
    icon:  '/icon.png',
    badge: '/badge.png',
    data:  payload.data,
  });
});

// Click vào notification → mở / focus lại trang
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) if ('focus' in c) return c.focus();
      return clients.openWindow('/');
    })
  );
});
