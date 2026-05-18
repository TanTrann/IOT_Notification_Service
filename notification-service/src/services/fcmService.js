import { messaging } from '../config/firebase.js';
import FCMToken from '../models/FCMToken.js';

class FCMService {
  _check() {
    if (!messaging) throw new Error('Firebase not initialized — check your credentials in .env');
  }

  async sendToDevice(token, { title, body, data = {} }) {
    this._check();
    const message = {
      token,
      notification: { title, body },
      data: { ...data, clickAction: '/dashboard' },
      webpush: {
        notification: {
          title,
          body,
          icon: '/logo.png',
          badge: '/badge.png',
          vibrate: [200, 100, 200],
        },
        fcmOptions: { link: '/dashboard' }
      }
    };

    try {
      const response = await messaging.send(message);
      return { success: true, messageId: response };
    } catch (error) {
      if (error.code === 'messaging/registration-token-not-registered') {
        await FCMToken.deleteOne({ token });
      }
      return { success: false, error: error.message };
    }
  }

  async sendToUser(userId, notification) {
    this._check();
    const tokens = await FCMToken.find({ userId }).select('token');
    if (!tokens.length) return [];

    const results = await Promise.allSettled(
      tokens.map(t => this.sendToDevice(t.token, notification))
    );
    return results;
  }

  async sendToTopic(topic, { title, body, data = {} }) {
    this._check();
    return messaging.send({
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      topic
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

  async sendToAll(notification) {
    this._check();
    const allTokens = await FCMToken.find().select('token');
    if (!allTokens.length) return null;

    return messaging.sendEachForMulticast({
      notification: { title: notification.title, body: notification.body },
      tokens: allTokens.map(t => t.token),
    });
  }
}

export default new FCMService();
