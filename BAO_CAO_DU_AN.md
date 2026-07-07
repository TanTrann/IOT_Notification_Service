# IOT Notification Service — Báo Cáo Dự Án

## Giới Thiệu Dự Án

Tên dự án: IOT Notification Service
Thuộc hệ thống: SmartFarm — Giám sát và điều khiển cây trồng thông minh
Người phụ trách module: Tân Trần

IOT Notification Service là một microservice trong hệ thống SmartFarm. Nhiệm vụ chính là nhận sự kiện từ thiết bị IoT, xử lý thành thông báo có nghĩa và gửi push notification đến điện thoại hoặc trình duyệt của người dùng thông qua Firebase Cloud Messaging (FCM).


## Bối Cảnh và Vấn Đề Cần Giải Quyết

Hệ thống SmartFarm theo dõi cây trồng tự động 24/7. Khi có sự kiện bất thường như cây thiếu nước, mắc bệnh, thiếu dinh dưỡng — người dùng cần được thông báo ngay lập tức dù không đang mở ứng dụng.

Vấn đề cần giải quyết:
- Thiết bị IoT phát sự kiện liên tục nhưng người dùng không thể theo dõi màn hình mọi lúc
- Cần cầu nối từ phần cứng IoT đến ứng dụng người dùng
- Tránh gửi thông báo trùng lặp gây phiền nhiễu
- Lưu lịch sử thông báo để người dùng xem lại


## Kiến Trúc Tổng Thể Hệ Thống SmartFarm

Hệ thống SmartFarm gồm 5 thành viên, mỗi người phụ trách một module:

Nhường phụ trách phần cứng IoT, thiết kế mạch và thu thập dữ liệu cảm biến như nhiệt độ, độ ẩm, ánh sáng.

Lĩnh phụ trách AI Server, nhận dữ liệu từ cảm biến và phân tích để xác định tình trạng cây: bệnh, thiếu nước, thiếu dinh dưỡng, thiếu ánh sáng.

Phong phụ trách server điều khiển (.NET) và MCP Server, nhận dữ liệu cảm biến và tự động ra lệnh điều khiển phần cứng như bật đèn, tưới nước theo rule.

Tân phụ trách Push Notification Service, lắng nghe dữ liệu cảm biến thô và lệnh điều khiển trên MQTT broker, tự phân tích thành thông báo và đẩy đến thiết bị người dùng.

Thịnh phụ trách Website quản lý SmartFarm, hiển thị thông số và lịch sử thông báo cho người dùng.

Luồng dữ liệu: Cảm biến IoT (ESP32) → MQTT Broker (HiveMQ Cloud) → Notification Service (tự so ngưỡng / dịch lệnh) → Firebase FCM → Ứng dụng người dùng.

Điểm thiết kế quan trọng: Notification Service "nghe ké" cùng broker với hệ thống của Phong (2 topic xmini/sensor_data và xmini/control), tự suy ra sự kiện đáng báo từ dữ liệu thô — các module khác không cần thay đổi hay tích hợp gì thêm.


## Công Nghệ Sử Dụng

Ngôn ngữ lập trình: Node.js với cú pháp ES6 Modules
Framework backend: Express.js phiên bản 4.19
Cơ sở dữ liệu: MongoDB thông qua thư viện Mongoose
Giao thức nhận sự kiện: MQTT — giao thức nhắn tin nhẹ cho IoT
Dịch vụ thông báo đẩy: Firebase Admin SDK phiên bản 12
Xác thực người dùng: JSON Web Token (JWT)
Bảo mật: Helmet và CORS middleware
MQTT Broker: HiveMQ Cloud (TLS 8883, dùng chung với hệ của Phong)


## Chức Năng Chính

Nhận dữ liệu IoT qua MQTT: Service lắng nghe 2 topic — xmini/sensor_data (số đo cảm biến thô từ ESP32) và xmini/control (lệnh tự động từ server .NET của Phong).

Tự so ngưỡng cảnh báo: Số đo cảm biến được so với ngưỡng cấu hình (độ ẩm đất dưới 30%, nhiệt độ trên 35°C, ánh sáng dưới 25 lux) để sinh cảnh báo, ví dụ "Cây đang thiếu nước — Độ ẩm đất 22% đã xuống dưới ngưỡng 30%".

