import { connectMQTT } from '../config/mqtt.js';
import notificationService from './notificationService.js';
import { evaluateSensorData, translateControl } from './eventTranslator.js';

// Nghe ké traffic IoT trên broker HiveMQ Cloud → dịch → notification → FCM.
// Hỗ trợ 2 HỌ TOPIC giống server .NET của Phong (PlantTreeIoTServer/MqttBackgroundService.cs):
//   • xmini/sensor_data + xmini/control           — payload snake_case; control KHÔNG có device_id
//   • planttree/{deviceId}/sensors + .../commands — payload camelCase; deviceId nằm TRONG topic

const PLANTTREE_SENSORS  = 'planttree/+/sensors';
const PLANTTREE_COMMANDS = 'planttree/+/commands';

export function startMQTTListener() {
  const client = connectMQTT();
  if (!client) return;

  const sensorTopic  = process.env.MQTT_SENSOR_TOPIC  || 'xmini/sensor_data';
  const controlTopic = process.env.MQTT_CONTROL_TOPIC || 'xmini/control';

  // xmini/control KHÔNG có device_id → nhớ device của bản tin sensor gần nhất để gán cho lệnh.
  // (Nhánh planttree lấy deviceId thẳng từ topic nên KHÔNG cần suy đoán — hết mơ hồ đa thiết bị.)
  let lastSensorDeviceId = process.env.DEFAULT_DEVICE_ID || null;

  client.on('connect', () => {
    const topics = [sensorTopic, controlTopic, PLANTTREE_SENSORS, PLANTTREE_COMMANDS];
    client.subscribe(topics, { qos: 1 }, (err, granted) => {
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
      const res = routeMessage(topic, data, { sensorTopic, controlTopic, lastSensorDeviceId });
      lastSensorDeviceId = res.lastSensorDeviceId;
      if (!res.notes.length && (topic === controlTopic || topic.endsWith('/commands'))) {
        console.warn(`MQTT: bỏ qua lệnh trên "${topic}" (thiếu command hoặc chưa biết deviceId):`, payload.toString());
      }
      for (const n of res.notes) await notificationService.notify(n);
    } catch (err) {
      console.error(`MQTT: lỗi xử lý message trên "${topic}":`, err.message);
    }
  });
}

// Định tuyến 1 message → danh sách notification. Hàm THUẦN (không I/O) để test dễ.
// Trả về { notes, lastSensorDeviceId } — lastSensorDeviceId có thể cập nhật khi gặp bản tin sensor.
export function routeMessage(topic, data, { sensorTopic, controlTopic, lastSensorDeviceId }) {
  let notes = [];

  if (topic === sensorTopic) {
    // xmini: số đo snake_case, device_id trong payload
    if (data.device_id) lastSensorDeviceId = data.device_id;
    notes = evaluateSensorData(data);
  } else if (topic === controlTopic) {
    // xmini: lệnh không có device_id → gán cho device sensor gần nhất
    const n = translateControl(data, lastSensorDeviceId);
    if (n) notes = [n];
  } else {
    // planttree/{deviceId}/{sensors|commands} — deviceId nằm trong topic
    const [root, deviceId, kind] = topic.split('/');
    if (root === 'planttree' && deviceId) {
      if (kind === 'sensors') {
        lastSensorDeviceId = deviceId;
        notes = evaluateSensorData(normalizePlanttreeSensor(deviceId, data));
      } else if (kind === 'commands') {
        const n = translateControl(data, deviceId);   // deviceId chắc chắn (từ topic)
        if (n) notes = [n];
      }
    }
  }

  return { notes, lastSensorDeviceId };
}

// Payload planttree dùng camelCase (temperature/humidity/soilMoisture/lightLevel — xem
// esp32-mqtt-client.ino của Phong). Map về đúng field mà evaluateSensorData đọc (dạng xmini),
// giữ nguyên payload gốc trong `data` của notification.
export function normalizePlanttreeSensor(deviceId, d) {
  return {
    ...d,
    device_id:             deviceId,
    temperature_c:         d.temperature,
    humidity_percent:      d.humidity,
    soil_moisture_percent: d.soilMoisture,
    light_lux:             d.lightLevel,
  };
}
