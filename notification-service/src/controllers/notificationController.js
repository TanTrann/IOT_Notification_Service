import FCMToken from '../models/FCMToken.js';
import notificationService from '../services/notificationService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { deviceScope } from '../utils/deviceScope.js';

// Mọi handler chạy sau userAuth: req.user = { userId, email, exp, devices, deviceIds } lấy từ server Phong.
// Người dùng chỉ thấy thông báo của cây mình sở hữu / được share; ?deviceId ngoài quyền → 403.

function scopeOr403(req, res) {
  const scope = deviceScope(req.user, req.query.deviceId || req.body?.deviceId);
  if (scope.forbidden) {
    res.status(403).json({ success: false, message: 'Không có quyền xem thiết bị này' });
    return null;
  }
  return scope.deviceIds;
}

export const getMe = (req, res) => {
  const { userId, email, devices } = req.user;
  res.json({ success: true, userId, email, devices });
};

export const getNotifications = asyncHandler(async (req, res) => {
  const deviceIds = scopeOr403(req, res);
  if (!deviceIds) return;
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const unread = req.query.unread === 'true';
  const result = await notificationService.list(req.user.userId, deviceIds, { unread, page, limit });
  res.json({ success: true, ...result });
});

export const getUnreadCount = asyncHandler(async (req, res) => {
  const deviceIds = scopeOr403(req, res);
  if (!deviceIds) return;
  const count = await notificationService.unreadCount(req.user.userId, deviceIds);
  res.json({ success: true, unreadCount: count });
});

export const markRead = asyncHandler(async (req, res) => {
  const updated = await notificationService.markRead(req.params.id, req.user.userId, [...req.user.deviceIds]);
  if (!updated) return res.status(404).json({ success: false, message: 'Notification not found' });
  res.json({ success: true, data: updated });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const deviceIds = scopeOr403(req, res);
  if (!deviceIds) return;
  await notificationService.markAllRead(req.user.userId, deviceIds);
  res.json({ success: true, message: 'All notifications marked as read' });
});

// ── FCM token: gắn với NGƯỜI DÙNG (không còn theo deviceId) ─────────────────────────────
// Lưu kèm JWT hiện tại + hạn của nó để lúc gửi push hỏi lại Phong quyền xem cây.
// Client gọi lại sau MỖI lần đăng nhập; cùng token mà người khác đăng ký → chuyển chủ.

export const registerPushToken = asyncHandler(async (req, res) => {
  const { token, device = 'web' } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  if (!['web', 'android', 'ios'].includes(device)) {
    return res.status(400).json({ success: false, message: 'device phải là web | android | ios' });
  }
  await FCMToken.findOneAndUpdate(
    { token },
    {
      token,
      device,
      userId: req.user.userId,
      jwt: req.jwt,
      expiresAt: req.user.exp ? new Date(req.user.exp * 1000) : null,
    },
    { upsert: true }
  );
  res.json({ success: true });
});

export const unregisterPushToken = asyncHandler(async (req, res) => {
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ success: false, message: 'Missing token' });
  await FCMToken.deleteOne({ token, userId: req.user.userId });
  res.json({ success: true });
});
