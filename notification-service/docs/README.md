# Tài liệu — IOT Notification Service

Bộ tài liệu chi tiết cho dịch vụ gửi thông báo đẩy của hệ thống IoT SmartFarm.

| Tài liệu | Nội dung |
|---|---|
| [01-firebase-setup.md](01-firebase-setup.md) | Hướng dẫn từng bước tạo project Firebase, lấy service account, VAPID key, cấu hình client & service worker |
| [02-kien-truc.md](02-kien-truc.md) | Kiến trúc hệ thống (nhận `POST /internal/notify` → Template Engine → push FCM tới người dùng có quyền xem cây; xác thực người dùng bằng JWT của Phong): thành phần, sơ đồ, mô hình dữ liệu |
| [03-luong-hoat-dong.md](03-luong-hoat-dong.md) | Luồng end-to-end: xác thực người dùng qua Phong, Phong → `POST /internal/notify` → Template Engine → chọn người nhận → push Firebase, client đăng nhập / đăng ký & nhận qua Firebase Web Push |
| [04-tich-hop-web.md](04-tich-hop-web.md) | **Hướng dẫn tích hợp web quản lý** (bàn giao cho team Frontend): đăng nhập qua Phong lấy JWT, REST API `/api/v1/*`, đăng ký FCM token, service worker, xử lý 401/503 |

> **Mô hình hiện tại (Firebase-only, Template Engine, thông báo theo người dùng):** 
> - Phong xử lý nghiệp vụ/phát hiện sự kiện xong rồi gọi **`POST /internal/notify`** (header `x-api-key`, body gồm `deviceId`, mã `event`, `severity` và dữ liệu đo đạc `data`).
> - Service sở hữu lớp **Template Engine (`templateEngine.js`)** tự động map `event` + `data` ra tiêu đề (`title`) và nội dung (`body`) trực quan (có hỗ trợ fallback và custom title/body ghi đè).
> - Người dùng **đăng nhập bằng tài khoản bên server .NET của Phong** (JWT). Web quản lý gọi `/api/v1/*` với `Authorization: Bearer <JWT>`; Notify hỏi `GET /api/devices` của Phong (cache `AUTH_CACHE_SECONDS`) để biết người đó được xem những cây nào.
> - Lưu lịch sử thông báo vào MongoDB (đã đọc tính riêng từng người) và **push qua Firebase (FCM)** tới **mọi người dùng đang có quyền xem** `deviceId` đó — quyền được hỏi lại Phong ngay lúc gửi.
> - Web quản lý nhận qua **Firebase Web Push** (onMessage khi mở tab, Service Worker khi đóng tab). `notification-web` là trang test giả lập web quản lý.
> - `x-api-key` (`INTERNAL_API_KEY`) **chỉ** dùng cho `POST /internal/notify`. Không còn MQTT listener, không còn SSE.
> - Cấu hình mới: `PLANT_API_URL` (địa chỉ server Phong), `AUTH_CACHE_SECONDS=60`. Test tự động: `npm test`.
