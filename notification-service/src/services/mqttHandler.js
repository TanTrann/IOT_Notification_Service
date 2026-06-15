import { connectMQTT } from '../config/mqtt.js';
import notificationService from './notificationService.js';

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

    const { deviceId, title, body, type, severity, data: extra } = data;
    if (!deviceId || !title || !body) {
      console.error('MQTT: missing required fields (deviceId, title, body)');
      return;
    }

    try {
      await notificationService.notify({
        deviceId,
        type:     type     || 'system',
        severity: severity || 'info',
        title,
        body,
        data:     extra || {},
      });
    } catch (err) {
      console.error(`MQTT: failed to process notification for user ${deviceId}:`, err.message);
    }
  });
}
