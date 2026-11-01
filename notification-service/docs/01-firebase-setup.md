# Hướng dẫn cấu hình Firebase (FCM)

Tài liệu này hướng dẫn thiết lập **Firebase Cloud Messaging (FCM)** cho cả hai phía:
- **Phía Server (Notification Service)** — dùng Firebase Admin SDK để *gửi* push.
- **Phía Client (web quản lý của người dùng; `notification-web` là trang test giả lập web đó)** — dùng Firebase JS SDK để *nhận* push và lấy registration token.

Toàn hệ thống dùng **một Firebase project duy nhất: `smartfarmai-f1426`** — cả trang test lẫn web quản lý của team Frontend
dùng chung Firebase web config + VAPID key do Notify bàn giao.

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
              │ POST /api/v1/push/token  { token, device }
              │ (Authorization: Bearer <JWT đăng nhập bên Phong>
              │  — lưu token + userId + JWT + hạn JWT vào MongoDB)
              ▼
        Notification Service
```

- **Server** cần **Service Account** (private key) để xác thực với Firebase và gửi message.
- **Client** cần **Web config + VAPID key** để đăng ký nhận push, rồi gửi token về server qua
  `POST /api/v1/push/token` với header `Authorization: Bearer <JWT>` (JWT lấy từ đăng nhập bên server Phong).
  Token được gắn với **người dùng** (`userId`), không gắn với cây. Client gọi lại sau **mỗi lần đăng nhập**
  và gọi `DELETE /api/v1/push/token` khi **đăng xuất**.
- Mỗi khi Phong `POST /internal/notify` (body kèm `deviceId`), server chọn các token còn phiên đăng nhập hợp lệ,
  **hỏi lại server Phong** xem chủ token hiện còn quyền xem `deviceId` đó không, rồi chỉ gửi cho những người có quyền
  (chủ cây hoặc được share). Chi tiết xem [02-kien-truc.md](02-kien-truc.md) và [03-luong-hoat-dong.md](03-luong-hoat-dong.md).

---

## Phần A — Tạo Firebase Project

1. Truy cập [Firebase Console](https://console.firebase.google.com/).
2. **Add project** → đặt tên (ví dụ `iot-smartfarm`) → tạo project.
3. Có thể tắt Google Analytics nếu không cần.

> Dự án SmartFarm hiện đã có sẵn project **`smartfarmai-f1426`** — chỉ cần làm lại phần này khi dựng môi trường mới.

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

Áp dụng cho web quản lý của người dùng (web của team Frontend) và trang test `notification-web` (giả lập web đó).
Cách tích hợp đầy đủ phía web (đăng nhập, gọi API, đăng ký token) xem [hướng dẫn tích hợp web quản lý](04-tich-hop-web.md).

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

3. Điền config này vào **cả hai** file của notification-web:
   - `notification-web/index.html`
   - `notification-web/firebase-messaging-sw.js` (service worker — chạy nền để nhận push khi tab đóng)

> Config phải **giống nhau** ở cả hai file.

### C.2. Lấy VAPID Key (Web Push certificate)

1. Firebase Console → **Project Settings** → tab **Cloud Messaging**.
2. Mục **Web Push certificates** → **Generate key pair**.
3. Copy chuỗi key → điền vào biến **VAPID_KEY** trong notification-web.

VAPID key dùng khi gọi `getToken(messaging, { vapidKey })` để lấy registration token của trình duyệt.

### C.3. Service Worker

- File `firebase-messaging-sw.js` xử lý push khi web ở chế độ nền/đóng tab.
- Service worker **chỉ chạy** trên `http://localhost` hoặc **HTTPS** — không mở file HTML trực tiếp.
- Chạy notification-web qua HTTP server: `cd notification-web && npm run dev` rồi mở `http://localhost:3003`.

---

## Phần D — Định dạng message server gửi đi

Tham khảo [`src/services/fcmService.js`](../src/services/fcmService.js) và [`src/services/notificationService.js`](../src/services/notificationService.js). Sau khi qua Template Engine, gói tin push gửi qua FCM gồm:

```js
{
  token,                                  // registration token của thiết bị
  notification: { 
    title,                                // do templateEngine render hoặc custom title
    body                                  // do templateEngine render hoặc custom body
  },
  data: {
    notificationId,                       // _id bản ghi lịch sử — client dùng để đánh dấu đã đọc
                                          // (rỗng nếu lưu DB lỗi; push vẫn gửi)
    deviceId,                             // id cây/thiết bị phát sinh sự kiện
    event: event || '',                   // mã event (vd: "pump.on", "water.empty")
    type: type || '',                     // danh mục ("water", "temperature", "system", ...)
    severity: severity || '',             // mức độ ("info", "warning", "critical")
    raw: JSON.stringify(payload),         // toàn bộ payload JSON gốc từ Phong
  },
  webpush: {
    notification: { 
      title, 
      body, 
      icon: '/logo.png', 
      badge: '/badge.png', 
      vibrate: [200, 100, 200] 
    },
  },
}
```

Lưu ý:
- **FCM bắt buộc mọi giá trị trong `data` là chuỗi** → code tự ép kiểu `String(v)` toàn bộ.
- Nếu token không còn hợp lệ (`messaging/registration-token-not-registered`), service **tự xóa** token đó khỏi MongoDB.
- Message chỉ cấu hình `webpush` (client đều là web), không gắn link điều hướng cố định.
- Danh sách token nhận do `recipientSelector.selectRecipients()` chọn (chỉ người **đang có quyền** xem `deviceId`, phiên còn hạn);
  `sendToTokens(tokens, …)` gửi song song tới các token đó, `sendToDevice(token, …)` gửi tới 1 token cụ thể.

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
- [ ] Token đã được lưu vào DB qua `POST /api/v1/push/token` (header `Authorization: Bearer <JWT>` của tài khoản Phong)

---

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân & cách xử lý |
|---|---|
| `Firebase not initialized` khi gửi | Credential server sai/thiếu. Kiểm tra log khởi động & 3 biến `FIREBASE_*`. |
| Private key lỗi parse | `FIREBASE_PRIVATE_KEY` chưa bọc nháy kép hoặc đã xuống dòng thật thay vì `\n`. |
| Client không lấy được token | Thiếu/sai VAPID key, hoặc chưa cấp quyền notification, hoặc không chạy trên HTTPS/localhost. |
| Gửi `/internal/notify` nhưng không có push (`recipients: 0`) | Tài khoản đăng ký token không sở hữu / không được share cây `deviceId` đó; phiên đăng nhập (JWT) đã hết hạn → đăng nhập lại để đăng ký lại token; server Phong không truy cập được (`PLANT_API_URL` sai/Phong tắt) → không gửi cho ai; hoặc token đã hết hiệu lực (đã bị tự xóa). |
| Push không hiện khi đóng tab | Service worker `firebase-messaging-sw.js` chưa được đăng ký hoặc thiếu config. |
