# scripts/

Script chạy bằng Node thuần (`.mjs`), không qua TypeScript — chúng chạy **trước**
khi có bundle nào, nên không thể phụ thuộc vào bước build.

| Script | Lệnh | Vai trò |
|---|---|---|
| `dev.mjs` | `pnpm dev` | Vite dev server + watch main/preload + mở Electron |
| `ui-check.mjs` | `pnpm ui-check` | Kiểm UI trong app **đang chạy** qua CDP |
| `sidecar-build.mjs` | `pnpm build:sidecar` | PyInstaller → `sidecar/dist/ln-sidecar/` |
| `sidecar-preflight.mjs` | *(tự gọi trong `build:win`)* | Chặn đóng gói khi sidecar thiếu/cũ |
| `sidecar-test.mjs` | `pnpm test:sidecar` | pytest của sidecar |
| `sqlite-abi.mjs` | `pnpm abi:node` / `abi:electron` | Đổi bản build `better-sqlite3` giữa Node và Electron |
| `copy-pdf-worker.mjs` | *(trong build của `@ln/main`)* | Chép `pdf.worker.mjs` cạnh bundle (PROGRESS 4.19) |

## `ui-check.mjs` — vì sao cần

Sáu lần trong dự án này unit test xanh mà UI vẫn hỏng (PROGRESS mục 4.19, 4.22,
4.23, 4.43…). Có **hai loại lỗi vitest không bắt được**, không phải vì test viết
kém mà vì jsdom không làm hai việc:

- **Không tính CSS thật** → lỗi màu trong suốt (4.23). `bg-accent/30` âm thầm mất
  màu khi biến CSS lưu hex thay vì kênh RGB, mà test chỉ thấy chuỗi class vẫn đủ.
- **Không tính layout** → `clientHeight` luôn `0` (4.43). Danh sách đoạn bị cắt
  mất nửa dưới nằm im từ P1.6c tới P2.7.

Vì vậy mọi phép kiểm ở đây là **số đo lấy từ Chromium thật**, không phải sự có
mặt của một class.

```bash
pnpm ui-check                # bản dev — thấy CSS thật + IPC thật
pnpm ui-check --packaged     # bản đã build — thêm được lỗi đường dẫn asar
pnpm ui-check --keep-open    # giữ app mở để soi tay tiếp
```

Ảnh chụp ghi ra `artifacts/ui-check/` (không commit).

### Kiểm những gì

| Phép kiểm | Bắt được lỗi loại nào |
|---|---|
| `window.api` có mặt, đủ nhóm | preload không nạp được ở bản đóng gói |
| `sidecar.getStatus()` lên `ready` | sai đường dẫn `resources/sidecar/` (4.29a) |
| `voices.listCatalog()` có dữ liệu | sai đường dẫn `resources/voices/` |
| Màu ở **cả dark lẫn light**, gồm nhánh có alpha | biến CSS lưu hex thay vì kênh RGB (4.23) |
| Hai theme cho màu **khác nhau** | lớp `.dark` không có tác dụng |
| Ô cuộn cao gần bằng panel | thiếu `flex-1 min-h-0` — lỗi 1 của 4.43 |
| Số dòng khớp chiều cao khung | `useEffect` đo sai lúc — lỗi 2 của 4.43 |
| Ẩn/hiện panel cho **cùng** số dòng | thứ tự khởi tạo còn quyết định kết quả |
| Canvas PDF có pixel khác trắng | pdfjs hỏng ở bản đóng gói (4.19) |
| Thanh dung lượng có chiều cao thật | Storage Manager hỏng bố cục |
| Có nút xoá audio phần đã đọc | P5.3 nối `deleteReadAudio` — handler có từ P2.7 mà thiếu chỗ bấm |
| Thanh cỡ chữ phụ đề có giá trị thật | màn Cài đặt (P5.3) không nạp được settings |
| **Xem thử khớp cỡ chữ đang chọn** | preview lệch thanh trượt → user chỉnh theo thứ mình nhìn rồi phụ đề ra khác |
| Chữ xem thử không trong suốt | lại rơi vào bẫy 4.23 ở component mới |
| Nút đánh dấu hiện ra, chữ không trong suốt | P5.4 nối `bookmarks:*` — bảng có từ schema v1 mà thiếu chỗ bấm |
| **Mỗi tab panel có chiều cao thật** | mỗi tab một khối `flex-1 min-h-0` riêng; chèn thêm lớp `div` là dựng lại lỗi 4.43 |
| Hai thanh tiến độ đọc/audio không trong suốt | lỡ dùng token màu **không tồn tại** (`bg-success`) → trong suốt, không đỏ ở đâu cả |
| Bảng hàng đợi nạp được (rỗng hoặc có job) | `queue:listPending` chưa từng gọi từ UI trước P5.4 |
| Thanh player hiện ra, màu không trong suốt | `PlayerBar` hỏng bố cục hoặc mất màu |
| Icon điều khiển vẽ ra hình thật, ăn màu chữ | icon SVG hỏng path, hoặc lỡ quay lại dùng emoji (P3.3) |
| Thanh tiến độ có bề ngang & chiều cao thật | `SegmentProgress` hỏng bố cục — đúng loại lỗi 4.43 |
| Menu tốc độ đủ 8 mốc và **mở lên** | thanh player sát đáy cửa sổ, mở xuống là nằm ngoài màn hình |
| **Chromium giữ `preservesPitch`** | nền tảng của "đổi tốc độ ≠ regenerate" (CLAUDE.md) — jsdom không có media element nên đây là chỗ **duy nhất** kiểm được |
| Tốc độ tới được thẻ `<audio>` thật | đứt ở một mắt trong chuỗi store → sink → thẻ `<audio>` |
| Phím tắt ăn ở ngoài, **nhường** khi đang gõ trong ô nhập | phím tắt gắn ở `window` cướp phím của cả app |

