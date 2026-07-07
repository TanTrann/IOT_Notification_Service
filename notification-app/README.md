# Notification App — SmartFarm trên Android

App mobile (React Native + Expo) nhận push notification khi hệ thống của Phong phát cảnh báo.
Tính năng giống `notification-web/`: nhận push FCM realtime, danh sách thông báo, đánh dấu
đã đọc, đếm chưa đọc — chạy native trên Android.

**Backend không cần sửa gì**: app lấy FCM registration token native
(`getDevicePushTokenAsync`) — đúng loại token mà `fcmService.sendToDevice()` đang gửi tới,
đăng ký qua `POST /token` với `device: 'android'` (đã có sẵn trong enum của model).

## Chuẩn bị (1 lần)

### 1. Đăng ký app Android với Firebase
1. [Firebase Console](https://console.firebase.google.com) → project `smartfarmai-f1426`
   → Project Settings → Your apps → **Add app → Android**.
2. Package name: `com.smartfarm.notifications` (phải khớp `android.package` trong `app.json`).
3. Tải **google-services.json** → đặt vào thư mục `notification-app/` (cùng cấp `app.json`).
   File này đã nằm trong `.gitignore` — mỗi máy tự tải.

### 2. Cài dependencies
```bash
cd notification-app
npm install
npx expo install --fix   # tự căn chỉnh version dependencies khớp Expo SDK
```

## Chạy app

```bash
npx expo run:android
```

Lệnh này tự sinh project Android native (`android/`), build bằng SDK local và cài lên
emulator/điện thoại đang kết nối. Yêu cầu Android Studio + SDK (đã có), và:
- **Emulator**: image có Google Play Services (chọn loại "Play Store" khi tạo AVD) — FCM cần nó.
- **Điện thoại thật**: bật USB debugging, cắm cáp, `adb devices` thấy máy là chạy được.

## Sử dụng

1. Đảm bảo `notification-service` đang chạy trên máy dev.
2. Sinh JWT: `cd notification-service && node generate-token.js <device_id>`.
3. Mở app → phần ⚙️ cấu hình:
   - **Server URL**: emulator giữ nguyên `http://10.0.2.2:3001` (10.0.2.2 = localhost của máy
     dev nhìn từ emulator). Điện thoại thật: đổi thành IP LAN của máy dev, vd
     `http://192.168.1.10:3001` (máy và điện thoại cùng Wi-Fi).
   - **JWT**: dán token (app tự làm sạch khoảng trắng, tự báo nếu hết hạn).
4. **Lưu & Kết nối** → thấy danh sách thông báo.
5. **🔔 Bật nhận push** → cho phép quyền → app đăng ký FCM token vào DB.
6. Test: mở `test-client/` bấm "🌵 Đất khô" → điện thoại nhận push (app mở thì banner +
   danh sách tự cập nhật; app đóng thì notification hệ thống).

## Lưu ý kỹ thuật

- `http://` (không phải https) hoạt động được vì Expo debug build cho phép cleartext traffic.
  Build release production cần HTTPS hoặc khai báo `usesCleartextTraffic`.
- Push khi app bị kill: FCM message dạng `notification` (backend đang gửi) được hệ thống
  Android tự hiển thị — không cần app chạy nền.
- JWT chứa `deviceId` — app chỉ thấy thông báo của thiết bị đó, giống web.
- Muốn build APK phát cho người khác: `cd android && .\gradlew assembleRelease`
  (APK tại `android/app/build/outputs/apk/release/`).

## Bài học build trên Windows (đã trả giá 3 lần build fail)

- **Đường dẫn project không được có dấu cách** — ninja (build C++ của NDK) fail với
  `mkdir ... No such file or directory`. Repo đã đổi tên folder cha thành
  `IOT-AI-Project\Demo-V2` vì lý do này.
- **Đường dẫn cũng không được quá dài** (giới hạn 260 ký tự của Windows): CMake nhúng
  đường dẫn project vào đường dẫn file object của target `fabric` (New Architecture).
  Đây là lý do `app.json` đặt **`"newArchEnabled": false`** — tắt New Arch thì không
  build target fabric nữa. Expo SDK 55 sẽ bắt buộc New Arch → khi nâng cấp phải chuyển
  project tới đường dẫn ngắn (vd `C:\dev\notification-app`) hoặc build bằng EAS cloud.
- **`JAVA_HOME` phải được set** (System Properties → Environment Variables), trỏ tới JDK 17.
  Chỉ có `java` trong PATH là chưa đủ cho Gradle spawn.
- Sau khi đổi đường dẫn project hoặc đổi config native: xóa folder `android/` rồi để
  `expo run:android` prebuild lại — cache Gradle/CMake ghim đường dẫn tuyệt đối cũ.
