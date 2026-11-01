import mongoose, { Schema } from 'mongoose';

const notificationSchema = new Schema(
  {
    eventId:  { type: String, unique: true, sparse: true },
    deviceId: { type: String, required: true },
    event:    { type: String },
    title:    { type: String, required: true },
    body:     { type: String, required: true },
    type:     { type: String, enum: ['disease', 'water', 'nutrition', 'light', 'temperature', 'system'] },
    severity: { type: String, enum: ['critical', 'warning', 'info'], default: 'info' },
    data:     { type: Schema.Types.Mixed },
    // Danh sách userId (tài khoản bên Phong) đã đọc — "đã đọc" tính riêng từng người.
    readBy:   { type: [String], default: [] },
  },
  { timestamps: true }
);

notificationSchema.index({ deviceId: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
