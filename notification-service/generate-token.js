import 'dotenv/config';

import jwt from 'jsonwebtoken';

// Nhận 1 hoặc nhiều deviceId: `node generate-token.js device_A device_B ...`
const ids = process.argv.slice(2);
if (!ids.length) ids.push('device_test_01');

// 1 thiết bị → payload { deviceId } (tương thích cũ); nhiều → { deviceIds: [...] }
const payload = ids.length === 1 ? { deviceId: ids[0] } : { deviceIds: ids };
const token   = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '7d' });

console.log(`\nJWT cho thiết bị: ${ids.map(id => `"${id}"`).join(', ')} (hết hạn sau 7 ngày)\n`);
console.log(token);
console.log();
