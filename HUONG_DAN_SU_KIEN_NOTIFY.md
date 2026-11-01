# Hướng Dẫn Tích Hợp & Quy Chuẩn Sự Kiện Notification (SmartFarm)

Tài liệu quy định chi tiết định dạng dữ liệu thô gửi từ **Server Điều Khiển (.NET / Phong)** sang **IOT Notification Service** (`POST /internal/notify`) và cách service tự động map ra thông báo đẩy (Push Notification) hiển thị trên web quản lý của người dùng.

Mỗi sự kiện được lưu vào lịch sử rồi **push tới mọi người dùng đang có quyền xem `deviceId` đó** (chủ cây hoặc được share
trên server Phong — quyền được hỏi lại Phong ngay lúc gửi). Phía Phong **chỉ cần gửi đúng `deviceId`**, không phải biết ai sẽ nhận.
`x-api-key` (`INTERNAL_API_KEY`) chỉ dùng cho endpoint này; web/app người dùng không dùng key này.

---

## 1. Cấu Trúc Request Đầu Vào (`POST /internal/notify`)

- **URL Endpoint**: `/internal/notify`
- **Method**: `POST`
- **Header**:
  - `Content-Type: application/json`
  - `x-api-key: <INTERNAL_API_KEY>`

### Object Payload JSON:
```json
{
  "deviceId": "ESP32S3_Zone1",
  "event": "pump.on",
  "data": {
    "soilPercent": 25,
    "soilOnPct": 35
  },
  "severity": "info",
  "eventId": "evt_20260728_001"
}
```

### Chi Tiết Trường Dữ Liệu:
| Trường | Kiểu Dữ Liệu | Bắt Buộc | Mô Tả |
| :--- | :--- | :--- | :--- |
| `deviceId` | `String` | **Có** | Mã thiết bị / cây trồng phát sinh sự kiện (trùng `deviceId` trong `GET /api/devices` của Phong). Push gửi tới mọi người dùng có quyền xem cây này. |
| `event` | `String` | Không | Mã sự kiện chuẩn (ví dụ `"pump.on"`, `"water.empty"`...). |
| `data` | `Object` | Không | Chứa các thông số đo đạc thô dạng `{ key: value }`. |
| `severity` | `String` | Không | Mức độ cảnh báo (`"info"`, `"warning"`, `"critical"`). |
| `title` | `String` | Không | Tiêu đề tùy chỉnh (nếu muốn ghi đè template mặc định). |
| `body` | `String` | Không | Nội dung tùy chỉnh (nếu muốn ghi đè template mặc định). |
| `type` | `String` | Không | Danh mục (`"water"`, `"temperature"`, `"light"`, `"system"`, `"disease"`, `"nutrition"`). |
| `eventId` / `id`| `String` | Không | Mã định danh duy nhất của sự kiện (dùng chống trùng lặp tin nhắn khi retry). |

### Phản Hồi

`202 { "success": true, "deviceId", "event", "title", "body", "recipients" }` — `recipients` là số FCM token đã gửi push
(`0` nếu chưa có người dùng nào có quyền xem cây này đang đăng ký nhận push, hoặc Notify tạm không hỏi được quyền từ server Phong;
lịch sử vẫn được lưu trong mọi trường hợp).

---

## 2. Bảng Quy Chuẩn Sự Kiện (`event`) & Template Kết Xuất

Khi nhận `event` và `data`, lớp `templateEngine.js` sẽ tự động ghép dữ liệu vào khung câu chữ hiển thị:

