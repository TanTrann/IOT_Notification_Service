import mongoose from 'mongoose';

import FCMToken from '../models/FCMToken.js';
import Notification from '../models/Notification.js';
import fcmService from './fcmService.js';
import { resolveAccess } from './plantAccess.js';
import { selectRecipients } from './recipientSelector.js';
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

// Bản ghi trả cho client: isRead tính theo người xem, KHÔNG lộ readBy (danh sách người khác).
function toUserView(doc, userId) {
  const { readBy = [], ...rest } = doc;
  return { ...rest, isRead: readBy.includes(userId) };
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

    // Ghi lịch sử vào MongoDB trước để lấy _id gửi kèm push (client dùng để đánh dấu đã đọc).
    // BEST-EFFORT: lỗi ghi DB KHÔNG chặn việc đẩy push, chỉ thiếu notificationId.
    let notificationId = '';
    try {
      notificationId = await this._saveHistory({ payload, deviceId, event, title, body, type, severity });
    } catch (err) {
      console.error('Lưu lịch sử lỗi:', err.message);
    }

    // Push tới mọi người dùng CÒN quyền xem deviceId — hỏi lại server Phong ngay lúc gửi.
    // Chỉ xét token có phiên đăng nhập chưa hết hạn (expiresAt = exp của JWT).
    const tokens = await FCMToken.find({ expiresAt: { $gt: new Date() } }).select('+jwt').lean();
    const recipients = await selectRecipients(tokens, deviceId, resolveAccess);

    const results = await fcmService.sendToTokens(recipients, {
      title,
      body,
      // FCM ép mọi field data về string; gửi kèm notificationId, deviceId, event, type, severity & raw payload
      data: {
        notificationId,
        deviceId,
        event: event || '',
        type: type || '',
        severity: severity || '',
        raw: JSON.stringify(payload),
      },
    });

    return { deviceId, event, title, body, recipients: results.length };
  }

  // Lưu 1 bản ghi lịch sử để REST /api/v1/notifications đọc lại được. Trả về _id (string).
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
      const saved = await Notification.findOneAndUpdate(
        { eventId: String(eventId) },
        { $setOnInsert: doc },
        { upsert: true, new: true, lean: true }
      );
      return String(saved._id);
    }
    const created = await Notification.create(doc);
    return String(created._id);
  }

  // ── Đọc theo người dùng: chỉ trong deviceIds người đó có quyền (lấy từ Phong), "đã đọc" theo readBy ──

  async list(userId, deviceIds, { unread = false, page = 1, limit = 20 } = {}) {
    const scope = { deviceId: { $in: deviceIds } };
    const filter = unread ? { ...scope, readBy: { $ne: userId } } : scope;
    const [docs, unreadCount] = await Promise.all([
      Notification.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit + 1)
        .lean(),
      this.unreadCount(userId, deviceIds),
    ]);
    const hasMore = docs.length > limit;
    const items = docs.slice(0, limit).map(d => toUserView(d, userId));
    return { items, unreadCount, page, limit, hasMore };
  }

  async unreadCount(userId, deviceIds) {
    return Notification.countDocuments({ deviceId: { $in: deviceIds }, readBy: { $ne: userId } });
  }

  async markRead(id, userId, deviceIds) {
    if (!mongoose.isValidObjectId(id)) return null;
    const doc = await Notification.findOneAndUpdate(
      { _id: id, deviceId: { $in: deviceIds } },
      { $addToSet: { readBy: userId } },
      { new: true, lean: true }
    );
    return doc ? toUserView(doc, userId) : null;
  }

  async markAllRead(userId, deviceIds) {
    await Notification.updateMany(
      { deviceId: { $in: deviceIds }, readBy: { $ne: userId } },
      { $addToSet: { readBy: userId } }
    );
  }
}

export default new NotificationService();
