# Kiến trúc hệ thống

Tài liệu mô tả kiến trúc của **IOT Notification Service** — vai trò từng thành phần, cách chúng kết nối và mô hình dữ liệu.

---

## 1. Sơ đồ kiến trúc tổng thể

```
┌─────────────────┐
│  Thiết bị IoT   │  ESP32 + cảm biến (độ ẩm đất, nhiệt độ, ánh sáng)
│   (xmini)       │
└────────┬────────┘
         │ publish MQTT
         ▼
┌─────────────────────────┐
│      MQTT Broker         │   HiveMQ Cloud (TLS, cổng 8883)
│  xmini/sensor_data       │   — dùng chung với hệ của Phong
│  xmini/control           │
└────────┬────────────────┘
         │ subscribe (QoS 1)
         ▼
╔═══════════════════════════════════════════════════════════════════╗
║                  IOT NOTIFICATION SERVICE (Node.js)                 ║
║                                                                     ║
║  ┌──────────────┐                                                   ║
║  │ mqttHandler  │  nhận & parse message, điều phối                  ║
║  └──────┬───────┘                                                   ║
║         │                                                           ║
║         ├──► eventTranslator   (so ngưỡng, dịch lệnh → thông báo)   ║
║         │       evaluateSensorData() / translateControl()           ║
║         │                                                           ║
║         ▼                                                           ║
║  ┌────────────────────┐      ┌──────────────┐                       ║
║  │ notificationService│ ───► │   MongoDB    │  lưu notifications     ║
║  │  (lưu DB + dedup)  │      │  (Mongoose)  │  & fcmtokens           ║
║  └─────────┬──────────┘      └──────────────┘                       ║
║            │                                                        ║
║            ▼                                                        ║
║  ┌────────────────┐         ┌──────────────────┐                    ║
║  │   fcmService   │ ──────► │  Firebase (FCM)  │ ──► push tới client ║
║  └────────────────┘         └──────────────────┘                    ║
║                                                                     ║
║  ┌──────────────────────────── REST API (Express) ──────────────┐  ║
║  │ routes → controller → service     [middleware: auth JWT]      │  ║
║  │ /api/v1/notifications/*           [helmet, cors, compression] │  ║
║  └───────────────────────────────────────────────────────────────┘ ║
╚═══════════════════════════════════════════════════════════════════╝
         ▲                                              │ push
         │ REST (JWT)                                   ▼
┌────────┴────────┐                          ┌──────────────────┐
│  App / Web      │ ◄────────────────────────│  Web/Android/iOS  │
│  (client)       │   nhận notification       │  (FCM client)     │
└─────────────────┘                          └──────────────────┘
```

---

## 2. Ba đầu vào của hệ thống

| Đầu vào | Nguồn | Xử lý bởi |
|---|---|---|
| **Dữ liệu cảm biến** | MQTT `xmini/sensor_data` | `mqttHandler` → `eventTranslator.evaluateSensorData()` |
| **Lệnh điều khiển** | MQTT `xmini/control` | `mqttHandler` → `eventTranslator.translateControl()` |
| **Yêu cầu từ client** | REST API (JWT) | `routes` → `controller` → `notificationService` |

---

## 3. Các thành phần (lớp xử lý)

### 3.1. Điểm khởi động — `src/index.js`
Khởi tạo theo thứ tự: nạp `.env` → init Firebase → `startMQTTListener()` → kết nối MongoDB → khởi động Express. Cung cấp `GET /health`. Lỗi tập trung tại error handler cuối.

### 3.2. Tầng cấu hình — `src/config/`
| File | Trách nhiệm |
|---|---|
| `mqtt.js` | Tạo kết nối MQTT (TLS), auto-reconnect 5s, QoS 1 |
| `database.js` | Kết nối MongoDB qua Mongoose |
| `firebase.js` | Khởi tạo Firebase Admin SDK (env hoặc serviceAccountKey.json) |

