# Thông báo theo người dùng (dùng tài khoản bên Phong) — Thiết kế

Ngày: 2026-11-01 · Repo: `IOT_Notification_Service` (`notification-service/` + `notification-web/`)

## 1. Vì sao làm

Hiện tại Notify **không có người dùng**: danh tính duy nhất là `deviceId` cấu hình trên một màn hình kiosk
đứng cạnh cây, mọi request (`/internal/*` lẫn `/api/v1/notifications`) chỉ dùng chung một `x-api-key`.

Hướng mới: **bỏ kiosk theo cây**, thay bằng giao diện cho **người dùng** xem thông báo của các cây mình có quyền.
Server .NET của Phong (`plant-tree-iot`) đã có sẵn tài khoản (JWT) và quyền theo cây (owner + members, xem
`GET /api/devices`). Notify **mượn** hệ thống đó, không tự làm tài khoản riêng.

Giao diện thật là **web quản lý do team Frontend làm** sau khi hệ thống xong. Team Frontend chỉ cần nhận **API + token truy cập**.
Vì vậy sản phẩm chính của đợt này là **service + tài liệu API + gói bàn giao cho team Frontend** (mục 5);
`notification-web` là **trang test giả lập web quản lý của team Frontend**: gọi API đúng như team Frontend sẽ gọi
(login Phong → JWT → API Notify → FCM web), để test toàn bộ luồng trước khi bàn giao và làm mẫu tham khảo cho team Frontend.

## 2. Mục tiêu / Không làm / Tuyệt đối tránh

**Mục tiêu**
- Người dùng xác thực bằng JWT của Phong; Notify biết người đó được xem những `deviceId` nào.
- API đọc thông báo trả về thông báo của **mọi cây người đó có quyền**, lọc được theo từng cây / chưa đọc.
- Trạng thái **đã đọc tính riêng cho từng người dùng**.
- Push FCM gửi theo **người dùng**: sự kiện của cây X → mọi người có quyền xem X (mọi token họ đã đăng ký).
- Một Firebase project duy nhất (`smartfarmai-f1426`) cho cả trang test lẫn web của team Frontend — team Frontend dùng Firebase web config + VAPID key do Notify bàn giao.
- Trang test `notification-web` viết lại theo bố cục A (mục 6) để kiểm tra toàn bộ API.
- Cập nhật tài liệu cho team Frontend tích hợp.

**Không làm**
- Không tạo tài khoản / đăng ký / quên mật khẩu trong Notify — đăng nhập luôn qua Phong.
- Không quản lý cây, chia sẻ cây, điều khiển bơm/đèn.
- Không email/SMS/Zalo, không tuỳ chọn tắt tiếng / ngưỡng.
- Không migrate trạng thái `isRead` cũ (dữ liệu demo).
- Không trau chuốt giao diện trang test.

**Tuyệt đối tránh**
- Bắt Phong sửa code `plant-tree-iot`, hoặc phải chia sẻ `JWT_SECRET` của Phong cho Notify.
- Người dùng thấy / nhận push thông báo của cây mình **không** có quyền.
- Làm hỏng luồng nhận sự kiện `POST /internal/notify` mà Phong đang gọi.

## 3. Ràng buộc từ phía Phong (đã kiểm tra trong `plant-tree-iot`)

- Login: `POST {PLANT_API_URL}/api/auth/login` `{ email, password }` → `{ token, email, displayName, role }`. JWT HS256, hạn 24h.
- `GET {PLANT_API_URL}/api/devices` (Bearer) → mảng `Device` user **sở hữu hoặc được share**:
  `{ id, deviceId, name, location, plantType, ownerId, members[], isActive, lastSeen, ... }`. Token sai/hết hạn → 401.
- `GET /api/auth/me` **không trả userId** (chỉ `email, displayName, role, createdAt`).
- userId nằm trong claim JWT `ClaimTypes.NameIdentifier`, khi ghi ra JWT thường là key `nameid`
  (có thể là URI `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier` — xử lý cả hai).
