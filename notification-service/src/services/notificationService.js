import Notification from '../models/Notification.js';
import fcmService from './fcmService.js';
import { formatEventPayload } from '../utils/templateEngine.js';

// Hỗ trợ bóc tách key linh hoạt từ payload
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };

// Chuẩn hóa để khớp enum của model Notification
const TYPE_ENUM = ['disease', 'water', 'nutrition', 'light', 'temperature', 'system'];
function normSeverity(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (['critical', 'crit', 'error', 'danger', 'high', 'nguy cấp'].some(x => s.includes(x))) return 'critical';
  if (['warning', 'warn', 'medium', 'cảnh báo'].some(x => s.includes(x))) return 'warning';
  return 'info';
}
function normType(raw) {
  const t = String(raw ?? '').toLowerCase();
  if (t === 'temp') return 'temperature';
  return TYPE_ENUM.includes(t) ? t : undefined;
}

class NotificationService {
  // Nhận 1 thông báo từ server .NET (Phong) qua POST /internal/notify.
  // Đã hỗ trợ cả dạng event + data cấu trúc lẫn dạng title + body truyền thống.
  async ingest(payload, deviceId) {
    if (!deviceId) throw Object.assign(new Error('Missing deviceId'), { status: 400 });

    // Format payload qua templateEngine (map event -> title, body, severity, type)
    const formatted = formatEventPayload(payload);
    const { event, title, body, severity: formattedSeverity, type: formattedType } = formatted;

    const severity = normSeverity(formattedSeverity);
    const type = normType(formattedType);

    // Ghi lịch sử vào MongoDB — BEST-EFFORT: lỗi ghi DB KHÔNG chặn việc đẩy push.
    this._saveHistory({ payload, deviceId, event, title, body, type, severity })
      .catch(err => console.error('Lưu lịch sử lỗi:', err.message));

    // Push tới đúng các màn hình đã đăng ký deviceId này (targeting theo thiết bị).
    const results = await fcmService.sendToDeviceId(deviceId, {
      title,
      body,
      // FCM ép mọi field data về string; gửi kèm deviceId, event, type, severity & raw payload
      data: {
        deviceId,
        event: event || '',
        type: type || '',
        severity: severity || '',
        raw: JSON.stringify(payload),
      },
    });

    const recipients = Array.isArray(results) ? results.length : 0;
    return { deviceId, event, title, body, recipients };
  }

  // Lưu 1 bản ghi lịch sử để REST /api/v1/notifications đọc lại được.
  async _saveHistory({ payload, deviceId, event, title, body, type, severity }) {
    const doc = {
      deviceId: deviceId || 'broadcast',
      event: event || payload?.event,
      title: String(title),
      body:  String(body) || String(title),
      severity: normSeverity(severity),
      data: payload?.data || payload,
    };
    const t = normType(type);
    if (t) doc.type = t;

    // Nếu Phong gửi id / eventId -> dùng chống trùng khi retry
    const eventId = pick(payload, ['eventId', 'event_id', 'id']);
    if (eventId != null && eventId !== '') {
      doc.eventId = String(eventId);
      await Notification.updateOne(
        { eventId: String(eventId) },
        { $setOnInsert: doc },
        { upsert: true }
      );
    } else {
      await Notification.create(doc);
    }
  }

  async getByUser(deviceId, page = 1, limit = 20) {
    const filter = (deviceId && deviceId !== 'all') ? { deviceId } : {};
    const [items, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Notification.countDocuments({ ...filter, isRead: false }),
    ]);
    return { items, unreadCount };
  }

  async markRead(id, deviceId) {
    const filter = { _id: id };
    if (deviceId && deviceId !== 'all') filter.deviceId = deviceId;
    return Notification.findOneAndUpdate(
      filter,
      { isRead: true },
      { new: true }
    );
  }

  async markAllRead(deviceId) {
    const filter = { isRead: false };
    if (deviceId && deviceId !== 'all') filter.deviceId = deviceId;
    return Notification.updateMany(filter, { isRead: true });
  }

  async getUnreadCount(deviceId) {
    const filter = { isRead: false };
    if (deviceId && deviceId !== 'all') filter.deviceId = deviceId;
    return Notification.countDocuments(filter);
  }
}

export default new NotificationService();
