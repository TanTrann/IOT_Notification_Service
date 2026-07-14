# Hướng dẫn cấu hình Firebase (FCM)

Tài liệu này hướng dẫn thiết lập **Firebase Cloud Messaging (FCM)** cho cả hai phía:
- **Phía Server (Notification Service)** — dùng Firebase Admin SDK để *gửi* push.
- **Phía Client (Web/test-client)** — dùng Firebase JS SDK để *nhận* push và lấy registration token.

---

## Tổng quan cơ chế

```
   ┌──────────────────────┐                    ┌──────────────────────┐
   │  Notification Service │   gửi qua          │   Firebase Cloud      │
   │  (Firebase Admin SDK) │ ─── messaging ───► │   Messaging (FCM)     │
   │  serviceAccountKey    │                    └──────────┬───────────┘
   └──────────────────────┘                               │ push
                                                           ▼
   ┌──────────────────────┐   token            ┌──────────────────────┐
   │  Client (Web SDK)     │ ◄── đăng ký ────── │  Trình duyệt / App    │
   │  + VAPID key          │                    │  (Service Worker)     │
   └──────────┬───────────┘                    └──────────────────────┘
              │ POST /api/v1/notifications/token (lưu token vào MongoDB)
              ▼
        Notification Service
```

- **Server** cần **Service Account** (private key) để xác thực với Firebase và gửi message.
- **Client** cần **Web config + VAPID key** để đăng ký nhận push, rồi gửi token về server lưu vào DB.
- Theo mô hình hiện tại, server **broadcast** tới **mọi** token đã đăng ký
  (`fcmService.sendToAll`) mỗi khi có tin trên `planttree/{deviceId}/notifications`.

---

## Phần A — Tạo Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com/).
2. **Add project** → đặt tên (ví dụ `iot-smartfarm`) → tạo project.
3. Có thể tắt Google Analytics nếu không cần.

---

## Phần B — Cấu hình phía Server (Admin SDK)

Server lấy credential theo **2 cách** (xem [`src/config/firebase.js`](../src/config/firebase.js)):

1. **Ưu tiên: biến môi trường** `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
2. **Dự phòng: file** `serviceAccountKey.json` (đường dẫn lấy từ `FIREBASE_SERVICE_ACCOUNT_PATH`, mặc định `../../serviceAccountKey.json`).

### B.1. Tạo Service Account key

1. Firebase Console → ⚙️ **Project Settings** → tab **Service accounts**.
2. Chọn **Node.js** → bấm **Generate new private key**.
3. Tải file JSON về. File có dạng:

```json
{
  "type": "service_account",
  "project_id": "iot-smartfarm",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxx@iot-smartfarm.iam.gserviceaccount.com",
  ...
}
```

### B.2. Cách 1 — Dùng biến môi trường (khuyến nghị cho production)

Lấy 3 trường từ file JSON và điền vào `.env`:

```env
FIREBASE_PROJECT_ID=iot-smartfarm
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxx@iot-smartfarm.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

> ⚠️ **Quan trọng về `FIREBASE_PRIVATE_KEY`:**
> - Phải đặt trong dấu nháy kép `"..."`.
> - Giữ nguyên các ký tự `\n` literal (không xuống dòng thật). Code sẽ tự chuyển `\n` → xuống dòng thật bằng `.replace(/\\n/g, '\n')`.

### B.3. Cách 2 — Dùng file `serviceAccountKey.json`

1. Đổi tên file tải về thành `serviceAccountKey.json`.
2. Đặt ở thư mục gốc `notification-service/`.
3. **Không** điền 3 biến `FIREBASE_*` ở trên (để code rơi vào nhánh dự phòng), hoặc trỏ rõ:

```env
FIREBASE_SERVICE_ACCOUNT_PATH=../../serviceAccountKey.json
```

> 🔒 **Bảo mật:** Service account key cấp quyền gửi push cho toàn project. **Không bao giờ commit** `serviceAccountKey.json` hay private key lên git. Thêm vào `.gitignore`.

### B.4. Kiểm tra

Khi chạy `npm start`, nếu cấu hình đúng sẽ thấy log:
```
Firebase Admin initialized successfully
```
Nếu sai sẽ thấy:
```
Failed to initialize Firebase Admin: ...
WARNING: Push notifications will not work without valid credentials!
```
(Service vẫn chạy, nhưng mọi lần gửi FCM sẽ ném lỗi `Firebase not initialized`.)

