import mongoose from 'mongoose';
import fcmService from './fcmService.js';
import Notification from '../models/Notification.js';

const dbReady = () => mongoose.connection.readyState === 1;

class NotificationService {

  // Nhận data từ Lĩnh (AI phân tích bệnh, nước, dinh dưỡng, ánh sáng)
  async handleAIResult(aiData) {
    const { userId, disease, water, nutrition, light } = aiData;
    const alerts = [];

    if (disease?.detected) {
      alerts.push({
        type: 'disease', severity: 'critical',
        title: '🦠 Phát hiện bệnh cây!',
        body:  `${disease.name} – Độ tin cậy: ${disease.confidence}%` +
               (disease.suggestion ? `. Gợi ý: ${disease.suggestion}` : ''),
        data:  disease
      });
    }

    if (water?.status === 'low') {
      alerts.push({
        type: 'water', severity: 'warning',
        title: '🟤 Đất khô — Cần tưới nước',
        body:  `Độ ẩm đất: ${water.value}% (ngưỡng tối thiểu: ${water.threshold}%). Cây cần được tưới ngay.`,
        data:  water
      });
    } else if (water?.status === 'high') {
      alerts.push({
        type: 'water', severity: 'warning',
        title: '💦 Đất quá ẩm',
        body:  `Độ ẩm đất: ${water.value}% (ngưỡng tối đa: ${water.threshold}%). Nguy cơ thối rễ, giảm tưới.`,
        data:  water
      });
    }

    if (nutrition?.deficient) {
      alerts.push({
        type: 'nutrition', severity: 'warning',
        title: '🌿 Thiếu dinh dưỡng',
        body:  `Cây đang thiếu: ${nutrition.missing.join(', ')}.` +
               (nutrition.suggestion ? ` ${nutrition.suggestion}` : ''),
        data:  nutrition
      });
    }

    if (light?.status === 'insufficient') {
      alerts.push({
        type: 'light', severity: 'info',
        title: '☀️ Ánh sáng không đủ',
        body:  `Cường độ sáng hiện tại: ${light.value} lux. Cân nhắc bật đèn Grow Light.`,
        data:  light
      });
    } else if (light?.status === 'excess') {
      alerts.push({
        type: 'light', severity: 'warning',
        title: '🌞 Ánh sáng quá mạnh',
        body:  `Cường độ sáng: ${light.value} lux. Có thể gây hại cho cây, cần che chắn.`,
        data:  light
      });
    }

    for (const alert of alerts) {
      await this.createAndSend({ userId, ...alert });
    }
  }

  // Nhận alert từ cảm biến (Nhường) — dùng eventType để map message chi tiết
  async handleSensorAlert(sensorData) {
    const eventType = sensorData.eventType || sensorData.sensorName;
    const { title, body } = buildIoTMessage(eventType, sensorData);

    await this.createAndSend({
      userId:   sensorData.userId,
      type:     mapEventToType(eventType),
      severity: sensorData.severity || mapEventToSeverity(eventType),
      title,
      body,
      data:     sensorData
    });
  }

