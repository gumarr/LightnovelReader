# Tiến độ — LN Reader

> File này ghi lại **trạng thái công việc** để phiên làm việc sau tiếp tục được ngay.
> Kế hoạch tổng thể ở [plan.md](plan.md), quy tắc code ở [CLAUDE.md](CLAUDE.md).
>
> **Cập nhật lần cuối:** 2026-07-25 · commit `3db0761`
>
> ⚠️ File này **bắt buộc cập nhật trong cùng commit** với thay đổi code —
> xem mục "PROGRESS.md" trong [CLAUDE.md](CLAUDE.md).

---

## 1. Bắt đầu nhanh cho phiên sau

```bash
nvm use 22.20.0          # BẮT BUỘC — xem mục 5 để biết lý do
pnpm install
pnpm typecheck && pnpm lint && pnpm test
pnpm dev                 # mở app
```

Nếu `pnpm dev` không mở được cửa sổ: xem **mục 5.2** (biến `ELECTRON_RUN_AS_NODE`).

**Việc tiếp theo:** P1.3 — Chapter detector (xem mục 3).

---

## 2. Đã hoàn thành

### Phase 0 — Scaffold ✅ (DoD đạt đủ 5/5)

| Mục DoD | Trạng thái | Ghi chú |
|---|---|---|
| Monorepo pnpm + Electron + Vite + React + TS | ✅ | 5 package, strict mode đầy đủ |
| Custom titlebar | ✅ | Frameless, nút gọi qua IPC |
| Theme provider (dark/light/system) | ✅ | Đã xác minh bằng ảnh chụp cả 2 chế độ |
| SQLite + migration runner | ✅ | Schema v1, WAL, chạy thật khi mở app |
| CI build Windows portable | ✅ | GitHub Actions + smoke test khởi động |

**Đã kiểm chứng bằng cách chạy thật** (không chỉ unit test):
- `pnpm dev` mở app, DB migrate `schema 0 → 1`, toggle theme hoạt động
- Bản đóng gói `.exe` chạy được, IPC hoạt động, cả dark lẫn light đúng
- Installer **80.8 MB** (mục tiêu plan: < 200 MB)

### Phase 1 — P1.1 Segmenter ✅

- `packages/parsers/src/segmenter/sentence-splitter.ts` — tách câu VI/EN
- `packages/parsers/src/segmenter/segmenter.ts` — gom câu thành segment ≤ 300 ký tự

### Phase 1 — P1.2 Cleaner ✅

Bốn hàm thuần, mỗi hàm một file + test riêng, ghép lại ở `cleaner.ts`:

| File | Vai trò | Test |
|---|---|---|
| `cleaner/header-footer.ts` | Loại running head / số trang lặp | 15 |
| `cleaner/dehyphenate.ts` | Nối từ bị ngắt cuối dòng | 21 |
| `cleaner/merge-lines.ts` | Nối dòng bị PDF ngắt giữa câu | 23 |
| `cleaner/columns.ts` | Detect 2 cột theo x-position, sắp lại thứ tự đọc | 15 |
| `cleaner/cleaner.ts` | Pipeline 4 bước, thứ tự bắt buộc | 7 |

`cleanPages()` trả về text **theo trang** (không gộp cả sách) để P1.3 còn
ánh xạ được chương ↔ khoảng trang.

**Chỉ mới có unit test** — chưa chạy trên PDF thật (chưa có file mẫu).

### Số liệu hiện tại

| Chỉ số | Giá trị |
|---|---|
| Unit test | **387 passed** (+81 từ P1.2) |
| Typecheck | Sạch (5 package) |
| Lint | Sạch (0 warning) |
| Installer | 80.8 MB |

---

## 3. Việc tiếp theo — Phase 1

Thứ tự đã thống nhất: **logic thuần trước, UI sau**. Mỗi phần làm xong phải có
unit test riêng và chạy `pnpm typecheck && pnpm lint && pnpm test` trước khi commit.

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P1.1 | Segmenter (tách câu, gom segment) | ✅ Xong |
| P1.2 | Cleaner — header/footer lặp, de-hyphenate, merge dòng, cột đôi | ✅ Xong |
| **P1.3** | **Chapter detector** — mỗi tín hiệu 1 hàm thuần + test riêng, trả điểm số | ⬅️ **Tiếp theo** |
| P1.4 | Parser PDF (`pdfjs-dist`) + DOCX (`mammoth`), interface `DocumentParser` chung | ⬜ |
| P1.5 | Màn hình "Xác nhận cấu trúc chương" — merge/split/rename/xóa | ⬜ |
| P1.6 | Viewer (PDF canvas + text layer, DOCX HTML) + Library grid + resume | ⬜ |

