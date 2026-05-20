import mongoose from 'mongoose';
import fcmService from './fcmService.js';
import Notification from '../models/Notification.js';

const dbReady = () => mongoose.connection.readyState === 1;

class NotificationService {

  // Endpoint duy nhất Phong's MCP gọi — payload đã được format sẵn
  async notify({ userId, type, severity, title, body, data }) {
    let saved = null;
    if (dbReady()) {
      saved = await Notification.create({ userId, type, severity, title, body, data });
    }

    const fcmData = {
      title,
      body,
      data: {
        notificationId: saved?._id?.toString() ?? '',
        type:           type     ?? '',
        severity:       severity ?? ''
      }
    };

    if (dbReady()) {
      await fcmService.sendToUser(userId, fcmData);
    } else {
      await fcmService.sendToTopic('iot_alerts_topic', fcmData);
    }
    return saved;
  }

  async getByUser(userId, page = 1, limit = 20) {
    const [items, unreadCount] = await Promise.all([
      Notification.find({ userId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments({ userId, isRead: false })
    ]);
    return { items, unreadCount };
  }

  async markRead(id, userId) {
    return Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true },
      { new: true }
    );
  }

  async markAllRead(userId) {
    return Notification.updateMany({ userId, isRead: false }, { isRead: true });
  }

  async getUnreadCount(userId) {
    return Notification.countDocuments({ userId, isRead: false });
  }
}

export default new NotificationService();
