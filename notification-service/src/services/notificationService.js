import Notification from '../models/Notification.js';
import fcmService from './fcmService.js';

class NotificationService {
  async notify({ deviceId, type, severity, title, body, data }) {
    const saved = await Notification.create({ deviceId, type, severity, title, body, data });
    await fcmService.sendToUser(deviceId, {
      title,
      body,
      data: {
        notificationId: saved._id.toString(),
        type:           type     ?? '',
        severity:       severity ?? '',
      },
    });
    return saved;
  }

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
