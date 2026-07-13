import { EventEmitter } from 'node:events';

// Hub in-memory cho màn hình rời: giữ N thông báo gần nhất + phát realtime qua SSE.
// KHÔNG lưu DB, KHÔNG biến đổi payload — chỉ chuyển nguyên những gì Phong gửi tới màn hình.
// Màn hình mở sau vẫn thấy "trạng thái hiện tại" nhờ đọc lịch sử gần nhất trong RAM.
// (Service restart thì mất lịch sử — chấp nhận được với màn hình hiển thị trạng thái sống.)
const MAX_RECENT = 50;

const recent = [];               // mới nhất đứng đầu
const emitter = new EventEmitter();
emitter.setMaxListeners(0);      // mỗi màn hình mở = 1 listener → bỏ giới hạn mặc định

// Nhận payload NGUYÊN từ Phong, bọc thêm mốc thời gian server đã nhận (không đụng payload gốc).
export function publish(payload) {
  const entry = { payload, receivedAt: new Date().toISOString() };
  recent.unshift(entry);
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT;
  emitter.emit('message', entry);
  return entry;
}

export function getRecent() {
  return recent;
}

export function subscribe(listener) {
  emitter.on('message', listener);
  return () => emitter.off('message', listener);   // hàm hủy đăng ký
}
