# Tích hợp thông báo vào web quản lý — dành cho team Frontend

Tài liệu bàn giao cho người làm **web quản lý**: cách cho người dùng đăng nhập, hiển thị danh sách thông báo
và nhận push realtime từ **IOT Notification Service** (gọi tắt là Notify).

Bạn **không cần đụng tới nguồn thông báo**: server .NET của Phong phát hiện sự kiện của cây và gửi sang Notify,
Notify lo lưu trữ và đẩy push. Web của bạn làm 3 việc:

1. **Cho người dùng đăng nhập** bằng tài khoản bên server Phong → nhận **JWT** (đây chính là "token truy cập").
2. **Gọi REST API của Notify** kèm JWT để hiện danh sách thông báo, đếm chưa đọc, đánh dấu đã đọc.
3. **Đăng ký FCM token** để trình duyệt nhận push realtime.

Mỗi người dùng **chỉ thấy thông báo của các cây mình sở hữu hoặc được chia sẻ** (quyền do server Phong quản lý).
Trạng thái "đã đọc" tính **riêng cho từng người**.

> Triển khai mẫu hoàn chỉnh (1 file HTML, làm đúng như hướng dẫn này):
> [`../../notification-web/index.html`](../../notification-web/index.html)

---

## 1. Gói bàn giao

| Thứ | Giá trị / nơi lấy |
|---|---|
| URL Notify | `http://localhost:3001` (dev) — production báo sau |
| URL server Phong | `http://localhost:8000` (dev, `dotnet run`) / `:8080` (Docker) — production báo sau |
| Tài khoản test | Một email/mật khẩu bên server Phong đã được chia sẻ vài cây — gửi qua kênh riêng |
| Firebase web config + VAPID key | Xem đầu `<script>` trong `notification-web/index.html` (project `smartfarmai-f1426`) |
| Service worker mẫu | [`../../notification-web/firebase-messaging-sw.js`](../../notification-web/firebase-messaging-sw.js) |

Bạn **không** nhận API key nào của Notify. `INTERNAL_API_KEY` chỉ dành cho server Phong gọi `/internal/notify`.

---

## 2. Đăng nhập — lấy JWT từ server Phong

