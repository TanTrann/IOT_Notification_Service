// Service Worker — nhận thông báo khi tab bị đóng / background
// File này phải nằm ở root của server (cùng cấp với index.html)

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

// Lấy apiKey, messagingSenderId, appId từ:
// Firebase Console → Project Settings → Your apps → Web app → SDK setup
firebase.initializeApp({
  apiKey: "AIzaSyCUaUnwE20Gi9V35CX9CkcDmqwwxFYZiNI",
  authDomain: "smartfarmai-f1426.firebaseapp.com",
  databaseURL: "https://smartfarmai-f1426-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "smartfarmai-f1426",
  storageBucket: "smartfarmai-f1426.firebasestorage.app",
  messagingSenderId: "1071313553757",
  appId: "1:1071313553757:web:d9ad58188bcde720ca80b4",
  measurementId: "G-XDQN35RNMK"
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  console.log('[SW] Background message:', payload);

  const { title, body } = payload.data || payload.notification || {};

  self.registration.showNotification(title || 'Thông báo', {
    body:  body || '',
    icon:  '/icon.png',
    badge: '/badge.png',
    data:  payload.data,
  });
});
