import { messaging } from '../config/firebase.js';
import FCMToken from '../models/FCMToken.js';

class FCMService {
  _check() {
    if (!messaging) throw new Error('Firebase not initialized — check your credentials in .env');
  }

  async sendToDevice(token, { title, body, data = {} }) {
    this._check();
    try {
      const response = await messaging.send({
        token,
        notification: { title, body },
        data: { ...data, clickAction: '/dashboard' },
        webpush: {
          notification: { title, body, icon: '/logo.png', badge: '/badge.png', vibrate: [200, 100, 200] },
          fcmOptions: { link: '/dashboard' },
        },
      });
      return { success: true, messageId: response };
    } catch (error) {
      if (error.code === 'messaging/registration-token-not-registered') {
        await FCMToken.deleteOne({ token });
      }
      return { success: false, error: error.message };
    }
  }

  async sendToUser(deviceId, notification) {
    this._check();
    const tokens = await FCMToken.find({ deviceId }).select('token');
    if (!tokens.length) return [];
    return Promise.allSettled(tokens.map(t => this.sendToDevice(t.token, notification)));
  }

  async sendToTopic(topic, { title, body, data = {} }) {
    this._check();
    return messaging.send({
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      topic,
    });
  }

  async subscribeToTopic(token, topic) {
    this._check();
    return messaging.subscribeToTopic(token, topic);
  }

  async unsubscribeFromTopic(token, topic) {
    this._check();
    return messaging.unsubscribeFromTopic(token, topic);
  }
}

export default new FCMService();
