# IOT Notification Service — Báo Cáo Dự Án

## Giới Thiệu Dự Án

Tên dự án: IOT Notification Service
Thuộc hệ thống: SmartFarm — Giám sát và điều khiển cây trồng thông minh
Người phụ trách module: Tân Trần — phần **Push Notification với Firebase**

IOT Notification Service là một microservice trong hệ thống SmartFarm. Nhiệm vụ chính là nhận thông báo do server của Phong gửi sang qua API (`POST /internal/notify`) và **đẩy push notification qua Firebase Cloud Messaging (FCM)** tới **những người dùng có quyền xem cây** phát sinh sự kiện — hiển thị đúng nguyên nội dung, kể cả khi trang/ứng dụng đang đóng. Người dùng đăng nhập bằng chính tài khoản bên server .NET của Phong; Notify mượn hệ thống tài khoản + phân quyền theo cây của Phong, không tự làm tài khoản riêng.


## Bối Cảnh và Vấn Đề Cần Giải Quyết

Hệ thống SmartFarm theo dõi cây trồng tự động 24/7. Khi có sự kiện đáng chú ý — cây thiếu nước, nhiệt độ vượt ngưỡng, phát hiện bệnh, thiết bị mất kết nối — người dùng cần được thông báo ngay.

Vấn đề cần giải quyết:
- Cần một cầu nối trung thực từ nơi sinh thông báo (server của Phong) tới web quản lý của người dùng.
- Thông báo phải hiển thị **realtime** và **đánh thức được** kể cả khi trang/ứng dụng không ở tiền cảnh → dùng Firebase push.
- Mỗi người chỉ được thấy / nhận thông báo của **cây mình sở hữu hoặc được share** — quyền này do server Phong quản lý.
- Nội dung thông báo do Phong quyết định — service không tự diễn giải lại, tránh sai lệch.

Trong dự án, use-case cụ thể: tích hợp **Trung tâm thông báo (Notification Center / Bell Component)** vào **Trang Web Application quản lý SmartFarm** (website của team Frontend), cho phép người dùng/chủ trang trại theo dõi thông báo realtime của tất cả các cây/thiết bị hoặc lọc theo từng cây.


## Kiến Trúc Tổng Thể Hệ Thống SmartFarm

Hệ thống SmartFarm gồm nhiều thành viên:

- **Nhường** — phần cứng IoT, mạch và cảm biến (nhiệt độ, độ ẩm, ánh sáng).
- **Lĩnh** — AI Server, phân tích tình trạng cây.
- **Phong** — Server điều khiển (.NET, `plant-tree-iot`) và **MCP Server**: nhận dữ liệu, ra quyết định, **sinh thông báo**; quản lý **tài khoản người dùng (JWT) và quyền theo cây**.
- **Tân** — **Push Notification Service (Firebase)**: nhận thông báo từ Phong (qua API) và đẩy push tới người dùng.
- **Team Frontend** — Website quản lý SmartFarm (tích hợp Notification Center / Chuông thông báo), đăng nhập bằng tài khoản Phong và gọi API của Notify bằng JWT đó.

Luồng dữ liệu (mô hình hiện tại):

```
Server Phong ─POST /internal/notify (JSON, x-api-key)─► Notification Service ─FCM─► Web quản lý SmartFarm
                                                                                      (Chuông & Notification Center)
Web quản lý  ─POST /api/auth/login─► Server Phong → JWT
Web quản lý  ─/api/v1/* (Bearer JWT)─► Notification Service ─GET /api/devices (Bearer JWT)─► Server Phong
                                                              → danh sách cây user sở hữu / được share
```

Điểm thiết kế quan trọng: server của Phong xử lý và phát hiện sự kiện xong rồi **gọi API `POST /internal/notify`** (kèm `deviceId`, mã `event`, mức độ `severity` và thông số thô `data` trong body). Notification Service sở hữu **lớp Template Engine (`templateEngine.js`)** để tự map từ mã `event` + `data` ra tiêu đề (`title`) và nội dung (`body`) trực quan trước khi đẩy push qua Firebase tới **web quản lý SmartFarm** của những người dùng đang có quyền xem cây đó (web hiển thị toàn bộ cây của người dùng hoặc lọc theo từng `deviceId`).

