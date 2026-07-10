import mongoose, { Schema } from 'mongoose';

const fcmTokenSchema = new Schema(
  {
    deviceId: { type: String, required: true },
    token:  { type: String, required: true, unique: true },
    device: { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
  },
  { timestamps: true }
);

fcmTokenSchema.index({ deviceId: 1 });

export default mongoose.model('FCMToken', fcmTokenSchema);
