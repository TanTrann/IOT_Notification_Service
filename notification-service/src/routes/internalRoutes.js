import { Router } from 'express';

import { internalAuth } from '../middlewares/internalAuth.js';
import notificationService from '../services/notificationService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// Server Phong phát hiện sự kiện → POST sang đây để service lưu lịch sử + đẩy FCM.
// Body: { deviceId, event, severity, id, data, ... }. Push tới mọi người dùng đang có quyền xem deviceId đó.
// Xác thực bằng API key (x-api-key) — endpoint DUY NHẤT còn dùng API key.
router.post('/notify', internalAuth, asyncHandler(async (req, res) => {
  const payload = req.body || {};
  const deviceId = payload.deviceId;
  if (!deviceId) return res.status(400).json({ success: false, message: 'Missing deviceId' });
  const result = await notificationService.ingest(payload, String(deviceId));
  res.status(202).json({ success: true, ...result });
}));

export default router;
