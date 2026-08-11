# Kiến trúc hệ thống

Tài liệu mô tả kiến trúc của **IOT Notification Service** — vai trò từng thành phần, cách chúng kết nối và mô hình dữ liệu.

> **Mô hình hiện tại (Firebase-only, Template Engine, targeting theo deviceId):** 
> - Phong xử lý điều khiển/phát hiện sự kiện xong rồi gọi **`POST /internal/notify`** (header `x-api-key`, body gồm `deviceId`, mã `event`, `severity` và dữ liệu `data`) sang service — **không còn nghe ké MQTT**.
> - Service tích hợp lớp **Template Engine (`templateEngine.js`)** để tự động map từ `event` + `data` ra tiêu đề (`title`) và nội dung (`body`) trực quan trước khi đẩy push.
> - **Push qua Firebase (FCM)** tới **đúng** các client đã đăng ký cùng `deviceId` đó (`fcmService.sendToDeviceId`) — mỗi màn hình kiosk chỉ nhận tin của cây mình đứng cạnh.
> - Màn hình hiển thị (kiosk web / Website SmartFarm) nhận qua **Firebase Web Push** (onMessage khi mở tab, Service Worker khi tab đóng).
> - Đã gỡ bỏ: nghe MQTT (`mqttHandler`/`config/mqtt.js`), SSE/`displayHub`, luồng dịch sensor/ngưỡng cũ, **và toàn bộ lớp user/đăng nhập/JWT** — mọi endpoint HTTP nay xác thực bằng một **API key** chung (`x-api-key`).
> - Lịch sử thông báo được lưu trữ bền vững vào MongoDB để REST đọc lại (hỗ trợ lọc theo từng `deviceId` hoặc xem tất cả `deviceId=all`).

---

## 1. Sơ đồ kiến trúc tổng thể

```
┌──────────────┐
│ Server Phong │  — xử lý nghiệp vụ, phát hiện sự kiện (Event-Driven)
└──────┬───────┘
       │ POST /internal/notify  (x-api-key; body { deviceId, event, data, severity, eventId })
       ▼
╔═════════════════════════════════════════════════════════════════════════════╗
║                      IOT NOTIFICATION SERVICE (Node.js)                     ║
║                                                                             ║
║   ┌──────────────────────────┐   1. Nhận request & xác thực API key         ║
║   │ POST /internal/notify     │   2. Gọi templateEngine.formatEventPayload() ║
║   │  → notificationService    │      (Map event + data -> title, body)      ║
║   │      .ingest()            │   3. Ghi lịch sử vào MongoDB (best-effort)   ║
║   └──────┬───────────────────┘                                              ║
║          │                                                                  ║
║          └──► fcmService.sendToDeviceId ──► Firebase Admin SDK (FCM)        ║
║                (tra token theo deviceId & push song song)                   ║
║                                                                             ║
║   ┌───────────── HTTP API (Express) ──────────────────────────────────┐     ║
║   │ /internal/notify       [x-api-key]  Phong gửi sự kiện vào         │     ║
║   │ /internal/push/token   [x-api-key]  đăng ký/hủy FCM token         │     ║
║   │ /api/v1/notifications  [x-api-key]  REST (lịch sử, đọc/đếm unread)│     ║
║   │                        lọc theo ?deviceId=... (hoặc ?deviceId=all)│     ║
║   └───────────────────────────────────────────────────────────────────┘     ║
╚═════════════════════════════════════════════════════════════════════════════╝
                               │ push (FCM, theo deviceId)
                               ▼
                   ┌──────────────────────────┐
                   │  Web kiosk / Web App     │  Firebase Web Push
                   │  (notification-web)       │  - onMessage (tab mở: toast + bell)
                   │                          │  - Service Worker (tab đóng)
                   └──────────────────────────┘
```

---

## 2. Các đầu vào của hệ thống

