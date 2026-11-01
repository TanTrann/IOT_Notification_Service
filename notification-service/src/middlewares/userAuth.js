import { resolveAccess as defaultResolveAccess } from '../services/plantAccess.js';

// Bảo vệ /api/v1/* — dành cho NGƯỜI DÙNG (web quản lý), xác thực bằng JWT đăng nhập bên server Phong.
// Header: Authorization: Bearer <JWT>. Quyền xem cây lấy từ Phong (xem services/plantAccess.js).
// Gắn req.user = { userId, email, exp, devices, deviceIds } và req.jwt (dùng khi đăng ký FCM token).
export function createUserAuth(resolveAccess) {
  return async function userAuth(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (!match) {
      return res.status(401).json({ success: false, message: 'Thiếu Authorization: Bearer <JWT>' });
    }

    const jwt = match[1].trim();
    try {
      const access = await resolveAccess(jwt);
      if (access.status === 'unauthorized') {
        return res.status(401).json({ success: false, message: 'JWT không hợp lệ hoặc đã hết hạn' });
      }
      if (access.status !== 'ok') {
        return res.status(503).json({ success: false, message: 'Không xác thực được với server Phong' });
      }

      const { status: _status, ...user } = access;
      req.user = user;
      req.jwt = jwt;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const userAuth = createUserAuth(defaultResolveAccess);