Đổi theme bằng cách **bấm nút thật** (`[data-theme-resolved]`), không sửa
`classList` — cần biết cả đường đi nút → IPC → settings → biến CSS có đúng không.

### Giới hạn

- Cần **ít nhất một sách trong thư viện**; không có thì phần reader/storage bị bỏ
  qua (script nói rõ, không âm thầm báo đạt).
- Phần canvas chỉ chạy khi sách đang mở là PDF; sách DOCX thì đổi sang kiểm số
  khối và chiều cao nội dung.
- **Không nghe được tiếng.** CDP không đọc được đầu ra âm thanh, nên script chỉ
  chứng minh được thẻ `<audio>` tồn tại, `preservesPitch` được giữ và nút bấm
  thông suốt. "Nghe liên tục hết chương" (DoD Phase 3) vẫn phải do người kiểm.
- Thẻ `<audio>` được gắn ẩn vào `document.body` với
  `data-testid="player-audio"`. Trước P3.3 nó nằm ngoài DOM, và phép kiểm
  `preservesPitch` **im lặng đo một thẻ `new Audio()` do chính nó tạo** — luôn
  xanh kể cả khi player không dựng được thẻ nào. Không bao giờ fallback sang thẻ
  tự tạo trong phép kiểm: thứ tự tạo luôn cho kết quả đẹp.
- **Chưa vào CI.** Bản dev cần venv Python cho sidecar, và cả hai bản cần một
  sách thật — chưa dựng được trên runner sạch. Xem PROGRESS mục 8.

## `sidecar-preflight.mjs` — vì sao cần

`electron-builder.yml` khai `extraResources` lấy từ `sidecar/dist/ln-sidecar`.
Nếu thư mục đó thiếu, electron-builder **không** coi là lỗi — nó chép được gì thì
chép rồi báo build thành công. Bản cài mở lên vẫn đọc được sách, chỉ tới lúc user
bấm generate mới lộ ra là không có sidecar.

`pnpm build:win` giờ tự gọi `build:sidecar` rồi tới preflight, nên không còn phải
nhớ chạy tay. Preflight kiểm ba cách hỏng đã gặp thật:

1. thiếu `ln-sidecar.exe` (chưa build, hoặc PyInstaller trả 0 mà file vẫn thiếu),
2. thiếu `_internal/` (onedir không đầy đủ → chết lúc khởi động),
3. `.exe` **cũ hơn** mã nguồn `.py` — sửa sidecar rồi quên build lại. Đây là cách
   hỏng duy nhất mắt thường không thấy.

Preflight chỉ kiểm phía **nguồn**. Phía **đích** (`resources/sidecar/` trong bản
đóng gói) do bước "Kiểm sidecar có trong bản đóng gói" ở CI lo — hai chỗ hỏng
khác nhau.
