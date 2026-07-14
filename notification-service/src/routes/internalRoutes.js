import { Router } from 'express';

import { internalAuth } from '../middlewares/internalAuth.js';
import FCMToken from '../models/FCMToken.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Client (web kiosk / app) đăng ký FCM token để nhận push. Mô hình "broadcast cho tất cả",
// nên KHÔNG cần deviceId/JWT; xác thực bằng API key giống các endpoint /internal khác.
router.post('/push/token', internalAuth, asyncHandler(async (req, res) => {
  const { token, device = 'web' } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  await FCMToken.findOneAndUpdate(
    { token },
    { deviceId: 'broadcast', token, device },
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
