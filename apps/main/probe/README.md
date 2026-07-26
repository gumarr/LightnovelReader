# probe (main) — chạy thật với sidecar Python

**Không phải test sản phẩm.** Đây là script spawn sidecar Python **thật** qua
supervisor **thật**, để kiểm phần nối hai đầu mà unit test dùng tiến trình giả
không bao giờ lộ ra.

Đã loại khỏi `pnpm test` (config gốc loại `**/probe/**`) vì cần venv Python và
mất vài giây mỗi lần chạy. Chạy bằng **config riêng**:

```bash
npx vitest run -c apps/main/probe/vitest.config.ts

# Một kịch bản
npx vitest run -c apps/main/probe/vitest.config.ts -t "giết tiến trình thật"
```

Chưa dựng `sidecar/.venv` thì tự bỏ qua (`describe.skipIf`), không báo lỗi.

## Kiểm những gì

| Kịch bản | Chứng minh điều gì |
|---|---|
| Khởi động + `/health` + `/normalize` | Bắt tay stdout khớp giữa Python và TS; token main sinh ra được sidecar chấp nhận |
| Giết tiến trình thật | Supervisor phát hiện và dựng lại; cổng **khác** lần trước → đúng là tiến trình mới |
| `stop()` | Không để lại tiến trình Python mồ côi; cổng được nhả |
| Token sai / thiếu | Sidecar thật trả 401 — token không phải hình thức |
| Hỏng cố định (thiếu env) | Hết lượt thì `failed`, không quay vòng vô tận |

## Vì sao phải có

Chạy thật ở đây **đã tìm ra một lỗi thật** mà 71 unit test không thấy: khử
trùng lặp báo hỏng theo *trạng thái* khiến lần chết thứ hai trở đi bị nuốt,
supervisor đứng im ở `restarting` mãi mãi và không bao giờ tới `failed`. Tiến
trình giả trong unit test luôn bắt tay thành công nên không dựng được kịch bản
"chết liên tiếp ngay lúc khởi động".

Lỗi đó nay đã có unit test khoá lại — xem mục "chết LIÊN TIẾP ngay lúc khởi
động" trong `sidecar-supervisor.test.ts`.
