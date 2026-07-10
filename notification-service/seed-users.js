import 'dotenv/config';

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import User from './src/models/User.js';

// Tạo/cập nhật 1 user demo (upsert theo username).
//   node seed-users.js                                  → demo / demo1234 / [device_test_01]
//   node seed-users.js alice secret device_A device_B   → user nhiều thiết bị
const [, , username = 'demo', password = 'demo1234', ...deviceIds] = process.argv;
if (!deviceIds.length) deviceIds.push('device_test_01');

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI chưa cấu hình trong .env');
  await mongoose.connect(process.env.MONGODB_URI);

  const passwordHash = await bcrypt.hash(password, 10);
  await User.findOneAndUpdate(
    { username },
    { username, passwordHash, deviceIds },
    { upsert: true, new: true }
  );

  console.log(`\n✓ User "${username}" đã sẵn sàng`);
  console.log(`  mật khẩu : ${password}`);
  console.log(`  thiết bị : ${deviceIds.join(', ')}\n`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Seed thất bại:', err.message);
  process.exit(1);
});
