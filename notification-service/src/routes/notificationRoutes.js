import { Router } from 'express';

import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
} from '../controllers/notificationController.js';
import { userAuth } from '../middlewares/userAuth.js';

const router = Router();

// Đọc lịch sử + trạng thái đã đọc cho NGƯỜI DÙNG (web quản lý). Auth: Bearer JWT của server Phong.
// Chỉ trả thông báo của cây người dùng có quyền; ?deviceId=... để lọc 1 cây (ngoài quyền → 403).
router.use(userAuth);
router.get('/',             getNotifications);
router.get('/unread-count', getUnreadCount);
router.patch('/read-all',   markAllRead);
router.patch('/:id/read',   markRead);

export default router;
