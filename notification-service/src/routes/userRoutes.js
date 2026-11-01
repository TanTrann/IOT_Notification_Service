import { Router } from 'express';

import { getMe, registerPushToken, unregisterPushToken } from '../controllers/notificationController.js';
import { userAuth } from '../middlewares/userAuth.js';

const router = Router();

// GET  /api/v1/me          → { userId, email, devices: [{ deviceId, name }] } — để client vẽ bộ lọc theo tên cây
// POST /api/v1/push/token  → đăng ký FCM token cho người dùng đang đăng nhập
// DELETE /api/v1/push/token → hủy (gọi khi đăng xuất)
router.use(userAuth);
router.get('/me', getMe);
router.post('/push/token', registerPushToken);
router.delete('/push/token', unregisterPushToken);

export default router;