> **Ghi chú tiến hoá:** 
> - Phiên bản đầu của service tự "nghe ké" dữ liệu cảm biến qua MQTT.
> - Giai đoạn 2: Phong chủ động bắn `title`/`body` sẵn qua API `POST /internal/notify` (pass-through).
> - **Phiên bản mới nhất (Hợp đồng mới):** Phong bắn dữ liệu thô dạng cấu trúc (`event` + `data` + `severity`), ranh giới rõ ràng: Phong chịu trách nhiệm phát hiện sự kiện và logic nghiệp vụ, còn **Notification Service chịu trách nhiệm quy định template câu chữ / UI / hiển thị**. Service tự động ghép thông số vào template (có fallback nếu event chưa có template) và đẩy push Firebase tới web quản lý SmartFarm của những người dùng có quyền xem cây (Notification Bell + Center, xem tất cả cây của mình hoặc lọc theo `deviceId`).

## Công Nghệ Sử Dụng

- Ngôn ngữ: Node.js (ES6 Modules)
- Framework backend: Express.js 4.19
- Cơ sở dữ liệu: MongoDB qua Mongoose (lưu FCM token + lịch sử thông báo)
- Giao thức nhận thông báo: HTTP REST (`POST /internal/notify`) — Phong gọi sang, xác thực bằng `x-api-key`
- **Dịch vụ push: Firebase Admin SDK 12 (FCM)** — trọng tâm module
- **Template Engine**: Định nghĩa từ điển `EVENT_TEMPLATES` map `event → title / body` linh hoạt
- Client: web quản lý của người dùng (HTML/JS + **Firebase JS SDK (Web Push)**); `notification-web` là trang test giả lập web đó
- Xác thực:
  - Server Phong → Notify: API key (header `x-api-key`) **chỉ** cho `POST /internal/notify`.
  - Người dùng → Notify: `Authorization: Bearer <JWT>` lấy từ đăng nhập bên Phong; Notify kiểm tra bằng cách gọi `GET {PLANT_API_URL}/api/devices` của Phong (cache `AUTH_CACHE_SECONDS`), không cần `JWT_SECRET` của Phong
- Kiểm thử: `npm test` (node:test, 23 test)
- Bảo mật: Helmet và CORS middleware


## Chức Năng Chính

**Nhận thông báo qua API:** Server của Phong gọi `POST /internal/notify` (header `x-api-key`, body JSON kèm `deviceId`, `event`, `severity`, `data`). Service xử lý ở `notificationService.ingest()`.

**Template Engine (Map event → câu chữ UI):** Dịch tự động từ mã máy `event` (như `water.empty`, `pump.on`, `battery.low`, `temp.high`...) và object `data` ra tiêu đề/nội dung thân thiện. Hỗ trợ fallback về `body` nếu event chưa đăng ký template.


**Xác thực người dùng bằng tài khoản Phong:** Người dùng đăng nhập bên Phong (`POST /api/auth/login` → JWT). Mọi API `/api/v1/*` yêu cầu `Authorization: Bearer <JWT>`; Notify hỏi `GET /api/devices` của Phong để biết JWT hợp lệ và người đó được xem những cây nào (sở hữu hoặc được share). JWT sai/hết hạn → 401; không hỏi được Phong → 503.

**Push qua Firebase (theo người dùng):** Sự kiện của cây X được gửi tới mọi token của mọi người **đang có quyền xem X** — quyền được hỏi lại Phong ngay lúc gửi (`recipientSelector`), nên thu hồi / thêm share có hiệu lực trong vòng `AUTH_CACHE_SECONDS` (60s). Phiên đăng nhập hết hạn hoặc đăng xuất → ngừng nhận push. Push nổ cả khi trang/ứng dụng đóng. Token không còn hợp lệ được tự động xóa.

**Đăng ký nhận push:** Web quản lý đăng ký FCM registration token qua `POST /api/v1/push/token` (Bearer JWT) sau mỗi lần đăng nhập; token gắn với **người dùng** (kèm JWT và hạn của JWT). Đăng xuất gọi `DELETE /api/v1/push/token`.

