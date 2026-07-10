# Test Client — Bộ giả lập hệ IoT

Trang test trên browser, **giả lập nguồn dữ liệu** để test notification service end-to-end:
- Giả lập **ESP32 (xmini)** publish số đo cảm biến lên `xmini/sensor_data` (snake_case).
- Giả lập **server điều khiển .NET** publish lệnh `{command, commandId, parameters}` xuống `xmini/control`.
- Subscribe cả 2 topic để xem mọi data đang chạy trên broker (kể cả từ thiết bị/server thật).
- **Sinh JWT ngay trên trang** (ký HS256 bằng Web Crypto, cần `JWT_SECRET` trong `.env` của service) — không phải chạy `generate-token.js` trong terminal.

> Test-client **chỉ publish**, không nhận push. Muốn xem thông báo/nhận push thì mở
> [`../notification-web/`](../notification-web/README.md) (port 3000) hoặc app Android
> ([`../notification-app/`](../notification-app/README.md)) với JWT của đúng device đang giả lập.

## Cách chạy

```bash
cd test-client
npm run dev
# Mở http://localhost:8080
```

## Cấu hình MQTT (HiveMQ Cloud)

- URL: `wss://<cluster>.s1.eu.hivemq.cloud:8884/mqtt` (WebSocket over TLS, port **8884**).
- Username/Password: tạo trong HiveMQ Console → Access Management.
- Dùng **cùng cluster với notification-service** (xem `.env` của service).

## Luồng test

1. **Bước 1 — Cấu hình:** MQTT URL + username/password, 2 topic.
2. **Bước 2 — Device ID & JWT:** để `device_test_01`, dán `JWT_SECRET` (từ `notification-service/.env`) → "🔑 Sinh JWT" → "📋 Copy" → dán vào notification-web. Secret được nhớ trong localStorage cho lần sau.
3. **Bước 3 — Kết nối MQTT:** badge xanh, client tự subscribe 2 topic; bản tin đến hiện ở Log (📥).
4. **Bước 4 — Giả lập ESP32:** bấm nút kịch bản ("🌵 Đất khô", "🔥 Quá nóng"...) để publish sensor.
5. **Bước 5 — Giả lập server .NET:** bấm WATER_ON / LIGHT_ON... để publish lệnh.

Kết quả xem ở **notification-web** (đã kết nối với JWT của device tương ứng): toast khi tab mở,
notification hệ thống khi tab đóng, danh sách tự cập nhật.

## Các kịch bản demo hay

| Kịch bản | Thao tác | Kết quả mong đợi (trên notification-web) |
|---|---|---|
| Báo số đo | Bấm "🌵 Đất khô (22%)" | Push cho các chỉ số vừa đổi, vd **"Độ ẩm đất — hiện tại 22%"** (warning) |
| Chống spam (giá trị đổi) | Bấm "🌵 Đất khô (22%)" lần 2 | **Không** push (mọi số đo y hệt lần trước) |
| Số đo mới | Bấm "💧 Đất ẩm lại (48%)" | Push **"Độ ẩm đất — hiện tại 48%"** (giá trị đổi 22→48) |
| Lệnh tự động | Bấm "💦 WATER_ON" | Push **"Đã tự động tưới nước... (độ ẩm hiện tại 22%, trong 5 giây)"** |
| Chống trùng QoS 1 | Bấm "🚀 Publish payload này" (bước 5) 2 lần, giữ nguyên `commandId` | Lần 2 service bỏ qua, **không** push lặp |
| Trọn vòng với server thật | Server điều khiển .NET chạy cùng broker + có moisture rule → bấm "🌵 Đất khô" | Server tự phát WATER_ON thật xuống `xmini/control` → nhận **2 push**: cảnh báo thiếu nước + đã tưới nước |

## Lưu ý
- `device_id` giả lập phải **trùng deviceId trong JWT** mà notification-web đang dùng thì mới thấy thông báo.
- Payload control **không có device_id** (đúng hợp đồng dữ liệu) — service gán lệnh cho
  device của bản tin sensor gần nhất, nên **luôn publish sensor (bước 4) trước khi test control (bước 5)**.
- Không thấy push: kiểm tra notification-web đã "Bật nhận push" chưa, và notification-service
  có đang chạy + kết nối cùng broker không.
