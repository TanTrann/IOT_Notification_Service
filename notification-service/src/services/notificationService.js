import Notification from '../models/Notification.js';
import fcmService from './fcmService.js';

class NotificationService {
  async notify({ eventId, deviceId, type, severity, title, body, data }) {
    let saved;
    try {
      saved = await Notification.create({ eventId, deviceId, type, severity, title, body, data });
    } catch (err) {
      // Mã lỗi 11000 = "duplicate key" → eventId này đã xử lý rồi
      if (err.code === 11000) {
        console.log(`Bỏ qua sự kiện trùng: ${eventId}`);
        return null;   // dừng, KHÔNG gửi FCM lần nữa
      }
      throw err;       // lỗi khác thì ném ra để xử lý/retry
    }

    // chỉ tới đây khi đây là sự kiện MỚI
    await fcmService.sendToUser(deviceId, { title, body, data: { ...data, type, severity, eventId: eventId ?? '' } });
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
