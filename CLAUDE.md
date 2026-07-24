# CLAUDE.md — LN Reader

Electron desktop app đọc Light Novel với TTS local, phụ đề sync theo từ.

- Target: **Windows x64 only**
- License: **MIT**, mã nguồn mở, dự án cá nhân
- Không code signing → không thêm bước build phụ thuộc cert

## Nguyên tắc chung

- Trả lời và comment code bằng **Tiếng Việt**; tên biến/hàm/file bằng **Tiếng Anh**.
- **TypeScript strict mode**. Không dùng `any` — bí thì `unknown` + type guard.
- Không tự ý thêm dependency mới nếu chưa hỏi. Ưu tiên stdlib / lib đã có.
- Không viết code "để đó cho sau" — không TODO rỗng, không stub trả mock.
- Sửa lỗi tận gốc, không `try/catch` nuốt lỗi rồi bỏ qua.

## Kiến trúc — không được vi phạm

```
renderer (React)  ──IPC──►  main (Electron)  ──HTTP──►  sidecar (Python)
     │                          │
     │                          └── SQLite (better-sqlite3)
     └── KHÔNG gọi trực tiếp sidecar, KHÔNG truy cập fs/db
```

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer chỉ dùng API expose qua `preload/src/api.ts` (`window.api.*`).
- Mọi IPC channel khai báo trong `packages/shared/src/ipc.ts` với type in/out rõ ràng.
- Type dùng chung **luôn** ở `packages/shared` — không copy-paste giữa package.
- Sidecar bind `127.0.0.1`, port ngẫu nhiên, mọi request kèm `X-Session-Token`.

## Domain model — BA TẦNG, không được gộp lẫn

| Tầng | Kích thước | Vai trò |
|---|---|---|
| **Chapter** | 10–30 trang | Đơn vị **UI/quản lý**. KHÔNG phải đơn vị audio |
| **Segment** | 1–3 câu, ≤ 300 ký tự | Đơn vị **generate + align + seek**. 1 file `.ogg` |
| **Word** | 1 từ | Đơn vị **highlight** |

**Quy tắc bắt buộc:**
- Audio sinh theo **segment**, không bao giờ theo chapter hay cả file. Segment ~10s vì CTC aligner degrade khi audio > 30s.
- Chapter chỉ là nhãn nhóm segment. Không có `chapter.audioPath`.
- Mỗi Segment = 1 `.ogg` + 1 `timings.json` (mảng `WordTiming`).
- Path audio: `{audioDir}/{bookId}/{segmentId}.ogg`. **Chỉ** lấy path qua `services/paths.ts` — không hardcode ở nơi khác. `audioDir` user đổi được, không giả định nằm trong `userData`.
- `alignStatus`: `none` → `estimated` (ước lượng ngay) → `aligned` (CTC xong). **UI phải hoạt động ở cả 3 trạng thái.**

## Chapter detection

- PDF: outline → font size heuristic → regex tiêu đề → vị trí dọc → fallback chia theo trang.
- DOCX: heading style → regex trên paragraph in đậm → page break.
- **Luôn** đi qua màn hình "Xác nhận cấu trúc chương" trước khi generate. Không bao giờ auto-generate ngay sau import.
- Mỗi tín hiệu detect là một hàm thuần riêng, có unit test riêng, trả về điểm số. Không viết một hàm khổng lồ.

## Generate & queue

- Mặc định generate chương hiện tại + prefetch chương kế khi đọc đến 80%.
- Job queue **persist trong SQLite** — đóng app mở lại phải tiếp tục được.
- Priority queue: segment sắp phát nhảy lên đầu hàng đợi.
- Mọi job phải pause/resume/cancel được.
- "Generate cả sách" **bắt buộc** hiện ước lượng thời gian + dung lượng trước khi chạy.

## Storage

- 1 vol ≈ 800 MB–1.2 GB audio. Dung lượng là mối quan tâm hạng nhất, không phải chuyện phụ.
- Bitrate configurable (16/24/32 kbps), mặc định 24.
- Storage manager phải có từ Phase 2: xem theo sách/chương, xóa audio giữ metadata, đổi thư mục, cảnh báo ngưỡng.
- Xóa audio **không** được xóa tiến độ đọc, bookmark, hay cấu trúc chương.

## Stack

| Layer | Công nghệ |
|---|---|
| Shell | Electron 32+, electron-builder |
| Renderer | React 18, TypeScript, Vite, Tailwind, shadcn/ui, Zustand |
| Main | Node 20, better-sqlite3 |
| Sidecar | Python 3.11, FastAPI, ONNX Runtime, Piper |
| PDF | pdfjs-dist |
| DOCX | mammoth |
| Test | Vitest (unit), Playwright (e2e), pytest (sidecar) |

