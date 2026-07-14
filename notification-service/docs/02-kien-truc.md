# Kiến trúc hệ thống

Tài liệu mô tả kiến trúc của **IOT Notification Service** — vai trò từng thành phần, cách chúng kết nối và mô hình dữ liệu.

> **Mô hình hiện tại (Firebase-only):** service nghe topic `planttree/{deviceId}/notifications`
> (wildcard `planttree/+/notifications`), **không dịch/biến đổi** payload, và **broadcast push qua
> Firebase (FCM)** tới mọi client đã đăng ký. Màn hình hiển thị (kiosk web cạnh cây) nhận qua
> **Firebase Web Push**. Đã gỡ bỏ: SSE/`displayHub`, luồng dịch sensor/ngưỡng, ghi DB thông báo.

---

## 1. Sơ đồ kiến trúc tổng thể

```
┌──────────────┐
│  MCP Server  │  (Phong) — sinh thông báo JSON tự do
└──────┬───────┘
       │ publish JSON lên planttree/{deviceId}/notifications
       ▼
┌───────────────────────────────────┐
│           MQTT Broker             │   HiveMQ Cloud (TLS, cổng 8883)
│ planttree/{deviceId}/notifications │   — dùng chung với hệ của Phong
└────────┬──────────────────────────┘
         │ subscribe (QoS 1)
         ▼
╔══════════════════════════════════════════════════════════════╗
║              IOT NOTIFICATION SERVICE (Node.js)              ║
║                                                              ║
║   ┌──────────────┐  parse JSON — KHÔNG dịch/biến đổi          ║
║   │ mqttHandler  │  bóc deviceId từ topic                     ║
║   └──────┬───────┘                                            ║
║          │                                                   ║
║          └──► fcmService.sendToAll ──► Firebase Admin (FCM)   ║
║                                                              ║
║   ┌───────────── HTTP API (Express) ─────────────────────┐  ║
║   │ /internal/push/token   [API key]  đăng ký FCM token   │  ║
║   │ /api/v1/auth/login     [—]        đăng nhập → JWT      │  ║
║   │ /api/v1/notifications  [JWT]      REST (web, đọc DB)   │  ║
║   └────────────────────────────────────────────────────────┘ ║
╚══════════════════════════════════════════════════════════════╝
                              │ push (FCM)
                              ▼
                  ┌──────────────────────────┐
                  │  Web kiosk cạnh cây       │  Firebase Web Push
                  │  (notification-web)       │  onMessage → danh sách trong trang
                  └──────────────────────────┘
```

---

## 2. Các đầu vào của hệ thống

| Đầu vào | Nguồn | Xử lý bởi |
|---|---|---|
| **Thông báo từ MCP** | MQTT `planttree/{deviceId}/notifications` | `mqttHandler` → `fcmService.sendToAll` |
| **Đăng ký nhận push** | `POST /internal/push/token` (API key) | `internalRoutes` → lưu `fcmtokens` |
| **Yêu cầu từ web (REST)** | `/api/v1/*` (JWT) | `routes` → `controller` → `notificationService` (đọc DB) |

> Payload là **JSON object bất kỳ**; `deviceId` lấy từ topic. Service chỉ bóc `title`/`body`/
> `severity`/`type` để đặt tiêu đề/nội dung push cho đẹp — **không bắt buộc** field nào, không đổi dữ liệu gốc.

---

## 3. Các thành phần (lớp xử lý)

### 3.1. Điểm khởi động — `src/index.js`
Khởi tạo theo thứ tự: nạp `.env` → init Firebase → `startMQTTListener()` → kết nối MongoDB → khởi động Express. Cung cấp `GET /health`. Lỗi tập trung tại error handler cuối.

### 3.2. Tầng cấu hình — `src/config/`
| File | Trách nhiệm |
|---|---|
| `mqtt.js` | Tạo kết nối MQTT (TLS), auto-reconnect 5s, QoS 1 |
| `firebase.js` | Khởi tạo Firebase Admin SDK (env hoặc serviceAccountKey.json) — **cốt lõi phần push** |
| `database.js` | Kết nối MongoDB (lưu FCM token; REST đọc) |

