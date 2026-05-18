import mongoose, { Schema } from 'mongoose';

const notificationSchema = new Schema({
  userId:    { type: String, required: true },
  title:     { type: String, required: true },
  body:      { type: String, required: true },
  type:      { type: String, enum: ['disease', 'water', 'nutrition', 'light', 'system'] },
  severity:  { type: String, enum: ['critical', 'warning', 'info'], default: 'info' },
  data:      { type: Object },
  isRead:    { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, isRead: 1 });

export default mongoose.model('Notification', notificationSchema);
