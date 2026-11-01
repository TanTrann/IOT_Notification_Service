// Phạm vi cây cho 1 request: không truyền ?deviceId → mọi cây người dùng có quyền;
// truyền deviceId thuộc quyền → chỉ cây đó; ngoài quyền → { forbidden: true } (controller trả 403).
export function deviceScope(user, deviceId) {
  if (!deviceId) return { deviceIds: [...user.deviceIds] };
  const id = String(deviceId);
  return user.deviceIds.has(id) ? { deviceIds: [id] } : { forbidden: true };
}
