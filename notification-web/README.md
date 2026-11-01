# Notification Web — trang test (giả lập web quản lý của team Frontend)

Trang này **giả lập web quản lý** mà team Frontend sẽ làm: người dùng đăng nhập bằng tài khoản bên server Phong,
xem thông báo của các cây mình sở hữu hoặc được chia sẻ, và nhận push realtime.

Trang **chỉ dùng đúng những gì bàn giao cho team Frontend** (đăng nhập Phong → JWT → API `/api/v1/*` của Notify → FCM web),
không dùng API key nội bộ. Test chạy được trên trang này thì team Frontend làm theo
[hướng dẫn tích hợp](../notification-service/docs/04-tich-hop-web.md) cũng chạy được.

- 🔐 Đăng nhập email/mật khẩu (tài khoản server Phong).
- 📋 Một danh sách thông báo; nút lọc **Tất cả · từng cây · Chưa đọc**; nút **Xem thêm** (20 tin/lần).
- 🎨 Viền màu theo mức độ (đỏ nguy cấp / cam cảnh báo / xanh thông tin), icon theo loại, tên cây, thời gian.
- ✓ Bấm thẻ để đánh dấu đã đọc, nút **Đọc tất cả**, chuông đếm chưa đọc — "đã đọc" tính riêng từng người.
- 🔔 Push realtime: tab mở hiện toast + tải lại danh sách; tab đóng hiện thông báo hệ thống (service worker).

## Cách chạy

Cần 3 thứ đang chạy:

1. **MongoDB** local (`mongodb://localhost:27017`).
2. **Server Phong** (`plant-tree-iot/PlantTreeIoTServer`): `dotnet run` → `http://localhost:8000`.
3. **Notify** (`notification-service`): `.env` có `PLANT_API_URL=http://localhost:8000`, rồi `npm run dev` → `http://localhost:3001`.

Sau đó:

```bash
cd notification-web
npm run dev
# Mở http://localhost:3003
```

> Phải chạy qua HTTP server (service worker không hoạt động khi mở file trực tiếp).

Địa chỉ server nằm ở **2 hằng số đầu `<script>`** trong `index.html` — đổi môi trường thì sửa 2 dòng này:

```js
const PLANT_API_URL = 'http://localhost:8000';
const NOTIFY_URL    = 'http://localhost:3001';
```

## Demo nhanh

1. Tạo tài khoản + cây bên server Phong bằng script (chạy lại nhiều lần không sao):
   ```bash
   cd notification-service
   node scripts/setup-demo.js demo@test.local 123456 ESP32S3_Zone1 "Cây Zone 1"
   ```
   Nếu báo cây đang thuộc tài khoản khác, dùng `deviceId` khác (vd `CAY_DEMO_1`) cho cả bước 3.
2. Mở `http://localhost:3003`, đăng nhập tài khoản đó, bấm 👤 → **Bật nhận push**.
3. Giả lập Phong bắn sự kiện:
   ```bash
   cd notification-service
   node scripts/publish-test.js water.empty ESP32S3_Zone1
   ```
   → toast **"Hết nước tưới"** hiện lên, chuông tăng, tin nằm đầu danh sách.
4. Thử chia sẻ cây cho tài khoản thứ hai (`POST /api/devices/ESP32S3_Zone1/share` `{ "email": ... }`):
   tài khoản đó đăng nhập là thấy tin, và tin vẫn **chưa đọc** với họ.

## Lưu ý kỹ thuật

- Firebase config + VAPID key hardcode trong `index.html` và `firebase-messaging-sw.js`
  (project `smartfarmai-f1426`) — đổi project thì sửa **cả hai file giống nhau**.
- JWT lưu ở `localStorage` (`notiweb-session`). Notify trả 401 → tự đăng xuất về màn đăng nhập.
- Sau mỗi lần đăng nhập, nếu trình duyệt đã cho phép thông báo thì trang tự đăng ký lại FCM token
  (để Notify lưu JWT còn hạn). Đăng xuất → hủy token trước rồi mới xoá JWT.
