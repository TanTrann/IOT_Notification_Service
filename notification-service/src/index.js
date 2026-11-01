import 'dotenv/config';
import './config/firebase.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import notificationRoutes from './routes/notificationRoutes.js';
import internalRoutes from './routes/internalRoutes.js';
import userRoutes from './routes/userRoutes.js';
import { connectDB } from './config/database.js';

const app = express();
const isProd = process.env.NODE_ENV === 'production';

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true,
  optionsSuccessStatus: 200,
}));
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(compression());
app.use(express.json());
app.use(morgan(isProd ? 'combined' : 'dev'));

app.use('/api/v1/notifications', notificationRoutes);   // người dùng đọc lịch sử — auth Bearer JWT của Phong
app.use('/api/v1', userRoutes);                         // /me + đăng ký/hủy FCM token — auth Bearer JWT của Phong
app.use('/internal', internalRoutes);                   // server Phong POST /internal/notify — auth API key

app.get('/health', (_req, res) => res.json({ status: 'ok', message: 'Notification Service is running' }));

app.use((err, _req, res, _next) => {
  console.error(err.stack);
  res.status(err.status ?? 500).json({
    success: false,
    message: isProd ? 'Internal Server Error' : err.message,
  });
});

const PORT = process.env.PORT || 3001;

async function start() {
  await connectDB();
  app.listen(PORT, () => console.log(`Notification Service running on port ${PORT}`));
}

start().catch(err => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
