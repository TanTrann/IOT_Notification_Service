# Tài liệu — IOT Notification Service

Bộ tài liệu chi tiết cho dịch vụ gửi thông báo đẩy của hệ thống IoT SmartFarm.

| Tài liệu | Nội dung |
|---|---|
| [01-firebase-setup.md](01-firebase-setup.md) | Hướng dẫn từng bước tạo project Firebase, lấy service account, VAPID key, cấu hình client & service worker |
| [02-kien-truc.md](02-kien-truc.md) | Kiến trúc hệ thống (nhận `POST /internal/notify` → push FCM theo deviceId): thành phần, sơ đồ, mô hình dữ liệu |
| [03-luong-hoat-dong.md](03-luong-hoat-dong.md) | Luồng end-to-end: Phong → `POST /internal/notify` → push Firebase, client đăng ký & nhận qua Firebase Web Push |
| [04-tich-hop-web.md](04-tich-hop-web.md) | **Bàn giao cho dev web**: cấu hình deviceId + API key, REST API, đăng ký FCM token, service worker, các bẫy thường gặp |

> **Mô hình hiện tại (Firebase-only, targeting theo deviceId):** Phong xử lý thông báo xong rồi
> **`POST /internal/notify`** (header `x-api-key`, body kèm `deviceId`) sang service — **không còn
> nghe ké MQTT** của Phong. Service **không dịch** payload, lưu lịch sử vào MongoDB, và **push qua
> Firebase (FCM)** tới **đúng** các màn hình đã đăng ký `deviceId` đó — mỗi màn hình kiosk chỉ nhận
> tin của cây mình đứng cạnh. Màn hình kiosk web nhận qua **Firebase Web Push**. Đã bỏ SSE **và bỏ
> luôn lớp user/đăng nhập/JWT** — xác thực HTTP nay dùng chung một **API key** (`x-api-key`). Các
> luồng cũ (nghe MQTT, 2 họ topic sensor/control, so ngưỡng, dịch lệnh) đã gỡ bỏ.
