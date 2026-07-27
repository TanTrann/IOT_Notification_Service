// Bảng template map `event → { title, body, severity, type }` cho IOT Notification Service.
// Khớp với hợp đồng "Hướng dẫn tích hợp Notify — Plant Tree IoT" từ server .NET.

export const EVENT_TEMPLATES = {
  // A. Nước & tưới
  'pump.on': {
    title: 'Đang tưới cây',
    body: 'Đất {soilPercent}% dưới ngưỡng {soilOnPct}%, bơm đang chạy',
    severity: 'info',
    type: 'water',
  },
  'pump.off': {
    title: 'Đã tưới xong',
    body: 'Độ ẩm đất đạt {soilPercent}%',
    severity: 'info',
    type: 'water',
  },
  'water.needed': {
    title: 'Cây thiếu nước',
    body: 'Đất {soilPercent}% cần tưới nhưng đang chế độ tay / hết nước',
    severity: 'warning',
    type: 'water',
  },
  'water.empty': {
    title: 'Hết nước tưới',
    body: 'Bình chứa cạn, không thể tưới, cần châm nước',
    severity: 'critical',
    type: 'water',
  },

  // B. Pin
  'battery.low': {
    title: 'Pin yếu',
    body: 'Pin còn {batteryPercent}%, cần sạc sớm',
    severity: 'warning',
    type: 'system',
  },
  'battery.cut': {
    title: 'Pin cạn — thiết bị tạm ngắt',
    body: 'Bơm/đèn tạm dừng đến khi sạc lại',
    severity: 'critical',
    type: 'system',
  },
  'battery.full': {
    title: 'Pin đã đầy',
    body: 'Có thể rút sạc',
    severity: 'info',
    type: 'system',
  },

  // C. Môi trường
  'temp.high': {
    title: 'Nhiệt độ cao',
    body: '{temperature}°C, cây có thể bị stress nhiệt',
    severity: 'warning',
    type: 'temperature',
  },
  'temp.low': {
    title: 'Nhiệt độ thấp',
    body: '{temperature}°C, coi chừng lạnh cây',
    severity: 'warning',
    type: 'temperature',
  },
  'light.low': {
    title: 'Thiếu sáng',
    body: 'Nên bổ sung đèn / đưa ra chỗ sáng',
    severity: 'info',
    type: 'light',
  },

  // D. Kết nối & sức khỏe
  'device.offline': {
    title: 'Mất kết nối thiết bị',
    body: 'Không nhận dữ liệu hơn {lastSeenSecondsAgo} giây',
    severity: 'warning',
    type: 'system',
  },
  'device.online': {
    title: 'Thiết bị online lại',
    body: 'Thiết bị đã kết nối lại bình thường',
    severity: 'info',
    type: 'system',
  },
  'sensor.error': {
    title: 'Cảm biến lỗi',
    body: 'Số đọc {field} không hợp lệ',
    severity: 'warning',
    type: 'system',
  },
};

/**
 * Thay thế biến dạng {key} trong chuỗi template bằng giá trị từ object data.
 */
function renderTemplate(templateStr, data = {}) {
  if (!templateStr) return '';
  return templateStr.replace(/\{(\w+)\}/g, (match, key) => {
    return data[key] !== undefined && data[key] !== null ? data[key] : match;
  });
}

/**
 * Xử lý payload đầu vào từ POST /internal/notify.
 * Map `event` + `data` -> `{ event, title, body, severity, type }`.
 */
export function formatEventPayload(payload = {}) {
  const {
    event,
    severity: rawSeverity,
    data = {},
    title: customTitle,
    body: customBody,
    type: customType,
  } = payload;

  let title = customTitle;
  let body = customBody;
  let severity = rawSeverity;
  let type = customType;

  if (event && EVENT_TEMPLATES[event]) {
    const tmpl = EVENT_TEMPLATES[event];
    if (!title) title = renderTemplate(tmpl.title, data);
    if (!body) body = renderTemplate(tmpl.body, data);
    if (!severity) severity = tmpl.severity;
    if (!type) type = tmpl.type;
  } else if (event) {
    console.warn(`[TemplateEngine] Chưa có template cho event: "${event}". Dùng fallback.`);
    if (!title) title = `Thông báo: ${event}`;
    if (!body) {
      body = customBody || (Object.keys(data).length > 0 ? JSON.stringify(data) : `Sự kiện ${event}`);
    }
  }

  // Trường hợp không có event (legacy payload) hoặc template không có body
  title = title || customTitle || payload.tieu_de || payload.name || 'Thông báo SmartFarm';
  body = body || customBody || payload.message || payload.msg || payload.content || payload.noi_dung || title;

  return {
    event,
    title: String(title),
    body: String(body),
    severity: severity || 'info',
    type,
  };
}