**DoD Phase 1:** Mở PDF & DOCX, thấy danh sách chương đúng, sửa được, thấy segment.

### Ghi chú cho P1.3 (Chapter detector)

Mỗi tín hiệu là một hàm thuần riêng **trả điểm số** (không trả boolean), có
test riêng, rồi một hàm tổng hợp cộng điểm:

- PDF: outline → font size heuristic → regex tiêu đề → vị trí dọc → fallback chia theo trang
- DOCX: heading style → regex trên paragraph in đậm → page break

Đầu vào lấy từ `cleanPages()` của P1.2 — đã có `pageNumber` để dựng
`pageStart`/`pageEnd` cho `Chapter`.

`TextLine` hiện chưa có `fontSize`; P1.3 cần thì **thêm field optional** vào
`cleaner/types.ts`, đừng tạo type song song.

### Chưa có dữ liệu thật

Chưa có file PDF/DOCX Light Novel thật để kiểm chứng chapter detection.
Khi có, chạy `/detect <đường-dẫn-file>` (đã định nghĩa ở
[.claude/commands/detect.md](.claude/commands/detect.md)) để tinh chỉnh ngưỡng.

**Không hardcode ngưỡng theo riêng một file** — mỗi lần chỉnh phải thêm test case
tương ứng vào `packages/parsers/src/chapter-detector/__tests__/`.

---

## 4. Quyết định kỹ thuật đã chốt

Những điều này khác hoặc bổ sung so với `plan.md`, cần biết trước khi sửa code.

### 4.1 Dung lượng audio trong plan.md sai một bậc

`plan.md` ghi 1 vol ≈ 800 MB – 1.2 GB, nhưng ở **Opus 24 kbps** thì
9 giờ × 3000 B/s ≈ **97 MB**. Muốn 1 GB phải cần ~250 kbps.

- Test `packages/shared/src/estimate.test.ts` khoá theo phép tính đúng
- `storageWarnBytes` mặc định chỉnh 20 GB → **5 GB**
- **Ảnh hưởng Phase 2**: Storage Manager phải dùng con số này, đừng theo plan.md

### 4.2 Bundling — hai bẫy chỉ lộ ra ở bản đóng gói

| Vấn đề | Cách xử lý |
|---|---|
| Vite SSR external hoá mọi dependency, asar không có `node_modules` đầy đủ → `Cannot find module 'zod'` | `ssr.noExternal: true` trong `apps/main/vite.config.ts`; chỉ `better-sqlite3` là external (native) |
| `app.getAppPath()` trỏ gốc asar → ghép thành `.../dist/dist/...` → cửa sổ trống | Dùng `__dirname`; `apps/main/src/window.test.ts` khoá lại |
| `electron-store` là ESM-only, `require()` từ bundle CJS sẽ lỗi | Đã nằm trong `noExternal` ở trên |

CI có bước smoke test khởi động bản đóng gói + kiểm tra renderer nạp được qua CDP,
để những lỗi kiểu này không lọt.

### 4.3 IPC — renderer phải bắt cả rejection

Handler bên main không throw (đã bọc ở `apps/main/src/ipc/wrap.ts`), **nhưng**
`ipcRenderer.invoke` vẫn reject được khi kênh chưa đăng ký hoặc main chết.
Không bắt thì UI kẹt ở "Đang tải…" vĩnh viễn.

→ Mọi store phía renderer gọi IPC **phải** có `try/catch`. Xem mẫu ở
`apps/renderer/src/stores/settings-store.ts`.

### 4.4 `AppSettingsPatch` thay cho `Partial<AppSettings>`

Dự án bật `exactOptionalPropertyTypes`, mà zod `.partial()` sinh ra `T | undefined`
— không gán được vào `Partial<T>`. Dùng `AppSettingsPatch` trong
`packages/shared/src/types.ts`.

Ngoài ra `settings.update` **lọc bỏ key mang `undefined`** trước khi spread,
nếu không sẽ xoá mất giá trị cũ.

### 4.5 Thán từ tiếng Việt một chữ

Luật "chữ cái đơn trước dấu chấm = viết tắt tên riêng" (`J. R. Tolkien`) đã nuốt
mất `"Ừ."`, `"À."`, `"Ồ."` khiến câu sau bị dính vào — sai ở **mọi đoạn hội thoại LN**.

→ `isInitial()` chỉ nhận **chữ Latin HOA không dấu**. Test khoá ở
`sentence-splitter.test.ts` mục "thán từ một chữ trong hội thoại LN".

### 4.6 Cleaner — ba bẫy phát hiện khi viết test

