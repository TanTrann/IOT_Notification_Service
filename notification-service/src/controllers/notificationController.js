import FCMToken from '../models/FCMToken.js';
import notificationService from '../services/notificationService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const saveToken = asyncHandler(async (req, res) => {
  const { token, device = 'web' } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  // Token gắn với TẤT CẢ thiết bị của user (từ JWT) → nhận push cho mọi thiết bị.
  await FCMToken.findOneAndUpdate(
    { token },
    { deviceIds: req.deviceIds, token, device },
    { upsert: true, new: true }
  );
  res.json({ success: true, message: 'Token saved' });
});

export const removeToken = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  // Chỉ chủ token (có ít nhất 1 thiết bị trùng) mới xoá được.
  await FCMToken.deleteOne({ token, deviceIds: { $in: req.deviceIds } });
  res.json({ success: true, message: 'Token removed' });
});

export const getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const result = await notificationService.getByUser(req.deviceIds, Number(page), Number(limit));
  res.json({ success: true, ...result });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.deviceIds);
  res.json({ success: true, unreadCount: count });
});

export const markRead = asyncHandler(async (req, res) => {
  const updated = await notificationService.markRead(req.params.id, req.deviceIds);
  if (!updated) return res.status(404).json({ success: false, message: 'Notification not found' });
  res.json({ success: true, data: updated });
});

export const markAllRead = asyncHandler(async (req, res) => {
  await notificationService.markAllRead(req.deviceIds);
  res.json({ success: true, message: 'All notifications marked as read' });
});
