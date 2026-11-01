// Tra quyền người dùng bằng server .NET của Phong — nguồn sự thật DUY NHẤT về "ai được xem cây nào".
// Gọi GET {PLANT_API_URL}/api/devices bằng chính JWT của người dùng: Phong trả 200 nghĩa là token hợp lệ
// (Phong đã kiểm chữ ký) và kèm luôn danh sách cây người đó sở hữu HOẶC được share.
// Notify KHÔNG cần JWT_SECRET của Phong — chỉ decode payload (không verify) để lấy userId/email/exp.
// Dùng chung cho middleware REST (userAuth) và bước chọn người nhận push (recipientSelector).

const NAMEID_URI = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier';
const EMAIL_URI = 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress';

export function decodeJwtPayload(jwt) {
  const part = typeof jwt === 'string' ? jwt.split('.')[1] : undefined;
  if (!part || jwt.split('.').length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function userIdOf(payload) {
  return payload?.nameid ?? payload?.[NAMEID_URI] ?? payload?.sub;
}

// Kết quả: { status: 'ok', userId, email, exp, devices, deviceIds } | { status: 'unauthorized' } | { status: 'unavailable' }.
// Cache theo chuỗi jwt trong ttlSeconds — CHỈ cache 'ok' (token rác không chiếm chỗ trong cache).
// Cache có giới hạn (maxEntries) và tự dọn mục hết hạn để không phình bộ nhớ.
// Phong không trả lời trong timeoutMs → 'unavailable' (không để request / /internal/notify treo theo).
export function createAccessResolver({
  baseUrl, ttlSeconds, timeoutMs = 3000, maxEntries = 5000, fetchImpl = fetch, now = Date.now,
}) {
  const cache = new Map();
  const ttlMs = ttlSeconds * 1000;

  function remember(jwt, value) {
    const t = now();
    for (const [k, e] of cache) if (e.expiresAt <= t) cache.delete(k);
    cache.delete(jwt);
    // Map giữ thứ tự chèn → mục đầu là cũ nhất
    while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
    cache.set(jwt, { value, expiresAt: t + ttlMs });
  }

  async function lookup(jwt) {
    // JWT không đọc được / thiếu userId → từ chối ngay, khỏi gọi Phong.
    const payload = decodeJwtPayload(jwt);
    const userId = userIdOf(payload);
    if (!userId) return { status: 'unauthorized' };
    if (!baseUrl) return { status: 'unavailable' };

    let res;
    try {
      res = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/api/devices`, {
        headers: { Authorization: `Bearer ${jwt}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { status: 'unavailable' };
    }
    if (res.status === 401 || res.status === 403) return { status: 'unauthorized' };
    if (!res.ok) return { status: 'unavailable' };

    const list = await res.json().catch(() => null);
    if (!Array.isArray(list)) return { status: 'unavailable' };

    const devices = list.map(d => ({ deviceId: String(d.deviceId), name: d.name || String(d.deviceId) }));
    return {
      status: 'ok',
      userId: String(userId),
      email: payload.email ?? payload[EMAIL_URI] ?? '',
      exp: typeof payload.exp === 'number' ? payload.exp : null,
      devices,
      deviceIds: new Set(devices.map(d => d.deviceId)),
    };
  }

  async function resolveAccess(jwt) {
    const hit = cache.get(jwt);
    if (hit && hit.expiresAt > now()) return hit.value;

    const value = await lookup(jwt);
    if (value.status === 'ok') remember(jwt, value);
    else cache.delete(jwt);
    return value;
  }
  resolveAccess.cacheSize = () => cache.size;
  return resolveAccess;
}

// Resolver mặc định theo .env — dựng lười ở lần gọi đầu (để dotenv kịp nạp trước).
let _default = null;
export function resolveAccess(jwt) {
  if (!_default) {
    _default = createAccessResolver({
      baseUrl: process.env.PLANT_API_URL,
      ttlSeconds: Number(process.env.AUTH_CACHE_SECONDS) || 60,
    });
  }
  return _default(jwt);
}
