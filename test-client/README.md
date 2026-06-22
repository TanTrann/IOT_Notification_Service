# Test Client — Notification Service

Trang test trên browser để: kết nối MQTT (HiveMQ Cloud), lấy FCM token và lưu vào DB,
rồi publish event giả lập để xem push notification hiện lên.

## Cách chạy

```bash
cd test-client
npm run dev
# Mở http://localhost:8080
```

> Phải chạy qua HTTP server (không mở file trực tiếp) vì service worker
> `firebase-messaging-sw.js` chỉ hoạt động trên `http://localhost` hoặc HTTPS.

## Chuẩn bị config (1 lần)

### 1. Firebase client config
Đã điền sẵn trong `index.html` (bước 4) và `firebase-messaging-sw.js`.
Nếu đổi project: lấy từ Firebase Console → Project Settings → Your apps → Web app → Config,
và điền **giống nhau ở cả hai file**.

### 2. VAPID Key
Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair.
Điền vào ô VAPID Key (bước 4).

### 3. MQTT (HiveMQ Cloud)
- URL: `wss://<cluster>.s1.eu.hivemq.cloud:8884/mqtt` (WebSocket over TLS, port **8884**).
- Username/Password: tạo trong HiveMQ Console → Access Management.

## Luồng test

1. **Bước 1 — Cấu hình chung:** kiểm tra Service URL, MQTT URL + username/password, topic.
2. **Bước 2 — JWT:** sinh token rồi paste vào:
   ```bash
   cd notification-service && node generate-token.js device_test_01
   ```
   `Device ID` ở ô bên dưới phải khớp `deviceId` trong JWT.
3. **Bước 3 — Kết nối MQTT:** click "Kết nối" → badge chuyển xanh "Đã kết nối".
4. **Bước 4 — Firebase:** click "Khởi tạo Firebase" → "Xin quyền → Lấy Token → Lưu vào DB".
   Cho phép quyền thông báo của browser. Token được lưu vào DB qua `POST /token`.
5. **Bước 5 — Publish:** chỉnh payload (giữ `deviceId` khớp bước 2) → click "Publish".
   Service nhận qua MQTT → lưu Mongo → gửi FCM → push hiện lên (foreground hiện ở Log,
   background hiện qua service worker).

## Lưu ý
- `deviceId` trong payload **phải trùng** `deviceId` của JWT thì service mới tìm đúng FCM token để gửi.
- Nếu publish mà không thấy push: kiểm tra đã hoàn tất bước 4 (token đã lưu) chưa.
