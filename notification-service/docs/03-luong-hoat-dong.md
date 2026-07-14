# Luồng hoạt động

Tài liệu mô tả các luồng chạy thực tế theo **mô hình hiện tại** (nghe
`planttree/{deviceId}/notifications`, không dịch, **push qua Firebase theo `deviceId`** — mỗi màn
hình chỉ nhận tin của cây mình; đã bỏ SSE và bỏ luôn lớp user/đăng nhập/JWT).

1. [Khởi động service](#1-luồng-khởi-động)
2. [Thông báo từ MCP → push Firebase](#2-luồng-thông-báo)
3. [Client đăng ký & nhận push (Firebase Web Push)](#3-luồng-client)

---

## 1. Luồng khởi động

```
npm start → src/index.js
   1. dotenv          → nạp biến môi trường từ .env
   2. firebase.js     → init Firebase Admin (log thành công / cảnh báo)
   3. startMQTTListener() → kết nối broker, subscribe planttree/+/notifications
   4. database.js     → kết nối MongoDB (lưu FCM token)
   5. Express         → middleware (helmet, cors, compression, morgan)
                      → mount /internal, /api/v1/notifications  (đều dùng x-api-key)
                      → GET /health
   6. listen PORT (mặc định 3001)
```

> Thiếu MQTT_BROKER_URL / MONGODB_URI / Firebase credentials → ghi cảnh báo và **vẫn tiếp tục chạy**.

---

## 2. Luồng thông báo

**Kích hoạt:** MCP/server của Phong publish một JSON bất kỳ lên `planttree/{deviceId}/notifications`.
Service **không dịch/biến đổi** — push qua Firebase tới **đúng** các màn hình đã đăng ký `deviceId` đó.

```
MCP ──publish JSON──► MQTT (planttree/{deviceId}/notifications)
                          │
                          ▼
                  mqttHandler nhận message
                          │ parse JSON (không đổi payload)
                          │ bóc deviceId từ topic (không có → bỏ qua)
                          │ ghi lịch sử vào MongoDB (best-effort)
                          ▼
                  fcmService.sendToDeviceId(deviceId, { title, body, data })
                          │  tìm các token có ĐÚNG deviceId trong fcmtokens
                          ▼
                  messaging.send() song song ──► Firebase ──► màn hình của cây đó
                          (token chết tự bị xóa)
```

### Payload mẫu (JSON tự do)
```json
{ "title": "Cây thiếu nước", "body": "Độ ẩm đất 22% — cần tưới ngay", "severity": "warning", "type": "water" }
```

### Bóc field để đặt push (chỉ để đẹp, không bắt buộc)
- **title**: `title` · `tieu_de` · `name` · `event`
- **body**: `body` · `message` · `msg` · `content` · `noi_dung` · `description`
- **type**: `type` · `category` · `loai`
- **severity**: `severity` · `level` · `muc_do` · `priority`

`deviceId` (từ topic) + payload gốc (`raw`) được gửi kèm trong phần `data` của message FCM để client dùng nếu cần. Payload không phải JSON object được bọc thành `{ message: "..." }`.

---

## 3. Luồng client (Firebase Web Push)

Màn hình cạnh cây là trang `notification-web` chạy full-screen, dùng Firebase JS SDK.

### 3.1. Đăng ký nhận push (1 lần / thiết bị)
```
Web kiosk
   1. xin quyền notification (browser)
   2. getToken({ vapidKey }) → registration token
   3. đăng ký token về service:
        POST /internal/push/token  (header x-api-key)
        body { token, deviceId, device: 'web' }   ← deviceId của cây màn hình đứng cạnh
              │
              ▼
   Server lưu vào collection fcmtokens (token gắn với đúng deviceId)
```

### 3.2. Nhận & hiển thị
```
fcmService.sendToDeviceId ──► Firebase ──► web kiosk (đúng deviceId)
   - Tab đang mở (foreground): messaging.onMessage(payload)
        → dựng 1 mục thông báo từ payload → thêm vào ĐẦU danh sách trong trang (unshift)
   - Tab đóng/nền: service worker firebase-messaging-sw.js hiển thị notification hệ thống
```

> Danh sách trên màn hình được dựng **realtime ngay trong trang** từ chính message FCM
> (`onMessage`). Song song, mỗi tin cũng được **ghi vào MongoDB** (best-effort), nên lịch sử
> bền vững đọc lại được qua REST `GET /api/v1/notifications` — kể cả sau khi reload hay từ máy khác.

---

## 4. Cơ chế đảm bảo chất lượng

| Cơ chế | Mục đích | Vị trí |
|---|---|---|
| Không dịch/biến đổi payload | Hiển thị đúng nguyên tin MCP gửi | `mqttHandler` |
| FCM best-effort (không chặn) | Lỗi push không làm gãy luồng | `mqttHandler.pushToDevice()` |
| Tự xóa token chết | Giữ DB token sạch | `fcmService.sendToDevice()` |
| Auto-reconnect MQTT 5s | Chịu lỗi mạng broker | `config/mqtt.js` |
| Graceful degradation | Không crash khi thiếu cấu hình | `index.js` + các config |

---

## 5. Cách thử nhanh (end-to-end)

1. Chạy service: `cd notification-service && npm run dev` (cần Firebase credentials trong `.env`).
2. Mở màn hình kiosk: `npx serve notification-web -l 3000` → mở `http://localhost:3000` full-screen →
   bấm ⚙️ nhập **Server URL + Device ID + API key** (bằng `INTERNAL_API_KEY`) → Lưu →
   **Bật nhận push** (cấp quyền browser). Token được đăng ký kèm đúng Device ID vừa nhập.
3. Bắn thử một thông báo:
   `node scripts/publish-test.js` (mặc định deviceId `ESP32S3_Zone1`; truyền deviceId khác ở tham số 2)
   → tin hiện ngay trên màn hình có **cùng Device ID** (Firebase Web Push, `onMessage`).
