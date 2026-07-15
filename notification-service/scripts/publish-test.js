// Bắn thử 1 thông báo qua HTTP tới POST /internal/notify (giả lập server của Phong gọi sang).
// Chạy:  node scripts/publish-test.js
// Tuỳ chọn: node scripts/publish-test.js '{"title":"Xin chào","body":"test"}' [deviceId]
import 'dotenv/config';

const deviceId = process.argv[3] || process.env.DEFAULT_DEVICE_ID || 'ESP32S3_Zone1';
const baseUrl = (process.env.TEST_SERVICE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
const apiKey = process.env.INTERNAL_API_KEY || '';

const body = process.argv[2]
  ? JSON.parse(process.argv[2])
  : {
      title: 'Cây thiếu nước',
      body: 'Độ ẩm đất 22% — cần tưới ngay',
      severity: 'warning',
      type: 'water',
    };
body.deviceId = body.deviceId || deviceId;   // deviceId cho biết màn hình đích

const res = await fetch(`${baseUrl}/internal/notify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
  body: JSON.stringify(body),
});

const json = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Lỗi ${res.status}:`, json.message || JSON.stringify(json));
  process.exit(1);
}
console.log(`Đã gửi tới "${baseUrl}/internal/notify" (deviceId=${body.deviceId}):`, JSON.stringify(json));
