# Kiến trúc hệ thống

Tài liệu mô tả kiến trúc của **IOT Notification Service** — vai trò từng thành phần, cách chúng kết nối và mô hình dữ liệu.

> **Mô hình hiện tại (Firebase-only, Template Engine, thông báo theo người dùng):** 
> - Phong xử lý điều khiển/phát hiện sự kiện xong rồi gọi **`POST /internal/notify`** (header `x-api-key`, body gồm `deviceId`, mã `event`, `severity` và dữ liệu `data`) sang service — **không còn nghe ké MQTT**.
> - Service tích hợp lớp **Template Engine (`templateEngine.js`)** để tự động map từ `event` + `data` ra tiêu đề (`title`) và nội dung (`body`) trực quan trước khi đẩy push.
> - **Người dùng đăng nhập bằng tài khoản bên server .NET của Phong** (`plant-tree-iot`, `POST /api/auth/login` → JWT). Web quản lý (do team Frontend làm; `notification-web` là trang test giả lập) gọi các API `/api/v1/*` của Notify với header `Authorization: Bearer <JWT>`.
> - Notify **mượn** hệ thống tài khoản + phân quyền của Phong: xác thực JWT bằng cách gọi `GET {PLANT_API_URL}/api/devices` của Phong với chính JWT đó → biết người dùng được xem những cây (`deviceId`) nào (sở hữu hoặc được share). Notify **không cần `JWT_SECRET`** của Phong, Phong **không phải sửa code**.
> - **Push qua Firebase (FCM)** tới **mọi người dùng đang có quyền xem** `deviceId` của sự kiện — quyền được hỏi lại Phong ngay lúc gửi.
> - Web nhận qua **Firebase Web Push** (onMessage khi mở tab, Service Worker khi tab đóng).
> - Lịch sử thông báo lưu bền vững trong MongoDB; trạng thái **đã đọc tính riêng cho từng người dùng**.
> - `INTERNAL_API_KEY` (`x-api-key`) **chỉ** dùng cho `POST /internal/notify` (server Phong gọi vào). Web/app người dùng không dùng key này.

---

## 1. Sơ đồ kiến trúc tổng thể

```
┌──────────────────────────┐
│ Server Phong (.NET)       │  — xử lý nghiệp vụ, phát hiện sự kiện (Event-Driven)
│ plant-tree-iot            │  — tài khoản người dùng (JWT) + quyền theo cây (owner + members)
└──────┬─────────────▲─────┘
       │             │ GET /api/devices  (Bearer <JWT người dùng>)
       │             │ → 200: danh sách cây user sở hữu / được share
       │             │ → 401/403: JWT sai/hết hạn
       │ POST /internal/notify  (x-api-key; body { deviceId, event, data, severity, eventId })
       ▼             │
╔═════════════════════════════════════════════════════════════════════════════╗
║                      IOT NOTIFICATION SERVICE (Node.js)                     ║
║                                                                             ║
║   ┌──────────────────────────┐   1. Xác thực API key                        ║
║   │ POST /internal/notify     │   2. templateEngine.formatEventPayload()     ║
║   │  → notificationService    │      (Map event + data -> title, body)      ║
║   │      .ingest()            │   3. Ghi lịch sử vào MongoDB (lấy _id)       ║
║   └──────┬───────────────────┘                                              ║
║          │                                                                  ║
║          ├──► 4. FCMToken còn hạn (expiresAt > now) → gom theo JWT          ║
║          ├──► 5. recipientSelector: plantAccess.resolveAccess(jwt)          ║
║          │       (hỏi Phong, cache AUTH_CACHE_SECONDS) → giữ người có quyền  ║
║          └──► 6. fcmService.sendToTokens ──► Firebase Admin SDK (FCM)       ║
║                                                                             ║
║   ┌───────────── HTTP API (Express) ──────────────────────────────────┐     ║
║   │ /internal/notify        [x-api-key]   Phong gửi sự kiện vào       │     ║
║   │ /api/v1/me              [Bearer JWT]  user + danh sách cây        │     ║
║   │ /api/v1/notifications/* [Bearer JWT]  lịch sử, đếm/đánh dấu đọc   │     ║
║   │ /api/v1/push/token      [Bearer JWT]  đăng ký/hủy FCM token       │     ║
║   │   (userAuth → plantAccess.resolveAccess: hỏi Phong, có cache)     │     ║
║   └───────────────────────────────────────────────────────────────────┘     ║
╚═════════════════════════════════════════════════════════════════════════════╝
            ▲ REST (Bearer JWT)                 │ push (FCM, theo người dùng có quyền)
            │                                   ▼
   ┌────────┴──────────────────────────────────────────┐
   │  Web quản lý của người dùng                         │  Firebase Web Push
   │  (web của team Frontend; notification-web là trang test)    │  - onMessage (tab mở: toast + chuông)
   │  Đăng nhập: POST {Phong}/api/auth/login → JWT       │  - Service Worker (tab đóng)
   └─────────────────────────────────────────────────────┘
```

