# Notification Web — Trung tâm thông báo SmartFarm

Màn hình **kiosk đặt cạnh cây**: nhận push notification khi hệ thống của Phong phát sự kiện
cảnh báo (cây thiếu nước, nhiệt độ cao, đã tự động tưới...) cho **đúng thiết bị/cây** mà màn hình
này đứng cạnh, xem lịch sử và đánh dấu đã đọc.

Trang này chỉ **nhận và hiển thị** — không có đăng nhập/user, danh tính là `deviceId` cấu hình sẵn:

- 🔔 Nhận push realtime qua FCM — tab đang mở hiện toast, tab đóng hiện notification hệ thống (service worker).
- 📋 Danh sách thông báo từ API, icon theo loại (💧 nước / 💡 ánh sáng / 🌡️ nhiệt độ...), màu theo mức độ (info / warning / critical).
- ✓ Click để đánh dấu đã đọc, nút "Đọc tất cả", badge đếm chưa đọc trên chuông.
- 🔄 Làm mới khi có push và khi bấm nút ↻.

## Cách chạy

```bash
cd notification-web
npm run dev
# Mở http://localhost:3000
```

> Chạy port **3000** vì đã nằm sẵn trong `ALLOWED_ORIGINS` của notification-service.
> Đổi port khác thì phải thêm origin đó vào `.env` của service.
> Phải chạy qua HTTP server (service worker không hoạt động khi mở file trực tiếp).

## Sử dụng

1. Đảm bảo `notification-service` đang chạy (`npm run dev` trong `notification-service/`).
2. Bấm **⚙️ Cấu hình** (góc phải) và nhập:
   - **Notification Service URL** — VD `http://localhost:3001`
   - **Device ID** — cây/thiết bị màn hình này đứng cạnh, VD `ESP32S3_Zone1`
   - **API key** — chính là `INTERNAL_API_KEY` trong `.env` của service
   rồi bấm **Lưu cấu hình**.
3. Bấm **🔔 Bật nhận push** → cho phép quyền thông báo.
4. Xong — khi Phong publish lên `planttree/<Device ID>/notifications` (hoặc bạn giả lập bằng
   `cd notification-service && node scripts/publish-test.js '{"title":"..."}' ESP32S3_Zone1`), thông báo tự hiện.

Cấu hình (server URL + deviceId + API key) lưu trong `localStorage`, lần sau mở trang tự kết nối lại.

## Demo nhanh (không cần thiết bị thật)

1. Mở `notification-web` (port 3000), cấu hình deviceId + API key và **🔔 Bật nhận push**.
2. Giả lập MCP bắn thông báo đúng device: `cd notification-service && node scripts/publish-test.js '' ESP32S3_Zone1`.

→ Trang này lập tức hiện toast **"Cây thiếu nước"** + badge chưa đọc tăng.

## Lưu ý kỹ thuật

- Firebase config + VAPID key hardcode trong `index.html` và `firebase-messaging-sw.js`
  (project `smartfarmai-f1426`) — đổi project thì sửa **cả hai file giống nhau**.
- Màn hình đăng ký FCM token **kèm deviceId** qua `POST /internal/push/token`; service chỉ đẩy
  tin của deviceId đó về đây. API đọc lịch sử (`GET /api/v1/notifications?deviceId=...`) cũng lọc theo deviceId.
- Mọi request gửi API key qua header `x-api-key` (không còn JWT).
- Push background chỉ hiện system notification (service worker không cập nhật được UI trong tab) —
  danh sách sẽ đồng bộ khi quay lại tab.
