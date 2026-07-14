import notificationService from '../services/notificationService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

// deviceId là danh tính của màn hình kiosk, truyền qua query (?deviceId=...) hoặc body.
// Không còn user/JWT — endpoint được bảo vệ bằng API key (internalAuth).
function getDeviceId(req) {
  return req.query.deviceId || req.body?.deviceId;
}

export const getNotifications = asyncHandler(async (req, res) => {
  const deviceId = getDeviceId(req);
  if (!deviceId) return res.status(400).json({ success: false, message: 'Missing deviceId' });
  const { page = 1, limit = 20 } = req.query;
  const result = await notificationService.getByUser(deviceId, Number(page), Number(limit));
  res.json({ success: true, ...result });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const deviceId = getDeviceId(req);
  if (!deviceId) return res.status(400).json({ success: false, message: 'Missing deviceId' });
  const count = await notificationService.getUnreadCount(deviceId);
  res.json({ success: true, unreadCount: count });
});

export const markRead = asyncHandler(async (req, res) => {
  const deviceId = getDeviceId(req);
  if (!deviceId) return res.status(400).json({ success: false, message: 'Missing deviceId' });
  const updated = await notificationService.markRead(req.params.id, deviceId);
  if (!updated) return res.status(404).json({ success: false, message: 'Notification not found' });
  res.json({ success: true, data: updated });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const deviceId = getDeviceId(req);
  if (!deviceId) return res.status(400).json({ success: false, message: 'Missing deviceId' });
  await notificationService.markAllRead(deviceId);
  res.json({ success: true, message: 'All notifications marked as read' });
});
