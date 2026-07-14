# IOT Notification Service — Báo Cáo Dự Án

## Giới Thiệu Dự Án

Tên dự án: IOT Notification Service
Thuộc hệ thống: SmartFarm — Giám sát và điều khiển cây trồng thông minh
Người phụ trách module: Tân Trần — phần **Push Notification với Firebase**

IOT Notification Service là một microservice trong hệ thống SmartFarm. Nhiệm vụ chính là nhận thông báo do MCP Server sinh ra và **đẩy push notification qua Firebase Cloud Messaging (FCM)** tới màn hình/thiết bị người dùng — hiển thị đúng nguyên nội dung, kể cả khi trang/ứng dụng đang đóng.


## Bối Cảnh và Vấn Đề Cần Giải Quyết

Hệ thống SmartFarm theo dõi cây trồng tự động 24/7. Khi có sự kiện đáng chú ý — cây thiếu nước, nhiệt độ vượt ngưỡng, phát hiện bệnh, thiết bị mất kết nối — người dùng cần được thông báo ngay.

Vấn đề cần giải quyết:
- Cần một cầu nối trung thực từ nơi sinh thông báo (MCP Server) tới màn hình hiển thị.
- Thông báo phải hiển thị **realtime** và **đánh thức được** kể cả khi màn hình/ứng dụng không ở tiền cảnh → dùng Firebase push.
- Nội dung thông báo do MCP quyết định — service không tự diễn giải lại, tránh sai lệch.

Trong dự án, use-case cụ thể: mỗi cây trồng bằng AI có một **màn hình web (kiosk) đặt cạnh cây** để hiển thị thông báo.


## Kiến Trúc Tổng Thể Hệ Thống SmartFarm

Hệ thống SmartFarm gồm nhiều thành viên:

- **Nhường** — phần cứng IoT, mạch và cảm biến (nhiệt độ, độ ẩm, ánh sáng).
- **Lĩnh** — AI Server, phân tích tình trạng cây.
- **Phong** — Server điều khiển (.NET) và **MCP Server**: nhận dữ liệu, ra quyết định và **sinh thông báo**.
- **Tân** — **Push Notification Service (Firebase)**: nhận thông báo từ MCP và đẩy push tới người dùng.
- **Thịnh** — Website quản lý SmartFarm.

Luồng dữ liệu (mô hình hiện tại):

```
MCP Server (Phong) ─publish JSON─► HiveMQ (planttree/{deviceId}/notifications) ─► Notification Service ─FCM─► Màn hình web kiosk cạnh cây
```

Điểm thiết kế quan trọng: MCP Server chỉ cần **publish một JSON bất kỳ** lên topic `planttree/{deviceId}/notifications` (song song với `sensors`/`commands` sẵn có của Phong). Notification Service **không dịch, không biến đổi** — đẩy nguyên nội dung qua Firebase tới **đúng các màn hình đã đăng ký deviceId đó** (targeting theo thiết bị): mỗi màn hình kiosk cấu hình deviceId của cây nó đứng cạnh, chỉ nhận tin của cây đó.

> **Ghi chú tiến hoá:** phiên bản đầu của service tự "nghe ké" dữ liệu cảm biến (`xmini/sensor_data`, `xmini/control`), so ngưỡng và dịch lệnh thành thông báo. Sau đó dự án chuyển sang mô hình trung thực hơn: **MCP tự sinh thông báo, service chỉ đẩy push qua Firebase**. Bản mới nhất bỏ luôn lớp user/đăng nhập (JWT): **deviceId trở thành danh tính của chính màn hình kiosk**, cấu hình trực tiếp trên máy — push và lịch sử đều lọc theo deviceId nên luôn khớp nhau. Các luồng dịch/so ngưỡng, kênh SSE trung gian và lớp user đã được gỡ bỏ.


## Công Nghệ Sử Dụng

- Ngôn ngữ: Node.js (ES6 Modules)
- Framework backend: Express.js 4.19
- Cơ sở dữ liệu: MongoDB qua Mongoose (lưu FCM token)
- Giao thức nhận thông báo: MQTT (HiveMQ Cloud, TLS 8883, dùng chung broker với hệ của Phong)
- **Dịch vụ push: Firebase Admin SDK 12 (FCM)** — trọng tâm module
- Client màn hình: HTML/JS + **Firebase JS SDK (Web Push)** (notification-web)
- Xác thực: **một API key dùng chung** (header `x-api-key`) cho cả `/internal/*` lẫn `/api/v1/*` — không còn user/JWT
- Bảo mật: Helmet và CORS middleware


## Chức Năng Chính

**Nhận thông báo qua MQTT:** Service subscribe `planttree/+/notifications` (cấu hình qua `MQTT_NOTIFICATION_TOPIC`), bóc `deviceId` từ topic. MCP Server publish JSON lên `planttree/{deviceId}/notifications`.

**Chuyển tiếp trung thực (không dịch):** Service giữ nguyên payload, chỉ bóc mềm dẻo các field `title`/`body`/`severity`/`type` để đặt tiêu đề/nội dung push cho đẹp; không field nào bắt buộc.

**Push qua Firebase (targeting theo device):** Mỗi tin chỉ gửi tới các token đã đăng ký **đúng deviceId** bóc từ topic (`fcmService.sendToDeviceId`) — mỗi màn hình chỉ nhận tin của cây mình. Push nổ cả khi trang/ứng dụng đóng. Token không còn hợp lệ được tự động xóa.

**Đăng ký thiết bị nhận push:** Màn hình kiosk đăng ký FCM registration token **kèm deviceId** qua `POST /internal/push/token` (API key).

