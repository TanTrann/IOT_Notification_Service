import { Router } from 'express';

import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
} from '../controllers/notificationController.js';
import { internalAuth } from '../middlewares/internalAuth.js';

const router = Router();

// Đọc lịch sử + trạng thái thông báo cho màn hình kiosk. Lọc theo ?deviceId=...
// Không còn user/JWT — bảo vệ bằng API key (x-api-key) giống các endpoint nội bộ khác.
// Đăng ký/hủy FCM token nay dùng /internal/push/token.
router.get('/',             internalAuth, getNotifications);
router.get('/unread-count', internalAuth, getUnreadCount);
router.patch('/:id/read',   internalAuth, markRead);
router.patch('/read-all',   internalAuth, markAllRead);

export default router;
