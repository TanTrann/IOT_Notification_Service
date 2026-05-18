# Test Client — Notification Service

## Cách chạy

```bash
cd test-client
npm run dev
# Mở http://localhost:8080
```

## Cần điền trước khi test

### 1. firebase-messaging-sw.js
Mở file này, điền Firebase config (giống với index.html):
- `apiKey`, `projectId`, `messagingSenderId`, `appId`

### 2. Lấy Firebase Client Config (khác với Service Account)
Firebase Console → Project Settings → Your apps → Web app → Config

### 3. Lấy VAPID Key
Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair

## Luồng test
1. Điền config → click "Khởi tạo Firebase"
2. Click "Xin quyền & Lấy Token"
3. Click "Subscribe topic iot_alerts_topic"
4. Click "Gửi IoT Event" → xem thông báo popup
