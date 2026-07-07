import { Router } from 'express';

import {
  getNotifications,
  getUnreadCount,
  markAllRead,
  markRead,
  removeToken,
  saveToken,
} from '../controllers/notificationController.js';
import { auth } from '../middlewares/auth.js';

const router = Router();

// Frontend gọi để đăng ký / xóa FCM token (cần auth)
router.post('/token',       auth, saveToken);
router.delete('/token',     auth, removeToken);

// Lịch sử và trạng thái thông báo của user
router.get('/',             auth, getNotifications);
router.get('/unread-count', auth, getUnreadCount);
router.patch('/:id/read',   auth, markRead);
router.patch('/read-all',   auth, markAllRead);

export default router;