  async createAndSend(notificationData) {
    let saved = null;
    if (dbReady()) {
      saved = await Notification.create(notificationData);
    }

    const fcmData = {
      title: notificationData.title,
      body:  notificationData.body,
      data:  {
        notificationId: saved?._id?.toString() ?? '',
        type:           notificationData.type     ?? '',
        severity:       notificationData.severity ?? ''
      }
    };

    if (dbReady()) {
      await fcmService.sendToUser(notificationData.userId, fcmData);
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildIoTMessage(eventType, data = {}) {
  const loc = data.location || 'vườn';
  let title = '🔔 Thông báo Garden';
  let body  = `Hệ thống ghi nhận sự kiện: ${eventType} tại ${loc}.`;

  switch (eventType) {
    // ── VEML7700: Ánh sáng ────────────────────────────────────
    case 'LOW_LIGHT':
      title = '☀️ Thiếu ánh sáng';
      body  = `Ánh sáng tại ${loc} quá thấp${data.lux ? ` (${data.lux} lux)` : ''}. Hãy bật đèn UV/Grow Light.`;
      break;
    case 'HIGH_LIGHT':
      title = '🌞 Ánh sáng quá mạnh';
      body  = `Ánh sáng tại ${loc} quá cao${data.lux ? ` (${data.lux} lux)` : ''}. Có thể gây hại cho cây.`;
      break;

    // ── STEMMA Soil Sensor: Độ ẩm & Nhiệt độ Đất ─────────────
    case 'LOW_SOIL_MOISTURE':
      title = '🟤 Đất khô — Cần tưới nước';
      body  = `Độ ẩm đất tại ${loc} quá thấp${data.moisture ? ` (${data.moisture}%)` : ''}. Cây cần được tưới ngay.`;
      break;
    case 'HIGH_SOIL_MOISTURE':
      title = '💦 Đất quá ẩm';
      body  = `Độ ẩm đất tại ${loc} quá cao${data.moisture ? ` (${data.moisture}%)` : ''}. Nguy cơ thối rễ, giảm tưới.`;
      break;
    case 'LOW_SOIL_TEMPERATURE':
      title = '🌡️ Nhiệt độ đất thấp';
      body  = `Nhiệt độ đất tại ${loc} đang thấp${data.temperature ? ` (${data.temperature}°C)` : ''}. Cây có thể bị ảnh hưởng.`;
      break;
    case 'HIGH_SOIL_TEMPERATURE':
      title = '🌡️ Nhiệt độ đất cao';
      body  = `Nhiệt độ đất tại ${loc} quá cao${data.temperature ? ` (${data.temperature}°C)` : ''}. Cần che chắn hoặc tưới làm mát.`;
      break;

    // ── SHT4x: Độ ẩm & Nhiệt độ Không khí ───────────────────
    case 'LOW_HUMIDITY':
      title = '💨 Độ ẩm không khí thấp';
      body  = `Độ ẩm không khí tại ${loc} quá thấp${data.humidity ? ` (${data.humidity}%)` : ''}. Cây dễ bị khô héo.`;
      break;
    case 'HIGH_HUMIDITY':
      title = '🌫️ Độ ẩm không khí cao';
      body  = `Độ ẩm không khí tại ${loc} quá cao${data.humidity ? ` (${data.humidity}%)` : ''}. Nguy cơ nấm mốc, cần thông gió.`;
      break;
    case 'LOW_TEMPERATURE':
      title = '❄️ Nhiệt độ không khí thấp';
      body  = `Nhiệt độ tại ${loc} đang thấp${data.temperature ? ` (${data.temperature}°C)` : ''}. Cần giữ ấm cho cây.`;
      break;
    case 'HIGH_TEMPERATURE':
      title = '🔥 Nhiệt độ không khí cao';
      body  = `Nhiệt độ tại ${loc} quá cao${data.temperature ? ` (${data.temperature}°C)` : ''}. Cần làm mát hoặc che bớt ánh nắng.`;
      break;

    // ── Relay / Đèn: Thông báo hành động ─────────────────────
    case 'LIGHT_TURNED_ON':
      title = '💡 Đèn Grow Light đã bật';
      body  = `Đèn trồng cây tại ${loc} đã được bật tự động.`;
      break;
    case 'LIGHT_TURNED_OFF':
      title = '💡 Đèn Grow Light đã tắt';
      body  = `Đèn trồng cây tại ${loc} đã được tắt tự động.`;
      break;
    case 'UV_LIGHT_ON':
      title = '🔵 Đèn UV đã bật';
      body  = `Đèn UV Halo Grow Light tại ${loc} đã được bật.`;
      break;
    case 'UV_LIGHT_OFF':
      title = '🔵 Đèn UV đã tắt';
      body  = `Đèn UV Halo Grow Light tại ${loc} đã được tắt.`;
      break;
    case 'PUMP_ON':
      title = '💧 Bơm nước đã bật';
      body  = `Hệ thống bơm nước tại ${loc} đã được kích hoạt tự động.`;
      break;
    case 'PUMP_OFF':
      title = '💧 Bơm nước đã tắt';
      body  = `Hệ thống bơm nước tại ${loc} đã dừng.`;
      break;

    // ── Tương thích ngược ─────────────────────────────────────
    case 'LOW_WATER':
      title = '💧 Thiếu nước';
      body  = `Nguồn nước tại ${loc} đang cạn hoặc đất đang thiếu nước tưới.`;
      break;
  }

  return { title, body };
}

function mapEventToType(eventType = '') {
  if (eventType.includes('LIGHT') || eventType.includes('UV')) return 'light';
  if (eventType.includes('MOISTURE') || eventType.includes('WATER') || eventType.includes('PUMP')) return 'water';
  if (eventType.includes('TEMPERATURE')) return 'system';
  if (eventType.includes('HUMIDITY')) return 'system';
  return 'system';
}

function mapEventToSeverity(eventType = '') {
  const critical = ['LOW_SOIL_MOISTURE', 'HIGH_SOIL_TEMPERATURE', 'HIGH_TEMPERATURE'];
  const info     = ['LIGHT_TURNED_ON', 'LIGHT_TURNED_OFF', 'UV_LIGHT_ON', 'UV_LIGHT_OFF', 'PUMP_ON', 'PUMP_OFF'];
  if (critical.includes(eventType)) return 'critical';
  if (info.includes(eventType))     return 'info';
  return 'warning';
}

export default new NotificationService();
