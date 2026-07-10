import 'dotenv/config';

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import User from './src/models/User.js';

// Tạo/cập nhật 1 user demo (upsert theo username).
//   node seed-users.js                                → demo / demo1234 / ESP32S3_Zone1
//   node seed-users.js alice secret device_X          → user với thiết bị khác
const [, , username = 'demo', password = 'demo1234', deviceId = 'ESP32S3_Zone1'] = process.argv;

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI chưa cấu hình trong .env');
  await mongoose.connect(process.env.MONGODB_URI);

  const passwordHash = await bcrypt.hash(password, 10);
  await User.findOneAndUpdate(
    { username },
    { username, passwordHash, deviceId },
    { upsert: true, new: true }
  );

  console.log(`\n✓ User "${username}" đã sẵn sàng`);
  console.log(`  mật khẩu : ${password}`);
  console.log(`  thiết bị : ${deviceId}\n`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Seed thất bại:', err.message);
  process.exit(1);
});
