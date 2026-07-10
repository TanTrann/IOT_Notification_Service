import mongoose, { Schema } from 'mongoose';

// User của website (stand-in cho identity backend ở production).
// deviceIds: danh sách thiết bị user sở hữu → được nhét vào JWT khi đăng nhập.
const userSchema = new Schema(
  {
    username:     { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    deviceIds:    { type: [String], default: [] },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