---

## Phần C — Cấu hình phía Client (Web SDK)

Áp dụng cho `test-client` hoặc ứng dụng web thật.

### C.1. Đăng ký Web App & lấy config

1. Firebase Console → **Project Settings** → **General** → mục **Your apps**.
2. Bấm biểu tượng **Web** (`</>`) → đăng ký app → copy đoạn `firebaseConfig`:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "iot-smartfarm.firebaseapp.com",
  projectId: "iot-smartfarm",
  storageBucket: "iot-smartfarm.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef",
};
```

3. Điền config này vào **cả hai** file của test-client:
   - `test-client/index.html`
   - `test-client/firebase-messaging-sw.js` (service worker — chạy nền để nhận push khi tab đóng)

> Config phải **giống nhau** ở cả hai file.

### C.2. Lấy VAPID Key (Web Push certificate)

1. Firebase Console → **Project Settings** → tab **Cloud Messaging**.
2. Mục **Web Push certificates** → **Generate key pair**.
3. Copy chuỗi key → điền vào ô **VAPID Key** trong test-client.

VAPID key dùng khi gọi `getToken(messaging, { vapidKey })` để lấy registration token của trình duyệt.

### C.3. Service Worker

- File `firebase-messaging-sw.js` xử lý push khi web ở chế độ nền/đóng tab.
- Service worker **chỉ chạy** trên `http://localhost` hoặc **HTTPS** — không mở file HTML trực tiếp.
- Chạy test-client qua HTTP server: `cd test-client && npm run dev` rồi mở `http://localhost:8080`.

---

## Phần D — Định dạng message server gửi đi

Tham khảo [`src/services/fcmService.js`](../src/services/fcmService.js). Mỗi push gồm:

```js
{
  token,                                  // registration token của thiết bị
  notification: { title, body },
  data: { ...customData, clickAction: '/dashboard' },  // mọi value bị ép thành String
  webpush: {
    notification: { title, body, icon: '/logo.png', badge: '/badge.png', vibrate: [200,100,200] },
    fcmOptions: { link: '/dashboard' },
  },
}
```

Lưu ý:
- **FCM bắt buộc mọi giá trị trong `data` là chuỗi** → code tự `String(v)` toàn bộ.
- Nếu token không còn hợp lệ (`messaging/registration-token-not-registered`), service **tự xóa** token đó khỏi MongoDB.
- `sendToAll()` tìm **tất cả** token trong `fcmtokens` và gửi song song (mô hình "1 topic — ai đăng ký cũng nhận"). Vẫn còn `sendToDevice(token, …)` để gửi tới 1 token cụ thể.

---

## Phần E — Checklist nhanh

**Server:**
- [ ] Đã tạo Service Account key
- [ ] Đã điền `FIREBASE_*` trong `.env` **hoặc** đặt `serviceAccountKey.json`
- [ ] Khởi động thấy log `Firebase Admin initialized successfully`
- [ ] Đã thêm key vào `.gitignore`

**Client:**
- [ ] Đã điền `firebaseConfig` ở `index.html` và `firebase-messaging-sw.js`
- [ ] Đã điền **VAPID key**
- [ ] Chạy qua `http://localhost` (không mở file trực tiếp)
- [ ] Đã cho phép quyền thông báo trên trình duyệt
- [ ] Token đã được lưu vào DB qua `POST /api/v1/notifications/token`

---

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| `Firebase not initialized` khi gửi | Credential server sai/thiếu. Kiểm tra log khởi động & 3 biến `FIREBASE_*`. |
| Private key lỗi parse | `FIREBASE_PRIVATE_KEY` chưa bọc nháy kép hoặc đã xuống dòng thật thay vì `\n`. |
| Client không lấy được token | Thiếu/sai VAPID key, hoặc chưa cấp quyền notification, hoặc không chạy trên HTTPS/localhost. |
| Publish nhưng không có push | `deviceId` payload không khớp `deviceId` của token đã lưu; hoặc token đã hết hạn (đã bị tự xóa). |
| Push không hiện khi đóng tab | Service worker `firebase-messaging-sw.js` chưa được đăng ký hoặc thiếu config. |
