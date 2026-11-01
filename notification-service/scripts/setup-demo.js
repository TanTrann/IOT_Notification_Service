// Tạo nhanh dữ liệu demo bên server Phong: 1 tài khoản + 1 cây thuộc tài khoản đó.
// Dùng để test trang notification-web mà không cần gõ curl.
//
//   node scripts/setup-demo.js <email> <mật khẩu> [deviceId] [tên cây]
//   vd: node scripts/setup-demo.js tan@test.local 123456 ESP32S3_Zone1 "Cây Zone 1"
//
// Chạy lại nhiều lần không sao: tài khoản/cây đã có thì bỏ qua.
// Đọc PLANT_API_URL từ .env (mặc định http://localhost:8000).
import 'dotenv/config';

const PHONG = (process.env.PLANT_API_URL || 'http://localhost:8000').replace(/\/+$/, '');
const [email, password, deviceId = process.env.DEFAULT_DEVICE_ID || 'ESP32S3_Zone1', name = 'Cây demo'] = process.argv.slice(2);

if (!email || !password) {
  console.log('Cách dùng: node scripts/setup-demo.js <email> <mật khẩu (>= 6 ký tự)> [deviceId] [tên cây]');
  process.exit(1);
}

async function call(method, path, body, token) {
  const r = await fetch(`${PHONG}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { status: r.status, text };
}

try {
  const reg = await call('POST', '/api/auth/register', { email, password, displayName: email.split('@')[0] });
  if (reg.status === 200) console.log(`✓ Đã tạo tài khoản ${email}`);
  else if (reg.status === 409) console.log(`• Tài khoản ${email} đã có — dùng lại`);
  else throw new Error(`Tạo tài khoản lỗi (HTTP ${reg.status}): ${reg.text}`);

  const login = await call('POST', '/api/auth/login', { email, password });
  if (login.status !== 200) throw new Error(`Đăng nhập lỗi (HTTP ${login.status}) — sai mật khẩu?`);
  const { token } = JSON.parse(login.text);

  const dev = await call('POST', '/api/devices/register', { deviceId, name }, token);
  if (dev.status === 201) {
    console.log(`✓ Đã tạo cây "${name}" (deviceId=${deviceId}) thuộc ${email}`);
  } else if (dev.status === 409) {
    // Cây đã tồn tại: của mình rồi, hoặc cây cũ chưa có chủ → thử nhận (claim).
    const mine = await call('GET', `/api/devices/${encodeURIComponent(deviceId)}`, null, token);
    if (mine.status === 200) {
      console.log(`• Cây ${deviceId} đã thuộc ${email} — dùng lại`);
    } else {
      const claim = await call('POST', `/api/devices/${encodeURIComponent(deviceId)}/claim`, null, token);
      if (claim.status >= 200 && claim.status < 300) console.log(`✓ Đã nhận cây ${deviceId} về ${email}`);
      else throw new Error(`Cây ${deviceId} đang thuộc tài khoản khác. Chạy lại với deviceId khác, vd: CAY_DEMO_1`);
    }
  } else {
    throw new Error(`Tạo cây lỗi (HTTP ${dev.status}): ${dev.text}`);
  }

  console.log(`\nXong. Mở http://localhost:3003, đăng nhập ${email}.`);
  console.log(`Bắn thử sự kiện: node scripts/publish-test.js water.empty ${deviceId}`);
} catch (err) {
  console.error('✗', err.message === 'fetch failed' ? `Không kết nối được server Phong ở ${PHONG} — đã chạy chưa?` : err.message);
  process.exitCode = 1; // không dùng process.exit(): Node trên Windows có thể crash khi fetch còn mở kết nối
}
