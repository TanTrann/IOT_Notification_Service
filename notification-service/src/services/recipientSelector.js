// Chọn FCM token nhận push cho 1 sự kiện của deviceId — hỏi lại quyền NGAY LÚC GỬI qua resolveAccess
// (server Phong, có cache), không dùng ảnh chụp quyền cũ: thu hồi / thêm share có hiệu lực trong vòng TTL cache.
// Gom theo jwt: nhiều token (nhiều trình duyệt) chung 1 JWT chỉ hỏi Phong 1 lần.
// unauthorized (phiên chết) và unavailable (Phong lỗi) → KHÔNG gửi (đóng an toàn).
export async function selectRecipients(tokens, deviceId, resolveAccess) {
  const byJwt = new Map();
  for (const t of tokens) {
    if (!t.jwt) continue;
    if (!byJwt.has(t.jwt)) byJwt.set(t.jwt, []);
    byJwt.get(t.jwt).push(t.token);
  }

  const groups = await Promise.all(
    [...byJwt].map(async ([jwt, list]) => {
      const access = await resolveAccess(jwt);
      if (access.status === 'unavailable') {
        console.warn(`Không hỏi được quyền từ server Phong — bỏ qua ${list.length} token cho ${deviceId}`);
      }
      return access.status === 'ok' && access.deviceIds.has(deviceId) ? list : [];
    })
  );
  return groups.flat();
}