- CORS bên Phong `AllowAnyOrigin` → trang web gọi login trực tiếp được.
- Port Phong: 8000 khi `dotnet run`, 8080 khi deploy Docker.

## 4. Thiết kế service

### 4.1 Xác thực người dùng — middleware `userAuth`

Áp cho mọi route `/api/v1/*`. Thay thế `internalAuth` ở các route này (**API key không còn mở `/api/v1/*`**).

1. Đọc `Authorization: Bearer <jwt>`; thiếu → 401.
2. Tra cache theo token (TTL `AUTH_CACHE_SECONDS`, mặc định 60). Trúng cache → dùng luôn.
3. Trượt cache → gọi `GET {PLANT_API_URL}/api/devices` với chính token đó:
   - 401/403 → trả 401 cho client.
   - Lỗi mạng / 5xx / thiếu `PLANT_API_URL` → 503 (`"Không xác thực được với server Phong"`).
   - 200 → token hợp lệ (Phong đã kiểm chữ ký). **Decode payload JWT (không verify)** lấy `userId` (`nameid`) và `email`.
4. Gắn `req.user = { userId, email, devices: [{ deviceId, name }], deviceIds: Set }`.

Bước 2–3 gói thành **một hàm dùng chung** (vd `resolveAccess(jwt)`), vì mục 4.4 cũng dùng nó khi gửi push.

Lý do không verify JWT tại Notify: không cần `JWT_SECRET` của Phong; Phong vừa xác nhận token khi trả 200.

### 4.2 Mô hình dữ liệu

- `Notification`: **bỏ `isRead`**, thêm `readBy: [String]` (danh sách userId đã đọc). Các field khác giữ nguyên.
  Index giữ `{ deviceId: 1, createdAt: -1 }`; bỏ index `{ deviceId, isRead }`.
- `FCMToken`: `deviceId` → **`userId`** (required), thêm **`jwt`** (JWT của người dùng lúc đăng ký, `select: false`)
  và **`expiresAt`** (= `exp` của JWT đó). Giữ `token` unique, `device` enum `web|android|ios`. Index `{ userId: 1 }`, `{ expiresAt: 1 }`.
  Token cũ (theo deviceId) không còn dùng — xoá collection/thả bỏ khi khởi động là tuỳ builder.
  **Bảo mật:** `jwt` là thông tin nhạy cảm (dùng được 24h) — chỉ nằm trong DB, **không bao giờ** trả ra API hay ghi log.

### 4.3 REST API cho giao diện (Bearer JWT của Phong)

Mọi route dưới đây chỉ thấy thông báo có `deviceId ∈ req.user.deviceIds`. Item trả ra có `isRead` **tính theo user**
(`readBy` chứa userId) và **không** lộ mảng `readBy`.

| Method | Path | Mô tả |
|---|---|---|
| GET | `/api/v1/me` | `{ userId, email, devices: [{ deviceId, name }] }` — để client vẽ nút lọc theo tên cây |
| GET | `/api/v1/notifications?deviceId=&unread=true&page=1&limit=20` | Danh sách mới nhất trước. `deviceId` tuỳ chọn, phải thuộc quyền (không thuộc → 403). `unread=true` chỉ lấy chưa đọc. Trả `{ items, unreadCount, page, limit, hasMore }` |
| GET | `/api/v1/notifications/unread-count?deviceId=` | `{ unreadCount }` |
| PATCH | `/api/v1/notifications/:id/read` | `$addToSet readBy: userId`. Không thuộc quyền / không tồn tại → 404 |
| PATCH | `/api/v1/notifications/read-all?deviceId=` | Đánh dấu tất cả (hoặc của một cây) đã đọc cho user này |
| POST | `/api/v1/push/token` | Body `{ token, device? }` → upsert `{ token, userId, device, jwt, expiresAt }` với `jwt` lấy từ header `Authorization` (token đổi chủ thì gán lại user mới). Client gọi lại **sau mỗi lần đăng nhập** để JWT lưu kèm luôn còn hạn |
| DELETE | `/api/v1/push/token` | Body `{ token }` → xoá (chỉ khi token thuộc user này) |