---

## 2. Các đầu vào của hệ thống

| Đầu vào | Nguồn | Xử lý bởi |
|---|---|---|
| **Sự kiện từ Phong** | `POST /internal/notify` (x-api-key, body kèm `deviceId`, `event`, `data`, `severity`, `eventId`) | `internalRoutes` → `notificationService.ingest` → `templateEngine` → `recipientSelector` → `fcmService.sendToTokens` |
| **Thông tin người dùng** | `GET /api/v1/me` (Bearer JWT) | `userRoutes` → `userAuth` → `notificationController.getMe` |
| **Đăng ký/hủy push** | `POST\|DELETE /api/v1/push/token` (Bearer JWT, body `{ token, device }`) | `userRoutes` → `userAuth` → lưu/xóa `fcmtokens` theo `userId` |
| **Yêu cầu từ web (REST)** | `/api/v1/notifications/*` (Bearer JWT, `?deviceId=` tuỳ chọn) | `notificationRoutes` → `userAuth` → `controller` → `notificationService` (đọc DB, lọc theo cây có quyền) |

---

## 3. Các thành phần (lớp xử lý)

### 3.1. Điểm khởi động — `src/index.js`
Khởi tạo theo thứ tự: nạp `.env` → init Firebase Admin → khởi động Express (cấu hình CORS, Helmet, Compression, Morgan) → mount `/api/v1/notifications`, `/api/v1` (me + push token), `/internal` → kết nối MongoDB rồi `listen`. Cung cấp endpoint kiểm tra sức khỏe `GET /health`.

### 3.2. Tầng cấu hình — `src/config/`
| File | Trách nhiệm |
|---|---|
| `firebase.js` | Khởi tạo Firebase Admin SDK (qua biến môi trường `FIREBASE_*` hoặc file `serviceAccountKey.json`) — **cốt lõi phần push** |
| `database.js` | Kết nối MongoDB qua Mongoose (lưu FCM token + lịch sử thông báo; phục vụ REST đọc) |

Biến môi trường liên quan xác thực người dùng:

| Biến | Ý nghĩa |
|---|---|
| `PLANT_API_URL` | Địa chỉ server .NET của Phong, vd `http://localhost:8000` (dev, `dotnet run`) / `http://host.docker.internal:8080` (Notify chạy Docker). Thiếu → `/api/v1/*` trả 503 và không gửi push cho ai. |
| `AUTH_CACHE_SECONDS` | Thời gian nhớ tạm kết quả hỏi quyền từ Phong (mặc định `60`). Thu hồi / thêm share có hiệu lực trong khoảng này. |
| `INTERNAL_API_KEY` | API key **chỉ** cho `POST /internal/notify` (server Phong gọi). |

### 3.3. Tầng tiện ích — `src/utils/`
| File | Trách nhiệm |
|---|---|
| `templateEngine.js` | Sở hữu từ điển `EVENT_TEMPLATES`. Map mã sự kiện (`pump.on`, `water.empty`, `battery.low`, `temp.high`, `device.offline`...) + object `data` $\rightarrow$ `{ title, body, severity, type }`. Hỗ trợ fallback an toàn và giữ nguyên custom title/body nếu Phong gửi sẵn. |
| `deviceScope.js` | Tính phạm vi cây cho 1 request: không truyền `?deviceId` → mọi cây người dùng có quyền; `deviceId` thuộc quyền → chỉ cây đó; ngoài quyền → 403. |
| `asyncHandler.js` | Bọc các handler async để bắt lỗi tập trung, trả về middleware error handler. |

