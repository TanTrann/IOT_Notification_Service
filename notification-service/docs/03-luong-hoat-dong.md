# Luồng hoạt động

Tài liệu mô tả các luồng chạy thực tế theo **mô hình hiện tại** (Phong `POST /internal/notify`,
xử lý qua **Template Engine**, **push qua Firebase theo `deviceId`** — mỗi màn hình chỉ nhận tin của cây mình; đã bỏ
nghe MQTT, bỏ SSE và bỏ luôn lớp user/đăng nhập/JWT).

1. [Khởi động service](#1-luồng-khởi-động)
2. [Thông báo từ Phong → Template Engine → push Firebase](#2-luồng-thông-báo)
3. [Client đăng ký & nhận push (Firebase Web Push)](#3-luồng-client)
4. [Cơ chế đảm bảo chất lượng](#4-cơ-chế-đảm-bảo-chất-lượng)
5. [Cách thử nhanh (end-to-end)](#5-cách-thử-nhanh-end-to-end)

---

## 1. Luồng khởi động

```
npm start → src/index.js
   1. dotenv          → nạp biến môi trường từ .env
   2. firebase.js     → init Firebase Admin SDK (log thành công / cảnh báo)
   3. database.js     → kết nối MongoDB bắt buộc (lưu FCM token + lịch sử)
   4. Express         → middleware (helmet, cors, compression, morgan)
                      → mount /internal, /api/v1/notifications  (đều dùng x-api-key)
                      → GET /health
   5. listen PORT (mặc định 3001)
```

---

## 2. Luồng thông báo

**Kích hoạt:** server của Phong xử lý xong một sự kiện nghiệp vụ rồi gọi `POST /internal/notify` (kèm header
`x-api-key`, body gồm `deviceId`, mã `event`, object `data`, `severity`, `eventId`).

```
Phong ──POST /internal/notify──► IOT Notification Service
       (x-api-key; body { deviceId, event, data, severity, eventId })
                          │
                          ▼
                  internalRoutes → notificationService.ingest(payload, deviceId)
                          │ 
                          ├─► 1. templateEngine.formatEventPayload(payload)
                          │      Map event + data -> { title, body, severity, type }
                          │      (Có fallback nếu event mới; hỗ trợ custom title/body)
                          │
                          ├─► 2. Ghi lịch sử vào MongoDB (best-effort, chống trùng qua eventId)
                          │
                          ▼
                  fcmService.sendToDeviceId(deviceId, { title, body, data })
                          │  tìm các token có ĐÚNG deviceId trong fcmtokens
                          ▼
                  messaging.send() song song ──► Firebase ──► màn hình của cây đó
                          (token chết tự bị xóa)
```

### Body mẫu từ Phong (JSON, `deviceId` bắt buộc)
```json
{
  "deviceId": "ESP32S3_Zone1",
  "event": "pump.on",
  "data": {
    "soilPercent": 25,
    "soilOnPct": 35
  },
  "severity": "info",
  "eventId": "evt_20260811_001"
}
```

Service trả `202 { success: true, deviceId, event, title, body, recipients }`. 
- `title`: `"Đang tưới cây"` *(sinh bởi Template Engine)*
- `body`: `"Đất 25% dưới ngưỡng 35%, bơm đang chạy"` *(sinh bởi Template Engine)*
- `recipients`: số token/thiết bị nhận được push (`recipients: 0` nghĩa là chưa có client nào đăng ký `deviceId` này).

---

## 3. Luồng client (Firebase Web Push)

Màn hình cạnh cây là trang `notification-web` hoặc Web App SmartFarm tích hợp Firebase JS SDK.

### 3.1. Đăng ký nhận push (1 lần / thiết bị)
```
Web client
   1. Xin quyền notification (browser Notification.requestPermission())
   2. getToken({ vapidKey }) → registration token
   3. Đăng ký token về service:
        POST /internal/push/token  (header x-api-key)
        body { token, deviceId, device: 'web' }   ← deviceId của cây màn hình đứng cạnh
              │
              ▼
   Server lưu vào collection fcmtokens (token gắn với đúng deviceId)
```

### 3.2. Nhận & hiển thị
```
fcmService.sendToDeviceId ──► Firebase ──► web client (đúng deviceId)
   - Tab đang mở (foreground): messaging.onMessage(payload)
        → Toast hiển thị trong trang + tăng badge chưa đọc + cập nhật danh sách
   - Tab đóng/nền: service worker firebase-messaging-sw.js hiển thị notification hệ thống
```

> Danh sách trên màn hình được dựng **realtime ngay trong trang** từ chính message FCM
> (`onMessage`). Song song, mỗi tin cũng được **ghi vào MongoDB** (best-effort), nên lịch sử
> bền vững đọc lại được qua REST `GET /api/v1/notifications` — kể cả sau khi reload hay từ máy khác.

---

## 4. Cơ chế đảm bảo chất lượng

| Cơ chế | Mục đích | Vị trí |
|---|---|---|
| **Template Engine tự động** | Chuẩn hóa câu chữ tiếng Việt, tách biệt logic nghiệp vụ khỏi UI | `src/utils/templateEngine.js` |
| **Fallback an toàn** | Không crash/mất tin khi nhận event chưa từng khai báo | `templateEngine.formatEventPayload()` |
| **FCM best-effort (không chặn)** | Lỗi ghi DB không làm gãy việc push realtime | `notificationService.ingest()` |
| **Chống trùng qua `eventId`** | Phong retry không tạo bản ghi lặp trong MongoDB | `notificationService._saveHistory()` |
| **Tự xóa token chết** | Giữ DB token sạch khi người dùng gỡ app/xóa quyền push | `fcmService.sendToDevice()` |
| **Bảo vệ xác thực tập trung** | Dùng chung 1 API key qua `x-api-key` | `middlewares/internalAuth.js` |

---

## 5. Cách thử nhanh (end-to-end)

1. Chạy service: `cd notification-service && npm run dev`.
2. Mở màn hình web: `cd notification-web && npm run dev` → mở `http://localhost:3000` →
   bấm ⚙️ nhập **Server URL (`http://localhost:3001`) + Device ID (`ESP32S3_Zone1`) + API key** (chính là `INTERNAL_API_KEY`) → Lưu →
   **Bật nhận push** (cấp quyền browser).
3. Bắn thử một sự kiện (giả lập Phong gọi `POST /internal/notify`):
   ```bash
   cd notification-service
   node scripts/publish-test.js
   ```
   Hoặc truyền payload custom:
   ```bash
   node scripts/publish-test.js '{"event":"water.empty","data":{}}' ESP32S3_Zone1
   ```

   Hoặc gọi trực tiếp bằng curl:
   ```bash
   curl -X POST http://localhost:3001/internal/notify \
     -H "Content-Type: application/json" \
     -H "x-api-key: <INTERNAL_API_KEY>" \
     -d '{
       "deviceId": "ESP32S3_Zone1",
       "event": "temp.high",
       "data": { "temperature": 38.5 },
       "severity": "warning",
       "eventId": "evt_test_001"
     }'
   ```
   $\rightarrow$ Màn hình web lập tức nổ thông báo: **"Nhiệt độ cao — 38.5°C, cây có thể bị stress nhiệt"**.
