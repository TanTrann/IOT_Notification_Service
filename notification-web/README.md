# Notification Web — Trung tâm thông báo SmartFarm

Web app cho **người dùng cuối**: nhận push notification khi hệ thống của Phong phát sự kiện
cảnh báo (cây thiếu nước, nhiệt độ cao, đã tự động tưới...), xem lịch sử và đánh dấu đã đọc.

Trang này chỉ **nhận và hiển thị**:

- 🔔 Nhận push realtime qua FCM — tab đang mở hiện toast, tab đóng hiện notification hệ thống (service worker).
- 📋 Danh sách thông báo từ API, phân trang, icon theo loại (💧 nước / 💡 ánh sáng / 🌡️ nhiệt độ...), màu theo mức độ (info / warning / critical).
- ✓ Click để đánh dấu đã đọc, nút "Đọc tất cả", badge đếm chưa đọc trên chuông.
- 🔄 Tự làm mới khi có push, khi quay lại tab, và mỗi 30 giây.

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
2. Đăng nhập trên trang (👤 góc phải) — tài khoản demo `demo` / `demo1234` (tạo bằng `cd notification-service && node seed-users.js`).
3. Bấm **🔔 Bật nhận push** → cho phép quyền thông báo.
4. Xong — khi Phong phát sự kiện (hoặc bạn giả lập bằng `cd notification-service && node scripts/publish-test.js`), thông báo tự hiện.

Cấu hình (server URL + JWT) lưu trong `localStorage`, lần sau mở trang tự kết nối lại.

## Demo nhanh (không cần thiết bị thật)

1. Mở `notification-web` (port 3000), đăng nhập và **🔔 Bật nhận push**.
2. Giả lập MCP bắn thông báo: `cd notification-service && node scripts/publish-test.js`.

→ Trang này lập tức hiện toast **"Cây thiếu nước"** + badge chưa đọc tăng.

## Lưu ý kỹ thuật

- Firebase config + VAPID key hardcode trong `index.html` và `firebase-messaging-sw.js`
  (project `smartfarmai-f1426`) — đổi project thì sửa **cả hai file giống nhau**.
- JWT chứa `deviceId`; API chỉ trả thông báo của đúng thiết bị đó.
- Push background chỉ hiện system notification (service worker không cập nhật được UI trong tab) —
  danh sách sẽ đồng bộ khi quay lại tab.
