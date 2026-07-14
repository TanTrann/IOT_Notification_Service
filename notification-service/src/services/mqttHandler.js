import { connectMQTT } from '../config/mqtt.js';
import fcmService from './fcmService.js';
import Notification from '../models/Notification.js';

// Nghe thông báo do server/MCP của Phong phát, theo cấu trúc SONG SONG với sensors/commands:
//   planttree/{deviceId}/sensors        (số đo   — Phong publish, thiết bị nghe)
//   planttree/{deviceId}/commands       (lệnh    — Phong publish, thiết bị nghe)
//   planttree/{deviceId}/notifications  (thông báo — Phong publish, SERVICE NÀY nghe) ◄──
//
// deviceId nằm TRONG topic. Service KHÔNG dịch/biến đổi payload — mỗi tin nhận được sẽ
// broadcast qua Firebase (FCM) tới mọi thiết bị đã đăng ký (web/app), nổ cả khi tab/app đóng.
const DEFAULT_TOPIC = 'planttree/+/notifications';

export function startMQTTListener() {
  const client = connectMQTT();
  if (!client) return;

  const topicFilter = process.env.MQTT_NOTIFICATION_TOPIC || DEFAULT_TOPIC;

  client.on('connect', () => {
    client.subscribe(topicFilter, { qos: 1 }, (err, granted) => {
      if (err) return console.error('MQTT subscribe error:', err.message);
      console.log('MQTT subscribed:', granted.map(g => g.topic).join(', '));
    });
  });

  client.on('message', (topic, payload) => {
    const raw = payload.toString();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };   // không phải JSON → vẫn hiển thị dạng text thô
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      data = { message: raw };
    }

    // Bóc deviceId từ topic: planttree/{deviceId}/notifications
    const parts = topic.split('/');
    const deviceId = parts.length >= 3 ? parts[1] : null;

    broadcastPush(data, deviceId)
      .then(() => console.log(`MQTT "${topic}" → FCM broadcast`))
      .catch(err => console.error('FCM broadcast lỗi:', err.message));
  });
}

// Bóc title/body để hiển thị đẹp trên khay/thông báo; payload gốc gửi kèm trong `data.raw`.
const pick = (o, keys) => { for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k]; return undefined; };

// Chuẩn hóa để khớp enum của model Notification (MCP có thể gửi tên/ngôn ngữ bất kỳ).
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

async function broadcastPush(payload, deviceId) {
  const title = pick(payload, ['title', 'tieu_de', 'name', 'event']) ?? 'Thông báo SmartFarm';
  const body  = pick(payload, ['body', 'message', 'msg', 'content', 'noi_dung', 'description']) ?? '';
  const type     = pick(payload, ['type', 'category', 'loai']);
  const severity = pick(payload, ['severity', 'level', 'muc_do', 'priority']);

  // Ghi lịch sử vào MongoDB — BEST-EFFORT: lỗi ghi DB KHÔNG chặn việc đẩy push.
  saveHistory({ payload, deviceId, title, body, type, severity })
    .catch(err => console.error('Lưu lịch sử lỗi:', err.message));

  // Hiện broadcast tới TẤT CẢ token (mô hình demo). Để push đúng theo deviceId (targeting),
  // cho client đăng ký token kèm deviceId thật rồi đổi sang fcmService.sendToUser(deviceId, ...).
  await fcmService.sendToAll({
    title: String(title),
    body:  String(body),
    // FCM ép mọi field data về string; gửi kèm deviceId + payload gốc để client dùng nếu cần
    data: { deviceId: deviceId ?? '', type: type ?? '', severity: severity ?? '', raw: JSON.stringify(payload) },
  });
}

// Lưu 1 bản ghi lịch sử để REST /api/v1/notifications đọc lại được (kể cả từ máy khác).
async function saveHistory({ payload, deviceId, title, body, type, severity }) {
  const doc = {
    deviceId: deviceId || 'broadcast',
    title: String(title),
    body:  String(body) || String(title),   // body là required → rỗng thì fallback về title
    severity: normSeverity(severity),
    data: payload,
  };
  const t = normType(type);
  if (t) doc.type = t;

  // Nếu MCP có gửi id → dùng làm eventId để chống trùng khi broker gửi lại (QoS 1).
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