Chống spam bằng edge-detection: Chỉ báo khi chỉ số chuyển trạng thái (tốt sang xấu báo một lần, hồi phục báo "đã ổn định" một lần) — cảm biến gửi liên tục vài giây một lần cũng không gây dội thông báo.

Dịch lệnh điều khiển thành thông báo: Lệnh WATER_ON, LIGHT_ON... được dịch sang câu dễ hiểu kèm chi tiết, ví dụ "Đã tự động tưới nước (độ ẩm hiện tại 22%, trong 5 giây)". Payload lệnh không chứa device_id nên service tự suy ra từ bản tin cảm biến gần nhất.

Lưu trữ thông báo: Mỗi thông báo được lưu vào MongoDB kèm loại, mức độ nghiêm trọng và trạng thái đã đọc hay chưa.

Gửi push notification: Tự động gửi thông báo đến tất cả thiết bị đã đăng ký của người dùng qua Firebase FCM, hỗ trợ web, Android và iOS.

API quản lý thông báo: Cung cấp REST API để lấy danh sách thông báo, đánh dấu đã đọc, đếm số chưa đọc.

Chống thông báo trùng lặp: Mỗi sự kiện có ID duy nhất, hệ thống bỏ qua nếu đã xử lý trước đó.


## Các Loại Thông Báo

Thông báo bệnh cây (disease): Khi AI phát hiện dấu hiệu bệnh trên cây trồng. Mức độ: nguy cấp hoặc cảnh báo.

Thông báo tưới nước (water): Khi cây thiếu nước hoặc hệ thống tự động tưới. Mức độ: cảnh báo hoặc thông tin.

Thông báo dinh dưỡng (nutrition): Khi cây thiếu chất dinh dưỡng. Mức độ: cảnh báo.

Thông báo nhiệt độ (temperature): Khi nhiệt độ vượt ngưỡng hoặc hạ về bình thường. Mức độ: cảnh báo hoặc thông tin.

Thông báo ánh sáng (light): Khi cây thiếu hoặc thừa ánh sáng. Mức độ: thông tin.

Thông báo hệ thống (system): Khi thiết bị kết nối, ngắt kết nối hoặc lỗi. Mức độ: thông tin.

Ba mức độ nghiêm trọng: Critical (nguy cấp), Warning (cảnh báo), Info (thông tin).


## Luồng Xử Lý Thông Báo

Bước 1 — Nhận dữ liệu: Thiết bị ESP32 publish số đo cảm biến lên topic "xmini/sensor_data"; server .NET của Phong publish lệnh tự động lên topic "xmini/control". Service subscribe cả hai.

Bước 2 — Phân tích: MQTT Handler parse JSON và điều phối theo topic — số đo cảm biến sang hàm so ngưỡng, lệnh điều khiển sang hàm dịch lệnh.

Bước 3 — Sinh thông báo: Event Translator so số đo với ngưỡng (kèm edge-detection chống spam) hoặc ánh xạ lệnh sang tiêu đề và nội dung tiếng Việt dễ hiểu.

Bước 4 — Lưu vào cơ sở dữ liệu: Notification Service lưu thông báo vào MongoDB. Nếu eventId đã tồn tại (trùng lặp) thì dừng, không gửi FCM.

Bước 5 — Gửi push notification: FCM Service tra cứu tất cả FCM token của thiết bị đó và gửi notification đến từng token qua Firebase.

Bước 6 — Người dùng nhận thông báo: Thiết bị người dùng nhận notification từ Firebase, hiển thị trên màn hình dù app đang đóng.


## Mô Hình Dữ Liệu

Bảng Notification lưu trữ:
- eventId: ID duy nhất để chống trùng lặp
- deviceId: ID của thiết bị IoT gửi sự kiện
- title: Tiêu đề thông báo
- body: Nội dung chi tiết
- type: Loại thông báo (disease, water, nutrition, light, temperature, system)
- severity: Mức độ nghiêm trọng (critical, warning, info)
- isRead: Trạng thái đã đọc hay chưa
- createdAt: Thời gian tạo

Bảng FCMToken lưu trữ:
- deviceId: ID thiết bị hoặc người dùng
- token: FCM registration token từ trình duyệt hoặc app
- device: Loại client (web, android, ios)


## REST API

API đăng ký FCM token: POST /api/v1/notifications/token — Thiết bị client gửi FCM token khi khởi động để nhận được notification về sau.

API lấy danh sách thông báo: GET /api/v1/notifications — Trả về danh sách thông báo có phân trang, kèm số lượng chưa đọc.