`/internal/push/token` (POST/DELETE theo deviceId) **bị gỡ**.

### 4.4 Nhận sự kiện & đẩy push

`POST /internal/notify` **giữ nguyên hợp đồng** với Phong (x-api-key, body, phản hồi `202 { success, deviceId, recipients, ... }`).
Chỉ đổi bước targeting:

1. Template + lưu lịch sử như hiện tại (lưu với `readBy: []`).
2. **Hỏi lại quyền ngay lúc gửi** (người dùng đã chốt — không dùng ảnh chụp quyền cũ):
   - `FCMToken.find({ expiresAt: { $gt: now } }).select('+jwt')` → mọi token còn phiên hợp lệ.
   - Gom theo `jwt` (nhiều token có thể chung một JWT), mỗi JWT gọi `resolveAccess(jwt)` (mục 4.1, **dùng chung cache**
     `AUTH_CACHE_SECONDS`) → chỉ giữ token có `deviceId` nằm trong danh sách cây của JWT đó.
   - Phong trả 401 → bỏ qua token đó (phiên đã chết). Phong lỗi mạng/5xx → **không gửi** cho token đó (đóng an toàn), log cảnh báo.
   - Gửi song song tới các token còn lại.

   Kết quả: thu hồi share / được share cây mới đều có hiệu lực với push trong vòng `AUTH_CACHE_SECONDS`.
   *(Người dùng đã chốt)* Lọc `expiresAt` + 401 → **phiên đăng nhập hết hạn thì ngừng nhận push**: trình duyệt dùng chung
   không tiếp tục hiện tin của người cũ. Đăng nhập lại → đăng ký lại token → nhận tiếp.
   Client gọi `DELETE /api/v1/push/token` khi **đăng xuất** để ngừng ngay.
3. `data` FCM giữ `deviceId, event, type, severity, raw` và thêm `notificationId` (chờ lưu DB xong để lấy `_id`;
   lưu lỗi thì bỏ trống field này, vẫn push) để client đánh dấu đọc.
4. Message FCM chỉ cần `webpush` (cả 2 client đều là web); bỏ link tương đối `/dashboard` (trỏ sai trang trên web của team Frontend).
   Token `registration-token-not-registered` vẫn tự xoá như hiện tại.
5. `recipients` = số token đã gửi.

**Chi phí đã chấp nhận (demo):** mỗi sự kiện có thể gọi `GET /api/devices` của Phong một lần cho mỗi JWT chưa có trong cache.
Quy mô demo (vài người dùng) không đáng lo; nếu sau này đông người dùng thì cần Phong cung cấp API tra quyền theo `deviceId`.

### 4.5 Cấu hình (`.env`)

- **Mới** `PLANT_API_URL` — vd `http://localhost:8000` (dev) / `http://host.docker.internal:8080` (Docker). Bắt buộc cho `/api/v1/*`.
- **Mới** `AUTH_CACHE_SECONDS=60`.
- `INTERNAL_API_KEY` — nay **chỉ** dùng cho `/internal/notify`.
- Cập nhật `.env.example`, `docker-compose*.yml` tương ứng.

## 5. Gói bàn giao cho team Frontend & tài liệu cần cập nhật

**"Token truy cập" team Frontend cần = JWT lấy từ đăng nhập bên Phong.** team Frontend không nhận một khoá tĩnh nào của Notify
(`INTERNAL_API_KEY` chỉ dành cho server Phong). Gói bàn giao gồm:
- Base URL Notify + base URL Phong.
- **Một tài khoản test bên Phong** (email/mật khẩu) đã được share vài cây, để team Frontend login lấy JWT khi phát triển.
- Firebase web config + VAPID key (project `smartfarmai-f1426`) và file mẫu `firebase-messaging-sw.js`.
- Tài liệu API (dưới).

