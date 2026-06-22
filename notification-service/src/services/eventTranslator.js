// Dịch payload sự kiện THÔ từ MCP server (Phong) sang notification payload
// mà notification-service hiểu (title, body, type, severity, eventId).
// Trả về null nếu sự kiện không cần gửi notification.

// Map command → type (khớp enum trong models/Notification.js)
const COMMAND_TYPE = {
  WATER_ON:      'water',
  WATER_OFF:     'water',
  LIGHT_ON:      'light',
  LIGHT_OFF:     'light',
  FERTILIZER_ON: 'nutrition',
  FERTILIZER_OFF:'nutrition',
};

// event: "rule_triggered" — rule tự động kích hoạt (quan trọng nhất)
function ruleTriggered(e) {
  const type = e.reason === 'light_rule'    ? 'light'
             : e.reason === 'moisture_rule' ? 'water'
             : COMMAND_TYPE[e.command] || 'system';

  let title, body;
  if (type === 'water') {
    const secs = e.duration ? ` ${Math.round(e.duration / 1000)} giây` : '';
    title = 'Đã tự động tưới nước';
    body  = `Độ ẩm ${e.currentMoisture}% < ngưỡng ${e.threshold}%, hệ thống đã tưới${secs}.`;
  } else if (type === 'light') {
    const on = e.command === 'LIGHT_ON';
    title = on ? 'Đã bật đèn' : 'Đã tắt đèn';
    body  = `Ánh sáng ${e.currentLight} so với ngưỡng ${e.threshold}, hệ thống đã ${on ? 'bật' : 'tắt'} đèn.`;
  } else {
    title = 'Quy tắc tự động kích hoạt';
    body  = `Lệnh ${e.command} (${e.reason}) đã được thực thi.`;
  }

  // eventId phải unique mỗi lần rule chạy → ghép ruleId + timestamp.
  // Thiếu một trong hai thì bỏ trống (vẫn lưu, chỉ mất khả năng chống trùng).
  const eventId = e.ruleId && e.timestamp ? `rule-${e.ruleId}-${e.timestamp}` : undefined;
  return { eventId, type, severity: 'info', title, body };
}

// event: "command_sent" — lệnh điều khiển gửi thủ công
function commandSent(e) {
  return {
    eventId:  e.commandId ? `cmd-${e.commandId}` : undefined,
    type:     COMMAND_TYPE[e.command] || 'system',
    severity: 'info',
    title:    'Đã gửi lệnh điều khiển',
    body:     `Lệnh ${e.command} đã được gửi tới ${e.deviceId}.`,
  };
}

// event: "device_registered" — thiết bị mới đăng ký
function deviceRegistered(e) {
  return {
    eventId:  `registered-${e.deviceId}`,   // mỗi device chỉ báo đăng ký 1 lần
    type:     'system',
    severity: 'info',
    title:    'Thiết bị mới đăng ký',
    body:     `${e.name || e.deviceId}${e.plantType ? ` (${e.plantType})` : ''} đã được thêm vào hệ thống.`,
  };
}

const HANDLERS = {
  rule_triggered:    ruleTriggered,
  command_sent:      commandSent,
  device_registered: deviceRegistered,
};

// Nhận object sự kiện thô (đã JSON.parse). Trả về notification payload hoặc null.
export function translateEvent(raw) {
  const handler = HANDLERS[raw.event];
  if (!handler) return null;          // sự kiện không nằm trong danh sách cần notify
  const base = handler(raw);
  return { ...base, deviceId: raw.deviceId, data: raw };
}
