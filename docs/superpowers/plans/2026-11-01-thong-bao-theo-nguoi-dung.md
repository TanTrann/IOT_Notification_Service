# Thông báo theo người dùng — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notify xác thực người dùng bằng JWT của server Phong, trả thông báo theo quyền cây của từng người, đẩy push theo người dùng (kiểm quyền lại lúc gửi), và trang test giả lập web của team Frontend.

**Architecture:** Một module `plantAccess` gọi `GET {PLANT_API_URL}/api/devices` bằng JWT của người dùng (cache 60s) — là nguồn quyền duy nhất cho cả middleware REST lẫn bước chọn người nhận push. `Notification.readBy` thay `isRead`; `FCMToken` gắn `userId` + `jwt` + `expiresAt`. `/internal/notify` giữ nguyên hợp đồng.

**Tech Stack:** Node 25 (ESM, `fetch` + `node:test` có sẵn), Express 4, Mongoose 8, firebase-admin 12; web test = HTML thuần + Firebase JS compat 10.12.

**Spec:** `docs/superpowers/specs/2026-11-01-thong-bao-theo-nguoi-dung-design.md`

## Global Constraints

- **KHÔNG commit** — người dùng xem lại trước. Bỏ mọi bước commit.
- Không sửa code `plant-tree-iot`. Không dùng / không cần `JWT_SECRET` của Phong.
- `POST /internal/notify`: giữ nguyên body, header `x-api-key`, phản hồi `202 { success, deviceId, event, title, body, recipients }`.
- `INTERNAL_API_KEY` chỉ còn mở `/internal/notify`; `/api/v1/*` chỉ nhận `Authorization: Bearer <JWT Phong>`.
- Env mới: `PLANT_API_URL` (bắt buộc cho `/api/v1/*`), `AUTH_CACHE_SECONDS` (mặc định `60`).
- userId lấy từ claim `nameid`, fallback `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`.
- Field `jwt` của FCMToken: `select: false`, không trả ra API, không log.
- Một Firebase project `smartfarmai-f1426`; message chỉ cần `webpush`, bỏ link `/dashboard`.
- Comment/thông báo lỗi viết tiếng Việt như code hiện có.

## Review Focus

1. Phong tắt / sai `PLANT_API_URL` → REST trả 503 (không phải 500/401), push không gửi cho ai (đóng an toàn), `/internal/notify` vẫn 202 và vẫn lưu lịch sử.
2. `?deviceId=` của cây không thuộc quyền trên mọi route đọc/ghi → 403, không rò dữ liệu.
3. Hai người cùng xem một cây: A đánh dấu đọc không làm đổi `isRead` của B.
4. JWT hỏng định dạng (không đủ 3 phần, base64 lỗi) mà Phong vẫn trả 200 (không xảy ra thực tế nhưng phải không crash) → 401.
5. Cùng một FCM token đăng ký lại bởi người khác (máy dùng chung) → token chuyển chủ, người cũ không còn nhận.

---

### Task 1: Module quyền `plantAccess` + test runner

**Files:**
- Create: `notification-service/src/services/plantAccess.js`
- Create: `notification-service/test/plantAccess.test.js`
- Modify: `notification-service/package.json` (thêm `"test": "node --test test/"`)

**Interfaces:**
- Produces:
  - `decodeJwtPayload(jwt: string) -> object | null` (base64url decode phần 2, lỗi → `null`)
  - `createAccessResolver({ baseUrl: string|undefined, ttlSeconds: number, fetchImpl = fetch, now = Date.now }) -> resolveAccess`
  - `resolveAccess(jwt) -> Promise<{ status: 'ok', userId, email, exp: number|null, devices: [{deviceId,name}], deviceIds: Set<string> } | { status: 'unauthorized' } | { status: 'unavailable' }>`
  - `export const resolveAccess` mặc định dựng từ `process.env.PLANT_API_URL` / `AUTH_CACHE_SECONDS` (đọc env lúc gọi lần đầu, không lúc import — để dotenv kịp nạp).
- Cache: chỉ cache kết quả `ok` và `unauthorized`, theo khóa = chuỗi jwt, hết hạn sau `ttlSeconds`. `unavailable` không cache.

