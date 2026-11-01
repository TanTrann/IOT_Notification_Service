# Luồng hoạt động

Tài liệu mô tả các luồng chạy thực tế theo **mô hình hiện tại** (Phong `POST /internal/notify`,
xử lý qua **Template Engine**, **push qua Firebase theo người dùng** — người dùng đăng nhập bằng tài khoản bên
server .NET của Phong và chỉ nhận/xem thông báo của các cây mình sở hữu hoặc được share).

1. [Khởi động service](#1-luồng-khởi-động)
2. [Xác thực người dùng & quyền theo cây](#2-luồng-xác-thực-người-dùng)
3. [Thông báo từ Phong → Template Engine → push Firebase](#3-luồng-thông-báo)
4. [Client đăng nhập, đăng ký & nhận push (Firebase Web Push)](#4-luồng-client)
5. [Cơ chế đảm bảo chất lượng](#5-cơ-chế-đảm-bảo-chất-lượng)
6. [Cách thử nhanh (end-to-end)](#6-cách-thử-nhanh-end-to-end)

---

## 1. Luồng khởi động

```
npm start → src/index.js
   1. dotenv          → nạp biến môi trường từ .env (PLANT_API_URL, AUTH_CACHE_SECONDS, INTERNAL_API_KEY, ...)
   2. firebase.js     → init Firebase Admin SDK (log thành công / cảnh báo)
   3. Express         → middleware (helmet, cors, compression, morgan)
                      → mount /api/v1/notifications, /api/v1 (me, push/token)   [Bearer JWT của Phong]
                      → mount /internal (notify)                               [x-api-key]
                      → GET /health
   4. database.js     → kết nối MongoDB bắt buộc (lưu FCM token + lịch sử)
   5. listen PORT (mặc định 3001)
```

---

## 2. Luồng xác thực người dùng

Mọi route `/api/v1/*` đi qua middleware `userAuth`. Notify **không tự làm tài khoản** và **không cần `JWT_SECRET`**
của Phong — nó hỏi chính server Phong.

```
Web quản lý ──(1) POST {PLANT_API_URL}/api/auth/login { email, password }──► Server Phong
            ◄──────────────────────── { token (JWT, hạn 24h), email, displayName, role }

Web quản lý ──(2) GET /api/v1/...  (Authorization: Bearer <JWT>)──► IOT Notification Service
                          │
                          ▼
                  userAuth → plantAccess.resolveAccess(jwt)
                          │  cache theo JWT còn hạn (AUTH_CACHE_SECONDS, mặc định 60s)? → dùng luôn
                          │  chưa có → GET {PLANT_API_URL}/api/devices (Bearer <JWT>) sang Phong
                          ▼
                  ├─ 200        → JWT hợp lệ. userId = claim `nameid` trong JWT (decode, không verify),
                  │               devices = các cây user sở hữu HOẶC được share
                  │               → req.user = { userId, email, exp, devices, deviceIds }
                  ├─ 401 / 403  → trả 401 (client đăng nhập lại)
                  └─ lỗi mạng / 5xx / thiếu PLANT_API_URL → trả 503 ("Không xác thực được với server Phong")
```

Sau đó controller chỉ đọc/ghi thông báo có `deviceId` thuộc `req.user.deviceIds`:
- Không truyền `?deviceId` → mọi cây có quyền; truyền `deviceId` thuộc quyền → chỉ cây đó; **ngoài quyền → 403**.
- `isRead` trả về được tính **theo người xem** (`readBy` chứa `userId`); đánh dấu đọc chỉ ảnh hưởng người đó.

---

## 3. Luồng thông báo

**Kích hoạt:** server của Phong xử lý xong một sự kiện nghiệp vụ rồi gọi `POST /internal/notify` (kèm header
`x-api-key`, body gồm `deviceId`, mã `event`, object `data`, `severity`, `eventId`).

```
Phong ──POST /internal/notify──► IOT Notification Service
       (x-api-key; body { deviceId, event, data, severity, eventId })
                          │
                          ▼
                  internalRoutes → notificationService.ingest(payload, deviceId)
                          │ 
                          ├─► 1. templateEngine.formatEventPayload(payload)
                          │      Map event + data -> { title, body, severity, type }
                          │      (Có fallback nếu event mới; hỗ trợ custom title/body)
                          │
                          ├─► 2. Ghi lịch sử vào MongoDB TRƯỚC (chống trùng qua eventId, readBy: [])
                          │      → lấy _id làm notificationId gửi kèm push (lỗi ghi → notificationId rỗng, vẫn push)
                          │
                          ├─► 3. FCMToken.find({ expiresAt > now }) — chỉ token có phiên đăng nhập còn hạn
                          │
                          ├─► 4. recipientSelector.selectRecipients(tokens, deviceId, resolveAccess)
                          │      gom token theo JWT → mỗi JWT hỏi lại Phong (GET /api/devices, dùng chung cache)
                          │      ├─ ok + có deviceId trong danh sách cây → GIỮ token
                          │      ├─ ok nhưng không có quyền cây này       → bỏ
                          │      ├─ unauthorized (phiên chết)              → bỏ
                          │      └─ unavailable (Phong lỗi)                → bỏ + log cảnh báo (đóng an toàn)
                          ▼
                  fcmService.sendToTokens(recipients, { title, body, data })
                          │
                          ▼
                  messaging.send() song song ──► Firebase ──► web của những người có quyền xem cây đó
                          (token chết tự bị xóa)
```

Hệ quả:
- **Thu hồi share / được share cây mới** có hiệu lực với push trong vòng `AUTH_CACHE_SECONDS` (60s).
- **Phiên đăng nhập hết hạn** (`expiresAt` = `exp` của JWT) hoặc **đăng xuất** (`DELETE /api/v1/push/token`) → ngừng nhận push.
  Đăng nhập lại → đăng ký lại token → nhận tiếp.
- **Phong không truy cập được** → không gửi push cho ai, nhưng lịch sử vẫn được lưu và vẫn trả `202`.

### Body mẫu từ Phong (JSON, `deviceId` bắt buộc)
```json
{
  "deviceId": "ESP32S3_Zone1",
  "event": "pump.on",
  "data": {
    "soilPercent": 25,
    "soilOnPct": 35
  },
  "severity": "info",
  "eventId": "evt_20260811_001"
}
```

Service trả `202 { success: true, deviceId, event, title, body, recipients }`. 
- `title`: `"Đang tưới cây"` *(sinh bởi Template Engine)*
- `body`: `"Đất 25% dưới ngưỡng 35%, bơm đang chạy"` *(sinh bởi Template Engine)*
- `recipients`: số token đã gửi push (`recipients: 0` nghĩa là chưa có người dùng nào **có quyền xem cây này** đăng ký nhận push với phiên còn hạn, hoặc không hỏi được Phong).

---

## 4. Luồng client (Firebase Web Push)

Client là **web quản lý của người dùng** (web do team Frontend làm) tích hợp Firebase JS SDK; `notification-web` là trang test
giả lập đúng các bước đó. Chi tiết tích hợp xem [hướng dẫn tích hợp web quản lý](04-tich-hop-web.md).

### 4.1. Đăng nhập & đăng ký nhận push
```
Web client
   1. Đăng nhập bên Phong: POST {PLANT_API_URL}/api/auth/login { email, password } → JWT (lưu phía client)
   2. GET /api/v1/me (Bearer JWT) → { userId, email, devices: [{ deviceId, name }] } để vẽ bộ lọc theo cây
   3. Xin quyền notification (browser Notification.requestPermission())
   4. getToken({ vapidKey }) → registration token
   5. Đăng ký token về service:
        POST /api/v1/push/token  (Authorization: Bearer <JWT>)
        body { token, device: 'web' }
              │
              ▼
   Server lưu vào fcmtokens: { token, userId, device, jwt, expiresAt = exp của JWT }
   (gọi lại sau MỖI lần đăng nhập để JWT lưu kèm luôn còn hạn)
   6. Đăng xuất: DELETE /api/v1/push/token { token } rồi mới xoá JWT phía client
```

### 4.2. Nhận & hiển thị
```
fcmService.sendToTokens ──► Firebase ──► web của người dùng có quyền xem cây
   - Tab đang mở (foreground): messaging.onMessage(payload)
        → nạp lại danh sách (GET /api/v1/notifications) + toast + cập nhật số chưa đọc trên chuông
   - Tab đóng/nền: service worker firebase-messaging-sw.js hiển thị notification hệ thống
```

### 4.3. Đọc lịch sử & đánh dấu đã đọc (Bearer JWT)
```
GET   /api/v1/notifications?deviceId=&unread=true&page=1&limit=20 → { items, unreadCount, page, limit, hasMore }
GET   /api/v1/notifications/unread-count?deviceId=                 → { unreadCount }
PATCH /api/v1/notifications/:id/read                                → đánh dấu đã đọc cho user này
                                                                      (id lấy từ data.notificationId của push hoặc từ danh sách)
PATCH /api/v1/notifications/read-all?deviceId=                      → đánh dấu tất cả (hoặc 1 cây) đã đọc
```
Bất kỳ API nào trả **401** → client xoá JWT và quay về màn đăng nhập; **503** → server Phong tạm không truy cập được.

---

## 5. Cơ chế đảm bảo chất lượng

| Cơ chế | Mục đích | Vị trí |
|---|---|---|
| **Template Engine tự động** | Chuẩn hóa câu chữ tiếng Việt, tách biệt logic nghiệp vụ khỏi UI | `src/utils/templateEngine.js` |
| **Fallback an toàn** | Không crash/mất tin khi nhận event chưa từng khai báo | `templateEngine.formatEventPayload()` |
| **Lưu lịch sử best-effort** | Lỗi ghi DB không làm gãy việc push realtime (chỉ thiếu `notificationId`) | `notificationService.ingest()` |
| **Chống trùng qua `eventId`** | Phong retry không tạo bản ghi lặp trong MongoDB | `notificationService._saveHistory()` |
| **Tự xóa token chết** | Giữ DB token sạch khi người dùng gỡ app/xóa quyền push | `fcmService.sendToDevice()` |
| **Quyền hỏi lại lúc gửi** | Chỉ người đang có quyền xem cây mới nhận push; thu hồi share có hiệu lực trong `AUTH_CACHE_SECONDS` | `services/recipientSelector.js` |
| **Đóng an toàn** | Phiên hết hạn / Phong lỗi → không gửi push (không lộ tin cho người không còn quyền) | `recipientSelector.js`, lọc `expiresAt` |
| **Cache quyền** | Giảm số lần gọi Phong (cache theo JWT, không cache lỗi) | `services/plantAccess.js` |
| **Xác thực tách biệt** | `x-api-key` chỉ cho `/internal/notify`; `/api/v1/*` dùng Bearer JWT của Phong | `middlewares/internalAuth.js`, `middlewares/userAuth.js` |
| **JWT lưu kèm token được bảo vệ** | `jwt` trong `fcmtokens` `select: false`, không trả ra API, không ghi log | `models/FCMToken.js` |
| **Test tự động** | `npm test` (node:test, 23 test) cho `plantAccess`, `userAuth`, `recipientSelector`, `deviceScope` | `notification-service/test/` |

---

## 6. Cách thử nhanh (end-to-end)

1. Chạy server .NET của Phong (`plant-tree-iot`) local — mặc định `http://localhost:8000` khi `dotnet run` — và có sẵn
   một tài khoản đã sở hữu / được share ít nhất một cây (vd `ESP32S3_Zone1`).
2. Chạy service: `cd notification-service` → đặt `PLANT_API_URL=http://localhost:8000` trong `.env` → `npm run dev`.
   (Chạy test tự động: `npm test`.)
3. Mở trang test: `cd notification-web && npm run dev` → mở `http://localhost:3003` →
   **đăng nhập bằng email/mật khẩu tài khoản Phong** → menu tài khoản → **Bật nhận push** (cấp quyền browser).
   (Địa chỉ server nằm ở 2 hằng số `PLANT_API_URL`, `NOTIFY_URL` đầu `index.html`.)
4. Bắn thử một sự kiện cho một cây tài khoản đó có quyền (giả lập Phong gọi `POST /internal/notify`):
   ```bash
   cd notification-service
   node scripts/publish-test.js
   ```
   Hoặc truyền payload custom:
   ```bash
   node scripts/publish-test.js '{"event":"water.empty","data":{}}' ESP32S3_Zone1
   ```

   Hoặc gọi trực tiếp bằng curl:
   ```bash
   curl -X POST http://localhost:3001/internal/notify \
     -H "Content-Type: application/json" \
     -H "x-api-key: <INTERNAL_API_KEY>" \
     -d '{
       "deviceId": "ESP32S3_Zone1",
       "event": "temp.high",
       "data": { "temperature": 38.5 },
       "severity": "warning",
       "eventId": "evt_test_001"
     }'
   ```
   $\rightarrow$ Web của người dùng có quyền xem `ESP32S3_Zone1` lập tức nổ thông báo: **"Nhiệt độ cao — 38.5°C, cây có thể bị stress nhiệt"**.
   Bắn sự kiện cho một `deviceId` tài khoản đó **không** có quyền → `recipients: 0`, web không nhận gì.
5. Thử API người dùng bằng curl (JWT lấy từ bước đăng nhập):
   ```bash
   curl http://localhost:3001/api/v1/me -H "Authorization: Bearer <JWT>"
   curl "http://localhost:3001/api/v1/notifications?unread=true" -H "Authorization: Bearer <JWT>"
   ```
