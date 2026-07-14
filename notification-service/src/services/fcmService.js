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

  // Gửi tới TẤT CẢ token đã đăng ký (mô hình "1 topic notification" — ai cũng nhận).
  async sendToAll(notification) {
    this._check();
    const tokens = await FCMToken.find().select('token');
    if (!tokens.length) return [];
    return Promise.allSettled(tokens.map(t => this.sendToDevice(t.token, notification)));
  }

}

export default new FCMService();