Cả ba đều là lỗi **xoá/dính mất nội dung thật**, không lộ ra nếu chỉ test
đường đi thuận lợi.

**a) Thay số bằng `#` khi so khớp header là chưa đủ.**
Ý tưởng ban đầu: chuẩn hoá `\d+` → `#` để "Trang 12" và "Trang 137" cùng một
mẫu. Nhưng thế thì hai câu **thân bài** khác nội dung mà cùng khung số cũng
trùng khoá → xoá mất cả đoạn văn.
→ Gộp khoá theo **phần chữ** (`letterPartOf`, bỏ hẳn cụm số), thêm lưới an
toàn `maxLength` (mặc định 80): running head thật luôn ngắn.
`normalizeForMatch` vẫn export để test riêng phần chuẩn hoá.

**b) Luật "dòng ngắn" trong merge-lines phải đo trên dòng nguồn.**
Đo trên biến tích luỹ `current` thì nó dài dần sau mỗi lần nối, luật không
bao giờ bắn nữa. Và dòng ngắn phải đứng **riêng hẳn một khối** — chặn cả hai
phía; chỉ chặn phía trước thì dòng sau vẫn dính vào tiêu đề.

**c) Trung vị, không phải trung bình.**
Một tiêu đề ngắn đủ kéo trung bình xuống khiến dòng thân bài bình thường bị
coi là ngắn. Thêm `minLinesForStats` (mặc định 5): dưới ngưỡng thì **tắt hẳn**
luật, vì với 2–3 dòng thì câu cuối ngắn tự nhiên sẽ bị cắt oan.

### 4.7 Thứ tự pipeline cleaner là bắt buộc

`stripHeadersFooters` → `reorderColumns` → `dehyphenate` → `mergeLines`.

- Header/footer phải bỏ **trước** khi sắp cột, nếu không số trang nằm giữa
  trang làm nhiễu thống kê rãnh.
- `dehyphenate` phải chạy **trước** `mergeLines` vì nó cần thấy ký tự `\n`.

Đổi thứ tự thì test `cleaner.test.ts` mục "pipeline đầy đủ" sẽ đỏ.

### 4.8 TypeScript project references — đã bỏ

`@ln/shared` trỏ thẳng vào `src/*.ts` (không build ra `dist`), nên project
references gây lỗi `TS6305`. Đã bỏ `composite` và `references`, để TS resolve
qua `node_modules`.

---

## 5. Môi trường — đọc kỹ nếu app không chạy

### 5.1 Bắt buộc Node 22

`better-sqlite3` là native module, chỉ nạp được bởi runtime đúng ABI:

| Runtime | ABI | Prebuild |
|---|---|---|
| Node 22.20.0 | 127 | ✅ có |
| Electron 33 | 130 | ✅ có |
| Node 25 | 141 | ❌ **không có** → phải compile, cần VS C++ Build Tools |

Máy dev đã cài **nvm-windows** + Node 22.20.0. Chuyển bằng `nvm use 22.20.0`.
Phiên bản pin trong [.nvmrc](.nvmrc), `engines` giới hạn `>=20 <24`.

`scripts/sqlite-abi.mjs` tự tráo bản `.node` đúng ABI:
- `pnpm test` → gọi `abi:node` trước
- `pnpm dev` / `pnpm build:win` → gọi `abi:electron` trước

Bản build cache ở `.abi-cache/` (đã gitignore).

### 5.2 `ELECTRON_RUN_AS_NODE` — bẫy hay gặp

Terminal tích hợp của VS Code đặt `ELECTRON_RUN_AS_NODE=1`, khiến Electron chạy
như Node thuần → `electron.app` là `undefined`, app không mở cửa sổ nào.

Nếu gặp:

```powershell
$env:ELECTRON_RUN_AS_NODE = $null
pnpm dev
```

Hoặc chạy từ PowerShell/Terminal ngoài VS Code.

### 5.3 Vị trí dữ liệu khi chạy

- **userData**: `%APPDATA%\LN Reader\` (đặt tường minh bằng `app.setName`, nếu
  không Electron lấy tên từ package `@ln/main` tạo thư mục lồng nhau khó hiểu)
- **Log**: `%APPDATA%\LN Reader\logs\app.log` (xoay vòng 2 MB × 5 bản)
- **Crash log**: `%APPDATA%\LN Reader\logs\crash.log` — ghi lỗi xảy ra **trước
  khi** logger sẵn sàng; trước đó loại lỗi này chỉ hiện dialog "Error" trống

---

## 6. Bản đồ mã nguồn

```
packages/shared/src/
  types.ts        Domain model 3 tầng: Chapter → Segment → Word
  ipc.ts          IPC contract (in/out có kiểu) + whitelist channel
  result.ts       Result<T> — handler không throw qua IPC
  schemas.ts      zod, validate ở biên IPC
  estimate.ts     Ước lượng thời lượng/dung lượng trước khi generate
  constants.ts    SEGMENT_MAX_CHARS, bitrate, ngưỡng job…

