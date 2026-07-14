# Notification App — SmartFarm trên Android

App mobile (React Native + Expo) nhận **push FCM** từ notification-service và hiển thị danh sách
thông báo trong app. **Chỉ dùng Firebase (FCM), không SSE.**

```
MCP ─publish JSON─▶ HiveMQ (planttree/{deviceId}/notifications) ─▶ notification-service ─FCM─▶ App này
```

- **Push (FCM)** nổ cả khi app đóng/kill (hệ điều hành hiện trên khay hệ thống).
- **Danh sách trong app** dựng từ chính message FCM nhận được (foreground listener + khi chạm
  notification từ khay), lưu `AsyncStorage` để mở lại app vẫn thấy lịch sử gần đây.
- Service **KHÔNG biến đổi** payload — app bóc `title`/`body`/`severity`/`type` để hiển thị đẹp,
  luôn cho xem JSON gốc (chạm vào 1 tin).

> Lưu ý: message đến lúc app **bị kill hẳn** chỉ hiện trên khay hệ thống, chưa vào danh sách
> trong app cho tới khi người dùng chạm mở (JS của app không chạy khi bị kill). Đây là giới hạn
> cố hữu của mô hình FCM-only không kèm DB.

## Chuẩn bị (1 lần)

### 1. google-services.json
Cần cho FCM trên Android (Firebase project `smartfarmai-f1426`). Tải **google-services.json** từ
Firebase Console → đặt vào thư mục `notification-app/` (cùng cấp `app.json`). File này nằm trong `.gitignore`.

### 2. Cài dependencies
```bash
cd notification-app
npm install
npx expo install --fix
```

## Chạy app
```bash
npx expo run:android
```
Sinh project Android native, build bằng SDK local, cài lên emulator/điện thoại. Yêu cầu Android
Studio + SDK, `JAVA_HOME` trỏ JDK 17. Emulator nên chọn image **có Google Play Services** (FCM cần).

## Sử dụng

1. Chạy `notification-service` (đảm bảo `.env` có `INTERNAL_API_KEY` và Firebase credentials).
2. Mở app → phần ⚙️ cấu hình:
   - **Server URL**: emulator giữ `http://10.0.2.2:3001`; điện thoại thật đổi thành IP LAN của máy dev.
   - **API key**: dán đúng `INTERNAL_API_KEY` trong `.env` của service.
3. **Lưu & Bật nhận push** → cấp quyền thông báo → app đăng ký FCM token qua `POST /internal/push/token`.
4. Bắn thử: `cd notification-service && node scripts/publish-test.js`
   - App đang mở → tin vào danh sách + banner.
   - App đóng hẳn → notification hệ thống trên khay (FCM). Chạm để mở app.

## Push (FCM) hoạt động thế nào

- App gọi `getDevicePushTokenAsync()` lấy FCM registration token, đăng ký qua
  `POST /internal/push/token` (xác thực API key). Service lưu vào collection `fcmtokens`.
- Mỗi tin trên `planttree/{deviceId}/notifications`, service **broadcast** tới tất cả token
  (`fcmService.sendToAll`). Payload gốc + `deviceId` đi kèm trong phần `data` của message.
- Cần Firebase cấu hình đúng trong `.env` của service (`FIREBASE_*`) và `google-services.json` trong app.

## Lưu ý kỹ thuật

- `http://` (không phải https) chạy được vì Expo debug build cho phép cleartext traffic.
  Build release cần HTTPS hoặc khai báo `usesCleartextTraffic`.
- `newArchEnabled: false` để build được trên Windows (đường dẫn dài + New Arch = fail).
  Xem lịch sử "bài học build" trong git nếu nâng cấp Expo SDK 55.
