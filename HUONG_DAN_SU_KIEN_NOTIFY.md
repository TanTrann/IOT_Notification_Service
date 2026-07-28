# Hướng Dẫn Tích Hợp & Quy Chuẩn Sự Kiện Notification (SmartFarm)

Tài liệu quy định chi tiết định dạng dữ liệu thô gửi từ **Server Điều Khiển (.NET / Phong)** sang **IOT Notification Service** (`POST /internal/notify`) và cách service tự động map ra thông báo đẩy (Push Notification) hiển thị trên màn hình Web Kiosk / App.

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
| `deviceId` | `String` | **Có** | Mã thiết bị / cây trồng mà màn hình kiosk đứng cạnh (dùng targeting push). |
| `event` | `String` | Không | Mã sự kiện chuẩn (ví dụ `"pump.on"`, `"water.empty"`...). |
| `data` | `Object` | Không | Chứa các thông số đo đạc thô dạng `{ key: value }`. |
| `severity` | `String` | Không | Mức độ cảnh báo (`"info"`, `"warning"`, `"critical"`). |
| `title` | `String` | Không | Tiêu đề tùy chỉnh (nếu muốn ghi đè template mặc định). |
| `body` | `String` | Không | Nội dung tùy chỉnh (nếu muốn ghi đè template mặc định). |
| `type` | `String` | Không | Danh mục (`"water"`, `"temperature"`, `"light"`, `"system"`, `"disease"`, `"nutrition"`). |
| `eventId` / `id`| `String` | Không | Mã định danh duy nhất của sự kiện (dùng chống trùng lặp tin nhắn khi retry). |

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

Gói tin cuối cùng được gửi tới Firebase Cloud Messaging (FCM):

```json
{
  "notification": {
    "title": "Đang tưới cây",
    "body": "Đất 25% dưới ngưỡng 35%, bơm đang chạy"
  },
  "data": {
    "deviceId": "ESP32S3_Zone1",
    "event": "pump.on",
    "type": "water",
    "severity": "info",
    "raw": "{\"event\":\"pump.on\",\"deviceId\":\"ESP32S3_Zone1\",\"data\":{\"soilPercent\":25,\"soilOnPct\":35}}"
  }
}
```
