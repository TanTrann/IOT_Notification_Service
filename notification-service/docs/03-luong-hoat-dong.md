# Luồng hoạt động

Tài liệu mô tả chi tiết các luồng chạy thực tế của hệ thống. Có 4 luồng chính:

1. [Khởi động service](#1-luồng-khởi-động)
2. [Dữ liệu cảm biến → thông báo](#2-luồng-dữ-liệu-cảm-biến)
3. [Lệnh điều khiển → thông báo](#3-luồng-lệnh-điều-khiển)
4. [Client đăng ký token & đọc thông báo](#4-luồng-phía-client)

---

## 1. Luồng khởi động

```
npm start → src/index.js
   1. dotenv          → nạp biến môi trường từ .env
   2. firebase.js     → init Firebase Admin (log thành công / cảnh báo)
   3. startMQTTListener() → kết nối broker, subscribe sensor + control topic
   4. database.js     → kết nối MongoDB
   5. Express         → middleware (helmet, cors, compression, morgan)
                      → mount /api/v1/notifications
                      → GET /health
   6. listen PORT (mặc định 3001)
```

> Nếu thiếu MQTT_BROKER_URL / MONGODB_URI / Firebase credentials → ghi cảnh báo và **vẫn tiếp tục chạy**.

---

## 2. Luồng dữ liệu cảm biến

**Kích hoạt:** thiết bị publish số đo cảm biến. Service nghe **2 họ topic** (giống server .NET của Phong):
- `xmini/sensor_data` — payload snake_case (`device_id`, `soil_moisture_percent`, `temperature_c`, `light_lux`), `device_id` nằm trong payload.
- `planttree/{deviceId}/sensors` — payload camelCase (`soilMoisture`, `temperature`, `lightLevel`…), `deviceId` lấy **từ topic** (`normalizePlanttreeSensor` map về cùng field trước khi xử lý).

```
Thiết bị ──publish──► MQTT (xmini/sensor_data)
                          │
                          ▼
                  mqttHandler nhận message
                          │ parse JSON
                          ▼
  evaluateSensorData(raw)
          │  (mỗi số đo →
          │   1 thông báo)
          ▼
  [mảng 0..n thông báo]
          │ với mỗi thông báo
          ▼
  notificationService.notify({ eventId, deviceId, type, severity, title, body, data })
          │
          ├─ lưu MongoDB ──► nếu trùng eventId (lỗi 11000): bỏ qua, KHÔNG gửi FCM
          │
          └─ fcmService.sendToUser(deviceId) ──► tìm mọi token theo deviceId
                                              └─► gửi push song song; xóa token chết
                                                      │
                                                      ▼
                                              Client nhận push
```

### Payload mẫu
```json
{
  "device_id": "esp32-001",
  "soil_moisture_percent": 25,
  "temperature_c": 38,
  "light_lux": 800
}
```

### Quy tắc sinh thông báo (`evaluateSensorData`)
**Không còn ngưỡng cảnh báo.** Mỗi chỉ số có mặt trong bản tin đều sinh 1 thông báo báo số đo hiện tại:

| Chỉ số | type | severity |
|---|---|---|
| `soil_moisture_percent` | `water` | warning |
| `temperature_c` | `temperature` | warning |
| `light_lux` | `light` | warning |

**Chống spam theo giá trị:** chỉ báo khi **giá trị của chỉ số thay đổi** so với lần trước (lưu theo key `${deviceId}:${metric}`). Nhờ vậy dù thiết bị gửi data liên tục mỗi vài giây, gửi lặp **cùng số đo** chỉ báo 1 lần.

**Ví dụ:** độ ẩm đi từ 40% → 25% → 25% → 35%:
- 40: giá trị mới → báo "Độ ẩm đất hiện tại 40%"
- 25: đổi giá trị → báo "Độ ẩm đất hiện tại 25%"
- 25: **cùng giá trị → không báo**
- 35: đổi giá trị → báo "Độ ẩm đất hiện tại 35%"

---

## 3. Luồng lệnh điều khiển

**Kích hoạt:** server tự động publish lệnh. Service nghe **2 họ topic**:
- `xmini/control` — payload **không có** `device_id` → gán cho `lastSensorDeviceId` (device của bản tin sensor gần nhất).
- `planttree/{deviceId}/commands` — `deviceId` lấy **thẳng từ topic** → không phải suy đoán, chính xác khi có nhiều thiết bị cùng gửi dữ liệu.

```
Server ──publish──► MQTT (xmini/control)
                        │
                        ▼
                mqttHandler nhận
                        │ parse JSON
                        ▼
            translateControl(raw, lastSensorDeviceId)  → 1 thông báo
                        │  (eventId lấy từ commandId)
                        ▼
            notificationService.notify(...) → MongoDB + FCM
```

### Payload mẫu (đúng format server .NET của Phong publish)
```json
{
  "command": "WATER_ON",
  "commandId": "6a378e4dce70376cdac2f38a",
  "parameters": {
    "duration": 5000,
    "reason": "moisture_rule",
    "ruleId": "rule-123",
    "currentMoisture": 25
  }
}
```

> **Payload KHÔNG có `device_id`** (topic `xmini/control` dùng chung cho mọi thiết bị xmini). Service suy ra deviceId từ **bản tin sensor gần nhất** — lệnh auto luôn được server bắn ra ngay sau bản tin sensor kích hoạt rule nên với demo 1 thiết bị là chính xác. Khi service vừa khởi động chưa nhận sensor nào thì dùng `DEFAULT_DEVICE_ID` trong `.env`.

### Ánh xạ lệnh
| command | Nội dung | type |
|---|---|---|
| `WATER_ON` / `WATER_OFF` | Đã tự động tưới nước / Đã ngừng tưới nước | `water` |
| `LIGHT_ON` / `LIGHT_OFF` | Đã bật đèn / Đã tắt đèn | `light` |

Chi tiết trong `parameters` (độ ẩm hiện tại, thời lượng tưới...) được ghép vào nội dung thông báo. `eventId` lấy từ `commandId` để chống trùng khi QoS 1 phát lại; lệnh gửi tay qua REST không có `commandId` thì bỏ trống eventId (vẫn gửi bình thường).

---

## 4. Luồng phía client

### 4.1. Đăng ký nhận thông báo (1 lần / thiết bị)
```
Client (web/app)
   1. Init Firebase SDK + xin quyền notification
   2. getToken({ vapidKey }) → registration token
   3. POST /api/v1/notifications/token  (Authorization: Bearer <JWT>)
        body: { token, device: 'web' }
              │
              ▼
   Server lưu vào collection fcmtokens (deviceId lấy từ JWT)
```

> `deviceId` được suy ra từ JWT, **không** truyền tay → đảm bảo token gắn đúng chủ.

### 4.2. Nhận push
```
Service gửi FCM ──► Firebase ──► thiết bị
   - App đang mở (foreground): SDK nhận qua onMessage → hiển thị trong app
   - App đóng/nền (background): service worker firebase-messaging-sw.js hiển thị
```

### 4.3. Xem & đánh dấu đã đọc
```
GET    /api/v1/notifications            → danh sách (phân trang) + unreadCount
GET    /api/v1/notifications/unread-count → số chưa đọc
PATCH  /api/v1/notifications/:id/read   → đánh dấu 1 cái đã đọc
PATCH  /api/v1/notifications/read-all   → đánh dấu tất cả đã đọc
```
Mọi thao tác lọc theo `deviceId` của JWT → người dùng chỉ thấy/sửa thông báo của mình.

---

## 5. Tóm tắt cơ chế đảm bảo chất lượng

| Cơ chế | Mục đích | Vị trí |
|---|---|---|
| `eventId` unique (lỗi 11000) | Cùng sự kiện đến 2 lần không gửi push lặp | `notificationService.notify()` |
| Bỏ qua khi số đo không đổi | Không spam khi cảm biến gửi liên tục | `eventTranslator.evaluateSensorData()` |
| Tự xóa token chết | Giữ DB token sạch | `fcmService.sendToDevice()` |
| Auto-reconnect MQTT 5s | Chịu lỗi mạng broker | `config/mqtt.js` |
| Graceful degradation | Không crash khi thiếu cấu hình | `index.js` + các config |

---

## 6. Cách thử nhanh (end-to-end)

Dùng `test-client` (xem [`../../test-client/README.md`](../../test-client/README.md)):

1. Mở test-client → bước 2: nhập Device ID + `JWT_SECRET` (từ `.env`) → Sinh JWT → Copy
   (hoặc CLI: `node generate-token.js ESP32S3_Zone1`)
2. Mở notification-web → dán JWT → Lưu & Kết nối → Bật nhận push
3. Quay lại test-client → kết nối MQTT → bấm các nút kịch bản giả lập ("🌵 Đất khô", "💦 WATER_ON"...) → push hiện lên ở notification-web

Người dùng cuối xem thông báo qua [`../../notification-web/`](../../notification-web/README.md) (browser, port 3000) hoặc [`../../notification-app/`](../../notification-app/README.md) (app Android native).
