import { Router } from 'express';

import { internalAuth } from '../middlewares/internalAuth.js';
import { publish, getRecent, subscribe } from '../services/displayHub.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();

// MCP server của Phong gọi vào đây để đẩy thông báo.
// Nhận NGUYÊN payload JSON (bất kỳ dạng nào) — không ép kiểu, không biến đổi.
router.post('/notify', internalAuth, asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
    return res.status(400).json({ success: false, message: 'Body phải là một JSON object' });
  }
  const entry = publish(req.body);
  res.status(201).json({ success: true, receivedAt: entry.receivedAt });
}));

// Màn hình rời kết nối vào đây (Server-Sent Events).
// Khi mở: nhận ngay các thông báo gần nhất (event: history),
// sau đó mỗi thông báo mới Phong gửi được đẩy realtime (event: notification).
router.get('/display/stream', internalAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection:      'keep-alive',
  });
  res.write('retry: 3000\n\n');   // browser tự reconnect sau 3s nếu rớt

  res.write(`event: history\ndata: ${JSON.stringify(getRecent())}\n\n`);

  const unsubscribe = subscribe(entry => {
    res.write(`event: notification\ndata: ${JSON.stringify(entry)}\n\n`);
  });

  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);   // giữ kết nối sống

  req.on('close', () => {
    clearInterval(ping);
    unsubscribe();
  });
});

export default router;
