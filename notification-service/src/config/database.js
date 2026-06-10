import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('WARNING: MONGODB_URI not set — DB routes will not work');
    return;
  }

  mongoose.connection.on('disconnected', () => console.warn('MongoDB disconnected'));
  mongoose.connection.on('error', err => console.error('MongoDB error:', err));

  await mongoose.connect(uri);
  console.log('MongoDB connected:', mongoose.connection.host);
}
