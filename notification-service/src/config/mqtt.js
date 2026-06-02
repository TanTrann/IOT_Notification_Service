import mqtt from 'mqtt';

let _client = null;

export function connectMQTT() {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  if (!brokerUrl) {
    console.warn('WARNING: MQTT_BROKER_URL not set — MQTT listener will not start');
    return null;
  }

  const options = {
    clientId: process.env.MQTT_CLIENT_ID || 'iot-notification-service',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
  };

  _client = mqtt.connect(brokerUrl, options);

  _client.on('connect', () => console.log(`MQTT connected to ${brokerUrl}`));
  _client.on('reconnect', () => console.log('MQTT reconnecting...'));
  _client.on('error', err => console.error('MQTT error:', err.message));
  _client.on('offline', () => console.warn('MQTT offline'));

  return _client;
}

export function getMQTTClient() {
  return _client;
}