| Đầu vào | Nguồn | Xử lý bởi |
|---|---|---|
| **Sự kiện từ Phong** | `POST /internal/notify` (x-api-key, body kèm `deviceId`, `event`, `data`, `severity`, `eventId`) | `internalRoutes` → `notificationService.ingest` → `templateEngine` → `fcmService.sendToDeviceId` |
| **Đăng ký/hủy push** | `POST\|DELETE /internal/push/token` (x-api-key, body kèm `deviceId`, `token`) | `internalRoutes` → lưu/xóa `fcmtokens` |
| **Yêu cầu từ web (REST)** | `/api/v1/notifications/*` (x-api-key, `?deviceId=...`) | `routes` → `controller` → `notificationService` (đọc DB) |

---

## 3. Các thành phần (lớp xử lý)

### 3.1. Điểm khởi động — `src/index.js`
Khởi tạo theo thứ tự: nạp `.env` → init Firebase Admin → kết nối MongoDB → khởi động Express (cấu hình CORS, Helmet, Compression, Morgan). Cung cấp endpoint kiểm tra sức khỏe `GET /health`.

### 3.2. Tầng cấu hình — `src/config/`
| File | Trách nhiệm |
|---|---|
| `firebase.js` | Khởi tạo Firebase Admin SDK (qua biến môi trường `FIREBASE_*` hoặc file `serviceAccountKey.json`) — **cốt lõi phần push** |
| `database.js` | Kết nối MongoDB qua Mongoose (lưu FCM token + lịch sử thông báo; phục vụ REST đọc) |

### 3.3. Tầng tiện ích — `src/utils/`
| File | Trách nhiệm |
|---|---|
| `templateEngine.js` | Sở hữu từ điển `EVENT_TEMPLATES`. Map mã sự kiện (`pump.on`, `water.empty`, `battery.low`, `temp.high`, `device.offline`...) + object `data` $\rightarrow$ `{ title, body, severity, type }`. Hỗ trợ fallback an toàn và giữ nguyên custom title/body nếu Phong gửi sẵn. |
| `asyncHandler.js` | Bọc các handler async để bắt lỗi tập trung, trả về middleware error handler. |

### 3.4. Tầng dịch vụ — `src/services/`
| File | Trách nhiệm chính |
|---|---|
| `notificationService.js` | `ingest(payload, deviceId)`: format payload qua `templateEngine`, chuẩn hóa severity/type, ghi lịch sử vào MongoDB (best-effort, chống trùng qua `eventId`), gọi `fcmService.sendToDeviceId()`. Cung cấp các hàm đọc cho REST web: `getByUser(deviceId, page, limit)` (hỗ trợ `all`), `markRead()`, `markAllRead()`, `getUnreadCount()`. |
| `fcmService.js` | `sendToDevice(token, …)` (1 token) và `sendToDeviceId(deviceId, …)` (gửi tới mọi token có đúng `deviceId`); tự động xóa token chết khi Firebase báo `registration-token-not-registered`. |

### 3.5. Tầng API — `routes` / `controllers` / `middlewares`
- `routes/internalRoutes.js`: 
  - `POST /internal/notify`: Phong gửi thông báo/sự kiện vào (body kèm `deviceId` bắt buộc).
  - `POST|DELETE /internal/push/token`: Web client đăng ký/hủy FCM token kèm `deviceId`.
- `routes/notificationRoutes.js` + `controllers/notificationController.js`: `/api/v1/notifications/*` cho web đọc lịch sử, đếm chưa đọc, đánh dấu đã đọc.
- `middlewares/internalAuth.js`: kiểm tra `x-api-key` header, dùng chung cho cả `/internal/*` lẫn `/api/v1/notifications`.

---

## 4. Kênh giao thông báo: Firebase (FCM)

| Kênh | Cách gửi | Client nhận |
|---|---|---|
| **FCM push** | `fcmService.sendToDeviceId` → Firebase Admin `messaging.send()` (chỉ token cùng `deviceId`) | Web kiosk/Web App qua **Firebase Web Push** (SDK JS + service worker): `onMessage` (tab mở) hiện toast + badge chuông; service worker (`firebase-messaging-sw.js`) hiện thông báo hệ thống khi tab đóng |

---

## 5. Mô hình dữ liệu (MongoDB)

### Collection `fcmtokens`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `deviceId` | String | **bắt buộc** — định danh thiết bị/cây mà màn hình đứng cạnh, client gửi kèm khi đăng ký qua `/internal/push/token` |
| `token` | String | **unique** — Firebase registration token của trình duyệt / app |
| `device` | String | enum: `web`, `android`, `ios` (mặc định `web`) |
| `createdAt`/`updatedAt` | Date | tự động |