Tài liệu:
- `notification-service/docs/04-tich-hop-web.md` → viết lại thành **hướng dẫn tích hợp web quản lý**, người đọc là team Frontend:
  login qua Phong lấy JWT, gọi các endpoint mục 4.3, đăng ký FCM web, xử lý 401 (đăng nhập lại) / 503, kèm ví dụ `curl`.
- `02-kien-truc.md`, `03-luong-hoat-dong.md`, `docs/README.md`, `notification-web/README.md`, `BAO_CAO_DU_AN.md`,
  `HUONG_DAN_SU_KIEN_NOTIFY.md`: thay "kiosk theo deviceId" bằng "người dùng theo tài khoản Phong".
- Ghi chú cho Phong (không bắt sửa code): sơ đồ trong `NOTIFY-INTEGRATION-GUIDE.md` nên đổi đích từ "kiosk cạnh cây" sang "app/web người dùng".

## 6. Trang test `notification-web` (giả lập web của team Frontend)

Chỉ dùng đúng những gì sẽ bàn giao cho team Frontend (mục 5) — không gọi endpoint nội bộ, không dùng `INTERNAL_API_KEY`.
Nếu trang test cần thứ gì ngoài gói bàn giao thì gói bàn giao đang thiếu → bổ sung vào mục 5.

Một file `index.html` + `firebase-messaging-sw.js` như hiện tại (chạy `npm run dev`, port 3003). Bố cục **A** (người dùng đã chọn):

- **Địa chỉ server:** 2 hằng số ở đầu `index.html` (`PLANT_API_URL = 'http://localhost:8000'`,
  `NOTIFY_URL = 'http://localhost:3001'`), giống cách team Frontend sẽ làm. Đổi môi trường thì sửa 2 dòng này — không có ô nhập trên giao diện.
- **Màn đăng nhập:** chỉ email + mật khẩu. Lưu JWT vào `localStorage`. Đăng nhập xong, nếu đã bật push trước đó thì đăng ký lại FCM token.
- **Thanh trên:** logo SmartFarm · chuông có số chưa đọc · tên/email user (menu: **Bật nhận push**, **Đăng xuất**).
- **Hàng nút lọc:** "Tất cả" · một nút mỗi cây (tên từ `/api/v1/me`) · "Chưa đọc".
- **Danh sách thẻ:** viền màu theo severity (đỏ/cam/xanh), icon theo type, tiêu đề, nội dung, tên cây, "x phút trước",
  chấm đỏ nếu chưa đọc; bấm thẻ → đánh dấu đọc; nút "Đọc tất cả"; nút "Xem thêm" (20 tin/lần).
- **Realtime:** `onMessage` → nạp lại trang đầu danh sách + toast + cập nhật chuông. Tab đóng → service worker hiện notification hệ thống.
- Bất kỳ API nào trả 401 → xoá JWT, quay về màn đăng nhập.
- Đăng xuất → `DELETE /api/v1/push/token` rồi mới xoá JWT.
- Bỏ hẳn form cấu hình deviceId + API key và danh sách `liveItems` trong localStorage.

## 7. Để builder tự quyết

- Cách cài cache (Map trong bộ nhớ là đủ), cấu trúc file/middleware, tên hàm.
- `deviceId` không thuộc quyền ở `unread-count` / `read-all`: 403 như `GET /notifications` (gợi ý), hoặc 404.
- Dọn dữ liệu cũ (`FCMToken` theo deviceId, field `isRead`): xoá hay để mặc. *(Người dùng đã chốt: không migrate.)*
- Có/không thêm test tự động (repo hiện chưa có test framework); tối thiểu phải smoke test tay end-to-end
  với server Phong chạy local (hoặc `POST /api/auth/dev-token` của Phong ở môi trường Development để lấy JWT nhanh).
- Có cập nhật `scripts/publish-test.js` hay không (luồng `/internal/notify` không đổi nên có thể giữ nguyên).