## Cấu trúc

```
apps/main        Electron main: IPC, DB, queue, sidecar supervisor, file I/O
apps/preload     contextBridge, chỉ expose API đã whitelist
apps/renderer    React UI
packages/shared  Types, constants, IPC contract, zod schemas
packages/parsers PDF/DOCX/EPUB → Document model, chapter detector, cleaner, segmenter
sidecar/         Python TTS + forced alignment
```

## Quy tắc code

### Renderer
- Không re-render mỗi frame. Highlight subtitle dùng `requestAnimationFrame` + DOM trực tiếp qua `ref`, **không** `useState` cho word index.
- Mọi màu lấy từ CSS variable (`--bg`, `--fg`, `--accent`...). Không hardcode hex trong component.
- Dark/Light phải test cả hai trước khi coi là xong.
- Component > 200 dòng thì tách.
- Danh sách segment dài → virtualization.

### Main
- Mọi IPC handler trả `{ ok: true, data }` | `{ ok: false, error }`. Không throw qua IPC.
- Query DB trong `db/repositories/*.ts`. Không viết SQL rải rác trong handler.
- Sidecar supervisor: health check 5s/lần, tự restart tối đa 3 lần, sau đó báo UI.
- Thao tác file lớn (copy sách, xóa audio hàng loạt) không block main thread.

### Sidecar
- Type hint đầy đủ, `pydantic` cho request/response.
- Job dài → background task + SSE progress, không block.
- Text normalize VI/EN ở `app/text/`, unit test cho từng rule.

### Parsers
- Mọi parser implement chung interface `DocumentParser`. Thêm format mới = thêm file, không sửa core.
- PDF: **không hỗ trợ** file scan không có text layer — detect sớm, báo lỗi rõ ràng cho user.

## Kiểm thử

Bắt buộc unit test cho: segmenter, chapter detector (từng tín hiệu), cleaner (header/footer, dehyphenate), text normalizer, timing interpolation.

Chạy `pnpm typecheck && pnpm lint && pnpm test` trước khi báo hoàn thành. Sidecar: `pytest sidecar/tests`.

## PROGRESS.md — cập nhật mỗi lần commit

`PROGRESS.md` là nơi phiên làm việc sau lấy lại ngữ cảnh. **Đọc nó trước khi bắt đầu**, và **cập nhật trong cùng commit** với thay đổi code — không để thành commit riêng hay việc dọn dẹp sau.

Mỗi commit phải sửa ít nhất:

- **Ngày + hash commit** ở đầu file
- **Mục 2 (Đã hoàn thành)** — đánh dấu phần vừa xong, cập nhật số test
- **Mục 3 (Việc tiếp theo)** — đổi trạng thái, dời mũi tên `⬅️` sang mục kế

Thêm mục mới khi gặp:

- **Mục 4** — quyết định kỹ thuật khác/bổ sung so với `plan.md`, kèm **lý do**. Đây là thứ dễ mất nhất giữa các phiên.
- **Mục 5** — bẫy môi trường (phiên bản runtime, biến môi trường, đường dẫn dữ liệu).
- **Mục 8** — nợ kỹ thuật cố ý để lại, kèm mức độ.

Ghi rõ cái gì **đã chạy thật** với cái gì **chỉ có unit test** — lỗi đóng gói và lỗi UI không lộ ra trong unit test.

## Lệnh

```bash
pnpm dev            # main + renderer + sidecar
pnpm typecheck      # tsc --noEmit toàn workspace
pnpm lint
pnpm test
pnpm build:win      # electron-builder → NSIS + portable
python sidecar/build.py   # PyInstaller onedir
```

## Không làm

- Không commit voice model / audio / `.db` vào git.
- Không gọi `fs`, `path`, `child_process` từ renderer.
- Không dùng `localStorage` cho dữ liệu quan trọng — dùng SQLite hoặc `electron-store`.
- Không regenerate audio khi user đổi tốc độ đọc — dùng `playbackRate` + `preservesPitch`.
- Không bundle voice model / aligner model vào installer — tải runtime từ Hugging Face.
- Không auto-generate audio ngay sau import — phải qua màn xác nhận chương.
- Không tự thêm telemetry / analytics.
- Không commit thay đổi code mà không cập nhật `PROGRESS.md` trong cùng commit.