**Hiển thị trên màn hình kiosk (Firebase Web Push):** Trang `notification-web` mở full-screen cạnh cây, cấu hình sẵn deviceId + API key; nhận message qua `messaging.onMessage` và **dựng danh sách realtime ngay trong trang**; service worker hiển thị khi tab đóng.

**REST cho web (đọc lịch sử):** `GET /api/v1/notifications?deviceId=...` cung cấp lịch sử/đã đọc (API key), lọc theo deviceId — khớp đúng những gì màn hình nhận realtime.


## Luồng Xử Lý Thông Báo

Bước 1 — Nhận: MCP Server publish JSON lên `planttree/{deviceId}/notifications`. Service subscribe, bóc `deviceId` từ topic và parse JSON.

Bước 2 — Đẩy push: `fcmService.sendToDeviceId(deviceId, ...)` tra các token đã đăng ký đúng deviceId và gửi push song song qua Firebase.

Bước 3 — Người dùng nhận: màn hình web mở → `onMessage` hiện tin ngay trong danh sách; màn/tab đóng → notification hệ thống hiển thị (Firebase Web Push + service worker).


## Mô Hình Dữ Liệu

Collection `fcmtokens` (đang dùng đầy đủ):
- deviceId: định danh thiết bị/cây mà màn hình đứng cạnh (dùng để targeting push)
- token: FCM registration token (unique)
- device: loại client (web, android, ios)

Collection `notifications` (chỉ phục vụ REST đọc của web):
- eventId, deviceId, title, body, type, severity, isRead, createdAt
- Lưu ý: luồng MQTT **ghi mỗi tin vào collection này** (best-effort, không chặn push) để REST đọc lại lịch sử bền vững. Màn hình kiosk vẫn hiện realtime từ message FCM; `severity`/`type` được chuẩn hóa cho khớp enum, trùng `eventId` chỉ ghi 1 lần.


## REST API và Endpoint

Tất cả xác thực bằng **một API key chung** qua header `x-api-key` (không còn user/JWT).

Đăng ký nhận push (`/internal/*`):
- `POST /internal/push/token` — đăng ký FCM token, body kèm `{ token, deviceId, device }`.
- `DELETE /internal/push/token` — hủy FCM token.

Đọc lịch sử (`/api/v1/notifications`, lọc theo `?deviceId=...`):
- `GET /api/v1/notifications?deviceId=...` — danh sách + đếm chưa đọc.
- `GET /api/v1/notifications/unread-count?deviceId=...` — đếm chưa đọc.
- `PATCH /api/v1/notifications/:id/read?deviceId=...` và `/read-all?deviceId=...` — đánh dấu đã đọc.

Khác: `GET /health` — kiểm tra service (không cần key).


## Tính Năng Kỹ Thuật Nổi Bật

**Firebase là trung tâm:** toàn bộ thông báo đi qua FCM — đúng phần việc "Push Notification với Firebase".

**Chuyển tiếp trung thực:** hiển thị đúng nguyên JSON MCP gửi; client luôn có thể xem dữ liệu gốc.

**Targeting theo thiết bị:** mỗi màn hình chỉ nhận tin của cây mình (`sendToDeviceId`) — deviceId bóc từ topic khớp deviceId token đã đăng ký. Đơn giản, không cần user/đăng nhập.

**Web Push cho màn kiosk:** dùng Firebase JS SDK — `onMessage` hiện realtime khi trang mở, service worker hiện khi trang đóng; không cần kênh trung gian.

**FCM best-effort:** lỗi gửi push không làm gãy luồng; token chết tự bị xóa khỏi DB.

**Tự động phục hồi kết nối:** MQTT client tự reconnect mỗi 5 giây; service không crash khi broker tạm ngắt.

**Khởi động an toàn:** service vẫn chạy dù thiếu Firebase, MQTT hoặc MongoDB — ghi log cảnh báo và tiếp tục.


## Kết Quả Đạt Được

- Service nhận thông báo từ `planttree/{deviceId}/notifications` và đẩy push qua Firebase tới đúng màn hình của deviceId đó.
- Tích hợp Firebase FCM thành công: push nổ tới màn hình/thiết bị kể cả khi trang đóng.
- Màn hình kiosk web (notification-web): mở full-screen cạnh cây, chỉ cần cấu hình deviceId + API key (không đăng nhập), nhận qua Firebase Web Push và hiển thị danh sách realtime.
- Realtime và lịch sử (REST) đều lọc theo deviceId → nhất quán, mở lại trang không mất tin.
- Có script `scripts/publish-test.js` giả lập MCP bắn thông báo lên `planttree/{deviceId}/notifications` để kiểm thử end-to-end.


## Hướng Phát Triển Tiếp Theo

- Phối hợp với Phong để MCP/server publish `planttree/{deviceId}/notifications` khi có sự kiện (điểm ráp nối production).
- Hàng đợi gửi lại khi Firebase tạm thời không khả dụng; rate limiting tránh dội thông báo.
- Bản app điện thoại (Android/iOS) đăng ký cùng cơ chế token-kèm-deviceId để nhận push khi rời màn hình.
- Xoay/cấp phát API key theo từng kiosk (thay vì một key chung) nếu cần siết bảo mật.


## Kết Luận

IOT Notification Service đảm nhiệm phần **Push Notification với Firebase** của SmartFarm: nhận thông báo do MCP Server sinh ra và đẩy qua FCM tới màn hình kiosk cạnh cây (Firebase Web Push), hiển thị đúng nguyên nội dung, kể cả khi trang đóng. Mô hình "không dịch, chỉ đẩy push, targeting theo deviceId" giúp service đơn giản, dễ bảo trì và dễ mở rộng thêm client.

Công nghệ sử dụng: Node.js, Express, MongoDB, MQTT, Firebase FCM.
Người phụ trách: Tân Trần — tan.tran@treehousei.com
