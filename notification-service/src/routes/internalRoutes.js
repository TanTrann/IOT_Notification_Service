import { Router } from 'express';

import { internalAuth } from '../middlewares/internalAuth.js';
import FCMToken from '../models/FCMToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Client (web kiosk / app) đăng ký FCM token để nhận push của ĐÚNG thiết bị nó đứng cạnh.
// deviceId là danh tính cấu hình trên chính màn hình (không gắn user); xác thực bằng API key.
router.post('/push/token', internalAuth, asyncHandler(async (req, res) => {
  const { token, deviceId, device = 'web' } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  if (!deviceId) return res.status(400).json({ success: false, message: 'Missing deviceId' });
  await FCMToken.findOneAndUpdate(
    { token },
    { deviceId: String(deviceId), token, device },
    { upsert: true, new: true }
  );
  res.json({ success: true });
}));

router.delete('/push/token', internalAuth, asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  await FCMToken.deleteOne({ token });
  res.json({ success: true });
}));

export default router;