### Collection `notifications` (ghi khi nhận `/internal/notify`, phục vụ REST đọc)
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `eventId` | String | Unique index (sparse) — mã sự kiện duy nhất để chống trùng lặp khi retry |
| `deviceId` | String | **bắt buộc** — định danh cây/thiết bị |
| `event` | String | Mã sự kiện thô (`pump.on`, `water.needed`...) |
| `title` | String | Tiêu đề kết xuất từ templateEngine |
| `body` | String | Nội dung kết xuất từ templateEngine |
| `type` | String | enum: `disease`, `water`, `nutrition`, `light`, `temperature`, `system` |
| `severity` | String | enum: `info`, `warning`, `critical` |
| `data` | Mixed | Dữ liệu thô kèm theo |
| `isRead` | Boolean | Trạng thái đã đọc (mặc định `false`) |
| `createdAt` | Date | Thời gian nhận thông báo |

---

## 6. Nguyên tắc thiết kế

- **Firebase là trung tâm:** Deliverable của module là push qua Firebase — mọi thông báo đi qua FCM.
- **Ranh giới rõ ràng:** Phong chịu trách nhiệm phát hiện sự kiện và logic nghiệp vụ, Notification Service chịu trách nhiệm **Template Engine câu chữ / hiển thị và kênh Push**.
- **Targeting theo `deviceId`:** Mỗi màn hình đăng ký token kèm `deviceId` của cây nó đứng cạnh $\rightarrow$ chỉ nhận push của đúng cây đó.
- **Push và lịch sử khớp nhau:** Push (`sendToDeviceId`) và REST lịch sử (lọc `?deviceId=...`) đều theo cùng `deviceId` $\rightarrow$ nhất quán.
- **Chống trùng khi retry:** Nhận diện `eventId` / `id` để upsert vào DB, tránh lặp tin khi server Phong retry.
- **Một API key chung:** Mọi endpoint HTTP (`/internal/*` lẫn `/api/v1/notifications`) xác thực bằng cùng `x-api-key`. Không còn user/JWT.push/token` |
| `token` | String | **unique** — Firebase registration token |
| `device` | String | enum: `web`, `android`, `ios` |
| `createdAt`/`updatedAt` | Date | tự động |

### Collection `notifications` (ghi khi nhận `/internal/notify`, REST đọc lại)
`eventId`, `deviceId`, `title`, `body`, `type`, `severity`, `isRead`, `data`, `createdAt`.

---

## 6. Các client trong repo

| Folder | Vai trò | Nhận thông báo |
|---|---|---|
| [`../../notification-web/`](../../notification-web/README.md) | **Màn hình kiosk cạnh cây** (chạy full-screen) | Firebase Web Push (`onMessage` → danh sách trong trang) |

---

## 7. Nguyên tắc thiết kế

- **Firebase là trung tâm:** deliverable của module là push qua Firebase — mọi thông báo đi qua FCM.
- **Không dịch payload:** service là ống dẫn trung thực từ Phong tới client — Phong đã xử lý nghiệp vụ, service chỉ hiển thị.
- **Targeting theo `deviceId`:** `deviceId` (lấy từ body request) được đối chiếu với `deviceId` của token đã đăng ký (`sendToDeviceId`) — mỗi màn hình chỉ nhận tin của cây mình. `deviceId` là danh tính cấu hình trên chính màn hình kiosk, không gắn với user.
- **Push và lịch sử khớp nhau:** push (`sendToDeviceId`) và REST lịch sử (lọc `?deviceId=`) đều theo cùng `deviceId` → realtime và lịch sử trùng nhau.
- **Chịu lỗi mềm:** thiếu MongoDB/Firebase → log cảnh báo, không crash. FCM lỗi không chặn luồng.
- **Một API key chung:** mọi endpoint HTTP (`/internal/*` lẫn `/api/v1/notifications`) xác thực bằng cùng `x-api-key`. Không còn user/JWT.

> Chi tiết các luồng chạy thực tế xem [03-luong-hoat-dong.md](03-luong-hoat-dong.md).