**Hiển thị trên web quản lý (Firebase Web Push):** Web nhận message qua `messaging.onMessage` (nạp lại danh sách + toast + chuông); service worker hiển thị khi tab đóng. Trang test `notification-web` giả lập đúng luồng này (đăng nhập → JWT → API Notify → FCM web).

**REST cho web (đọc lịch sử):** `GET /api/v1/notifications` trả thông báo của **mọi cây người dùng có quyền**, lọc được theo từng cây (`?deviceId=`) hoặc chỉ chưa đọc (`?unread=true`). Trạng thái **đã đọc tính riêng từng người dùng**.


## Luồng Xử Lý Thông Báo

Bước 1 — Nhận: server của Phong gọi `POST /internal/notify` (body JSON kèm `deviceId`). Service xác thực `x-api-key`, lấy `deviceId` từ body, qua Template Engine, chuẩn hóa field và **ghi lịch sử vào MongoDB trước** (best-effort, chống trùng qua `eventId`) để lấy `notificationId` gửi kèm push.

Bước 2 — Chọn người nhận: lấy các FCM token có phiên đăng nhập còn hạn (`expiresAt > now`), gom theo JWT, hỏi lại Phong (`GET /api/devices`, có cache) → chỉ giữ token của người đang có quyền xem `deviceId`. Phong không truy cập được → không gửi cho ai (đóng an toàn), lịch sử vẫn lưu và vẫn trả `202`.

Bước 3 — Đẩy push: `fcmService.sendToTokens(...)` gửi song song qua Firebase; `recipients` = số token đã gửi.

Bước 4 — Người dùng nhận: web đang mở → `onMessage` nạp lại danh sách + toast; tab đóng → notification hệ thống hiển thị (Firebase Web Push + service worker).


## Mô Hình Dữ Liệu

Collection `fcmtokens` (FCM token theo người dùng):
- userId: userId tài khoản bên Phong (claim `nameid` của JWT)
- token: FCM registration token (unique)
- device: loại client (web, android, ios)
- jwt: JWT của người dùng lúc đăng ký — dùng hỏi lại Phong quyền xem cây khi gửi push. Thông tin nhạy cảm: không select mặc định, không trả ra API, không ghi log
- expiresAt: hạn của JWT; hết hạn thì ngừng nhận push

Collection `notifications` (ghi khi nhận `/internal/notify`, phục vụ REST đọc của web):
- eventId, deviceId, event, title, body, type, severity, data, readBy, createdAt
- `readBy`: danh sách userId đã đọc — API trả `isRead` tính theo người xem, không lộ mảng này.
- Lưu ý: `notificationService.ingest` **ghi mỗi tin vào collection này trước khi push** (best-effort, lỗi ghi không chặn push) để REST đọc lại lịch sử bền vững; `severity`/`type` được chuẩn hóa cho khớp enum, trùng `eventId` chỉ ghi 1 lần.


## REST API và Endpoint

Nhận thông báo từ Phong (`/internal/notify`, header `x-api-key` — endpoint duy nhất dùng API key):
- `POST /internal/notify` — Phong gửi sự kiện vào, body `{ deviceId, event, data, severity, eventId, title?, body? }` (`deviceId` bắt buộc). Trả `202 { success, deviceId, event, title, body, recipients }`.

API cho người dùng (`/api/v1/*`, header `Authorization: Bearer <JWT đăng nhập bên Phong>`; JWT sai/hết hạn → 401, không hỏi được Phong → 503, `deviceId` ngoài quyền → 403):
- `GET /api/v1/me` — `{ userId, email, devices: [{ deviceId, name }] }`.
- `GET /api/v1/notifications?deviceId=&unread=true&page=1&limit=20` — `{ items, unreadCount, page, limit, hasMore }`; không truyền `deviceId` → mọi cây có quyền.
- `GET /api/v1/notifications/unread-count?deviceId=` — `{ unreadCount }`.
- `PATCH /api/v1/notifications/:id/read` — đánh dấu đã đọc cho người dùng này.
- `PATCH /api/v1/notifications/read-all?deviceId=` — đánh dấu tất cả (hoặc của 1 cây) đã đọc cho người dùng này.
- `POST /api/v1/push/token` — đăng ký FCM token, body `{ token, device }` (gọi lại sau mỗi lần đăng nhập).
- `DELETE /api/v1/push/token` — hủy FCM token, body `{ token }` (gọi khi đăng xuất).

