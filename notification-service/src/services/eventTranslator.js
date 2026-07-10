// ============================================================================
// DỊCH DỮ LIỆU THÔ TỪ HỆ IOT → notification dễ hiểu cho người dùng.
// ----------------------------------------------------------------------------
// Theo "hợp đồng dữ liệu" với hệ IoT, ta NGHE KÉ 2 topic trên cùng broker:
//   • xmini/sensor_data : thiết bị ESP32 gửi SỐ ĐO CẢM BIẾN thô.
//                         → service tạo thông báo cho MỖI số đo (KHÔNG so ngưỡng).
//   • xmini/control     : server điều khiển .NET gửi LỆNH tự động (WATER_ON / LIGHT_ON ...).
//                         → dịch sang câu "hệ thống đã tự động ...".
// Payload sensor dùng snake_case: device_id, temperature_c, soil_moisture_percent, light_lux
// Payload control (theo MqttBackgroundService.cs của server điều khiển) — KHÔNG có device_id:
//   { "command": "WATER_ON", "commandId": "...", "parameters": { duration, reason, ruleId, currentMoisture } }
// ============================================================================

// --- Bộ nhớ giá trị gần nhất để CHỐNG SPAM ---------------------------------
// KHÔNG còn ngưỡng cảnh báo: mọi bản tin sensor đều sinh thông báo. Để tránh spam
// khi thiết bị gửi liên tục CÙNG số đo, chỉ báo khi GIÁ TRỊ của chỉ số THAY ĐỔI so
// với lần trước. Key: `${deviceId}:${metric}`.
const lastValue = new Map();

function changed(deviceId, metric, value) {
  const key = `${deviceId}:${metric}`;
  if (lastValue.get(key) === value) return false;   // cùng giá trị → không báo lại
  lastValue.set(key, value);
  return true;
}

// Hàm dựng 1 object notification chuẩn (notificationService cần: deviceId, title, body).
function mk(deviceId, type, severity, title, body, raw, eventId) {
  return { eventId, deviceId, type, severity, title, body, data: raw };
}

// ── TOPIC xmini/sensor_data ────────────────────────────────────────────────
// Nhận 1 bản tin cảm biến → trả về MẢNG notification. KHÔNG so ngưỡng: mỗi chỉ số
// có mặt (và vừa đổi giá trị) → 1 thông báo báo số đo hiện tại.
export function evaluateSensorData(raw) {
  const deviceId = raw.device_id;
  if (!deviceId) return [];          // không biết của thiết bị nào → bỏ qua
  const out = [];

  if (raw.soil_moisture_percent != null && changed(deviceId, 'soil', raw.soil_moisture_percent)) {
    out.push(mk(deviceId, 'water', 'warning',
      'Độ ẩm đất', `Độ ẩm đất hiện tại ${raw.soil_moisture_percent}%.`, raw));
  }

  if (raw.temperature_c != null && changed(deviceId, 'temp', raw.temperature_c)) {
    out.push(mk(deviceId, 'temperature', 'warning',
      'Nhiệt độ', `Nhiệt độ hiện tại ${raw.temperature_c}°C.`, raw));
  }

  if (raw.light_lux != null && changed(deviceId, 'light', raw.light_lux)) {
    out.push(mk(deviceId, 'light', 'warning',
      'Ánh sáng', `Ánh sáng hiện tại ${raw.light_lux} lux.`, raw));
  }

  return out;
}

// ── TOPIC xmini/control ────────────────────────────────────────────────────
// Server điều khiển .NET chỉ phát 4 lệnh: WATER_ON/OFF, LIGHT_ON/OFF.
const COMMAND = {
  WATER_ON:  { type: 'water', title: 'Đã tự động tưới nước', verb: 'bật tưới nước' },
  WATER_OFF: { type: 'water', title: 'Đã ngừng tưới nước',   verb: 'tắt tưới nước' },
  LIGHT_ON:  { type: 'light', title: 'Đã bật đèn',           verb: 'bật đèn' },
  LIGHT_OFF: { type: 'light', title: 'Đã tắt đèn',           verb: 'tắt đèn' },
};

// Nhận 1 bản tin lệnh → trả về 1 notification (hoặc null nếu không đọc được).
// LƯU Ý: payload control KHÔNG có device_id (topic dùng chung cho mọi
// thiết bị xmini) → deviceId do mqttHandler suy từ bản tin sensor gần nhất
// (hoặc DEFAULT_DEVICE_ID) rồi truyền vào đây.
export function translateControl(raw, deviceId) {
  const command = raw.command;
  if (!command || !deviceId) return null;

  const meta = COMMAND[command];
  const p    = raw.parameters || {};

  // Nhặt chi tiết từ parameters để câu thông báo cụ thể hơn.
  const extra = [];
  if (p.currentMoisture != null) extra.push(`độ ẩm hiện tại ${p.currentMoisture}%`);
  if (p.currentLight    != null) extra.push(`ánh sáng hiện tại ${p.currentLight} lux`);
  if (p.duration        != null) extra.push(`trong ${Math.round(p.duration / 1000)} giây`);
  const detail = extra.length ? ` (${extra.join(', ')})` : '';

  const title = meta ? meta.title : 'Hệ thống đã thực thi lệnh';
  const body  = meta
    ? `Hệ thống đã tự động ${meta.verb} cho thiết bị ${deviceId}${detail}.`
    : `Lệnh ${command} đã được thực thi trên thiết bị ${deviceId}${detail}.`;

  // Chống trùng khi QoS 1 phát lại: lệnh do rule tự động sinh có commandId
  // (camelCase). Lệnh gửi tay qua REST không có commandId → bỏ trống eventId
  // (vẫn lưu + gửi bình thường, chỉ không dedup được trường hợp hiếm đó).
  const eventId = raw.commandId ? `ctrl-${raw.commandId}` : undefined;
  return mk(deviceId, meta?.type || 'system', 'info', title, body, raw, eventId);
}
