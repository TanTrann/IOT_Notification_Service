import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not defined in .env — MongoDB is required to store notifications and FCM tokens.');
  }

  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
  mongoose.connection.on('error', err => console.error('MongoDB error:', err.message || err));

  // Bắt buộc kết nối MongoDB thành công trước khi server hoạt động
  await mongoose.connect(uri);
  console.log('MongoDB connected successfully:', mongoose.connection.host);
}
