# Tích hợp thông báo vào website — dành cho dev web

Tài liệu bàn giao cho người phụ trách website: cách hiển thị danh sách thông báo và nhận
push notification từ **IOT Notification Service** trên trang của bạn.

Bạn **không cần đụng tới nguồn thông báo** — Phong xử lý và gửi thông báo vào service
(`POST /internal/notify`), service lo phần lưu trữ và đẩy push. Website/màn hình kiosk chỉ làm 3 việc:

1. **Cấu hình** Server URL + `deviceId` (cây/thiết bị màn hình này đứng cạnh) + API key.
2. **Gọi REST API** để hiển thị danh sách thông báo, đếm chưa đọc, đánh dấu đã đọc.
3. **Đăng ký FCM token** (kèm `deviceId`) để trình duyệt nhận push realtime của đúng cây đó.

> Tham khảo triển khai mẫu hoàn chỉnh (1 file HTML): [`../../notification-web/index.html`](../../notification-web/index.html)

> ⚠️ **Mô hình hiện tại (Phong `POST /internal/notify`, targeting theo deviceId — KHÔNG còn user/đăng nhập/JWT):**
> - **`deviceId` là danh tính của chính màn hình kiosk** (cấu hình trên máy), không gắn với user.
> - **Push (FCM) theo deviceId**: mỗi tin Phong gửi kèm một `deviceId`, service chỉ gửi tới các token đã
>   đăng ký **đúng `deviceId`** đó → mỗi màn hình chỉ nhận tin của cây mình.
> - **REST danh sách lọc theo `deviceId`**: mỗi tin nhận qua `/internal/notify` được **ghi vào MongoDB**, nên
>   `GET /api/v1/notifications?deviceId=...` trả về lịch sử bền vững của đúng cây đó. Push realtime và
>   lịch sử REST dùng chung `deviceId` → **khớp nhau**.
> - **Xác thực**: chỉ một **API key** chung gửi qua header `x-api-key` cho **mọi** request
>   (cả `/internal/*` lẫn `/api/v1/notifications`). Không còn `Authorization: Bearer`/JWT/đăng nhập.
> - Màn hình kiosk (`notification-web`) hiện danh sách realtime **ngay trong trang từ chính message
>   FCM** (`onMessage`), đồng thời nạp thêm lịch sử cũ từ REST khi mở trang.

---

## 1. Những thứ được bàn giao

| Thứ | Giá trị / nơi lấy |
|---|---|
| Base URL | `http://localhost:3001` (dev) — production sẽ báo sau |
| API key (`x-api-key`) | Gửi qua kênh riêng (KHÔNG nằm trong repo) — chính là `INTERNAL_API_KEY` của service, dùng cho MỌI request |
| `deviceId` | Danh tính của cây/thiết bị mà màn hình đứng cạnh (vd `ESP32S3_Zone1`) — cấu hình trên chính màn hình |
| Firebase web config | apiKey/projectId/senderId/appId — xem trong `notification-web/index.html` (project `smartfarmai-f1426`) |
| VAPID key | Xem `notification-web/index.html` (ô VAPID) |
| CORS | Báo origin trang của bạn (vd `https://smartfarm.example.com`) để thêm vào `ALLOWED_ORIGINS` của service |

---

## 2. Xác thực — API key + deviceId (không còn đăng nhập/JWT)

Không còn user/đăng nhập. **Mọi** request tới service gửi kèm header `x-api-key: <API key>`
(chính là `INTERNAL_API_KEY` của service). API key luôn ở phía server/kiosk cấu hình, không public.

Thay cho "user", mỗi màn hình có một **`deviceId`** — danh tính của cây/thiết bị nó đứng cạnh.
Các API lịch sử nhận `deviceId` qua **query string** `?deviceId=...` (hoặc trong body), và chỉ
trả/sửa thông báo của đúng `deviceId` đó.

