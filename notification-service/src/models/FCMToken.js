import mongoose, { Schema } from 'mongoose';

const fcmTokenSchema = new Schema({
  userId:    { type: String, required: true },
  token:     { type: String, required: true, unique: true },
  device:    { type: String, enum: ['web', 'android', 'ios'], default: 'web' },
  createdAt: { type: Date, default: Date.now }
});

fcmTokenSchema.index({ userId: 1 });

export default mongoose.model('FCMToken', fcmTokenSchema);
