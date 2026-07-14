// Bắn thử 1 thông báo lên planttree/{deviceId}/notifications (giả lập MCP server của Phong).
// Chạy:  node scripts/publish-test.js
// Tuỳ chọn: node scripts/publish-test.js '{"title":"Xin chào","body":"test"}' [deviceId]
import 'dotenv/config';
import mqtt from 'mqtt';

// Publish phải vào topic CỤ THỂ (không dùng wildcard "+"). Lấy deviceId từ tham số hoặc env.
const deviceId = process.argv[3] || process.env.DEFAULT_DEVICE_ID || 'ESP32S3_Zone1';
const topic = `planttree/${deviceId}/notifications`;

const payload = process.argv[2]
  ? process.argv[2]
  : JSON.stringify({
      title: 'Cây thiếu nước',
      body: 'Độ ẩm đất 22% — cần tưới ngay',
      severity: 'warning',
      type: 'water',
    });

const client = mqtt.connect(process.env.MQTT_BROKER_URL, {
  username: process.env.MQTT_USERNAME || undefined,
  password: process.env.MQTT_PASSWORD || undefined,
  connectTimeout: 10000,
});

client.on('connect', () => {
  client.publish(topic, payload, { qos: 1 }, err => {
    if (err) console.error('Publish lỗi:', err.message);
    else console.log(`Đã publish lên "${topic}":`, payload);
    client.end();
  });
});

client.on('error', err => {
  console.error('MQTT error:', err.message);
  client.end();
  process.exit(1);
});
