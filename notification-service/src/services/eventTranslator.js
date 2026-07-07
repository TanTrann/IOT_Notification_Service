// ============================================================================
// DỊCH DỮ LIỆU THÔ TỪ PHONG → notification dễ hiểu cho người dùng.
// ----------------------------------------------------------------------------
// Theo "hợp đồng dữ liệu" với Phong, ta NGHE KÉ 2 topic trên cùng broker:
//   • xmini/sensor_data : Phong (ESP32) gửi SỐ ĐO CẢM BIẾN thô — CHƯA phải cảnh báo.
//                         → service TỰ so sánh với ngưỡng để quyết định có báo không.
//   • xmini/control     : server .NET gửi LỆNH tự động (WATER_ON / LIGHT_ON ...).
//                         → dịch sang câu "hệ thống đã tự động ...".
// Payload sensor dùng snake_case: device_id, temperature_c, soil_moisture_percent, light_lux
// Payload control (theo MqttBackgroundService.cs phía Phong) — KHÔNG có device_id:
//   { "command": "WATER_ON", "commandId": "...", "parameters": { duration, reason, ruleId, currentMoisture } }
// ============================================================================

// --- Ngưỡng cảnh báo (đọc từ .env, có giá trị mặc định nếu thiếu) ---
const TH = {
  soilMin:  Number(process.env.THRESHOLD_SOIL_MOISTURE_MIN ?? 30),  // % — thấp hơn = thiếu nước
  tempMax:  Number(process.env.THRESHOLD_TEMP_MAX          ?? 35),  // °C — cao hơn = quá nóng
  // Thiết bị xmini của Phong đo light_lux cỡ vài chục (demo ~57 lux), rule đèn
  // phía server .NET mặc định min 25 / max 60 → ngưỡng ở đây phải cùng scale đó.
  lightMin: Number(process.env.THRESHOLD_LIGHT_MIN         ?? 25),  // lux — thấp hơn = thiếu sáng
};

// --- Bộ nhớ trạng thái để CHỐNG SPAM ---------------------------------------
// Cảm biến gửi liên tục (vài giây/lần). Nếu cứ thấy thấp là báo thì sẽ spam.
// Giải pháp: chỉ báo khi CHUYỂN trạng thái — đang OK rơi xuống BAD (báo 1 lần),
// và khi hồi phục BAD trở lại OK (báo "đã ổn"). Key: `${deviceId}:${metric}`.
const state = new Map();

function edge(deviceId, metric, isBad) {
  const key  = `${deviceId}:${metric}`;
  const prev = state.get(key) || 'ok';
  const now  = isBad ? 'bad' : 'ok';
  if (now === prev) return null;     // trạng thái không đổi → không báo
  state.set(key, now);
  return now;                        // 'bad' = vừa rơi xuống | 'ok' = vừa hồi phục
}

// Hàm dựng 1 object notification chuẩn (notificationService cần: deviceId, title, body).
function mk(deviceId, type, severity, title, body, raw, eventId) {
  return { eventId, deviceId, type, severity, title, body, data: raw };
}

// ── TOPIC xmini/sensor_data ────────────────────────────────────────────────
// Nhận 1 bản tin cảm biến → trả về MẢNG notification (0, 1 hoặc nhiều cái).
export function evaluateSensorData(raw) {
  const deviceId = raw.device_id;
  if (!deviceId) return [];          // không biết của thiết bị nào → bỏ qua
  const out = [];

  // 1) Độ ẩm đất → loại "water"
  if (raw.soil_moisture_percent != null) {
    const v = raw.soil_moisture_percent;
    const t = edge(deviceId, 'soil', v < TH.soilMin);
    if (t === 'bad') out.push(mk(deviceId, 'water', 'warning',
      'Cây đang thiếu nước', `Độ ẩm đất ${v}% đã xuống dưới ngưỡng ${TH.soilMin}%.`, raw));
    if (t === 'ok')  out.push(mk(deviceId, 'water', 'info',
      'Độ ẩm đã ổn định', `Độ ẩm đất đã hồi phục lên ${v}%.`, raw));
  }

  // 2) Nhiệt độ → loại "temperature"
  if (raw.temperature_c != null) {
    const v = raw.temperature_c;
    const t = edge(deviceId, 'temp', v > TH.tempMax);
    if (t === 'bad') out.push(mk(deviceId, 'temperature', 'warning',
      'Nhiệt độ quá cao', `Nhiệt độ ${v}°C đã vượt ngưỡng ${TH.tempMax}°C.`, raw));
    if (t === 'ok')  out.push(mk(deviceId, 'temperature', 'info',
      'Nhiệt độ đã ổn định', `Nhiệt độ đã giảm về ${v}°C.`, raw));
  }

  // 3) Ánh sáng → loại "light"
  if (raw.light_lux != null) {
    const v = raw.light_lux;
    const t = edge(deviceId, 'light', v < TH.lightMin);
    if (t === 'bad') out.push(mk(deviceId, 'light', 'info',
      'Cây đang thiếu sáng', `Ánh sáng ${v} lux thấp hơn ngưỡng ${TH.lightMin} lux.`, raw));
    if (t === 'ok')  out.push(mk(deviceId, 'light', 'info',
      'Ánh sáng đã đủ', `Ánh sáng đã tăng lên ${v} lux.`, raw));
  }

  return out;
}

// ── TOPIC xmini/control ────────────────────────────────────────────────────
// Server .NET của Phong chỉ phát 4 lệnh: WATER_ON/OFF, LIGHT_ON/OFF.
const COMMAND = {
  WATER_ON:  { type: 'water', title: 'Đã tự động tưới nước', verb: 'bật tưới nước' },
  WATER_OFF: { type: 'water', title: 'Đã ngừng tưới nước',   verb: 'tắt tưới nước' },
  LIGHT_ON:  { type: 'light', title: 'Đã bật đèn',           verb: 'bật đèn' },
  LIGHT_OFF: { type: 'light', title: 'Đã tắt đèn',           verb: 'tắt đèn' },
};

// Nhận 1 bản tin lệnh → trả về 1 notification (hoặc null nếu không đọc được).
// LƯU Ý: payload control của Phong KHÔNG có device_id (topic dùng chung cho mọi
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
