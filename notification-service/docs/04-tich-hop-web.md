# Tích hợp thông báo vào website — dành cho dev web

Tài liệu bàn giao cho người phụ trách website: cách hiển thị danh sách thông báo và nhận
push notification từ **IOT Notification Service** trên trang của bạn.

Bạn **không cần đụng tới MQTT/broker** — service đã lo toàn bộ phần nhận dữ liệu IoT,
xử lý và tạo thông báo. Website chỉ làm 2 việc:

1. **Gọi REST API** để hiển thị danh sách thông báo, đếm chưa đọc, đánh dấu đã đọc.
2. **Đăng ký FCM token** để trình duyệt của người dùng nhận push realtime.

> Tham khảo triển khai mẫu hoàn chỉnh (1 file HTML): [`../../notification-web/index.html`](../../notification-web/index.html)

---

## 1. Những thứ được bàn giao

| Thứ | Giá trị / nơi lấy |
|---|---|
| Base URL | `http://localhost:3001` (dev) — production sẽ báo sau |
| `JWT_SECRET` | Gửi qua kênh riêng (KHÔNG nằm trong repo) — dùng để backend của bạn sign token |
| Firebase web config | apiKey/projectId/senderId/appId — xem trong `notification-web/index.html` (project `smartfarmai-f1426`) |
| VAPID key | Xem `notification-web/index.html` (ô VAPID) |
| CORS | Báo origin trang của bạn (vd `https://smartfarm.example.com`) để thêm vào `ALLOWED_ORIGINS` của service |

---

## 2. Xác thực — đăng nhập & JWT

Mọi API thông báo cần header `Authorization: Bearer <JWT>`. Token là HS256, payload mang thiết bị
của user — hỗ trợ **1 hoặc nhiều thiết bị**:

```json
// 1 thiết bị
{ "deviceId": "device_A", "exp": <unix seconds> }

// nhiều thiết bị (1 user có nhiều thiết bị) — dùng deviceIds (mảng)
{ "deviceIds": ["device_A", "device_B"], "exp": <unix seconds> }
```

### Cách web lấy JWT: đăng nhập

Web **không** tự sign token (sign cần `JWT_SECRET` — lộ ở client là hỏng). Thay vào đó gọi endpoint
đăng nhập, backend verify mật khẩu rồi trả JWT đã gắn sẵn `deviceIds` của user:

```
POST /api/v1/auth/login      body: { "username": "...", "password": "..." }
→ 200 { success, token, expiresIn, user: { username, deviceIds } }
→ 401 { success:false, message:"Invalid credentials" }
```

```js
const { token } = await (await fetch(`${BASE_URL}/api/v1/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
})).json();
// dùng token này cho MỌI request thông báo (Authorization: Bearer <token>)
```

Tài khoản demo tạo bằng: `node seed-users.js <username> <password> <deviceId...>` (mặc định
`demo` / `demo1234` / `device_test_01`).

> **Production:** endpoint `/api/v1/auth/login` ở đây đóng vai **identity backend mẫu**. Ở hệ thật,
> phần đăng nhập/quản lý user thường nằm ở backend riêng của bạn — chỉ cần nó dùng **cùng
> `JWT_SECRET`** và ký payload `{ deviceIds }` như trên là notification-service chấp nhận. `JWT_SECRET`
> luôn chỉ ở phía server, không bao giờ xuống client.

API trả/sửa thông báo của **mọi `deviceId` trong token** (gộp thành 1 inbox), và push realtime
tới thiết bị dùng token này cho **bất kỳ** thiết bị nào trong danh sách. Token hết hạn → API trả
401 `Invalid or expired token` → đăng nhập lại. Khi user thêm/bớt thiết bị → cập nhật `deviceIds`
của user rồi đăng nhập lại (token mới) và `POST /token` lại để cập nhật danh sách nhận push.

> **Tương thích:** token cũ chỉ có `deviceId` (một chuỗi) vẫn chạy bình thường — service tự
> coi như danh sách 1 phần tử.

---

## 3. REST API

Base path: `/api/v1/notifications`

| Method & path | Chức năng | Trả về |
|---|---|---|
| `GET /?page=1&limit=20` | Danh sách thông báo (mới nhất trước) | `{ success, items: [...], unreadCount }` |
| `GET /unread-count` | Đếm chưa đọc (cho badge) | `{ success, unreadCount }` |
| `PATCH /:id/read` | Đánh dấu 1 thông báo đã đọc | `{ success, data }` |
| `PATCH /read-all` | Đánh dấu tất cả đã đọc | `{ success, message }` |
| `POST /token` | Đăng ký FCM token — body `{ token, device: 'web' }` | `{ success, message }` |
| `DELETE /token` | Hủy đăng ký (logout) — body `{ token }` | `{ success, message }` |

Một item thông báo:

```json
{
  "_id": "66b...",
  "deviceId": "device_test_01",
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

### 4.1. Đăng ký (chạy 1 lần sau khi user đăng nhập)

```js
// Firebase SDK v10 (compat hoặc modular đều được)
firebase.initializeApp(FIREBASE_CONFIG);
const messaging = firebase.messaging();

const permission = await Notification.requestPermission();          // xin quyền browser
const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
const fcmToken = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });

await fetch(`${BASE_URL}/api/v1/notifications/token`, {             // lưu token vào service
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
  body: JSON.stringify({ token: fcmToken, device: 'web' }),
});
```

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
- **Push không tới?** Kiểm tra: đã `POST /token` thành công chưa, quyền notification của
  browser, và service worker đăng ký đúng scope root.
- **Mỗi user nhiều browser/máy**: cứ `POST /token` cho từng cái — mỗi token gắn cả danh
  sách `deviceIds` của user; sự kiện của bất kỳ thiết bị nào cũng push tới mọi browser đó,
  token chết tự bị xóa.
- **Lọc theo thiết bị trên UI**: inbox đã gộp mọi thiết bị; mỗi item có field `deviceId`
  nên bạn tự lọc/nhóm phía client (vd dropdown "Tất cả / Thiết bị A / B"), không cần API mới.
- **Realtime khi tab mở**: ngoài push, nên refresh danh sách khi tab focus lại
  (background push không chạy được JS trong tab).
