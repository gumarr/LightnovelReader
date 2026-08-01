# LN Reader

Ứng dụng desktop đọc Light Novel với TTS local (Tiếng Việt / Tiếng Anh), phụ đề đồng bộ theo từ, hiển thị song song trang gốc.

- **Nền tảng:** Windows x64
- **License:** MIT

## Trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Scaffold: monorepo, Electron, SQLite, titlebar, theme | ✅ Xong |
| 1 | Import, chapter detection, viewer | ✅ Xong |
| 2 | TTS sidecar & storage manager | ✅ Xong |
| 3 | Player & subtitle sync | ✅ Xong |
| 4 | Forced alignment | ⏹️ Đã bỏ |
| 5 | Polish & ship | ✅ Xong |

**Phase 4 bỏ có chủ đích.** Highlight theo từ hiện dùng nội suy theo độ dài từ,
nghe thật thì bám đúng nhịp. Đổi sang CTC forced alignment là thêm model ~300 MB,
đẩy installer từ 143 MB lên ~450 MB — quá đắt cho thứ không ai thấy thiếu. Lý do
đầy đủ và **điều kiện mở lại** ở [PROGRESS.md](PROGRESS.md) mục 4.68.

Chi tiết kế hoạch: [plan.md](plan.md). Trạng thái công việc và ghi chú kỹ thuật:
[PROGRESS.md](PROGRESS.md).

## Yêu cầu môi trường

- **Node 22 LTS** (bắt buộc — xem ghi chú bên dưới)
- pnpm 9
- Python 3.11+ (từ Phase 2, cho sidecar TTS)

### Vì sao phải là Node 22

`better-sqlite3` là native module và chỉ nạp được bởi runtime có đúng ABI.
Node 22 dùng ABI 127, Electron 33 dùng ABI 130, còn Node 25 (ABI 141) chưa có
bản dựng sẵn. Dự án pin Node 22 trong [.nvmrc](.nvmrc):

```bash
nvm install 22.20.0
nvm use 22.20.0
```

Script `pnpm test` và `pnpm dev` tự tráo bản `.node` đúng ABI trước khi chạy
(xem [scripts/sqlite-abi.mjs](scripts/sqlite-abi.mjs)), nên không cần thao tác thủ công.

## Bắt đầu

```bash
pnpm install
pnpm dev            # main + renderer, hot reload
```

## Lệnh

```bash
pnpm dev            # chạy app ở chế độ phát triển
pnpm typecheck      # tsc --noEmit toàn workspace
pnpm lint
pnpm test           # vitest
pnpm build          # build main + preload + renderer
pnpm build:win      # electron-builder → NSIS + portable
```

## Kiến trúc

```
renderer (React)  ──IPC──►  main (Electron)  ──HTTP──►  sidecar (Python)
     │                          │
     │                          └── SQLite (better-sqlite3)
     └── KHÔNG gọi trực tiếp sidecar, KHÔNG truy cập fs/db
```

| Thư mục | Vai trò |
|---|---|
| `apps/main` | Electron main: IPC, DB, queue, sidecar supervisor, file I/O |
| `apps/preload` | contextBridge, chỉ expose API đã whitelist |
| `apps/renderer` | React UI |
| `packages/shared` | Types, constants, IPC contract, zod schemas |
| `packages/parsers` | PDF/DOCX → Document model, chapter detector, segmenter |
| `sidecar/` | Python TTS + forced alignment |

Renderer chạy với `nodeIntegration: false`, `contextIsolation: true`,
`sandbox: true` và chỉ gọi được các channel đã khai báo trong
[packages/shared/src/ipc.ts](packages/shared/src/ipc.ts).

## Domain model

Ba tầng, không gộp lẫn:

| Tầng | Kích thước | Vai trò |
|---|---|---|
| **Chapter** | 10–30 trang | Đơn vị UI/quản lý. Không phải đơn vị audio |
| **Segment** | 1–3 câu, ≤ 300 ký tự | Đơn vị generate + align + seek. 1 file `.ogg` |
| **Word** | 1 từ | Đơn vị highlight |

Segment nhỏ (~10s audio) vì CTC aligner degrade nghiêm trọng khi audio > 30s.

## Cài đặt bản phát hành

Tải từ trang [Releases](../../releases). Có hai bản:

| File | Dùng khi | Tự cập nhật |
|---|---|---|
| `LN-Reader-<version>-x64.exe` | Cài bình thường (khuyến nghị) | ✅ Có |
| `LN-Reader-<version>-portable.exe` | Chạy từ USB, không muốn cài | ❌ Không |

Bản portable **không tự cập nhật được** — nó không có trình gỡ cài để thay chính
mình. App biết điều đó và nói thẳng trong mục Cài đặt thay vì báo lỗi mơ hồ; muốn
lên bản mới thì tải file mới và thay file cũ.

### Windows SmartScreen chặn — đây là chuyện bình thường

Đây là dự án cá nhân mã nguồn mở, **không mua code signing certificate** (~400
USD/năm). Windows không nhận ra nhà phát hành nên chặn mọi file `.exe` chưa ký,
bất kể nội dung là gì.

Cách qua: bấm **More info** → **Run anyway**.

Nếu ngại, hai cách tự kiểm chứng — đều không cần tin lời README này:

- Đối chiếu SHA-512 của file tải về với dòng `sha512` trong `latest.yml` cùng
  release.
- Tự build từ mã nguồn: `pnpm install && pnpm build:win`.

### Cập nhật

Bản cài kiểm bản mới lúc khởi động rồi hiện một dải báo ở đầu cửa sổ. **Chỉ kiểm
tra là tự động** — tải (~150 MB) và cài đều do bạn bấm, vì đây là app đọc offline
và không nên tự ngốn băng thông của bạn.

Tắt hẳn việc kiểm tra ở **Cài đặt → Cập nhật → bỏ tick "Tự kiểm tra bản mới"**.
Tắt rồi thì app không gửi request mạng nào ra ngoài; vẫn kiểm tay được bằng nút
**Kiểm tra** ngay cạnh đó.

Ứng dụng **không có** telemetry hay analytics dưới bất kỳ dạng nào.

### Dữ liệu của bạn nằm ở đâu

- Sách, tiến độ đọc, dấu trang, hàng đợi: `%APPDATA%/LN Reader/`
- Audio đã tạo: thư mục bạn chọn trong **Dung lượng & audio** (mặc định
  `%APPDATA%/LN Reader/audio/`)

Một volume có thể chiếm 800 MB–1.2 GB audio, nên nếu ổ C chật thì đổi thư mục
sang ổ khác ngay từ đầu.

Gỡ cài **không** xoá hai thư mục này. Cài đè bản mới giữ nguyên toàn bộ dữ liệu.

## Đóng góp

Đọc [CLAUDE.md](CLAUDE.md) trước khi sửa code: file này ghi các quy tắc kiến
trúc bắt buộc của dự án.

Trước khi mở PR:

```bash
pnpm typecheck && pnpm lint && pnpm test
```
