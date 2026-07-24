# LN Reader

Ứng dụng desktop đọc Light Novel với TTS local (Tiếng Việt / Tiếng Anh), phụ đề đồng bộ theo từ, hiển thị song song trang gốc.

- **Nền tảng:** Windows x64
- **License:** MIT

## Trạng thái

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Scaffold: monorepo, Electron, SQLite, titlebar, theme | ✅ Xong |
| 1 | Import, chapter detection, viewer | ⏳ Đang làm |
| 2 | TTS sidecar & storage manager | — |
| 3 | Player & subtitle sync | — |
| 4 | Forced alignment | — |
| 5 | Polish & ship | — |

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

Ứng dụng không mua code signing certificate. Khi cài, Windows SmartScreen sẽ
cảnh báo — chọn **More info → Run anyway**.

## Đóng góp

Đọc [CLAUDE.md](CLAUDE.md) trước khi sửa code: file này ghi các quy tắc kiến
trúc bắt buộc của dự án.

Trước khi mở PR:

```bash
pnpm typecheck && pnpm lint && pnpm test
```
