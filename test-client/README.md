# Test Client — Notification Service

Trang test trên browser, **giả lập hệ thống của Phong** để test notification service end-to-end:
- Giả lập **ESP32 (xmini)** publish số đo cảm biến lên `xmini/sensor_data` (snake_case).
- Giả lập **server .NET** publish lệnh `{command, commandId, parameters}` xuống `xmini/control`.
- Subscribe cả 2 topic để xem mọi data đang chạy trên broker (kể cả từ thiết bị/server thật của Phong).
- Lấy FCM token, lưu vào DB và nhận push notification ngay trên trang.

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
- Dùng **cùng cluster với Phong** thì mới thấy data của thiết bị/server thật.

## Luồng test

1. **Bước 1 — Cấu hình chung:** kiểm tra Service URL, MQTT URL + username/password, 2 topic.
2. **Bước 2 — JWT:** sinh token rồi paste vào:
   ```bash
   cd notification-service && node generate-token.js device_test_01
   ```
   `Device ID` ở ô bên dưới phải khớp `deviceId` trong JWT.
3. **Bước 3 — Kết nối MQTT:** click "Kết nối" → badge xanh, client tự subscribe 2 topic;
   bản tin đến hiện ở Log với tag 📥.
4. **Bước 4 — Firebase:** click "Khởi tạo Firebase" → "Xin quyền → Lấy Token → Lưu vào DB".
5. **Bước 5 — Giả lập ESP32:** bấm các nút kịch bản ("🌵 Đất khô", "🔥 Quá nóng"...) để publish
   bản tin sensor. Service so ngưỡng → push "Cây đang thiếu nước"... hiện lên.
6. **Bước 6 — Giả lập server .NET:** bấm WATER_ON / LIGHT_ON... để publish lệnh.
   Service dịch → push "Đã tự động tưới nước...".

## Các kịch bản demo hay

| Kịch bản | Thao tác | Kết quả mong đợi |
|---|---|---|
| Cảnh báo ngưỡng | Bấm "🌵 Đất khô (22%)" | Push **"Cây đang thiếu nước"** (warning) |
| Chống spam (edge-detection) | Bấm "🌵 Đất khô" lần 2, lần 3 | **Không** có push thêm |
| Hồi phục | Bấm "💧 Đất ẩm lại (48%)" | Push **"Độ ẩm đã ổn định"** (info) |
| Lệnh tự động | Bấm "💦 WATER_ON" | Push **"Đã tự động tưới nước... (độ ẩm hiện tại 22%, trong 5 giây)"** |
| Chống trùng QoS 1 | Bấm "🚀 Publish payload này" (bước 6) 2 lần, giữ nguyên `commandId` | Lần 2 service bỏ qua, **không** push lặp |
| Trọn vòng với server thật | Server .NET của Phong chạy cùng broker + có moisture rule → bấm "🌵 Đất khô" | Server tự phát WATER_ON thật xuống `xmini/control` → nhận **2 push**: cảnh báo thiếu nước + đã tưới nước |

## Lưu ý
- `device_id` trong bản tin sensor **phải trùng** `deviceId` của JWT thì service mới tìm đúng FCM token để gửi.
- Payload control **không có device_id** (đúng theo hợp đồng của Phong) — service gán lệnh cho
  device của bản tin sensor gần nhất, nên **luôn publish sensor (bước 5) trước khi test control (bước 6)**.
- Nếu publish mà không thấy push: kiểm tra đã hoàn tất bước 4 (token đã lưu) chưa,
  và notification-service có đang chạy + kết nối cùng broker không.