### 3.4. Tầng dịch vụ — `src/services/`
| File | Trách nhiệm chính |
|---|---|
| `plantAccess.js` | `resolveAccess(jwt)`: gọi `GET {PLANT_API_URL}/api/devices` với JWT người dùng. 200 → `{ status: 'ok', userId, email, exp, devices, deviceIds }` (`userId` decode từ claim `nameid` của JWT, không verify chữ ký vì Phong đã kiểm); 401/403 → `unauthorized`; lỗi mạng/5xx/thiếu `PLANT_API_URL` → `unavailable`. Cache theo chuỗi JWT trong `AUTH_CACHE_SECONDS` (không cache `unavailable`). Dùng chung cho REST và chọn người nhận push. |
| `recipientSelector.js` | `selectRecipients(tokens, deviceId, resolveAccess)`: gom token theo JWT, mỗi JWT hỏi quyền 1 lần, chỉ giữ token của người **hiện đang** có quyền xem `deviceId`. `unauthorized`/`unavailable` → không gửi (đóng an toàn). |
| `notificationService.js` | `ingest(payload, deviceId)`: format qua `templateEngine`, chuẩn hóa severity/type, **ghi lịch sử trước** (chống trùng qua `eventId`, lấy `_id` làm `notificationId`), lấy token còn hạn, gọi `selectRecipients` rồi `fcmService.sendToTokens()`. Hàm đọc cho REST theo người dùng: `list(userId, deviceIds, { unread, page, limit })`, `unreadCount()`, `markRead()`, `markAllRead()` (đã đọc theo `readBy`). |
| `fcmService.js` | `sendToTokens(tokens, …)` gửi song song tới danh sách token đã chọn; `sendToDevice(token, …)` gửi 1 token (chỉ `webpush`); tự xóa token chết khi Firebase báo `registration-token-not-registered`. Chưa cấu hình Firebase → bỏ qua push, không ném lỗi. |

### 3.5. Tầng API — `routes` / `controllers` / `middlewares`
- `routes/internalRoutes.js`: 
  - `POST /internal/notify`: Phong gửi thông báo/sự kiện vào (body kèm `deviceId` bắt buộc). Endpoint **duy nhất** dùng API key.
- `routes/userRoutes.js` (Bearer JWT):
  - `GET /api/v1/me` → `{ userId, email, devices: [{ deviceId, name }] }` để client vẽ bộ lọc theo tên cây.
  - `POST /api/v1/push/token` body `{ token, device? }` → upsert token gắn với user đang đăng nhập (kèm JWT + hạn JWT). Token đã thuộc user khác → chuyển chủ.
  - `DELETE /api/v1/push/token` body `{ token }` → xóa (chỉ khi token thuộc user này) — gọi khi đăng xuất.
- `routes/notificationRoutes.js` + `controllers/notificationController.js` (Bearer JWT):
  - `GET /api/v1/notifications?deviceId=&unread=true&page=1&limit=20` → `{ items, unreadCount, page, limit, hasMore }`.
  - `GET /api/v1/notifications/unread-count?deviceId=` → `{ unreadCount }`.
  - `PATCH /api/v1/notifications/:id/read` → đánh dấu đã đọc cho user này (không thuộc quyền / không tồn tại → 404).
  - `PATCH /api/v1/notifications/read-all?deviceId=` → đánh dấu tất cả (hoặc của 1 cây) đã đọc cho user này.
  - `deviceId` không thuộc quyền → **403**.
- `middlewares/userAuth.js`: đọc `Authorization: Bearer <JWT>`, gọi `resolveAccess` → gắn `req.user = { userId, email, exp, devices, deviceIds }`. Thiếu/sai/hết hạn JWT → **401**; không hỏi được Phong → **503**.
- `middlewares/internalAuth.js`: kiểm tra header `x-api-key` cho `/internal/notify`.

---

## 4. Kênh giao thông báo: Firebase (FCM)

| Kênh | Cách gửi | Client nhận |
|---|---|---|
| **FCM push** | `recipientSelector.selectRecipients` (chỉ người có quyền xem `deviceId`) → `fcmService.sendToTokens` → Firebase Admin `messaging.send()` | Web quản lý của người dùng qua **Firebase Web Push** (SDK JS + service worker): `onMessage` (tab mở) hiện toast + badge chuông; service worker (`firebase-messaging-sw.js`) hiện thông báo hệ thống khi tab đóng |

