import mongoose, { Schema } from 'mongoose';

const fcmTokenSchema = new Schema(
  {
    // Danh sách thiết bị mà token (browser/app) này nhận push cho — 1 user có thể nhiều thiết bị.
    deviceIds: { type: [String], required: true },
    token:  { type: String, required: true, unique: true },
    device: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
  },
  { timestamps: true }
);

// Index để push nhanh: tìm mọi token có chứa deviceId của sự kiện.
fcmTokenSchema.index({ deviceIds: 1 });

export default mongoose.model('FCMToken', fcmTokenSchema);
