import 'dotenv/config';
import './config/firebase.js'; // khởi tạo Firebase Admin sớm
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import mongoose from 'mongoose';
import notificationRoutes from './routes/notificationRoutes.js';

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`Origin ${origin} not allowed by CORS`));
  }
}));
app.use(compression());
app.use(express.json());
app.use(morgan('dev'));

app.use('/api/v1/notifications', notificationRoutes);

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Notification Service is running' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

const PORT = process.env.PORT || 3001;
const MONGODB_URI = process.env.MONGODB_URI;

async function start() {
  if (MONGODB_URI) {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB connected');
  } else {
    console.warn('WARNING: MONGODB_URI not set — DB-dependent routes will not work');
  }
  app.listen(PORT, () => console.log(`Notification Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