```js
const PLANT_API_URL = 'http://localhost:8000';
const NOTIFY_URL    = 'http://localhost:3001';

const r = await fetch(`${PLANT_API_URL}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
// 200 → { token, email, displayName, role }   ·   401 → sai email/mật khẩu
const { token } = await r.json();
```

- JWT có hạn **24 giờ**. Lưu ở client (vd `localStorage`) để mở lại trang không phải đăng nhập lại.
- Mọi request tới Notify gửi header `Authorization: Bearer <token>`.
- Notify trả **401** bất kỳ lúc nào → token hết hạn/không hợp lệ → xoá token, đưa người dùng về màn đăng nhập.

```js
async function notify(path, opts = {}) {
  const r = await fetch(`${NOTIFY_URL}/api/v1${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (r.status === 401) { /* xoá token, về màn đăng nhập */ }
  return r.json();
}
```

---

## 3. REST API của Notify

Header bắt buộc: `Authorization: Bearer <JWT>`.

| Method & path | Chức năng | Trả về |
|---|---|---|
| `GET /api/v1/me` | Người đang đăng nhập + danh sách cây được xem (để vẽ bộ lọc theo **tên** cây) | `{ success, userId, email, devices: [{ deviceId, name }] }` |
| `GET /api/v1/notifications` | Danh sách, mới nhất trước | `{ success, items, unreadCount, page, limit, hasMore }` |
| `GET /api/v1/notifications/unread-count` | Đếm chưa đọc (badge chuông) | `{ success, unreadCount }` |
| `PATCH /api/v1/notifications/:id/read` | Đánh dấu 1 tin đã đọc (cho người này) | `{ success, data }` |
| `PATCH /api/v1/notifications/read-all` | Đánh dấu tất cả đã đọc (cho người này) | `{ success, message }` |
| `POST /api/v1/push/token` | Đăng ký FCM token — body `{ token, device: 'web' }` | `{ success }` |
| `DELETE /api/v1/push/token` | Hủy FCM token — body `{ token }` | `{ success }` |

Tham số query của các route `/notifications` (đều tuỳ chọn):

| Tham số | Ý nghĩa |
|---|---|
| `deviceId` | Chỉ lấy/sửa thông báo của 1 cây. Không truyền = mọi cây người dùng có quyền |
| `unread=true` | Chỉ lấy tin chưa đọc (chỉ cho `GET /notifications`) |
| `page`, `limit` | Phân trang, mặc định `1`, `20`; `limit` tối đa `100`. Dùng `hasMore` để hiện nút "Xem thêm" |

`unreadCount` luôn đếm theo phạm vi `deviceId` (nếu có), không phụ thuộc `unread`/`page`.

Một item thông báo:

```json
{
  "_id": "6730f1a2b3c4d5e6f7a8b9c0",
  "eventId": "ESP32S3_Zone1:water.empty:1793520000",
  "deviceId": "ESP32S3_Zone1",
  "event": "water.empty",
  "title": "Hết nước tưới",
  "body": "Bình chứa cạn, không thể tưới, cần châm nước",
  "type": "water",          // water | light | temperature | nutrition | disease | system
  "severity": "critical",   // info | warning | critical
  "isRead": false,          // tính theo NGƯỜI ĐANG ĐĂNG NHẬP
  "data": { "soilPercent": 18, "waterOk": false },
  "createdAt": "2026-11-01T09:15:00.000Z"
}
```

Gợi ý UI:
- Tên cây: map `deviceId` → `name` từ `GET /api/v1/me` (đừng hiện mã thô).
- Icon theo `type`: 💧 `water`, 💡 `light`, 🌡️ `temperature`, 🌱 `nutrition`, 🦠 `disease`, ⚙️ `system`.
- Màu theo `severity`: xanh `info`, cam `warning`, đỏ `critical`.

### Mã lỗi

| Mã | Khi nào | Web nên làm |
|---|---|---|
| 401 | Thiếu / sai / hết hạn JWT | Xoá token, về màn đăng nhập |
| 403 | `deviceId` không thuộc quyền người dùng | Bỏ bộ lọc đó, tải lại `/me` |
| 404 | `:id` không tồn tại hoặc thuộc cây người dùng không có quyền | Tải lại danh sách |
| 503 | Notify không liên lạc được server Phong để kiểm quyền | Báo "hệ thống tạm thời gián đoạn", thử lại sau |

### Thử nhanh bằng curl

```bash
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login -H "Content-Type: application/json" \
  -d '{"email":"<email>","password":"<mật khẩu>"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/v1/me
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3001/api/v1/notifications?limit=5"
curl -H "Authorization: Bearer $TOKEN" -X PATCH http://localhost:3001/api/v1/notifications/read-all
```

---

## 4. Nhận push realtime (FCM)

### 4.1. Đăng ký — sau MỖI lần đăng nhập

```js
// Firebase SDK v10 (compat hoặc modular đều được)
firebase.initializeApp(FIREBASE_CONFIG);
const messaging = firebase.messaging();

const permission = await Notification.requestPermission();
const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
const fcmToken = await messaging.getToken({ vapidKey: VAPID_KEY, serviceWorkerRegistration: swReg });

await notify('/push/token', { method: 'POST', body: JSON.stringify({ token: fcmToken, device: 'web' }) });
```

Vì sao phải gọi lại sau mỗi lần đăng nhập: Notify lưu token **kèm JWT hiện tại**. Mỗi khi có sự kiện, Notify
dùng JWT đó hỏi lại server Phong xem người dùng **còn quyền** với cây không rồi mới gửi. JWT hết hạn → ngừng gửi
cho máy đó cho tới khi đăng nhập lại và đăng ký lại.

### 4.2. Đăng xuất

Gọi `DELETE /api/v1/push/token` với `{ token: fcmToken }` **trước** khi xoá JWT, rồi `messaging.deleteToken()`,
để máy này ngừng nhận push của tài khoản ngay (quan trọng với máy dùng chung). Nếu lúc đăng xuất chưa có
`fcmToken` trong bộ nhớ (vd trang chưa bật push lần này) mà quyền thông báo đã `granted`, lấy lại bằng
`messaging.getToken(...)` trước khi DELETE. Đồng thời xoá mọi trạng thái theo người dùng (bộ lọc, danh sách) ở client.

### 4.3. Tab đang mở (foreground)

```js
messaging.onMessage(payload => {
  // payload.notification = { title, body }
  // payload.data = { notificationId, deviceId, event, type, severity, raw }
  // → hiện toast + tải lại danh sách / badge
});
```

`data.notificationId` là `_id` của bản ghi — dùng được cho `PATCH /notifications/:id/read`.

### 4.4. Tab đóng / background — service worker

File `firebase-messaging-sw.js` đặt ở **root** của site. ⚠️ Message đã có field `notification` thì trình duyệt
**tự hiển thị** — nếu trong `onBackgroundMessage` gọi `showNotification` nữa sẽ bị **nhân đôi**:

```js
messaging.onBackgroundMessage(payload => {
  if (payload.notification) return;   // đã tự hiển thị — đừng show thêm!
});
```

(Xem file mẫu: [`../../notification-web/firebase-messaging-sw.js`](../../notification-web/firebase-messaging-sw.js))

---

## 5. Lưu ý

- **Quyền thay đổi** (chủ cây chia sẻ / thu hồi bên server Phong): danh sách và push cập nhật trong vòng ~1 phút.
- **Push không tới?** Kiểm tra: `POST /api/v1/push/token` đã 200 chưa, có gọi lại sau lần đăng nhập gần nhất không,
  quyền notification của trình duyệt, service worker đăng ký ở scope root, và tài khoản có quyền với cây phát sự kiện.
- **Nhiều trình duyệt / thiết bị của cùng người dùng**: mỗi nơi tự đăng ký token của mình, đều nhận push.
- **Realtime khi tab mở lại**: ngoài push, nên tải lại danh sách khi tab được focus.
- **CORS**: Notify hiện cho phép mọi origin; nếu deploy production có giới hạn origin, báo Tân thêm domain web của bạn.