### 3.3. Tầng dịch vụ — `src/services/`
| File | Trách nhiệm chính |
|---|---|
| `mqttHandler.js` | `startMQTTListener()`: subscribe 2 topic, parse JSON, điều phối sang translator, đẩy kết quả vào `notificationService.notify()` |
| `eventTranslator.js` | `evaluateSensorData(raw)`: so ngưỡng với **edge-detection** (chỉ báo khi đổi trạng thái). `translateControl(raw)`: ánh xạ lệnh → 1 thông báo |
| `notificationService.js` | `notify()`: lưu DB + chống trùng (lỗi 11000) + gọi FCM. `getByUser()`, `markRead()`, `markAllRead()`, `getUnreadCount()` |
| `fcmService.js` | `sendToDevice()`, `sendToUser()`; tự xóa token chết |

### 3.4. Tầng API — `controllers` / `routes` / `middlewares`
- `routes/notificationRoutes.js`: định nghĩa endpoint dưới `/api/v1/notifications`.
- `controllers/notificationController.js`: xử lý request, gọi service, trả JSON chuẩn `{ success, ... }`.
- `middlewares/auth.js`: xác thực JWT Bearer, giải mã lấy `deviceId` (từ `deviceId`/`sub`/`id`).
- `utils/asyncHandler.js`: bọc handler async để bắt lỗi tập trung.

---

## 4. Mô hình dữ liệu (MongoDB)

### Collection `notifications`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `eventId` | String | **unique, sparse** — khóa chống trùng sự kiện |
| `deviceId` | String | bắt buộc — định danh thiết bị/người dùng |
| `title` | String | bắt buộc |
| `body` | String | bắt buộc |
| `type` | String | enum: `disease`, `water`, `nutrition`, `light`, `temperature`, `system` |
| `severity` | String | enum: `critical`, `warning`, `info` (mặc định `info`) |
| `data` | Mixed | payload/ngữ cảnh thô |
| `isRead` | Boolean | mặc định `false` |
| `createdAt`/`updatedAt` | Date | tự động |

Index: `{ deviceId:1, createdAt:-1 }` (lấy lịch sử), `{ deviceId:1, isRead:1 }` (đếm chưa đọc).

### Collection `fcmtokens`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `deviceId` | String | bắt buộc |
| `token` | String | bắt buộc, **unique** — Firebase registration token |
| `device` | String | enum: `web`, `android`, `ios` (mặc định `web`) |
| `createdAt`/`updatedAt` | Date | tự động |

Index: `{ deviceId:1 }`.

---

## 5. Các client trong repo

| Folder | Vai trò | Chạy |
|---|---|---|
| [`../../notification-web/`](../../notification-web/README.md) | Trung tâm thông báo cho người dùng cuối trên browser (push FCM + lịch sử + đã đọc) | `npm run dev` → port 3000 |
| [`../../notification-app/`](../../notification-app/README.md) | App Android (React Native + Expo) — cùng tính năng với web, push native | `npx expo run:android` |
| [`../../test-client/`](../../test-client/README.md) | Công cụ dev: giả lập ESP32 + server .NET của Phong để test end-to-end | `npm run dev` → port 8080 |

Cả ba đăng ký FCM token qua `POST /token` với JWT — backend không phân biệt client nào.

---

## 6. Nguyên tắc thiết kế

- **Chịu lỗi mềm (graceful degradation):** thiếu MQTT/MongoDB/Firebase → log cảnh báo, **không crash**.
- **Chống trùng & chống spam:** `eventId` unique + edge-detection theo trạng thái.
- **Đa thiết bị:** một `deviceId` có nhiều FCM token; push gửi song song tới tất cả.
- **Tách lớp rõ ràng:** config → services → (api: routes/controllers). MQTT và REST dùng chung tầng service.
- **Bảo mật:** JWT cho route bảo vệ, Helmet headers, CORS whitelist, ẩn chi tiết lỗi ở production.

> Chi tiết các luồng chạy thực tế xem [03-luong-hoat-dong.md](03-luong-hoat-dong.md).
