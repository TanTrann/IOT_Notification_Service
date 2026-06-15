import mongoose, { Schema } from 'mongoose';

const notificationSchema = new Schema(
  {
    deviceId:   { type: String, required: true },
    title:    { type: String, required: true },
    body:     { type: String, required: true },
    type:     { type: String, enum: ['disease', 'water', 'nutrition', 'light', 'system'] },
    severity: { type: String, enum: ['critical', 'warning', 'info'], default: 'info' },
    data:     { type: Schema.Types.Mixed },
    isRead:   { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ deviceId: 1, createdAt: -1 });
notificationSchema.index({ deviceId: 1, isRead: 1 });

export default mongoose.model('Notification', notificationSchema);
