import { messaging } from '../config/firebase.js';
import FCMToken from '../models/FCMToken.js';

class FCMService {
  _check() {
    if (!messaging) throw new Error('Firebase not initialized — check your credentials in .env');
  }

  async sendToDevice(token, { title, body, data = {} }) {
    this._check();
    // FCM yêu cầu mọi giá trị trong `data` phải là string → ép kiểu trước khi gửi
    const stringData = Object.fromEntries(
      Object.entries({ ...data, clickAction: '/dashboard' }).map(([k, v]) => [k, String(v)])
    );
    try {
      const response = await messaging.send({
        token,
        notification: { title, body },
        data: stringData,
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

  // Gửi tới mọi token đã đăng ký ĐÚNG deviceId này (targeting theo thiết bị).
  // Mỗi màn hình kiosk đăng ký token kèm deviceId của cây nó đứng cạnh → chỉ nhận tin của cây đó.
  async sendToDeviceId(deviceId, notification) {
    this._check();
    if (!deviceId) return [];
    const tokens = await FCMToken.find({ deviceId }).select('token');
    if (!tokens.length) return [];
    return Promise.allSettled(tokens.map(t => this.sendToDevice(t.token, notification)));
  }

}

export default new FCMService();
