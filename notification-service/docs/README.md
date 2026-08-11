# Tài liệu — IOT Notification Service

Bộ tài liệu chi tiết cho dịch vụ gửi thông báo đẩy của hệ thống IoT SmartFarm.

| Tài liệu | Nội dung |
|---|---|
| [01-firebase-setup.md](01-firebase-setup.md) | Hướng dẫn từng bước tạo project Firebase, lấy service account, VAPID key, cấu hình client & service worker |
| [02-kien-truc.md](02-kien-truc.md) | Kiến trúc hệ thống (nhận `POST /internal/notify` → Template Engine → push FCM theo deviceId): thành phần, sơ đồ, mô hình dữ liệu |
| [03-luong-hoat-dong.md](03-luong-hoat-dong.md) | Luồng end-to-end: Phong → `POST /internal/notify` → Template Engine → push Firebase, client đăng ký & nhận qua Firebase Web Push |
| [04-tich-hop-web.md](04-tich-hop-web.md) | **Bàn giao cho dev web**: cấu hình deviceId + API key, REST API (hỗ trợ `all` & từng deviceId), đăng ký FCM token, service worker, các bẫy thường gặp |

> **Mô hình hiện tại (Firebase-only, Template Engine, targeting theo deviceId):** 
> - Phong xử lý nghiệp vụ/phát hiện sự kiện xong rồi gọi **`POST /internal/notify`** (header `x-api-key`, body gồm `deviceId`, mã `event`, `severity` và dữ liệu đo đạc `data`).
> - Service sở hữu lớp **Template Engine (`templateEngine.js`)** tự động map `event` + `data` ra tiêu đề (`title`) và nội dung (`body`) trực quan (có hỗ trợ fallback và custom title/body ghi đè).
> - Lưu lịch sử thông báo vào MongoDB và **push qua Firebase (FCM)** tới **đúng** các màn hình đã đăng ký `deviceId` đó (`fcmService.sendToDeviceId`).
> - Màn hình kiosk web/Web App nhận qua **Firebase Web Push** (onMessage khi mở tab, Service Worker khi đóng tab).
> - Xác thực HTTP dùng chung một **API key** (`x-api-key`) cho mọi endpoint nội bộ và REST. Giao tiếp sạch sẽ, không còn MQTT listener, không còn SSE và không còn user/JWT.
