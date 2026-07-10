# Notification Web — Trung tâm thông báo SmartFarm

Web app cho **người dùng cuối**: nhận push notification khi hệ thống của Phong phát sự kiện
cảnh báo (cây thiếu nước, nhiệt độ cao, đã tự động tưới...), xem lịch sử và đánh dấu đã đọc.

Khác với `test-client/` (công cụ giả lập để dev test), trang này chỉ **nhận và hiển thị**:

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
2. Lấy JWT cho thiết bị muốn theo dõi: mở **test-client** (bước 2) → nhập Device ID + `JWT_SECRET` → "🔑 Sinh JWT" → "📋 Copy". (Hoặc dùng CLI: `cd notification-service && node generate-token.js device_test_01`.)
   `device_id` phải khớp thiết bị đang gửi dữ liệu (`device_test_01` khi test bằng test-client, hoặc device_id của thiết bị thật).
3. Mở trang → dán JWT → **Lưu & Kết nối** → **🔔 Bật nhận push** → cho phép quyền thông báo.
4. Xong — khi Phong phát sự kiện (hoặc bạn giả lập bằng `test-client/`), thông báo tự hiện.

Cấu hình (server URL + JWT) lưu trong `localStorage`, lần sau mở trang tự kết nối lại.

## Demo nhanh (không cần thiết bị thật)

Mở song song 2 trang:
- `notification-web` (port 3000) — người dùng, JWT của `device_test_01`.
- `test-client` (port 8080) — giả lập: bấm "🌵 Đất khô (22%)".

→ Trang này lập tức hiện toast **"Cây đang thiếu nước"** + badge chưa đọc tăng.

## Lưu ý kỹ thuật

- Firebase config + VAPID key hardcode trong `index.html` và `firebase-messaging-sw.js`
  (project `smartfarmai-f1426`) — đổi project thì sửa **cả hai file giống nhau**.
- JWT chứa `deviceId`; API chỉ trả thông báo của đúng thiết bị đó.
- Push background chỉ hiện system notification (service worker không cập nhật được UI trong tab) —
  danh sách sẽ đồng bộ khi quay lại tab.