| STT | Nhóm | Mã Sự Kiện (`event`) | Tiêu Đề Kết Xuất (`title`) | Nội Dung Kết Xuất (`body`) | Phân Loại (`type`) | Mức Độ (`severity`) |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **💧 Nước & Tưới** | `pump.on` | **Đang tưới cây** | Đất `{soilPercent}%` dưới ngưỡng `{soilOnPct}%`, bơm đang chạy | `water` | `info` |
| 2 | | `pump.off` | **Đã tưới xong** | Độ ẩm đất đạt `{soilPercent}%` | `water` | `info` |
| 3 | | `water.needed` | **Cây thiếu nước** | Đất `{soilPercent}%` cần tưới nhưng đang chế độ tay / hết nước | `water` | `warning` |
| 4 | | `water.empty` | **Hết nước tưới** | Bình chứa cạn, không thể tưới, cần châm nước | `water` | `critical` |
| 5 | **🔋 Pin & Nguồn** | `battery.low` | **Pin yếu** | Pin còn `{batteryPercent}%`, cần sạc sớm | `system` | `warning` |
| 6 | | `battery.cut` | **Pin cạn — thiết bị tạm ngắt** | Bơm/đèn tạm dừng đến khi sạc lại | `system` | `critical` |
| 7 | | `battery.full` | **Pin đã đầy** | Có thể rút sạc | `system` | `info` |
| 8 | **🌡️ Môi Trường** | `temp.high` | **Nhiệt độ cao** | `{temperature}°C`, cây có thể bị stress nhiệt | `temperature` | `warning` |
| 9 | | `temp.low` | **Nhiệt độ thấp** | `{temperature}°C`, coi chừng lạnh cây | `temperature` | `warning` |
| 10 | | `light.low` | **Thiếu sáng** | Nên bổ sung đèn / đưa ra chỗ sáng | `light` | `info` |
| 11 | **📡 Kết Nối** | `device.offline` | **Mất kết nối thiết bị** | Không nhận dữ liệu hơn `{lastSeenSecondsAgo}` giây | `system` | `warning` |
| 12 | | `device.online` | **Thiết bị online lại** | Thiết bị đã kết nối lại bình thường | `system` | `info` |
| 13 | | `sensor.error` | **Cảm biến lỗi** | Số đọc `{field}` không hợp lệ | `system` | `warning` |

---

## 3. Các Cơ Chế Xử Lý Nâng Cao & Fallback

1. **Event chưa đăng ký template (Event mới)**:
   - `title`: `Thông báo: {event}`
   - `body`: Tự động serialization JSON của object `data` hoặc fallback thành `"Sự kiện {event}"`.

2. **Cơ chế Pass-through (Custom Title / Body)**:
   - Nếu server Phong tự gửi `title` hoặc `body` trong payload, service sẽ ưu tiên giữ nguyên nội dung tùy chỉnh thay vì ghi đè bằng template.

3. **Chuẩn hóa Severity & Type**:
   - `severity`: Tự động map các từ khóa (`danger`, `high`, `nguy cấp` $\rightarrow$ `critical`; `warn`, `medium`, `cảnh báo` $\rightarrow$ `warning`; mặc định $\rightarrow$ `info`).
   - `type`: Tự động ép về enum hợp lệ (`disease`, `water`, `nutrition`, `light`, `temperature`, `system`).

---

## 4. Cấu Trúc FCM Push Payload Xuất Ra Client

Gói tin cuối cùng được gửi tới Firebase Cloud Messaging (FCM) cho từng token của người dùng có quyền
(kèm cấu hình `webpush` cho trình duyệt). `notificationId` là `_id` bản ghi lịch sử — client dùng để đánh dấu đã đọc
qua `PATCH /api/v1/notifications/:id/read`:

```json
{
  "notification": {
    "title": "Đang tưới cây",
    "body": "Đất 25% dưới ngưỡng 35%, bơm đang chạy"
  },
  "data": {
    "notificationId": "6724a1f0c3b2e95a1d0f1234",
    "deviceId": "ESP32S3_Zone1",
    "event": "pump.on",
    "type": "water",
    "severity": "info",
    "raw": "{\"event\":\"pump.on\",\"deviceId\":\"ESP32S3_Zone1\",\"data\":{\"soilPercent\":25,\"soilOnPct\":35}}"
  }
}
```
