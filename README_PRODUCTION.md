# Hướng dẫn đưa Picrew Web lên Render (Miễn phí)

Đây là các bước để bạn đưa dự án này lên mạng hoàn toàn miễn phí bằng **Render**.

### Bước 1: Chuẩn bị Repository trên GitHub
1. Tạo một repository mới trên GitHub (ví dụ: `picrew-web`).
2. Tải toàn bộ source code trong thư mục `picrew_web` lên GitHub repository này.
   - Nhớ là chỉ đẩy các file trong thư mục `picrew_web`, không phải cả thư mục cha `picrew_scraper`.
   - File `.gitignore` tôi đã tạo sẽ giúp bạn bỏ qua các file rác và file temp.

### Bước 2: Tạo Web Service trên Render
1. Truy cập [dashboard.render.com](https://dashboard.render.com/) và đăng nhập bằng GitHub.
2. Nhấn nút **New +** và chọn **Web Service**.
3. Kết nối với GitHub repository bạn vừa tạo.

### Bước 3: Cấu hình trên Render
Trong trang cấu hình của Render, hãy thiết lập như sau:
- **Name**: `picrew-web` (hoặc tên bất kỳ bạn thích).
- **Region**: Chọn vùng gần bạn nhất (ví dụ: `Singapore`).
- **Runtime**: `Node`.
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: Chọn **Free**.

### Bước 4: Hoàn thành
- Nhấn **Create Web Service**. 
- Đợi vài phút để Render build ứng dụng của bạn.
- Sau khi hoàn tất, Render sẽ cung cấp cho bạn một đường dẫn (ví dụ: `https://picrew-web.onrender.com`). Bạn có thể truy cập vào đó để sử dụng.

> [!NOTE]
> Gói miễn phí của Render sẽ tự động "ngủ" nếu không có ai truy cập trong một khoảng thời gian. Lần truy cập tiếp theo sẽ mất khoảng 30-60 giây để ứng dụng khởi động lại.


http://192.168.1.93:3000/
node server.js