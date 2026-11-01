import { messaging } from '../config/firebase.js';
import FCMToken from '../models/FCMToken.js';

class FCMService {
  async sendToDevice(token, { title, body, data = {} }) {
    // FCM yêu cầu mọi giá trị trong `data` phải là string → ép kiểu trước khi gửi
    const stringData = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    try {
      const response = await messaging.send({
        token,
        notification: { title, body },
        data: stringData,
        webpush: {
          notification: { title, body, icon: '/logo.png', badge: '/badge.png', vibrate: [200, 100, 200] },
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

  // Gửi song song tới danh sách token đã được chọn (xem recipientSelector — kiểm quyền theo người dùng).
  // Chưa cấu hình Firebase → không gửi gì (trả []), KHÔNG ném lỗi để /internal/notify vẫn lưu lịch sử.
  async sendToTokens(tokens, notification) {
    if (!tokens.length) return [];
    if (!messaging) {
      console.warn('Firebase chưa khởi tạo — bỏ qua push (kiểm tra credentials trong .env)');
      return [];
    }
    return Promise.allSettled(tokens.map(t => this.sendToDevice(t, notification)));
  }
}

export default new FCMService();
