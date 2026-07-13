# notification-display — Màn hình rời cho SmartFarm

Trang hiển thị **đúng nguyên** những thông báo JSON mà MCP server của Phong gửi sang
notification-service. Dựng trên một màn hình rời (tablet / màn hình phụ / trình duyệt
fullscreen) để xem trạng thái hiện tại của hệ thống theo thời gian thực.

Không cần đăng nhập người dùng — xác thực bằng `INTERNAL_API_KEY` của service.

## Luồng

```
Phong (MCP) ──POST /internal/notify──▶ Notification Service ──SSE──▶ Màn hình rời (trang này)
              (JSON bất kỳ)              (giữ 50 bản gần nhất trong RAM)
```

- Mở trang: nhận ngay các thông báo gần nhất (`event: history`)
- Sau đó: mỗi thông báo mới Phong gửi được đẩy realtime (`event: notification`)
- Rớt mạng: trình duyệt tự reconnect sau 3 giây
- Service KHÔNG biến đổi payload — màn hình hiển thị đúng những gì Phong gửi
  (bóc `title`/`body`/`severity`/`type` nếu có để hiển thị đẹp, và luôn kèm nút xem JSON gốc)

## Phong gửi thông báo thế nào

```bash
curl -X POST http://localhost:3001/internal/notify \
  -H "x-api-key: <INTERNAL_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{ "title": "Cây thiếu nước", "body": "Độ ẩm 22%", "severity": "warning", "type": "water" }'
```

Payload là **JSON object bất kỳ** — các field trên chỉ là gợi ý để hiển thị đẹp, không bắt buộc.
Response: `201 { success: true, receivedAt }`.

## Chạy màn hình

Mở qua HTTP (đừng mở bằng `file://` — origin `null` sẽ bị CORS chặn):

```bash
npx serve notification-display -l 8080
```

Truy cập kèm cấu hình trên URL:

```
http://localhost:8080/?service=http://localhost:3001&key=<INTERNAL_API_KEY>
```

Hoặc mở trang trống rồi bấm ⚙️ để điền (lưu vào localStorage).

Nhớ thêm origin trang (vd `http://localhost:8080`) vào `ALLOWED_ORIGINS` của service.

## Fullscreen kiosk

`F11`, hoặc Chrome chế độ kiosk:

```bash
chrome --kiosk "http://localhost:8080/?service=...&key=..."
```
