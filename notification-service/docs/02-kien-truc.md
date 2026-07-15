# Kiến trúc hệ thống

Tài liệu mô tả kiến trúc của **IOT Notification Service** — vai trò từng thành phần, cách chúng kết nối và mô hình dữ liệu.

> **Mô hình hiện tại (Firebase-only, targeting theo deviceId):** Phong xử lý thông báo xong rồi
> **`POST /internal/notify`** (header `x-api-key`, body kèm `deviceId`) sang service — **không còn
> nghe ké MQTT**. Service **không dịch/biến đổi** payload, và **push qua Firebase (FCM)** tới **đúng**
> các client đã đăng ký cùng `deviceId` đó — mỗi màn hình kiosk chỉ nhận tin của cây mình đứng cạnh.
> Màn hình hiển thị (kiosk web cạnh cây) nhận qua **Firebase Web Push**. Đã gỡ bỏ: nghe MQTT
> (`mqttHandler`/`config/mqtt.js`), SSE/`displayHub`, luồng dịch sensor/ngưỡng, **và toàn bộ lớp
> user/đăng nhập/JWT** — mọi endpoint HTTP nay xác thực bằng một **API key** chung (`x-api-key`).
> Lịch sử thông báo vẫn được ghi vào MongoDB.

---

## 1. Sơ đồ kiến trúc tổng thể