packages/parsers/src/
  segmenter/
    sentence-splitter.ts   Tách câu VI/EN (xử lý 「」『』, viết tắt, số thập phân)
    segmenter.ts           Gom câu → segment ≤ 300 ký tự
  cleaner/
    types.ts               TextLine + Page (đầu vào có toạ độ, từ parser PDF)
    header-footer.ts       Loại running head / số trang lặp (khớp theo phần chữ)
    dehyphenate.ts         Nối từ bị ngắt cuối dòng
    merge-lines.ts         Nối dòng bị PDF ngắt giữa câu
    columns.ts             Detect rãnh giữa 2 cột → sắp lại thứ tự đọc
    cleaner.ts             Pipeline 4 bước (thứ tự bắt buộc — mục 4.7)

apps/main/src/
  index.ts                 Entry: settings → logger → DB → IPC → cửa sổ
  window.ts                BrowserWindow frameless, cấu hình bảo mật
  db/migrations.ts         Schema SQL theo version (KHÔNG sửa migration đã phát hành)
  db/migrator.ts           Runner theo PRAGMA user_version
  db/connection.ts         Instance dùng chung, WAL
  ipc/wrap.ts              Bọc handler → Result lỗi (test được, không cần Electron)
  ipc/registry.ts          Gắn vào ipcMain, từ chối channel chưa khai báo
  ipc/handlers/            app / settings / window
  services/paths.ts        NGUỒN DUY NHẤT sinh path + chặn path traversal
  services/settings.ts     electron-store, file hỏng → rơi về mặc định từng field
  services/logger.ts       Log file + xoay vòng

apps/preload/src/
  api.ts                   window.api.* — không lộ ipcRenderer

apps/renderer/src/
  App.tsx                  Shell (màn hình tạm, thay bằng Library ở P1.6)
  lib/theme.ts             Logic theme thuần
  features/theme/          use-theme + ThemeToggle
  features/titlebar/       TitleBar + WindowControls
  stores/settings-store.ts Zustand, có bắt rejection IPC
  styles/theme.css         CSS variables — mọi màu lấy từ đây
```

---

## 7. Quy ước làm việc

- Mỗi phần nhỏ (P1.x) = 1 commit, có test đi kèm
- Chạy `pnpm typecheck && pnpm lint && pnpm test` **trước khi** báo hoàn thành
- Với thay đổi ảnh hưởng UI hoặc đóng gói: **chạy app thật** để kiểm chứng,
  đừng chỉ dựa vào unit test (mục 4.2 là bài học)
- Test phải kiểm tra hành vi thật, không viết test chỉ để tăng số lượng
- **Cập nhật file này trong cùng commit với code**, không để thành commit riêng:
  ngày + hash ở đầu file, mục 2 (số test), mục 3 (dời mũi tên `⬅️`), và thêm
  mục 4/5/8 nếu có quyết định kỹ thuật, bẫy môi trường hay nợ mới

---

## 8. Nợ kỹ thuật

| Việc | Mức | Ghi chú |
|---|---|---|
| `vitest` v2 kéo Vite 5 trong khi project dùng Vite 6 | Thấp | Đã né bằng cách bỏ `vitest.config.ts` khỏi typecheck của renderer. Nâng vitest lên v3 sẽ sạch hơn |
| Chưa có icon ứng dụng | Thấp | electron-builder đang dùng icon Electron mặc định |
| CI chưa chạy lần nào | TB | Workflow đã viết nhưng chưa có push nào kích hoạt để xác nhận |
| `@electron/rebuild` là dependency thừa | Thấp | electron-builder đã có sẵn; giữ lại vô hại |
| Ngưỡng cleaner chưa kiểm chứng trên PDF thật | **TB** | `minRatio` 0.6, `maxLength` 80, `shortLineRatio` 0.6, `minGutterRatio` 0.04 đều chọn theo suy luận + test tổng hợp. Khi có file thật phải chạy `/detect` và **thêm test case** cho mỗi lần chỉnh, không sửa ngưỡng trần |
| Cleaner chưa xử lý cột đôi trải qua nhiều trang | Thấp | `detectColumnLayout` xét từng trang độc lập; sách đổi bố cục giữa chương vẫn đúng, nhưng trang có đúng 1 dòng mỗi cột thì rơi về `single` |
