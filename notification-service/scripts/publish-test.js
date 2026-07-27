// Bắn thử 1 thông báo qua HTTP tới POST /internal/notify (giả lập server của Phong gọi sang).
// Cách 1 (dùng event code theo spec Phong):
//   node scripts/publish-test.js water.empty ESP32S3_Zone1
//   node scripts/publish-test.js pump.on ESP32S3_Zone1
//   node scripts/publish-test.js battery.low ESP32S3_Zone1
//
// Cách 2 (truyền JSON custom):
//   node scripts/publish-test.js '{"event":"temp.high","data":{"temperature":39}}' ESP32S3_Zone1

import 'dotenv/config';

const deviceId = process.argv[3] || process.env.DEFAULT_DEVICE_ID || 'ESP32S3_Zone1';
const baseUrl = (process.env.TEST_SERVICE_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
const apiKey = process.env.INTERNAL_API_KEY || '';

let body;
const arg = process.argv[2];

if (arg && arg.startsWith('{')) {
  body = JSON.parse(arg);
} else if (arg && arg.includes('.')) {
  body = {
    event: arg,
    id: `${deviceId}:${arg}:${Date.now()}`,
    data: {
      soilPercent: 18,
      soilOnPct: 30,
      waterOk: false,
      batteryPercent: 15,
      temperature: 39,
      lastSeenSecondsAgo: 240,
      field: 'soil_percent',
    },
  };
} else {
  body = {
    event: 'water.empty',
    severity: 'critical',
    id: `${deviceId}:water.empty:${Date.now()}`,
    data: {
      soilPercent: 18,
      waterOk: false,
    },
  };
}

body.deviceId = body.deviceId || deviceId;

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
console.log(`Đã gửi tới "${baseUrl}/internal/notify" (deviceId=${body.deviceId}):`, JSON.stringify(json, null, 2));