API đếm chưa đọc: GET /api/v1/notifications/unread-count — Trả về số thông báo chưa đọc để hiển thị badge trên UI.

API đánh dấu đã đọc: PATCH /api/v1/notifications/:id/read — Đánh dấu một thông báo cụ thể là đã đọc.

API đánh dấu tất cả đã đọc: PATCH /api/v1/notifications/read-all — Xóa toàn bộ badge thông báo.

API health check: GET /health — Kiểm tra service có đang hoạt động không.

Tất cả API quản lý thông báo yêu cầu JWT Bearer token trong header để xác thực người dùng.


## Tính Năng Kỹ Thuật Nổi Bật

Chống thông báo trùng lặp: Sử dụng unique sparse index trên MongoDB cho trường eventId (lấy từ commandId của lệnh). Khi broker phát lại cùng một lệnh (QoS 1), hệ thống nhận ra và bỏ qua, không gửi FCM lần thứ hai.

Chống spam bằng edge-detection: Lưu trạng thái tốt/xấu của từng chỉ số theo thiết bị; chỉ thông báo tại thời điểm chuyển trạng thái nên cảm biến gửi dữ liệu liên tục cũng không làm phiền người dùng.

Không xâm lấn hệ thống hiện có: Service chỉ subscribe thêm vào broker sẵn có của Phong và tự phân tích dữ liệu thô — phần cứng và server điều khiển không phải sửa dòng code nào.

Hỗ trợ nhiều thiết bị cùng lúc: Một người dùng có thể đăng ký nhiều FCM token từ điện thoại, máy tính bảng, trình duyệt. Khi có sự kiện, tất cả thiết bị đều nhận được thông báo đồng thời.

Tự động phục hồi kết nối: MQTT client tự động kết nối lại mỗi 5 giây nếu mất kết nối. Service không bị crash khi broker tạm thời ngắt.

Khởi động an toàn: Service vẫn chạy bình thường dù Firebase, MQTT hoặc MongoDB chưa kết nối. Ghi log cảnh báo và tiếp tục thay vì dừng hẳn.

Hỗ trợ thông báo nền: Tích hợp Firebase Service Worker cho phép người dùng nhận notification ngay cả khi trình duyệt đang đóng hoặc app đang chạy nền.


## Kết Quả Đạt Được

Service hoạt động ổn định, nhận và xử lý sự kiện từ MQTT thành công.

Tích hợp thành công với Firebase FCM, gửi push notification đến trình duyệt web.

API đầy đủ để website của Thịnh lấy danh sách thông báo và quản lý trạng thái đọc.

Cơ chế chống trùng lặp và edge-detection hoạt động đúng, không gây spam thông báo (đã kiểm chứng end-to-end qua HiveMQ Cloud thật).

Giao diện test client (test-client/) giả lập được cả ESP32 lẫn server .NET của Phong, kiểm thử toàn bộ luồng end-to-end mà không cần phần cứng thật.

Web nhận thông báo cho người dùng cuối (notification-web/): trung tâm thông báo với push realtime, danh sách lịch sử, đánh dấu đã đọc và badge đếm chưa đọc.


## Hướng Phát Triển Tiếp Theo

Tích hợp sâu hơn với MCP Server để hỗ trợ thêm loại sự kiện mới khi AI phát hiện thêm bệnh cây.

Thêm rate limiting để giới hạn số thông báo mỗi giờ, tránh làm phiền người dùng.

Xây dựng hàng đợi gửi lại khi Firebase tạm thời không khả dụng.

Thêm thống kê tỷ lệ mở thông báo để cải thiện nội dung.

Hỗ trợ đa ngôn ngữ cho thông báo theo cài đặt của người dùng.


## Kết Luận

IOT Notification Service hoàn thành vai trò cầu nối quan trọng trong hệ sinh thái SmartFarm. Service chuyển đổi dữ liệu kỹ thuật từ phần cứng IoT thành thông báo thân thiện, đảm bảo người dùng luôn được cập nhật tình trạng cây trồng kịp thời dù không mở ứng dụng.

Với kiến trúc microservice độc lập, service dễ bảo trì, mở rộng và tích hợp với các module khác trong hệ thống mà không ảnh hưởng lẫn nhau.

Công nghệ sử dụng: Node.js, Express, MongoDB, MQTT, Firebase FCM, JWT.
Người phụ trách: Tân Trần — tan.tran@treehousei.com
