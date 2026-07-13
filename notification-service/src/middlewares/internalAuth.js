// Bảo vệ các endpoint /internal/* — dành cho service nội bộ (MCP server của Phong
// và màn hình rời) chứ KHÔNG phải người dùng cuối, nên dùng API key thay vì JWT.
// Key nhận qua header `x-api-key`, hoặc query `?key=` (EventSource không set được header).
export function internalAuth(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    return res.status(503).json({ success: false, message: 'INTERNAL_API_KEY chưa được cấu hình trên server' });
  }

  const got = req.headers['x-api-key'] || req.query.key;
  if (got !== expected) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }
  next();
}
