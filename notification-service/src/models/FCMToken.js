import mongoose, { Schema } from 'mongoose';

const fcmTokenSchema = new Schema(
  {
    userId: { type: String, required: true },   // userId tài khoản bên Phong
    token:  { type: String, required: true, unique: true },
    device: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
    // JWT của người dùng lúc đăng ký — dùng để hỏi lại Phong quyền xem cây mỗi lần gửi push.
    // NHẠY CẢM: không select mặc định, không trả ra API, không ghi log.
    jwt:       { type: String, select: false },
    expiresAt: { type: Date },                  // = exp của JWT; hết hạn thì ngừng nhận push
  },
  { timestamps: true }
);

fcmTokenSchema.index({ userId: 1 });
fcmTokenSchema.index({ expiresAt: 1 });

export default mongoose.model('FCMToken', fcmTokenSchema);
