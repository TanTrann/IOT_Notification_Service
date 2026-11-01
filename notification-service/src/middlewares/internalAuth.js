// Bảo vệ /internal/notify — dành cho server .NET của Phong (server-to-server) chứ KHÔNG phải
// người dùng cuối, nên dùng API key thay vì JWT. Key nhận qua header `x-api-key`.
// Người dùng (web quản lý) xác thực bằng JWT của Phong — xem userAuth.js.
export function internalAuth(req, res, next) {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    return res.status(503).json({ success: false, message: 'INTERNAL_API_KEY chưa được cấu hình trên server' });
  }

  const got = req.headers['x-api-key'];
  if (got !== expected) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }
  next();
}
