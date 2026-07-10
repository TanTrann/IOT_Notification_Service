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


  // deviceIds: mảng thiết bị của user (từ JWT). Gộp thông báo của mọi thiết bị vào 1 inbox.
  async getByUser(deviceIds, page = 1, limit = 20) {
    const filter = { deviceId: { $in: deviceIds } };
    const [items, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments({ ...filter, isRead: false }),
    ]);
    return { items, unreadCount };
  }

  async markRead(id, deviceIds) {
    return Notification.findOneAndUpdate(
      { _id: id, deviceId: { $in: deviceIds } },
      { isRead: true },
      { new: true }
    );
  }

  async markAllRead(deviceIds) {
    return Notification.updateMany({ deviceId: { $in: deviceIds }, isRead: false }, { isRead: true });
  }

  async getUnreadCount(deviceIds) {
    return Notification.countDocuments({ deviceId: { $in: deviceIds }, isRead: false });
  }
}

export default new NotificationService();