```
┌──────────────┐
│ Server Phong │  — xử lý & sinh thông báo JSON, kèm deviceId
└──────┬───────┘
       │ POST /internal/notify  (x-api-key; body { deviceId, title, body, ... })
       ▼
╔══════════════════════════════════════════════════════════════════╗
║              IOT NOTIFICATION SERVICE (Node.js)                  ║
║                                                                  ║
║   ┌──────────────────────────┐  parse JSON — KHÔNG dịch/biến đổi   ║
║   │ POST /internal/notify     │  deviceId lấy từ body               ║
║   │  → notificationService    │  ghi lịch sử vào MongoDB (best-eff) ║
║   │      .ingest()            │                                     ║
║   └──────┬───────────────────┘                                     ║
║          │                                                         ║
║          └──► fcmService.sendToDeviceId ──► Firebase Admin (FCM)   ║
║                (chỉ token cùng deviceId)                            ║
║                                                                    ║
║   ┌───────────── HTTP API (Express) ───────────────────────────┐  ║
║   │ /internal/notify       [x-api-key]  Phong gửi thông báo vào │  ║
║   │ /internal/push/token   [x-api-key]  đăng ký/hủy FCM token   │  ║
║   │ /api/v1/notifications  [x-api-key]  REST (web, đọc DB)      │  ║
║   │                        lọc theo ?deviceId=...               │  ║
║   └────────────────────────────────────────────────────────────┘  ║
╚══════════════════════════════════════════════════════════════════╝
                              │ push (FCM, theo deviceId)
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
| **Thông báo từ Phong** | `POST /internal/notify` (x-api-key, body kèm `deviceId`) | `internalRoutes` → `notificationService.ingest` → `fcmService.sendToDeviceId` |
| **Đăng ký/hủy push** | `POST\|DELETE /internal/push/token` (x-api-key, body kèm `deviceId`) | `internalRoutes` → lưu/xóa `fcmtokens` |
| **Yêu cầu từ web (REST)** | `/api/v1/notifications/*` (x-api-key, `?deviceId=...`) | `routes` → `controller` → `notificationService` (đọc DB) |

> Payload là **JSON object bất kỳ**; `deviceId` lấy từ body. Service chỉ bóc `title`/`body`/
> `severity`/`type` để đặt tiêu đề/nội dung push cho đẹp — ngoài `deviceId` (bắt buộc), **không bắt
> buộc** field nào khác, không đổi dữ liệu gốc.

---

## 3. Các thành phần (lớp xử lý)

### 3.1. Điểm khởi động — `src/index.js`
Khởi tạo theo thứ tự: nạp `.env` → init Firebase → kết nối MongoDB → khởi động Express. Cung cấp `GET /health`. Lỗi tập trung tại error handler cuối. (Không còn MQTT listener.)

### 3.2. Tầng cấu hình — `src/config/`
| File | Trách nhiệm |
|---|---|
| `firebase.js` | Khởi tạo Firebase Admin SDK (env hoặc serviceAccountKey.json) — **cốt lõi phần push** |
| `database.js` | Kết nối MongoDB (lưu FCM token + lịch sử; REST đọc) |

### 3.3. Tầng dịch vụ — `src/services/`
| File | Trách nhiệm chính |
|---|---|
| `notificationService.js` | `ingest(payload, deviceId)`: chuẩn hóa (bóc `title`/`body`/`type`/`severity`), ghi lịch sử vào MongoDB (best-effort, chống trùng qua `eventId` nếu có) rồi gọi `fcmService.sendToDeviceId()`. Không dịch/biến đổi. Cộng thêm phần **đọc** cho REST web (lọc theo `deviceId`): `getByUser()`, `markRead()`, `markAllRead()`, `getUnreadCount()`. |
| `fcmService.js` | `sendToDevice(token, …)` (1 token) và `sendToDeviceId(deviceId, …)` (gửi tới các token có đúng `deviceId`); tự xóa token chết khi Firebase báo không hợp lệ. Không còn `sendToAll`. |

### 3.4. Tầng API — `routes` / `controllers` / `middlewares`
- `routes/internalRoutes.js`: `POST /internal/notify` — Phong gửi thông báo vào (body kèm `deviceId` bắt buộc); `POST|DELETE /internal/push/token` — đăng ký/hủy FCM token (body kèm `deviceId` bắt buộc khi đăng ký). Bảo vệ bằng **API key** (`internalAuth`).
- `routes/notificationRoutes.js` + `controllers/notificationController.js`: `/api/v1/notifications/*` cho web — cũng bảo vệ bằng **cùng API key** (`internalAuth`); lấy `deviceId` từ `?deviceId=...` (hoặc body).
- `middlewares/internalAuth.js`: kiểm tra `x-api-key` header, dùng chung cho cả `/internal/*` lẫn `/api/v1/notifications`.
- `utils/asyncHandler.js`: bọc handler async để bắt lỗi tập trung.

> Đã **xóa** hoàn toàn lớp user/đăng nhập: `routes/authRoutes.js`, `controllers/authController.js`,
> `models/User.js`, `middlewares/auth.js`, `seed-users.js`, `generate-token.js`. `.env` không còn
> `JWT_SECRET`/`JWT_EXPIRES`; chỉ còn `INTERNAL_API_KEY` dùng chung cho mọi endpoint HTTP.

---

## 4. Kênh giao thông báo: Firebase (FCM)

| Kênh | Cách gửi | Client nhận |
|---|---|---|
| **FCM push** | `fcmService.sendToDeviceId` → Firebase Admin `messaging.send()` (chỉ token cùng `deviceId`) | Web kiosk qua **Firebase Web Push** (SDK JS + service worker): `onMessage` (tab mở) hiện danh sách trong trang; service worker hiện khi tab đóng |

> Đã **bỏ SSE**. Màn hình hiển thị dựa hoàn toàn vào Firebase Web Push. Chi tiết luồng xem
> [03-luong-hoat-dong.md](03-luong-hoat-dong.md); cấu hình Firebase 2 phía xem [01-firebase-setup.md](01-firebase-setup.md).

---

## 5. Mô hình dữ liệu (MongoDB)

> Lưu ý: `notificationService.ingest` **ghi mỗi tin vào collection `notifications`** (best-effort — lỗi ghi DB không
> chặn việc đẩy push), đồng thời push qua FCM theo `deviceId`. Màn hình kiosk hiện danh sách realtime
> từ chính message FCM (`onMessage`); REST `/api/v1/notifications?deviceId=...` đọc lại lịch sử bền
> vững từ DB. `fcmtokens` và `notifications` đều được dùng đầy đủ.

### Collection `fcmtokens`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `deviceId` | String | **bắt buộc** — danh tính của màn hình kiosk (cây/thiết bị nó đứng cạnh), client gửi kèm khi đăng ký qua `/internal/push/token` |
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
