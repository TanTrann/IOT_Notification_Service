import jwt from 'jsonwebtoken';

export function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Token có thể mang 1 thiết bị (deviceId) hoặc nhiều (deviceIds: [...]).
    // Chuẩn hoá về mảng để phần dưới luôn xử lý đồng nhất; giữ tương thích token cũ.
    const single = decoded.deviceId || decoded.sub || decoded.id;
    req.deviceIds = (Array.isArray(decoded.deviceIds) ? decoded.deviceIds : [single]).filter(Boolean);
    if (!req.deviceIds.length) {
      return res.status(401).json({ success: false, message: 'Token missing deviceId(s)' });
    }
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

