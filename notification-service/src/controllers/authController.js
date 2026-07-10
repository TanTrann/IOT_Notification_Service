import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import User from '../models/User.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// POST /api/v1/auth/login  — luồng giống production: user đăng nhập → nhận JWT.
// JWT mang deviceIds của user; JWT_SECRET chỉ nằm ở server, client không bao giờ thấy.
export const login = asyncHandler(async (req, res) => {
  if (!process.env.JWT_SECRET) {
    return res.status(500).json({ success: false, message: 'JWT_SECRET is not configured' });
  }

  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Missing username or password' });
  }

  const user = await User.findOne({ username: String(username).trim() });
  // Thông báo lỗi CHUNG cho cả sai user lẫn sai mật khẩu → tránh dò tài khoản.
  const ok = user && (await bcrypt.compare(String(password), user.passwordHash));
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  const expiresIn = process.env.JWT_EXPIRES || '30d';
  const token = jwt.sign({ deviceId: user.deviceId }, process.env.JWT_SECRET, { expiresIn });

  res.json({
    success: true,
    token,
    expiresIn,
    user: { username: user.username, deviceId: user.deviceId },
  });
});
