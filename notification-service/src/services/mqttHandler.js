import { connectMQTT } from '../config/mqtt.js';
import notificationService from './notificationService.js';
import { translateEvent } from './eventTranslator.js';

export function startMQTTListener() {
  const client = connectMQTT();
  if (!client) return;

  const topic = process.env.MQTT_NOTIFY_TOPIC || 'iot/notifications';

  client.on('connect', () => {
    client.subscribe(topic, { qos: 1 }, err => {
      if (err) return console.error(`MQTT subscribe error (${topic}):`, err.message);
      console.log(`MQTT subscribed to topic: ${topic}`);
    });
  });

  client.on('message', async (_topic, payload) => {
    let data;
    try {
      data = JSON.parse(payload.toString());
    } catch {
      console.error('MQTT: invalid JSON payload:', payload.toString());
      return;
    }

    // Hỗ trợ 2 dạng payload:
    //  - Sự kiện THÔ từ MCP server (Phong): có field `event` → tự dịch sang title/body
    //  - Notification dựng sẵn (test-client / publish thủ công): có sẵn title/body
    let notification;
    if (data.event) {
      notification = translateEvent(data);
      if (!notification) {
        console.log(`MQTT: bỏ qua sự kiện không cần notify: "${data.event}"`);
        return;
      }
    } else {
      const { eventId, deviceId, title, body, type, severity, data: extra } = data;
      notification = {
        eventId,
        deviceId,
        type:     type     || 'system',
        severity: severity || 'info',
        title,
        body,
        data:     extra || {},
      };
    }

    if (!notification.deviceId || !notification.title || !notification.body) {
      console.error('MQTT: missing required fields (deviceId, title, body)');
      return;
    }

    try {
      await notificationService.notify(notification);
    } catch (err) {
      console.error(`MQTT: failed to process notification for device ${notification.deviceId}:`, err.message);
    }
  });
}
