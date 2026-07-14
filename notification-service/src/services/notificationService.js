import Notification from '../models/Notification.js';

// Truy vấn lịch sử thông báo cho REST /api/v1/notifications (web dùng). Việc gửi push FCM
// nay do mqttHandler → fcmService.sendToAll đảm nhiệm theo mô hình "1 topic notification".
class NotificationService {
  async getByUser(deviceId, page = 1, limit = 20) {
    const [items, unreadCount] = await Promise.all([
      Notification.find({ deviceId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments({ deviceId, isRead: false }),
    ]);
    return { items, unreadCount };
  }

  async markRead(id, deviceId) {
    return Notification.findOneAndUpdate(
      { _id: id, deviceId },
      { isRead: true },
      { new: true }
    );
  }

  async markAllRead(deviceId) {
    return Notification.updateMany({ deviceId, isRead: false }, { isRead: true });
  }

  async getUnreadCount(deviceId) {
    return Notification.countDocuments({ deviceId, isRead: false });
  }
}

export default new NotificationService();
