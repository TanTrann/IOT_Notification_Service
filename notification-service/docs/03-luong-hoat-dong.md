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

**Kích hoạt:** thiết bị publish lên topic `xmini/sensor_data`.

```
Thiết bị ──publish──► MQTT (xmini/sensor_data)
                          │
                          ▼
                  mqttHandler nhận message
                          │ parse JSON
                          ▼
  evaluateSensorData(raw)
          │  (so ngưỡng,
          │   edge-detection)
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

### Quy tắc ngưỡng (`evaluateSensorData`)
| Chỉ số | Cảnh báo khi | type | severity |
|---|---|---|---|
| Độ ẩm đất | `< THRESHOLD_SOIL_MOISTURE_MIN` (30%) | `water` | warning / info (hồi phục) |
| Nhiệt độ | `> THRESHOLD_TEMP_MAX` (35°C) | `temperature` | warning / info (hồi phục) |
| Ánh sáng | `< THRESHOLD_LIGHT_MIN` (25 lux) | `light` | info |

> Ngưỡng phải **cùng scale với rule phía server .NET** (MoistureRule mặc định min 30%, LightRule mặc định min 25 / max 60 lux) — nếu lệch, thông báo sẽ mâu thuẫn với hành động tưới/bật đèn của hệ thống.

**Edge-detection:** chỉ phát thông báo khi chỉ số **chuyển trạng thái** (tốt→xấu hoặc xấu→tốt). Trạng thái lưu theo key `${deviceId}:${metric}`. Nhờ vậy dù thiết bị gửi data liên tục mỗi vài giây, người dùng chỉ nhận thông báo tại thời điểm vượt ngưỡng / hồi phục, tránh spam.

**Ví dụ:** độ ẩm đi từ 40% → 25% → 22% → 35%:
- 40→25: vượt ngưỡng → báo "thiếu nước" (warning)
- 25→22: vẫn xấu → **không báo**
- 22→35: hồi phục → báo "độ ẩm đã ổn" (info)

---

## 3. Luồng lệnh điều khiển

**Kích hoạt:** server tự động publish lên topic `xmini/control`.

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
| Edge-detection theo trạng thái | Không spam khi cảm biến gửi liên tục | `eventTranslator.evaluateSensorData()` |
| Tự xóa token chết | Giữ DB token sạch | `fcmService.sendToDevice()` |
| Auto-reconnect MQTT 5s | Chịu lỗi mạng broker | `config/mqtt.js` |
| Graceful degradation | Không crash khi thiếu cấu hình | `index.js` + các config |

---

## 6. Cách thử nhanh (end-to-end)

Dùng `test-client` (xem [`../../test-client/README.md`](../../test-client/README.md)):

1. Sinh JWT: `node generate-token.js device_test_01`
2. Mở test-client → kết nối MQTT → init Firebase → lấy & lưu token
3. Publish payload sensor (giữ `deviceId` khớp JWT) → quan sát push hiện lên

Hoặc xem [runbook trong bộ nhớ dự án](../../README.md) để chạy MongoDB + Mosquitto + service cục bộ.