Khác: `GET /health` — kiểm tra service (không cần key).


## Tính Năng Kỹ Thuật Nổi Bật

**Firebase là trung tâm:** toàn bộ thông báo đi qua FCM — đúng phần việc "Push Notification với Firebase".

**Template Engine thông minh:** Tự động map `event` + `data` ra tiêu đề (`title`) và nội dung (`body`) trực quan, hỗ trợ fallback an toàn và custom title/body ghi đè.

**Thông báo theo người dùng, quyền do Phong quản lý:** Notify mượn tài khoản + phân quyền theo cây của Phong (không cần `JWT_SECRET`, Phong không phải sửa code). Quyền được hỏi lại ngay lúc gửi push → người dùng không nhận push của cây mình không có quyền; thu hồi / thêm share có hiệu lực trong vòng 60s.

**Đóng an toàn:** phiên hết hạn / đăng xuất → ngừng nhận push; Phong không truy cập được → không gửi push cho ai (lịch sử vẫn lưu).

**Đã đọc theo từng người:** cùng một thông báo, mỗi người dùng có trạng thái đã đọc riêng (`readBy`).

**Web Push cho web quản lý:** dùng Firebase JS SDK — `onMessage` hiện realtime khi trang mở, service worker hiện khi trang đóng; không cần kênh trung gian. Một Firebase project duy nhất (`smartfarmai-f1426`).

**FCM best-effort:** lỗi ghi DB không làm gãy việc push; token chết tự bị xóa khỏi DB.

**Chống trùng khi retry:** nếu Phong gửi kèm `id`/`eventId`, service dùng làm khóa upsert — Phong gọi lại cùng tin không tạo bản ghi lặp.


## Kết Quả Đạt Được

- Service nhận thông báo qua `POST /internal/notify` và đẩy push qua Firebase tới đúng những người dùng đang có quyền xem cây đó.
- Xác thực người dùng bằng JWT của Phong, phân quyền theo cây lấy trực tiếp từ Phong — không phải sửa code phía Phong.
- Tích hợp Firebase FCM thành công: push nổ tới trình duyệt kể cả khi trang đóng.
- Trang test `notification-web` giả lập web quản lý của team Frontend: đăng nhập tài khoản Phong, lọc theo cây / chưa đọc, đánh dấu đã đọc, bật nhận push, nhận qua Firebase Web Push.
- Realtime và lịch sử (REST) cùng dựa trên danh sách cây người dùng có quyền → nhất quán, mở lại trang không mất tin.
- Có script `scripts/publish-test.js` giả lập Phong gọi `POST /internal/notify` để kiểm thử end-to-end, và bộ test tự động `npm test` (23 test).


## Hướng Phát Triển Tiếp Theo

- Phối hợp với Phong để chốt contract body của `POST /internal/notify` và cấp API key (điểm ráp nối production).
- Hàng đợi gửi lại khi Firebase tạm thời không khả dụng; rate limiting tránh dội thông báo.
- Bàn giao cho team Frontend tích hợp vào web quản lý theo [hướng dẫn tích hợp web quản lý](notification-service/docs/04-tich-hop-web.md).
- Bản app điện thoại (Android/iOS) đăng ký token qua cùng API `POST /api/v1/push/token` (Bearer JWT) để nhận push.
- Khi số người dùng tăng: đề nghị Phong cung cấp API tra quyền theo `deviceId`, thay cho việc gọi `GET /api/devices` theo từng JWT mỗi sự kiện.


## Kết Luận

IOT Notification Service đảm nhiệm phần **Push Notification với Firebase** của SmartFarm: nhận thông báo do server của Phong gửi sang qua API (`POST /internal/notify`) và đẩy qua FCM tới web quản lý của những người dùng có quyền xem cây (Firebase Web Push), kể cả khi trang đóng. Mô hình "Phong quản lý tài khoản và quyền, Notify lo câu chữ, lịch sử và push theo người dùng" giúp service đơn giản, an toàn, dễ bảo trì và dễ mở rộng thêm client.

Công nghệ sử dụng: Node.js, Express, MongoDB, Firebase FCM.
Người phụ trách: Tân Trần — tan.tran@treehousei.com