- [ ] **Step 1: Viết test** (`node:test` + `assert/strict`, fetch giả trả `{ ok, status, json() }`):
  - `decodeJwtPayload` đọc được `{ nameid: 'u1', email: 'a@x', exp: 123 }` từ token tự dựng; trả `null` cho `'abc'` và `'a.%%%.c'`.
  - 200 + mảng `[{ deviceId:'D1', name:'Cây 1', ownerId:'u1' }]` → `status 'ok'`, `userId 'u1'`, `deviceIds.has('D1')`, `devices` chỉ có `{deviceId,name}`.
  - Claim URI nameidentifier cũng ra `userId`.
  - 401 và 403 → `unauthorized`; 500 và fetch ném lỗi → `unavailable`; `baseUrl` undefined → `unavailable`, không gọi fetch.
  - 200 nhưng payload không decode được / thiếu userId → `unauthorized` (Review Focus #4).
  - Gọi 2 lần trong TTL → fetch gọi 1 lần; tăng `now` quá TTL → gọi lại. `unavailable` không cache.
  - fetch nhận URL `${baseUrl}/api/devices` (bỏ `/` cuối baseUrl) và header `Authorization: Bearer <jwt>`.
- [ ] **Step 2:** `npm test` → FAIL (module chưa có).
- [ ] **Step 3:** Cài đặt `plantAccess.js` theo Interfaces.
- [ ] **Step 4:** `npm test` → PASS.

### Task 2: Middleware `userAuth` + model + REST `/api/v1/*`

**Files:**
- Create: `notification-service/src/middlewares/userAuth.js`
- Create: `notification-service/test/userAuth.test.js`
- Modify: `src/models/Notification.js`, `src/models/FCMToken.js`, `src/services/notificationService.js`, `src/controllers/notificationController.js`, `src/routes/notificationRoutes.js`, `src/routes/internalRoutes.js` (gỡ `/push/token`), `src/index.js`
- Create: `src/routes/meRoutes.js`, `src/routes/pushRoutes.js` (hoặc gộp — tuỳ, giữ mỗi file một trách nhiệm)

**Interfaces:**
- Consumes: `resolveAccess` (Task 1).
- Produces:
  - `createUserAuth(resolveAccess) -> express middleware`; `export const userAuth = createUserAuth(defaultResolveAccess)`. Gắn `req.user = { userId, email, exp, devices, deviceIds }`, `req.jwt = <chuỗi token>`. Thiếu/không phải Bearer hoặc `unauthorized` → `401 { success:false, message }`; `unavailable` → `503 { success:false, message:'Không xác thực được với server Phong' }`.
  - `Notification`: bỏ `isRead` + index `{deviceId,isRead}`; thêm `readBy: { type:[String], default:[] }`.
  - `FCMToken`: `{ userId: String required, token unique, device enum web|android|ios, jwt: { type:String, select:false }, expiresAt: Date }`; index `{userId:1}`, `{expiresAt:1}`.
  - `notificationService`:
    - `list(userId, deviceIds: string[], { unread: boolean, page, limit }) -> { items, unreadCount, page, limit, hasMore }` — `items[i]` là object thường có `isRead` tính theo `readBy.includes(userId)`, đã xoá `readBy`.
    - `unreadCount(userId, deviceIds) -> number`
    - `markRead(id, userId, deviceIds) -> item | null`
    - `markAllRead(userId, deviceIds) -> void`
    - Lọc "chưa đọc" = `{ deviceId: {$in}, readBy: { $ne: userId } }`.
  - Routes (đều qua `userAuth`):
    - `GET /api/v1/me` → `{ success, userId, email, devices }`
    - `GET /api/v1/notifications` (`deviceId?`, `unread=true`, `page=1`, `limit=20`, limit tối đa 100)
    - `GET /api/v1/notifications/unread-count`, `PATCH /api/v1/notifications/read-all`, `PATCH /api/v1/notifications/:id/read`
    - `POST /api/v1/push/token { token, device? }` → upsert theo `token`: `{ userId, device, jwt: req.jwt, expiresAt: req.user.exp ? new Date(exp*1000) : null }`
    - `DELETE /api/v1/push/token { token }` → `deleteOne({ token, userId })`
  - Helper phạm vi cây trong controller: `?deviceId` có và không thuộc `req.user.deviceIds` → `403`; có và thuộc → `[deviceId]`; không có → toàn bộ `deviceIds`. Áp cho cả 4 route notifications (Review Focus #2). `:id` không tồn tại / ngoài quyền → 404. `:id` không phải ObjectId hợp lệ → 404 (không để CastError thành 500).

- [ ] **Step 1: Viết test `userAuth.test.js`** với resolver giả + `req/res` giả: thiếu header → 401; `Basic x` → 401; resolver `unauthorized` → 401; `unavailable` → 503; `ok` → `next()` được gọi, `req.user.userId` và `req.jwt` đúng.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Cài `userAuth.js`; sửa model, service, controller, routes; `index.js` mount `/api/v1/me`, `/api/v1/notifications`, `/api/v1/push`; gỡ `/internal/push/token`.
- [ ] **Step 4:** `npm test` → PASS; `node --check` từng file sửa đổi không lỗi.

### Task 3: Chọn người nhận push lúc gửi

**Files:**
- Create: `notification-service/src/services/recipientSelector.js`
- Create: `notification-service/test/recipientSelector.test.js`
- Modify: `src/services/notificationService.js` (`ingest`), `src/services/fcmService.js`

**Interfaces:**
- Consumes: `resolveAccess` (Task 1), model `FCMToken` (Task 2).
- Produces:
  - `selectRecipients(tokens: [{ token, jwt }], deviceId: string, resolveAccess) -> Promise<string[]>` — gom theo `jwt` (mỗi jwt resolve 1 lần), giữ token khi `status==='ok' && deviceIds.has(deviceId)`; `unauthorized`/`unavailable` → bỏ (với `unavailable` log `console.warn` không kèm jwt).
  - `fcmService.sendToTokens(tokens: string[], { title, body, data }) -> Promise<PromiseSettledResult[]>`; xoá `sendToDeviceId`. `sendToDevice` bỏ `clickAction:'/dashboard'` và `fcmOptions.link`.
  - `ingest`: lưu lịch sử **trước** (await, lỗi thì log và tiếp tục với `notificationId` rỗng) → `FCMToken.find({ expiresAt: { $gt: new Date() } }).select('+jwt')` → `selectRecipients` → `sendToTokens` với `data` thêm `notificationId`. `_saveHistory` trả `_id` (dùng `findOneAndUpdate(..., { upsert:true, new:true })` cho nhánh eventId). Phản hồi giữ nguyên các key. Không có Firebase (`messaging` null) → vẫn lưu lịch sử, `recipients: 0`, không ném lỗi.

- [ ] **Step 1: Viết test** `selectRecipients`: 3 token, 2 chung jwt A (có D1), 1 jwt B (không có D1) → trả 2 token của A, resolver được gọi đúng 2 lần; jwt `unauthorized` → bị bỏ; jwt `unavailable` → bị bỏ; danh sách rỗng → `[]`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Cài `recipientSelector.js`; sửa `ingest` + `fcmService`.
- [ ] **Step 4:** `npm test` → PASS.

### Task 4: Cấu hình & deploy

**Files:** `notification-service/.env.example`, `docker-compose.yml`, `docker-compose.deploy.yml`, `.env` (local, thêm `PLANT_API_URL=http://localhost:8000` và origin `http://localhost:3003` vào `ALLOWED_ORIGINS`)

- [ ] **Step 1:** `.env.example`: thêm `PLANT_API_URL`, `AUTH_CACHE_SECONDS=60` có chú thích; sửa chú thích `INTERNAL_API_KEY` = chỉ cho `/internal/notify`.
- [ ] **Step 2:** 2 file compose: thêm `PLANT_API_URL: http://host.docker.internal:8080` + `extra_hosts: ["host.docker.internal:host-gateway"]`.
- [ ] **Step 3:** `docker compose -f docker-compose.yml config` nếu có docker; không có thì kiểm YAML bằng mắt.

### Task 5: Trang test `notification-web` (giả lập web team Frontend)

**Files:** Modify `notification-web/index.html`, `notification-web/firebase-messaging-sw.js` (chỉ sửa chú thích "kiosk")

**Interfaces:** Consumes các route Task 2 đúng như spec mục 4.3.

- [ ] **Step 1:** Viết lại `index.html` theo spec mục 6: hằng `PLANT_API_URL`, `NOTIFY_URL` đầu script; màn đăng nhập (POST `${PLANT_API_URL}/api/auth/login`, lưu `{ token, email, displayName }`); thanh trên (chuông + menu Bật nhận push / Đăng xuất); hàng nút lọc (Tất cả · từng cây từ `/api/v1/me` · Chưa đọc); danh sách thẻ bố cục A (giữ style/màu/icon hiện có); bấm thẻ → `PATCH :id/read`; "Đọc tất cả" (theo bộ lọc cây hiện tại); "Xem thêm" (page+1); `onMessage` + `postMessage` từ SW → nạp lại trang 1 + toast + chuông; 401 bất kỳ → xoá phiên, về màn đăng nhập; Đăng xuất → `DELETE /api/v1/push/token` (nếu có token) rồi xoá phiên; đăng nhập xong nếu đã từng bật push (`Notification.permission === 'granted'`) → đăng ký lại token. Bỏ toàn bộ `cfg`/`liveItems`/API key.
- [ ] **Step 2:** Mở bằng `npm run dev` (port 3003) và kiểm tra trong Task 7.

### Task 6: Tài liệu

**Files:** `notification-service/docs/04-tich-hop-web.md` (viết lại cho team Frontend), `02-kien-truc.md`, `03-luong-hoat-dong.md`, `docs/README.md`, `notification-web/README.md`, `BAO_CAO_DU_AN.md`, `HUONG_DAN_SU_KIEN_NOTIFY.md`

- [ ] **Step 1:** `04-tich-hop-web.md`: người đọc = team Frontend. Mục: gói bàn giao (spec mục 5), đăng nhập qua Phong lấy JWT, bảng endpoint + ví dụ `curl` + mẫu response, đăng ký FCM web (config + VAPID + SW, gọi lại sau mỗi lần login, DELETE khi logout), xử lý 401/403/503.
- [ ] **Step 2:** Các file còn lại: thay mô hình "kiosk theo deviceId / API key cho /api/v1" bằng "người dùng theo tài khoản Phong"; giữ nguyên phần `/internal/notify` và template.
- [ ] **Step 3:** `grep -rn "kiosk\|/internal/push/token\|x-api-key" docs ../notification-web ../*.md` → chỉ còn chỗ nói về `/internal/notify` hoặc lịch sử thay đổi.

### Task 7: Kiểm tra end-to-end

- [ ] **Step 1:** `npm test` trong `notification-service` → PASS toàn bộ.
- [ ] **Step 2:** Chạy Phong local (`dotnet run` trong `plant-tree-iot/PlantTreeIoTServer`, port 8000, Development) với Mongo local; lấy JWT 2 user (`/api/auth/register` + `/login`), user A sở hữu `ESP32S3_Zone1`, user B không có cây. *(Không sửa code Phong; chỉ chạy.)*
- [ ] **Step 3:** Chạy Notify (`npm run dev`), `node scripts/publish-test.js water.empty ESP32S3_Zone1` → 202.
- [ ] **Step 4:** `curl` kiểm: A thấy tin, `isRead:false`; B thấy 0 tin; B `?deviceId=ESP32S3_Zone1` → 403; không token → 401; A đánh dấu đọc → A `unreadCount` giảm; share cây cho B → B thấy tin và `isRead:false` (Review Focus #3).
- [ ] **Step 5:** Tắt Phong → `GET /api/v1/me` với JWT mới (ngoài cache) → 503; `publish-test` vẫn 202 (Review Focus #1).
- [ ] **Step 6:** Mở `http://localhost:3003`, đăng nhập A, thấy danh sách; push thật cần trình duyệt người dùng cho phép — ghi lại là phần người dùng tự kiểm.