### 3.3. Tầng dịch vụ — `src/services/`
| File | Trách nhiệm chính |
|---|---|
| `mqttHandler.js` | `startMQTTListener()`: subscribe `planttree/+/notifications` (env `MQTT_NOTIFICATION_TOPIC`), bóc `deviceId` từ topic, parse JSON, gọi `fcmService.sendToAll()`. Không dịch/biến đổi. |
| `fcmService.js` | `sendToDevice()`, `sendToAll()` (broadcast mọi token); tự xóa token chết khi Firebase báo không hợp lệ. |
| `notificationService.js` | Chỉ còn phần **đọc** cho REST web: `getByUser()`, `markRead()`, `markAllRead()`, `getUnreadCount()`. |

### 3.4. Tầng API — `routes` / `controllers` / `middlewares`
- `routes/internalRoutes.js`: `POST|DELETE /internal/push/token` — đăng ký/hủy FCM token. Bảo vệ bằng **API key** (`internalAuth`).
- `routes/notificationRoutes.js` + `controllers/notificationController.js`: `/api/v1/notifications/*` cho web (JWT).
- `routes/authRoutes.js` + `controllers/authController.js`: `POST /api/v1/auth/login` → JWT.
- `middlewares/internalAuth.js`: kiểm tra `x-api-key` header hoặc `?key=` query.
- `middlewares/auth.js`: xác thực JWT Bearer, lấy `deviceId`.
- `utils/asyncHandler.js`: bọc handler async để bắt lỗi tập trung.

---

## 4. Kênh giao thông báo: Firebase (FCM)

| Kênh | Cách gửi | Client nhận |
|---|---|---|
| **FCM push** | `fcmService.sendToAll` → Firebase Admin `messaging.send()` | Web kiosk qua **Firebase Web Push** (SDK JS + service worker): `onMessage` (tab mở) hiện danh sách trong trang; service worker hiện khi tab đóng |

> Đã **bỏ SSE**. Màn hình hiển thị dựa hoàn toàn vào Firebase Web Push. Chi tiết luồng xem
> [03-luong-hoat-dong.md](03-luong-hoat-dong.md); cấu hình Firebase 2 phía xem [01-firebase-setup.md](01-firebase-setup.md).

---

## 5. Mô hình dữ liệu (MongoDB)

> Lưu ý: luồng MQTT **ghi mỗi tin vào collection `notifications`** (best-effort — lỗi ghi DB không
> chặn việc đẩy push), đồng thời broadcast qua FCM. Màn hình kiosk hiện danh sách realtime từ chính
> message FCM (`onMessage`); REST `/api/v1/notifications` đọc lại lịch sử bền vững từ DB. `fcmtokens`
> và `notifications` đều được dùng đầy đủ.

### Collection `fcmtokens`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `deviceId` | String | client đăng ký qua `/internal/push/token` dùng `'broadcast'`; web (REST) dùng deviceId từ JWT |
| `token` | String | **unique** — Firebase registration token |
| `device` | String | enum: `web`, `android`, `ios` |
| `createdAt`/`updatedAt` | Date | tự động |

### Collection `notifications` (ghi từ luồng MQTT, REST đọc lại)
`eventId`, `deviceId`, `title`, `body`, `type`, `severity`, `isRead`, `data`, `createdAt`.

---

## 6. Các client trong repo

| Folder | Vai trò | Nhận thông báo |
|---|---|---|
| [`../../notification-web/`](../../notification-web/README.md) | **Màn hình kiosk cạnh cây** (chạy full-screen) | Firebase Web Push (`onMessage` → danh sách trong trang) |

---

## 7. Nguyên tắc thiết kế

- **Firebase là trung tâm:** deliverable của module là push qua Firebase — mọi thông báo đi qua FCM.
- **Không dịch payload:** service là ống dẫn trung thực từ MCP tới client.
- **Broadcast:** mô hình "1 loại thông báo — ai đăng ký cũng nhận" (`sendToAll`). Có thể chuyển sang targeting theo `deviceId` (đã bóc sẵn từ topic) bằng `sendToUser` khi client đăng ký token kèm deviceId thật.
- **Chịu lỗi mềm:** thiếu MQTT/MongoDB/Firebase → log cảnh báo, không crash. FCM lỗi không chặn luồng.
- **Tách xác thực:** `/internal/*` API key, `/api/v1/*` JWT.

> Chi tiết các luồng chạy thực tế xem [03-luong-hoat-dong.md](03-luong-hoat-dong.md).
