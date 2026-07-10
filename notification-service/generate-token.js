import 'dotenv/config';

import jwt from 'jsonwebtoken';

const deviceId = process.argv[2] || 'ESP32S3_Zone1';
const token    = jwt.sign({ deviceId }, process.env.JWT_SECRET, { expiresIn: '7d' });

console.log(`\nJWT cho deviceId: "${deviceId}" (hết hạn sau 7 ngày)\n`);
console.log(token);
console.log();