Một Firebase project duy nhất (`smartfarmai-f1426`) cho cả trang test lẫn web của team Frontend. `data` FCM gồm `notificationId, deviceId, event, type, severity, raw` — `notificationId` để client đánh dấu đã đọc.

---

## 5. Mô hình dữ liệu (MongoDB)

### Collection `fcmtokens`
| Trường | Kiểu | Ghi chú |
|---|---|---|
| `userId` | String | **bắt buộc** — userId tài khoản bên Phong (claim `nameid` của JWT) |
| `token` | String | **unique** — Firebase registration token của trình duyệt / app |
| `device` | String | enum: `web`, `android`, `ios` (mặc định `web`) |
| `jwt` | String | JWT của người dùng lúc đăng ký, dùng để hỏi lại Phong quyền xem cây mỗi lần gửi push. **Nhạy cảm**: `select: false`, không bao giờ trả ra API hay ghi log |
| `expiresAt` | Date | = `exp` của JWT; hết hạn thì token không được chọn gửi push nữa (đăng nhập lại → đăng ký lại) |
| `createdAt`/`updatedAt` | Date | tự động |

Index: `{ userId: 1 }`, `{ expiresAt: 1 }`.

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
| `readBy` | [String] | Danh sách `userId` đã đọc (mặc định `[]`). API trả về `isRead` **tính theo người xem** và không lộ mảng này |
| `createdAt` | Date | Thời gian nhận thông báo |

Index: `{ deviceId: 1, createdAt: -1 }`.

---

## 6. Các client trong repo

| Folder | Vai trò | Nhận thông báo |
|---|---|---|
| [`../../notification-web/`](../../notification-web/README.md) | **Trang test giả lập web quản lý của team Frontend**: đăng nhập tài khoản Phong → JWT → gọi API Notify → nhận FCM web | Firebase Web Push (`onMessage` → nạp lại danh sách + toast + chuông) |

Web quản lý thật tích hợp theo [hướng dẫn tích hợp web quản lý](04-tich-hop-web.md).

---

## 7. Nguyên tắc thiết kế

- **Firebase là trung tâm:** deliverable của module là push qua Firebase — mọi thông báo đi qua FCM.
- **Ranh giới rõ ràng:** Phong chịu trách nhiệm phát hiện sự kiện, logic nghiệp vụ, **tài khoản và quyền theo cây**; Notification Service chịu trách nhiệm **Template Engine câu chữ / hiển thị, lịch sử và kênh Push**.
- **Phong là nguồn sự thật duy nhất về quyền:** Notify không tự làm tài khoản, không cần `JWT_SECRET` của Phong; mọi kiểm tra quyền đi qua `GET /api/devices` của Phong (có cache `AUTH_CACHE_SECONDS`).
- **Thông báo theo người dùng:** sự kiện của cây X → push tới mọi token của mọi người **hiện đang** có quyền xem X. Quyền hỏi lại lúc gửi → thu hồi / thêm share có hiệu lực trong vòng `AUTH_CACHE_SECONDS`.
- **Đóng an toàn:** phiên hết hạn / đăng xuất → ngừng nhận push; Phong không truy cập được → không gửi push cho ai (lịch sử vẫn được lưu, vẫn trả 202).
- **Push và lịch sử khớp nhau:** push và REST lịch sử cùng dựa trên danh sách cây người dùng có quyền → realtime và lịch sử nhất quán. Đã đọc tính riêng từng người (`readBy`).
- **Chống trùng khi retry:** nhận diện `eventId` / `id` để upsert vào DB, tránh lặp tin khi server Phong retry.
- **Chịu lỗi mềm:** thiếu Firebase → log cảnh báo, không crash; lỗi ghi lịch sử không chặn push; FCM lỗi không chặn luồng.
- **Hai cơ chế xác thực tách biệt:** `x-api-key` chỉ cho server Phong gọi `POST /internal/notify`; mọi `/api/v1/*` dùng Bearer JWT của người dùng.

> Chi tiết các luồng chạy thực tế xem [03-luong-hoat-dong.md](03-luong-hoat-dong.md).
