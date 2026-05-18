import jwt from 'jsonwebtoken';

export function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId || decoded.sub || decoded.id;
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

export function internalAuth(req, res, next) {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized: invalid internal API key' });
  }
  next();
}
