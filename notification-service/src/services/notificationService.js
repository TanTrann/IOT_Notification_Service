import Notification from '../models/Notification.js';
import fcmService from './fcmService.js';

// Bóc title/body để hiển thị đẹp trên khay/thông báo; payload gốc gửi kèm trong `data.raw`.
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };

// Chuẩn hóa để khớp enum của model Notification (Phong có thể gửi tên/ngôn ngữ bất kỳ).
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
  return TYPE_ENUM.includes(t) ? t : undefined;   // ngoài enum → bỏ (field type không bắt buộc)
}

// Truy vấn lịch sử thông báo cho REST /api/v1/notifications (web dùng), lọc theo deviceId.
// Nhận thông báo từ Phong qua POST /internal/notify → lưu lịch sử + đẩy FCM (targeting theo thiết bị).
class NotificationService {
  // Nhận 1 thông báo Phong đã xử lý sẵn và gửi sang. deviceId cho biết màn hình nào cần hiển thị.
  // Service KHÔNG diễn giải nghiệp vụ — chỉ chuẩn hóa để hiển thị, lưu lịch sử rồi đẩy push.
  async ingest(payload, deviceId) {
    if (!deviceId) throw Object.assign(new Error('Missing deviceId'), { status: 400 });

    const title = pick(payload, ['title', 'tieu_de', 'name', 'event']) ?? 'Thông báo SmartFarm';
    const body  = pick(payload, ['body', 'message', 'msg', 'content', 'noi_dung', 'description']) ?? '';
    const type     = pick(payload, ['type', 'category', 'loai']);
    const severity = pick(payload, ['severity', 'level', 'muc_do', 'priority']);

    // Ghi lịch sử vào MongoDB — BEST-EFFORT: lỗi ghi DB KHÔNG chặn việc đẩy push.
    this._saveHistory({ payload, deviceId, title, body, type, severity })
      .catch(err => console.error('Lưu lịch sử lỗi:', err.message));

    // Push tới đúng các màn hình đã đăng ký deviceId này (targeting theo thiết bị).
    const results = await fcmService.sendToDeviceId(deviceId, {
      title: String(title),
      body:  String(body),
      // FCM ép mọi field data về string; gửi kèm deviceId + payload gốc để client dùng nếu cần
      data: { deviceId, type: type ?? '', severity: severity ?? '', raw: JSON.stringify(payload) },
    });

    // recipients = số màn hình đã đăng ký đúng deviceId này. recipients=0 nghĩa là KHÔNG
    // màn hình nào khớp deviceId → Phong biết ngay bị sai deviceId (thay vì tưởng đã gửi OK).
    const recipients = Array.isArray(results) ? results.length : 0;
    return { deviceId, title: String(title), body: String(body), recipients };
  }

  // Lưu 1 bản ghi lịch sử để REST /api/v1/notifications đọc lại được (kể cả từ máy khác).
  async _saveHistory({ payload, deviceId, title, body, type, severity }) {
    const doc = {
      deviceId: deviceId || 'broadcast',
      title: String(title),
      body:  String(body) || String(title),   // body là required → rỗng thì fallback về title
      severity: normSeverity(severity),
      data: payload,
    };
    const t = normType(type);
    if (t) doc.type = t;

    // Nếu Phong có gửi id → dùng làm eventId để chống trùng khi gọi lại (retry).
    const eventId = pick(payload, ['eventId', 'event_id', 'id']);
    if (eventId != null && eventId !== '') {
      await Notification.updateOne(
        { eventId: String(eventId) },
        { $setOnInsert: { ...doc, eventId: String(eventId) } },
        { upsert: true }
      );
    } else {
      await Notification.create(doc);
    }
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
