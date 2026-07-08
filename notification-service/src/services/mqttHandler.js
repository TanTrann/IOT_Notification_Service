import { connectMQTT } from '../config/mqtt.js';
import notificationService from './notificationService.js';
import { evaluateSensorData, translateControl } from './eventTranslator.js';

// Nghe ké 2 topic của hệ IoT trên broker HiveMQ Cloud, tự dịch → notification → FCM.
export function startMQTTListener() {
  const client = connectMQTT();
  if (!client) return;

  const SENSOR_TOPIC  = process.env.MQTT_SENSOR_TOPIC  || 'xmini/sensor_data';
  const CONTROL_TOPIC = process.env.MQTT_CONTROL_TOPIC || 'xmini/control';

  // Payload xmini/control KHÔNG có device_id → nhớ device của bản tin
  // sensor gần nhất để gán cho lệnh (lệnh auto luôn được server bắn ra ngay sau
  // bản tin sensor kích hoạt rule, nên với demo 1 thiết bị là chính xác).
  let lastSensorDeviceId = process.env.DEFAULT_DEVICE_ID || null;

  client.on('connect', () => {
    client.subscribe([SENSOR_TOPIC, CONTROL_TOPIC], { qos: 1 }, (err, granted) => {
      if (err) return console.error('MQTT subscribe error:', err.message);
      console.log('MQTT subscribed:', granted.map(g => g.topic).join(', '));
    });
  });

  client.on('message', async (topic, payload) => {
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      console.error('MQTT: payload không phải JSON hợp lệ:', payload.toString());
      return;
    }

    try {
      if (topic === SENSOR_TOPIC) {
        // Số đo thô → tự so ngưỡng → 0..n notification
        if (data.device_id) lastSensorDeviceId = data.device_id;
        const notes = evaluateSensorData(data);
        for (const n of notes) await notificationService.notify(n);
      } else if (topic === CONTROL_TOPIC) {
        // Lệnh từ server .NET → 1 notification, gán cho device sensor gần nhất
        const n = translateControl(data, lastSensorDeviceId);
        if (n) await notificationService.notify(n);
        else console.warn('MQTT: bỏ qua lệnh control (thiếu command hoặc chưa biết deviceId):', payload.toString());
      }
    } catch (err) {
      console.error(`MQTT: lỗi xử lý message trên "${topic}":`, err.message);
    }
  });
}