```js
// Gợi ý: lưu cấu hình trên máy kiosk (vd localStorage)
const cfg = { server: 'http://localhost:3001', deviceId: 'ESP32S3_Zone1', apiKey: '...' };

// Helper gọi REST: tự gắn x-api-key + ?deviceId
function api(path, opts = {}) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${cfg.server}/api/v1/notifications${path}${sep}deviceId=${encodeURIComponent(cfg.deviceId)}`;
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, ...(opts.headers || {}) },
  }).then(r => r.json());
}
```

> Sai/thiếu API key → API trả **401** `Invalid API key`. Chưa cấu hình `INTERNAL_API_KEY` phía
> server → **503**. Thiếu `deviceId` → **400** `Missing deviceId`.

---

## 3. REST API

Base path: `/api/v1/notifications` · Header bắt buộc: `x-api-key` · Tham số bắt buộc: `deviceId`
(qua `?deviceId=...` hoặc body).

| Method & path | Chức năng | Trả về |
|---|---|---|
| `GET /?deviceId=...&page=1&limit=20` | Danh sách thông báo của deviceId (mới nhất trước) | `{ success, items: [...], unreadCount }` |
| `GET /unread-count?deviceId=...` | Đếm chưa đọc (cho badge) | `{ success, unreadCount }` |
| `PATCH /:id/read?deviceId=...` | Đánh dấu 1 thông báo đã đọc | `{ success, data }` |
| `PATCH /read-all?deviceId=...` | Đánh dấu tất cả đã đọc | `{ success, message }` |

> Đăng ký/hủy FCM token **không** nằm ở đây nữa — dùng `/internal/push/token` (xem mục 4).

Một item thông báo:

```json
{
  "_id": "66b...",
  "deviceId": "ESP32S3_Zone1",
  "title": "Độ ẩm đất",
  "body": "Độ ẩm đất hiện tại 22%.",
  "type": "water",          // water | light | temperature | nutrition | disease | system
  "severity": "warning",    // info | warning | critical
  "isRead": false,
  "data": { "...payload gốc từ thiết bị..." },
  "createdAt": "2026-07-07T03:20:50.531Z"
}
```

Gợi ý UI: icon theo `type` (💧💡🌡️🌱🦠⚙️), màu theo `severity`.

---

## 4. Nhận push realtime (FCM)

### 4.1. Đăng ký (chạy 1 lần sau khi cấu hình deviceId + API key)

```js
// Firebase SDK v10 (compat hoặc modular đều được)
firebase.initializeApp(FIREBASE_CONFIG);
const messaging = firebase.messaging();

const permission = await Notification.requestPermission();          // xin quyền browser
const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
const fcmToken = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });

// Đăng ký token KÈM deviceId qua endpoint nội bộ → service chỉ đẩy tin của cây này về máy này.
await fetch(`${cfg.server}/internal/push/token`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey },
  body: JSON.stringify({ token: fcmToken, deviceId: cfg.deviceId, device: 'web' }),
});
```

Endpoint đăng ký/hủy token:

| Method & path | Body | Auth |
|---|---|---|
| `POST /internal/push/token` | `{ token, deviceId, device }` (`deviceId` **bắt buộc**; `device` mặc định `'web'`) | `x-api-key` |
| `DELETE /internal/push/token` | `{ token }` | `x-api-key` |

### 4.2. Tab đang mở (foreground)

```js
messaging.onMessage(payload => {
  // payload.notification = { title, body }; payload.data = { type, severity, eventId, ... }
  // → hiện toast trong trang + refresh danh sách
});
```

### 4.3. Tab đóng / background — service worker

File `firebase-messaging-sw.js` đặt ở **root** của site. ⚠️ **Bẫy quan trọng**: message
đã có field `notification` thì Chrome/FCM SDK **tự hiển thị** — nếu trong
`onBackgroundMessage` bạn gọi `showNotification` nữa sẽ bị **nhân đôi thông báo**:

```js
messaging.onBackgroundMessage(payload => {
  if (payload.notification) return;   // FCM tự hiển thị rồi — đừng show thêm!
  // chỉ tự show cho data-only message
});
```

(Xem file mẫu đầy đủ: [`../../notification-web/firebase-messaging-sw.js`](../../notification-web/firebase-messaging-sw.js))

---

## 5. Các lưu ý còn lại

- **CORS**: origin của bạn phải nằm trong `ALLOWED_ORIGINS` của service — báo cho Tân thêm.
- **Push không tới?** Kiểm tra: đã `POST /internal/push/token` thành công chưa (đúng `x-api-key`),
  `deviceId` đăng ký có **khớp** `deviceId` mà Phong gửi trong `/internal/notify` không, quyền
  notification của browser, và service worker đăng ký đúng scope root.
- **Nhiều màn hình cùng một cây**: cứ `POST /internal/push/token` với **cùng `deviceId`** cho từng
  máy — service gửi push song song tới mọi token của `deviceId` đó, token chết tự bị xóa.
- **Đổi cây**: đăng ký lại token với `deviceId` mới; nên xóa danh sách cũ ở client để không lẫn tin
  của cây khác.
- **Realtime khi tab mở**: ngoài push, nên refresh danh sách (`GET /?deviceId=...`) khi tab focus lại
  (background push không chạy được JS trong tab).
