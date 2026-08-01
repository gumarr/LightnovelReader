# Tiến độ — LN Reader

> File này ghi lại **trạng thái công việc** để phiên làm việc sau tiếp tục được ngay.
> Kế hoạch tổng thể ở [plan.md](plan.md), quy tắc code ở [CLAUDE.md](CLAUDE.md).
>
> **Cập nhật lần cuối:** 2026-08-01 · commit `20515de`
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

# Sidecar Python (từ P2.1) — venv riêng, xem mục 5.4
cd sidecar && py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
cd .. && pnpm test:sidecar

# Chạy thật supervisor + hàng đợi generate với sidecar Python + model 63 MB
# (ngoài pnpm test — xem apps/main/probe/). Cần voice đã tải trong userData.
npx vitest run -c apps/main/probe/vitest.config.ts

# Đóng gói sidecar thành .exe. `pnpm build:win` tự gọi bước này rồi preflight
# kiểm lại (mục 4.44) — không còn phải nhớ thứ tự như trước.
pnpm build:sidecar

# Kiểm UI trong app đang chạy bằng CDP — đo màu, chiều cao, số dòng thật.
# Bắt được hai loại lỗi vitest không thể bắt (mục 4.45).
pnpm ui-check              # bản dev
pnpm ui-check --packaged   # bản đã build:win
```

Nếu `pnpm dev` không mở được cửa sổ: xem **mục 5.2** (biến `ELECTRON_RUN_AS_NODE`).

**Việc tiếp theo:** Phase 5 xong hết. Hai việc song song:
1. **Publish release** + kiểm nhánh cập nhật trên bản cài thật (mục 3, mục 8).
2. **Phase 6 — đổi engine TTS** vì user thấy giọng Piper không hợp đọc LN. Bắt
   đầu bằng **P6.1** (cải tiến `estimate`), xem `plan.md` và mục 4.79.

**Phase 1, 2, 3 đã xong.** **Phase 4 (CTC forced alignment) đã BỎ** — user nghe
thật một chương thấy highlight bám đúng nhịp, không đáng đổi lấy model ~300 MB.
Xem mục 4.68 để biết lý do đầy đủ và **điều kiện mở lại**.

**Phase 5 đang làm: P5.1 → P5.4 xong** (giọng VI thứ hai + nghe thử giọng; UI sửa
cách đọc — trả nợ treo từ P3.5; màn Cài đặt + ba nợ mức TB; dấu trang + thống kê
đọc + bảng hàng đợi — nối ba thứ hạ tầng đã dựng sẵn mà chưa ai gọi tới).

---

## 2. Đã hoàn thành

### Phase 0 — Scaffold ✅ (DoD đạt đủ 5/5)

| Mục DoD | Trạng thái | Ghi chú |
|---|---|---|
| Monorepo pnpm + Electron + Vite + React + TS | ✅ | 5 package, strict mode đầy đủ |
| Custom titlebar | ✅ | Frameless, nút gọi qua IPC |
| Theme provider (dark/light/system) | ✅ | Đã xác minh bằng ảnh chụp cả 2 chế độ |
| SQLite + migration runner | ✅ | Schema v1, WAL, chạy thật khi mở app |
| CI build Windows portable | ⚠️ | Workflow đã viết + đã sửa lỗi lần chạy đầu (mục 4.14), nhưng job `build` chưa xác nhận xanh lần nào |

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

**Đã kiểm chứng trên PDF thật** (2 file trong `samples/`, 30 trang mỗi file):

| Kết quả | VI có outline | EN không outline |
|---|---|---|
| Header/footer bắt đúng | ✅ số trang | ✅ `Page N \| Kuku Moms House` |
| Xoá nhầm nội dung | ✅ không | ✅ không |
| Nhận nhầm 2 cột | ✅ 0/30 trang | ✅ 0/30 trang |

Tìm ra **1 lỗi thật** mà unit test không lộ — xem mục 4.9.

### Phase 1 — P1.3 Chapter detector ✅

Năm tín hiệu, mỗi tín hiệu một hàm thuần **trả điểm số** + test riêng:

| File | Tín hiệu | Trọng số | Test |
|---|---|---|---|
| `signals/outline.ts` | Mục outline/bookmark | 3.0 | 16 |
| `signals/font-size.ts` | Cỡ chữ lớn hơn thân bài | 1.5 | 13 |
| `signals/pattern.ts` | Regex tiêu đề VI/EN | 1.5 | 14 |
| `signals/position.ts` | Đầu trang + khoảng trắng + trang thưa | 0.6 / 0.4 | 16 |
| `signals/toc.ts` | Loại trang mục lục (bộ lọc, không phải điểm) | — | 11 |
| `detector.ts` | Cộng điểm, dựng chương, fallback theo trang | — | 18 |

**Đã kiểm chứng trên file thật — kết quả chính xác tuyệt đối:**

| | VI có outline (270 tr.) | EN không outline (259 tr.) |
|---|---|---|
| Chương phát hiện | **10/10** khớp outline | **3/3** (Prologue, Chapter 1, Chapter 2) |
| Khoảng trang | ✅ khớp hoàn toàn | ✅ khớp |
| False positive | 0 | 0 |
| Điểm thật vs nhiễu | 5.15–6.36 vs < 3.3 | 1.41–1.86 vs < 0.77 |

Biên giữa thật và nhiễu rất rộng ở cả hai file → ngưỡng 1.4 không phải may mắn.

### Phase 1 — P1.4 Parser PDF + DOCX ✅

| File | Vai trò | Test |
|---|---|---|
| `parser/types.ts` | Interface `DocumentParser`, `ParsedDocument`, `ParseError` | — |
| `parser/pdf.ts` | pdfjs → Page[], đọc outline, phát hiện PDF scan | 32 |
| `parser/docx.ts` | mammoth → HTML → khối → Page[] | 29 |
| `parser/registry.ts` | Chọn parser theo đuôi file | 15 |
| `parser/node-parsers.ts` | Nối thư viện thật (chỗ **duy nhất** chạm pdfjs/mammoth) | — |

**Đã chạy thật trên cả 4 file mẫu, trọn đường đi file → parser → cleaner →
detector → segmenter:**

| File | format | hasRealPages | Chương | Segment |
|---|---|---|---|---|
| PDF VI có outline (270tr) | pdf | true | 10 | 4818 |
| PDF EN không outline (140tr) | pdf | true | 3 | 2889 |
| DOCX có heading (381 đoạn) | docx | false | 2 | 430 |
| DOCX không heading (217 đoạn) | docx | false | 1 | 235 |

Tìm ra **3 lỗi thật** khi nối các phần lại — xem mục 4.16.

### Phase 1 — P1.5 Màn xác nhận cấu trúc chương ✅

UI đầu tiên dùng tới toàn bộ tầng logic. Chia bốn tầng đúng ràng buộc kiến trúc:

| File | Vai trò | Test |
|---|---|---|
| `shared/chapter-draft.ts` | merge/split/rename/xoá/loại trừ + `validateDraft` — **hàm thuần** | 37 |
| `main/services/import-session.ts` | Giữ tài liệu đã parse, sinh preview theo khoảng trang | 23 |
| `main/ipc/handlers/import.ts` | 4 kênh `import:*`, đổi `ParseError` → mã lỗi riêng | 20 |
| `renderer/stores/import-store.ts` | State + hoàn tác, nối IPC | 36 |
| `renderer/features/import/ChapterConfirm.tsx` | Danh sách chương, sửa tại chỗ | 25 |
| `renderer/features/import/confidence.ts` | Điểm detector → nhãn cho user | 15 |
| `parsers/parser/node-parsers.ts` | Tìm `pdf.worker.mjs` (mục 4.19) | 4 |

Logic sửa chương đặt ở `packages/shared` (không phải renderer) vì đó là quy
tắc miền có bất biến thật — vùng trang không chồng, không âm — và P1.6 dùng lại.

**Đã chạy thật trên bản đóng gói** (không chỉ unit test): gọi
`window.api.import.parseFile` qua CDP trên `.exe` đã build:

| File | Kết quả |
|---|---|
| PDF VI có outline | ✅ 270tr → 10 chương, outline=true |
| PDF EN không outline | ✅ 259tr → 5 chương |
| **PDF scan (C1)** | ✅ báo `PDF_NO_TEXT_LAYER`, không crash |
| DOCX A4 / B3 | ✅ 2 chương / 1 chương |

Tìm ra **2 lỗi đóng gói** mà unit test không lộ (mục 4.19) và **2 lỗi UI** chỉ
thấy được bằng mắt trên ảnh chụp thật (mục 4.20).

Đã xem cả **dark lẫn light** trên bản đóng gói — mọi màu lấy từ CSS variable.

### Phase 1 — P1.6a Lưu sách + dựng segment ✅

P1.6 chia ba phần làm tuần tự (thống nhất với user): **a)** lưu sách + segment,
**b)** Library + resume, **c)** Viewer. Đây là phần a.

| File | Vai trò | Test |
|---|---|---|
| `parsers/segmenter/chapter-segments.ts` | Dựng segment **theo trang** + neo về tài liệu gốc | 24 |
| `main/db/repositories/books.ts` | Truy vấn sách, tìm theo hash, resume | 24 |
| `main/db/repositories/chapters.ts` | Chương, insert theo transaction | ↑ |
| `main/db/repositories/segments.ts` | Segment, anchor lưu JSON | ↑ |
| `main/services/library.ts` | Copy file, hash SHA-256, dựng segment, lưu DB | 17 |
| `main/ipc/handlers/library.ts` | `library:saveBook`, `library:list` | 14 |

**Đã chạy thật trên bản đóng gói**, gọi IPC như UI:

| | Kết quả |
|---|---|
| PDF VI 270tr | 10 chương, **4817 segment**, 397ms |
| DOCX A4 | 2 chương, 430 segment, 24ms |
| Import lại cùng file | `duplicate=true`, không tạo bản sao |
| `library:list` | Đọc lại đúng từ SQLite |

Kiểm chứng dữ liệu trong DB (không chỉ tin API trả về):

- Khoảng trang khớp outline: `Chương Một tr 17–76`, `Chương Hai tr 77–132`…
- Neo PDF đúng: `page=15 rects=1`, câu trải 2 dòng cho `rects=2`
- Neo DOCX: `nodePath=p:1`, `p:2`
- **0/5247** segment chứa `\n` hoặc vượt 300 ký tự — các bản sửa ở P1.4 giữ
  nguyên hiệu lực ở quy mô thật
- **0/4817** segment PDF thiếu `rects` (xem mục 4.21)

### Phase 1 — P1.6b Library grid + resume ✅

| File | Vai trò | Test |
|---|---|---|
| `main/ipc/handlers/library.ts` | Thêm `openBook` / `setProgress` / `removeBook` | 29 |
| `renderer/stores/library-store.ts` | Danh sách sách + sách đang mở | 17 |
| `renderer/features/library/LibraryGrid.tsx` | Grid, nút đọc tiếp, xoá sách | 16 |
| `renderer/features/library/BookCard.tsx` | Thẻ sách + bìa tạm | ↑ |
| `renderer/features/library/BookDetailView.tsx` | Mục lục chương, đánh dấu chương đọc dở | 9 |
| `renderer/features/library/format.ts` | Thời gian tương đối, chữ cái bìa | 14 |

`App.tsx` giờ điều hướng ba màn: thư viện → nhập sách → chi tiết sách. **Chưa
dùng router** — ba màn, không có URL cần chia sẻ, Electron không có thanh địa
chỉ; thêm router lúc này là thêm phụ thuộc mà chưa cần.

**Đã chạy thật trên bản đóng gói, xem cả dark lẫn light:**

- Grid hiện đúng 2 sách với bìa tạm phân biệt được (`SD` / `SV`), nhãn định
  dạng, số chương, và trạng thái đọc khác nhau ("Vừa xong" / "Chưa đọc")
- Nút "Đọc tiếp" trỏ đúng sách vừa mở
- Màn chi tiết DOCX hiện **"Đoạn 1–164"** chứ không phải "Trang" — cờ
  `hasRealPages` đi đúng suốt từ parser tới UI

Sửa một lỗi bố cục chỉ thấy khi nhìn ảnh: thẻ 150px không đủ chỗ cho
`N chương · M segment`, chữ tràn thành ba dòng. Số segment chuyển vào tooltip
— vẫn tra được vì đó là thứ quyết định dung lượng audio ở Phase 2.

Nút xoá có hộp thoại xác nhận, nói rõ mất bao nhiêu chương và file gốc vẫn
còn: xoá sách là mất luôn cấu trúc chương user đã sửa tay ở màn xác nhận,
một cú bấm nhầm không được phép huỷ công đó.

### Phase 1 — P1.6c Viewer PDF + DOCX ✅

| File | Vai trò | Test |
|---|---|---|
| `main/services/docx-html.ts` | Sanitize + đánh số khối HTML của mammoth | 19 |
| `main/ipc/handlers/reader.ts` | `getBookFile` / `getBookHtml` / `listSegments` | 14 |
| `renderer/features/reader/windowing.ts` | Ảo hoá: offset cộng dồn, tìm nhị phân, cuộn tới | 26 |
| `renderer/features/reader/pdf-document.ts` | Nạp pdfjs, đo trang, vẽ canvas | — |
| `renderer/features/reader/PdfViewer.tsx` | Cuộn liên tục, chỉ render trang trong tầm nhìn | — |
| `renderer/features/reader/PdfPage.tsx` | Canvas một trang + lớp phủ `rects` | — |
| `renderer/features/reader/DocxViewer.tsx` | Render HTML, tô khối theo `nodePath` | 8 |
| `renderer/features/reader/docx-anchor.ts` | Đọc `p:<index>` → phần tử | 9 |
| `renderer/features/reader/SegmentList.tsx` | Danh sách segment có ảo hoá | 7 |
| `renderer/features/reader/ReaderScreen.tsx` | Ghép viewer + panel + ghi tiến độ | 12 |
| `renderer/stores/reader-store.ts` | Nội dung sách + segment đang chọn | 15 |

**Phạm vi đã thống nhất với user:** chỉ viewer full-width, panel segment bật/tắt
được. **Chưa** dựng khung 2/3–1/3 với subtitle pane như mockup `plan.md`: pane đó
chỉ có nghĩa khi đã có timing từng từ (Phase 2), dựng sẵn khung rỗng là đúng thứ
CLAUDE.md cấm.

**Đã chạy thật trên bản đóng gói, cả dark lẫn light:**

- PDF 270 trang: cuộn liên tục, mỗi lúc chỉ 2–3 canvas sống, vùng cuộn cao
  179 280px. Canvas vẽ ở 864×1296 (đã nhân `devicePixelRatio`), đo được
  29 733 pixel khác trắng — tức nội dung thật chứ không phải canvas trắng.
- **Neo đúng trên sách thật:** bấm segment ở chương 2 → nhảy tới trang 77, vẽ
  4 ô highlight phủ đúng đoạn văn của segment đó, nằm trong khung nhìn.
- DOCX: 388 khối, giữ 2 `<h1>`, **không** còn `<script>` hay thuộc tính lạ nào
  sau sanitize. Bấm segment → tô đúng khối `data-block="2"`.
- Ghi tiến độ đọc chạy thật: mở lại sách thì nút đổi từ "Đọc" sang "Đọc tiếp".

### Phase 2 — P2.1 Sidecar skeleton + text normalize ✅

Phần đầu của Phase 2. **Chưa có engine TTS nào** — cố ý, vì dựng route
`/synthesize` trả mock là đúng thứ CLAUDE.md cấm.

| File | Vai trò | Test |
|---|---|---|
| `sidecar/app/config.py` | Đọc env do main đặt lúc spawn | 12 |
| `sidecar/app/auth.py` | Middleware `X-Session-Token`, so token thời gian hằng | 4 |
| `sidecar/app/main.py` | FastAPI: `/health`, `/normalize` | 14 |
| `sidecar/app/server.py` | Bind socket + bắt tay stdout | 10 |
| `sidecar/app/schemas.py` | pydantic cho mọi biên vào-ra | — |
| `sidecar/app/text/numbers_vi.py` | Đọc số VI ("lăm"/"mốt"/"tư"/"lẻ") | 35 |
| `sidecar/app/text/numbers_en.py` | Đọc số EN + năm kiểu Anh | ↑ |
| `sidecar/app/text/normalize_vi.py` | 8 luật, mỗi luật một hàm thuần | 48 |
| `sidecar/app/text/normalize_en.py` | Như trên, ngày tháng kiểu Mỹ | 42 |
| `sidecar/app/text/__init__.py` | Registry chọn normalizer theo `lang` | — |

**Đã chạy thật như tiến trình con** (không chỉ `TestClient`):

| | Kết quả |
|---|---|
| Bắt tay stdout | `LN_SIDECAR_READY {"host":"127.0.0.1","port":54757,...}` |
| `/health` không token | 200 — main chẩn đoán được cả khi token lệch |
| `/normalize` thiếu/sai token | 401, hai trường hợp trả **giống hệt nhau** |
| Chỉ nghe loopback | Nối qua `192.168.1.9` **bị từ chối** |

**Đã chạy normalize trên 2429 segment thật** lấy từ sách mẫu qua
`probe/dump-segments.test.ts` (parser → cleaner → segmenter thật):
0 lỗi, 0 segment mất nội dung, chỉ 3 segment còn chữ số — cả 3 đều **đúng**
(`A2`, `F1` là mã hạng dính chữ, không được tách).

Tìm ra **1 lỗi nặng** mà 90 unit test không lộ — xem mục 4.25.

### Phase 2 — P2.2 Supervisor sidecar bên main ✅

Nối sidecar vào vòng đời app: spawn cùng app, health check 5s, tự dựng lại khi
chết, hết lượt thì báo UI. Chia bốn tầng vì bốn thứ hỏng theo cách khác nhau —
gộp lại thì không test được tầng nào mà không dựng tầng kia:

| File | Vai trò | Test |
|---|---|---|
| `services/sidecar-paths.ts` | Tìm sidecar: venv lúc dev vs `.exe` lúc đóng gói | 10 |
| `services/sidecar-process.ts` | Spawn, đọc bắt tay stdout, timeout, kill sạch | 24 |
| `services/sidecar-client.ts` | HTTP client kèm `X-Session-Token`, timeout riêng cho health | 13 |
| `services/sidecar-supervisor.ts` | Health check, chính sách restart, trạng thái | 23 |
| `services/sidecar-spawn.ts` | Nối `child_process` thật (chỗ **duy nhất** chạm nó) | — |
| `ipc/handlers/sidecar.ts` | `sidecar:getStatus` — chỉ đọc, không cho renderer restart | 3 |

**Đã chạy thật với sidecar Python thật** (`apps/main/probe/`, 5 kịch bản):

| | Kết quả |
|---|---|
| Khởi động + `/health` + `/normalize` | ✅ bắt tay khớp giữa Python và TS, token được chấp nhận |
| Giết PID thật | ✅ phát hiện → dựng lại, cổng **65056 → 61399** (tiến trình mới thật) |
| `stop()` | ✅ Python chết hẳn, cổng được nhả, không mồ côi |
| Token sai / thiếu | ✅ 401 cả hai |
| Hỏng cố định (thiếu env) | ✅ hết lượt → `failed`, không quay vòng vô tận |

**Đã chạy thật trong app Electron** (không chỉ probe): app lên → log
`Sidecar sẵn sàng ở cổng 63023`, `/health` trả `{"status":"ok"}`; **đóng cửa sổ
thì tiến trình Python chết theo**, không còn `python.exe` nào và cổng được nhả.

Tìm ra **1 lỗi thật** mà 71 unit test không lộ — xem mục 4.27.

### Phase 2 — P2.3 Voice manager + đóng gói sidecar ✅

Hai việc trong một phần: voice manager (P2.3 theo kế hoạch) và **đóng gói
sidecar** — nợ mức Cao đã chặn P2.4, làm luôn ở đây theo đúng ghi chú phiên trước.

| File | Vai trò | Test |
|---|---|---|
| `resources/voices/catalog.json` | Catalog tĩnh, **sha256 lấy thật** (xem 4.28) | 4 |
| `sidecar/app/voices/catalog.py` | Đọc catalog, soi đĩa xem đã cài chưa (thuần) | 38 |
| `sidecar/app/voices/download.py` | Tải + băm theo dòng chảy + dọn khi hỏng | 19 |
| `sidecar/app/main.py` | `/voices`, `/voices/catalog`, `/voices/{id}/download` (SSE), `DELETE` | 32 |
| `sidecar/entry.py` | Điểm vào cho PyInstaller (xem 4.29a) | 8 |
| `sidecar/build.py` | PyInstaller onedir → `ln-sidecar.exe` | ↑ |
| `main/services/sidecar-client.ts` | Thêm 4 hàm voice + **đọc SSE** | 20 |
| `main/services/sidecar-paths.ts` | `resolveVoiceCatalogPath` — dev vs đóng gói | 14 |
| `main/ipc/handlers/voices.ts` | 5 kênh `voices:*`, tải chạy nền, chặn tải trùng | 20 |
| `renderer/stores/voice-store.ts` | Catalog + tiến độ theo `voiceId` | 18 |
| `renderer/features/voices/VoiceManager.tsx` | Màn quản lý giọng đọc | 19 |
| `renderer/features/voices/SidecarBadge.tsx` | **Trạng thái sidecar** — nợ P2.2 | ↑ |
| `renderer/features/voices/format.ts` | Dung lượng, phần trăm, nhãn trạng thái | 18 |

**Đã chạy thật với `.exe` do PyInstaller sinh** (không chỉ venv):

| | Kết quả |
|---|---|
| Bắt tay stdout từ `.exe` | ✅ `LN_SIDECAR_READY {...,"port":50065,...}` |
| `/voices/catalog` qua `.exe` | ✅ 2 voice, sha256 đúng như catalog |
| Tải voice VI **63 MB thật** từ HF | ✅ `downloading → verifying → done` |
| sha256 file tải về | ✅ khớp `ec7c89e2…` — đối chiếu bằng `sha256sum` |
| **sha256 cố tình sai** | ✅ từ chối, **xoá sạch thư mục**, không để lại file nào |
| `DELETE /voices/{id}` | ✅ `removed:true`, thư mục biến mất |
| Token sai / thiếu | ✅ 401 |

**Đã chạy thật trên BẢN ĐÓNG GÓI** (`.exe` app + `.exe` sidecar, qua CDP):

| | Kết quả |
|---|---|
| Sidecar `.exe` trong `resources/sidecar/` | ✅ `state: ready`, cổng 60569 |
| Catalog từ `resources/voices/` | ✅ đọc được 2 voice |
| Tải voice trong app đóng gói | ✅ **66 mốc SSE** tới được UI, xong ở 100% |
| Sau khi tải | ✅ nhãn "Đã cài" hiện, nút đổi thành "Xoá", `listInstalled` có 1 |
| Màu thanh tiến trình (dark) | ✅ `rgb(129, 140, 248)` — **không** trong suốt (bài học 4.23) |
| Màu badge (light) | ✅ `rgb(79, 70, 229)`, nền `rgb(255,255,255)` |
| Đóng app | ✅ `ln-sidecar.exe` chết theo, không mồ côi |

Tìm ra **1 lỗi đóng gói** mà 245 test sidecar không lộ — xem mục 4.29.

### Phase 2 — P2.4 Piper engine + `/synthesize` ✅

Lần đầu app sinh ra audio thật. Chia theo **thứ hỏng theo cách khác nhau**: ba
hàm thuần trên mảng numpy (test không cần voice 63 MB), rồi engine, rồi route.

| File | Vai trò | Test |
|---|---|---|
| `sidecar/app/audio/resample.py` | Polyphase 22050→24000 (xem 4.30) | 21 |
| `sidecar/app/audio/encode.py` | Opus trong `.ogg`, bitrate 16/24/32 (4.31) | 19 |
| `sidecar/app/audio/timings.py` | Phoneme alignment → `WordTiming` (4.32) | 23 |
| `sidecar/app/audio/paths.py` | Chặn ghi ra ngoài `audioDir` (4.33) | 7 |
| `sidecar/app/engines/piper.py` | Nạp + cache model, `engine_ready` thật | 16 |
| `sidecar/app/main.py` | `POST /synthesize`, `/health` báo engine thật | +9 |
| `main/services/sidecar-client.ts` | `synthesize()` + giữ `detail` lỗi thật | +8 |
| `main/services/sidecar-process.ts` | Truyền `LN_SIDECAR_AUDIO_DIR` | +2 |
| `main/services/sidecar-supervisor.ts` | `audioDir` là **hàm** — user đổi được | +1 |
| `shared/types.ts` | `TimingSource`, `SynthesisResult` | — |

**Đã chạy thật với model `vi_VN-vais1000-medium` 63 MB** (không chỉ bản giả):

| | Kết quả |
|---|---|
| Tổng hợp câu VI 13 từ | ✅ 2.81s audio, RTF ~0.76 lần đầu |
| Cache model | ✅ 1.58s → **0.07s** cho segment kế (23×) |
| Timing từ phoneme thật | ✅ 13/13 từ khớp, mốc nối liền nhau |
| Nhiều câu một segment | ✅ `"Ừ. À. Ồ."` 3 chunk → 3 từ (xem 4.32) |
| Chữ số rơi về ước lượng | ✅ `"Lớp 11-5 có 30…"` → `estimate`, không gán lệch |

**Đã chạy thật với `.exe` PyInstaller** (đường đi mà unit test không chạm tới):

| | Kết quả |
|---|---|
| Bắt tay stdout từ `.exe` | ✅ `LN_SIDECAR_READY {...,"port":54402,...}` |
| `/synthesize` qua `.exe` | ✅ 4.25s (gồm nạp model), `timingSource: phoneme` |
| File `.ogg` sinh ra | ✅ magic `OggS`, 24000 Hz, 2.74s, **RMS 0.168** — tiếng thật |
| Lần 2 (cache) | ✅ **0.11s** |
| `engine_ready` | ✅ `false` → `true` sau lượt đầu, kèm `loaded_voice_id` |
| Đóng app | ✅ không còn tiến trình mồ côi |

Tìm ra **1 lỗi đóng gói** mà 340 test không lộ — xem mục 4.34.

### Phase 2 — P2.5 Job queue persist SQLite ✅

Hàng đợi generate nằm trong SQLite, chạy tuần tự một worker, dừng/huỷ được.
Bảng `jobs` đã có sẵn từ schema v1 nên **không cần migration mới**.

| File | Vai trò | Test |
|---|---|---|
| `main/services/timings-store.ts` | Ghi/đọc `{segmentId}.json` — **trả nợ P2.4** | 16 |
| `main/db/repositories/jobs.ts` | enqueue/claim/retry/cancel, priority, khôi phục | 36 |
| `main/db/repositories/segments.ts` | Vòng đời generate + dồn `audio_bytes` lên chương | +13 |
| `main/services/queue.ts` | Worker tuần tự, pause/resume/cancel, `AbortSignal` | 44 |
| `main/ipc/handlers/queue.ts` | 9 channel `queue:*` | 22 |
| `preload/api.ts` | `window.api.queue.*` + 2 event | +2 |
| `shared/ipc.ts` | `QueueStatusInfo`, `EnqueueResult`, event tiến độ | — |
| `shared/types.ts` | `AppSettings.voiceVi` / `voiceEn` (xem 4.36) | — |

**Đã chạy thật với sidecar + model 63 MB + SQLite + đĩa thật**
(`probe/queue-real.test.ts`, ngoài `pnpm test`):

| | Kết quả |
|---|---|
| Generate cả chương 3 segment | ✅ 1.83s, cả 3 `ready` |
| File `.ogg` là audio thật | ✅ magic `OggS`, > 9 KB mỗi file |
| `audioBytes` trong DB vs đĩa | ✅ khớp từng byte |
| Timing ghi ra đĩa (nợ P2.4) | ✅ 13–14 từ/segment, `timingSource: phoneme` |
| Bitrate settings có tác dụng | ✅ 16 kbps → 6797 B · 32 kbps → **12574 B** |
| Khôi phục job mồ côi | ✅ job kẹt `running` chạy lại và xong |
| Huỷ giữa chừng | ✅ cắt thật, segment về `pending` cả 3 |

Tìm ra **1 lỗi thật mà 1319 unit test không lộ** — xem mục 4.35.

### Phase 2 — P2.6 Generate theo chương + prefetch + ước lượng ✅

Lần đầu renderer bấm được vào hàng đợi. Trước P2.6 cả 9 channel `queue:*` đã
chạy thật qua probe nhưng **không có nút nào** — đây là phần nối UI vào.

| File | Vai trò | Test |
|---|---|---|
| `main/db/repositories/segments.ts` | `pendingStats*` đếm ký tự bằng SQL, `listPendingByBook` | +9 |
| `main/db/repositories/chapters.ts` | `audioBytesByBook` — dung lượng đã sinh | +3 |
| `main/ipc/handlers/queue.ts` | `enqueueBook`, `estimateChapter`, `estimateBook` | +12 |
| `shared/estimate.ts` | `estimateFromTotals` — cùng công thức, nhận số tổng | +3 |
| `renderer/stores/queue-store.ts` | Status + event, prefetch chống trùng | 27 |
| `renderer/features/generate/format.ts` | `queuePercent`, nhãn, mốc prefetch (thuần) | 20 |
| `renderer/features/generate/GenerateEstimateDialog.tsx` | Hộp xác nhận **bắt buộc** trước generate | 11 |
| `renderer/features/generate/QueueProgress.tsx` | Thanh tiến độ + pause/resume/huỷ | ↑ |
| `renderer/features/generate/GenerateControls.tsx` | Nút theo chương + cả sách | 15 |
| `renderer/features/voices/VoiceRow.tsx` | Nút **"Dùng giọng này"** — nợ P2.5 | +10 |
| `renderer/features/reader/ReaderScreen.tsx` | Nối generate + prefetch 80% + event | +11 |
| `renderer/features/reader/SegmentList.tsx` | Dấu trạng thái audio từng segment | +4 |
| `renderer/features/library/BookDetailView.tsx` | Nút cả sách + dung lượng theo chương | +6 |

**Đã chạy thật với sidecar + model 63 MB + SQLite + đĩa thật**
(`probe/queue-real.test.ts`, 2 kịch bản mới):

| | Kết quả |
|---|---|
| Ước lượng dung lượng vs đĩa thật | ✅ 33 600 B ước · **28 498 B thật** (lệch −15%) |
| Ước lượng thời lượng vs đo thật | ✅ 11 200 ms ước · 8 533 ms thật (−24%) |
| Ước lượng thời gian xử lý | ✅ 1 680 ms ước · 2 045 ms thật (+22%), **RTF thật 0.24** |
| `existingBytes` sau khi generate | ✅ khớp tổng byte trên đĩa từng byte |
| `enqueueBook` bỏ segment đã xong | ✅ 1 segment sẵn có → chỉ thêm 2 job |
| `chapters.audio_bytes` vs segment con | ✅ khớp, chương lên `complete` |

Ba con số ước lượng đều lệch dưới 25% so với thật → **giữ nguyên hằng số**
`CHARS_PER_SECOND_ESTIMATE = 15` và `SYNTHESIS_RTF_ESTIMATE = 0.15`. Đây là
lần đầu chúng được đối chiếu với số đo thật (nợ mục 8 đã trả).

**Chưa chạy trên bản đóng gói.** Toàn bộ phần UI ở đây mới chỉ có unit test +
probe qua handler thật; chưa mở app thật để xem hộp ước lượng và thanh tiến độ
ở cả dark lẫn light. Xem mục 8.

### Phase 2 — P2.7 Storage Manager ✅

Phần cuối của Phase 2. Đây cũng là **chỗ duy nhất trong app xoá file của user** —
import chỉ copy vào, hàng đợi chỉ ghi ra, mọi đường xoá đều đi qua
`services/storage.ts`.

| File | Việc | Test |
|---|---|---|
| `main/db/repositories/segments.ts` | `listReady*`, `clearAudioBy{Chapter,Book}` | +13 |
| `main/db/repositories/chapters.ts` | `audioBytesPerBook` (1 query), `audioBytesTotal` | +4 |
| `main/services/storage.ts` | Xoá audio+timing, quét đĩa, dọn mồ côi, xoá file sách | 36 |
| `main/ipc/handlers/storage.ts` | 6 kênh `storage:*`, **huỷ job trước khi xoá** | 16 |
| `main/ipc/handlers/library.ts` | `removeBook` xoá luôn file đã copy (nợ mục 8) | +5 |
| `shared/ipc.ts` | `StorageUsageInfo`, `ChapterUsageInfo`, 6 kênh | — |
| `renderer/stores/storage-store.ts` | Nạp/xoá, chặn bấm trùng, giữ lỗi qua lượt refresh | 22 |
| `renderer/features/storage/format.ts` | `warnPercent`, `usageLevel`, nhãn (thuần) | 18 |
| `renderer/features/storage/StorageManager.tsx` | Màn chính | 28 |
| `renderer/features/storage/DeleteAudioDialog.tsx` | Hộp xác nhận **bắt buộc** trước khi xoá | ↑ |
| `renderer/features/storage/StorageBookRow.tsx` | Hàng sách, mở ra xem từng chương | ↑ |
| `renderer/features/storage/StorageSettings.tsx` | Thư mục audio, bitrate, ngưỡng cảnh báo | ↑ |

**Đã chạy thật trên app đang chạy** (`pnpm dev` + CDP, không chỉ unit test) —
đây là lần đầu UI của Phase 2 được mở bằng mắt:

| Bước | Kết quả |
|---|---|
| Chọn giọng đọc qua UI (nợ P2.5) | ✅ nhắc "đã cài chưa chọn" đúng lúc → bấm xong `voiceVi` vào settings, badge đổi "Đang dùng" |
| Hộp ước lượng cả sách | ✅ 430 đoạn · ~49:20 · ~8.5 MB · ~7:24 — trên sách DOCX thật |
| Generate 1 chương thật | ✅ 190/195 đoạn, ~4 đoạn/giây; 5 đoạn hỏng là **nội dung rỗng/toàn dấu câu** (Piper không sinh audio) — hàng đợi ghi lỗi rồi chạy tiếp, đúng thiết kế |
| Prefetch 80% | ✅ tự xếp chương kế (62/235 đoạn xong trước khi dừng) |
| `audioBytesOnDisk` vs đĩa thật | ✅ **4 560 696 B khớp từng byte** (253 `.ogg` + 252 `.json`) |
| Dung lượng theo chương | ✅ 3 141 990 + 937 940 = 4 079 930 khớp tổng |
| Xoá 1 chương qua UI | ✅ **380 file** (190×2) mất khỏi đĩa (505 → 125), UI về 916 KB, chương thành "Chưa tạo audio" |
| Tiến độ đọc sau khi xoá | ✅ `lastSegmentId` + `resumeChapterId` **còn nguyên**, 195 segment còn đủ |
| Vượt ngưỡng cảnh báo | ✅ thanh 100%, fill đổi sang `rgb(220 38 38)`, hiện đúng câu cảnh báo |
| Màu ở **cả dark lẫn light** | ✅ đo `getComputedStyle`: accent `129 140 248`/`79 70 229`, danger `248 113 113`/`220 38 38` — **không màu nào trong suốt** |
| File `.ogg` là audio thật | ✅ magic `OggS`, timing `source: "phoneme"` từng từ |

Số đo probe lần này (3 segment VI, 24 kbps): ước 33 600 B vs thật **28 205 B**
(−16%), RTF thật **0.24** — khớp lần đo ở P2.6, hằng số vẫn đúng.

### Phase 2 — P2.7b Ba lỗi UI user tìm ra khi dùng thật ✅

User mở app và tìm ra ba lỗi mà **1594 unit test không lộ**. Lần thứ sáu ghi
nhận "test xanh mà UI vẫn hỏng".

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| Màn Nhập sách không có đường ra | Bước chọn file không có nút nào về thư viện — vào rồi kẹt, phải đóng app. Bước xác nhận chương thì có "Huỷ" nên không ai để ý bước trước thiếu | Thêm `← Thư viện` ở góc trên như mọi màn khác + `ImportScreen.test.tsx` (6 test) |
| Không thấy số đoạn lỗi | `generateStatus` chỉ có 3 giá trị; chương 1058 đoạn hỏng 3 đoạn hiện y như chương mới xong nửa. User không biết vì sao chương không bao giờ "Đủ audio" | Migration **v2**: cột `chapters.error_count`, tính LẠI từ segment con trong cùng transaction với `markReady`/`markError`/`resetToPending`. Badge riêng ở màn chi tiết sách + tổng ở header (mục 4.42) |
| Danh sách đoạn bị cắt mất nửa dưới | **Hai lỗi cùng lúc** — xem mục 4.43 | `flex-1 min-h-0` ở khối bọc + đo lại theo `segments.length` |

**Đã kiểm lại trên app đang chạy** (CDP, không chỉ unit test):

| | Kết quả |
|---|---|
| Nút về ở màn Nhập sách | ✅ hiện đúng, bấm về `Thư viện` |
| Số đoạn lỗi trên **dữ liệu thật** | ✅ 5 đoạn hỏng từ lần test P2.7 hiện đúng ở cả chương lẫn header, màu `rgb(248 113 113)` trên nền `rgba(…, 0.12)` |
| Danh sách đoạn lần đầu mở chương | ✅ **15 dòng** (trước khi sửa: 4 dòng), khung 764/811 px |
| Ẩn rồi hiện lại | ✅ vẫn 15 dòng — không còn khác biệt giữa hai đường |

### P2.8 Trả hết nợ kỹ thuật mức Cao ✅

Bốn nợ mức **Cao** trong mục 8, và ba trong bốn cùng cần một thứ: một script CDP
chạy được bằng một lệnh. Không thêm dependency nào — Node 22 có sẵn `WebSocket`
và `fetch`.

| Nợ | Đã làm |
|---|---|
| Đóng gói sidecar chưa vào CI | `build:win` tự gọi `build:sidecar` + `sidecar-preflight.mjs`; CI dựng venv 3.12 ở cả 2 job (mục 4.44) |
| Kiểm bản đóng gói vẫn làm thủ công | `scripts/ui-check.mjs` + `pnpm ui-check` (mục 4.45) |
| Không test nào bắt được lỗi bố cục/chiều cao | Cùng script: đo `clientHeight` + số dòng thật |
| UI Phase 2 chưa kiểm trên bản đóng gói | `pnpm ui-check --packaged` trên `.exe` đã build |

| File | Việc |
|---|---|
| `scripts/ui-check.mjs` | Lái app qua CDP, 24 phép kiểm bằng **số đo thật** |
| `scripts/sidecar-preflight.mjs` | Chặn đóng gói khi sidecar thiếu / không đủ / cũ hơn `.py` |
| `scripts/README.md` | Kiểm những gì, bắt được lỗi loại nào, giới hạn |
| `scripts/dev.mjs` | `LN_REMOTE_DEBUG_PORT` — chỉ mở cổng debug khi được yêu cầu |
| `.github/workflows/ci.yml` | venv Python 2 job, `pnpm test:sidecar`, kiểm `resources/sidecar/` sau đóng gói |
| `StorageManager.tsx` | Thêm `data-testid="storage-back"` |
| `eslint.config.js` | Cho phép `fetch`/`WebSocket`/`Buffer` trong `scripts/**` |

**Đã chạy thật trên CẢ HAI bản** — `pnpm ui-check` và `pnpm ui-check --packaged`,
**24/24 đạt ở cả hai**:

| Phép kiểm | Bản dev | **Bản đóng gói** |
|---|---|---|
| Sidecar lên `ready` | ✅ (venv Python) | ✅ **`.exe` PyInstaller**, cổng 64601 |
| Catalog voice | ✅ 2 voice | ✅ 2 voice, đọc từ `resources/voices/` |
| Ô cuộn cao so với panel | 776 px (90%) | **764/811 px = 94%** |
| Số dòng vs chiều cao khung | 16 dòng (khung ~12) | **15 dòng** (khung ~11) |
| Ẩn rồi hiện lại | 776 px cả hai đường | **764 px cả hai đường** |
| Màu `accent` dark / light | `rgb(129,140,248)` / `rgb(79,70,229)` | ✅ y hệt |
| Nhánh **alpha** `bg-accent/10` | `rgba(…, 0.1)` cả 2 theme | ✅ y hệt — 4.23 chưa quay lại |
| Viewer DOCX | 388 khối, cao 27 366 px | 388 khối, cao 27 058 px |

Bản đóng gói là chỗ duy nhất chứng minh được đường dẫn kiểu asar đúng: sidecar
`.exe` nằm trong `resources/sidecar/` lên được `ready`, và catalog đọc từ
`resources/voices/` — hai đường mà bản dev đi qua venv và gốc repo nên không chạm tới.

Installer sau khi thêm sidecar: **NSIS 143.0 MB**, portable **142.8 MB**
(trước là 80.8 MB). `resources/sidecar/` trong bản giải nén đo được **147 MB**,
đủ cả `_internal/` — tức electron-builder **có** chép trọn onedir.

Viết script này mất **bốn lượt chạy đỏ**, và cả bốn nguyên nhân đều là bẫy của
chính phép kiểm chứ không phải lỗi app — trong đó có một cái mà script này sinh ra
để bắt (`crash.log` do sai ABI). Chi tiết ở mục 4.45; đáng đọc trước khi thêm phép
kiểm mới, vì cả bốn sẽ gặp lại.

### Phase 3 — P3.1 Tầng dữ liệu audio + timing ✅

Phần đầu Phase 3. **Chưa có nút phát nào** — cố ý: đây là tầng cấp audio và mốc
từng từ cho player, dựng UI trước khi có dữ liệu chạy được là dựng khung rỗng.

| File | Vai trò | Test |
|---|---|---|
| `shared/timings.ts` | `splitWords`, `estimateWordTimings`, `wordIndexAt`, `seekMsForChar` — **hàm thuần** | 28 |
| `shared/ipc.ts` | `SegmentAudio` + kênh `reader:getSegmentAudio` | — |
| `main/ipc/handlers/reader.ts` | Đọc `.ogg` + `.json`, ước lượng khi thiếu mốc | +11 |
| `main/index.ts` | `timingsStore` dùng chung hàng đợi ↔ trình đọc | — |
| `preload/api.ts` | `window.api.reader.getSegmentAudio` | +1 |

Bốn quyết định ở mục 4.46–4.49. Tóm tắt:

- **Bytes qua IPC, không phải path** — cùng lý do `BookFileBytes`; segment ~10s ở
  24 kbps chỉ ~30 KB nên structured clone không đáng kể.
- **Audio và timing về trong MỘT lượt** — tách hai kênh thì có cửa sổ mà `.ogg`
  là bản mới còn `.json` là bản cũ, highlight lệch hẳn một câu.
- **Thiếu file timing thì main ước lượng ngay**, renderer không bao giờ nhận
  segment `ready` mà mảng mốc rỗng.
- **Ranh giới từ theo khoảng trắng**, không phải `\w+` — `\w` cắt mất dấu tiếng
  Việt và chẻ đôi `Wi-Fi`, `John's`.

**Đã chạy thật với sidecar + model 63 MB + đĩa thật** (`probe/queue-real.test.ts`,
kịch bản mới) — sinh audio bằng hàng đợi thật rồi đọc lại bằng handler thật:

| | Kết quả |
|---|---|
| Bytes qua handler vs file trên đĩa | ✅ **khớp từng byte**, magic `OggS` |
| Nguồn timing | ✅ `phoneme` — không âm thầm rơi về ước lượng |
| `durationMs` handler vs DB | ✅ khớp (2810 ms) |
| `charStart`/`charEnd` cắt lại đúng chữ | ✅ **13/13 từ** trên text thật |
| Mốc tăng dần, nằm trong thời lượng | ✅ |
| Xoá file `.json` rồi đọc lại | ✅ rơi về `estimate`, **13 từ**, không rỗng |
| Xoá file `.ogg` (DB vẫn `ready`) | ✅ `NOT_FOUND` — player xếp lại hàng đợi được |
| Segment chưa generate | ✅ `NOT_FOUND` cùng mã, không đọc đĩa |

Tìm ra **1 lỗi thật** mà 1667 unit test không lộ — xem mục 4.50. Đây là lần thứ
bảy ghi nhận "test xanh mà đường nối thật hỏng", và lần này nạn nhân là chính
lớp probe dựng ra để bắt loại lỗi đó.

### Phase 3 — P3.2 Playback engine ✅

Lần đầu app phát được audio liên tục. Ràng buộc **user đặt ra** dẫn dắt toàn bộ
thiết kế: *đoạn nào lỗi thì bỏ qua luôn, không làm gián đoạn audio của người dùng.*

| File | Vai trò | Test |
|---|---|---|
| `player/playback-plan.ts` | `decideSegment`, `findNextPlayable`, `tailSkips`, `findPreloadTarget`, `segmentsToPrioritise` — **hàm thuần** | 34 |
| `player/audio-element.ts` | Bọc `<audio>` + Blob URL + preloader — chỗ **duy nhất** chạm DOM audio | 19 |
| `stores/player-store.ts` | Máy trạng thái: `idle`/`playing`/`paused`/`waiting` | 44 |
| `player/usePlayer.ts` | Dựng thẻ audio, nối IPC, nhả Blob URL khi rời | — |
| `player/PlayerBar.tsx` | Nút phát/trước/sau + 6 mốc tốc độ | 15 |
| `player/format.ts` | Nhãn, mốc tốc độ, phần trăm (thuần) | 18 |
| `reader/ReaderScreen.tsx` | Nối player, chuyển `queue:segmentUpdated` sang player | +7 |
| `shared/constants.ts` | `PLAYBACK_LOOKAHEAD_SEGMENTS = 5` | — |
| `test/setup.ts` | Giả `HTMLMediaElement.play/pause/load` + `URL.createObjectURL` | — |

**Bốn đường "bỏ qua", tất cả dồn về một chỗ** (`playAt`) nên quy tắc chỉ cần đúng
một lần:

| Ca | Xử lý |
|---|---|
| `status === 'error'` | Bỏ qua ngay, **không thử lại** — hàng đợi đã cháy hết lượt retry mới đặt `error` |
| Đoạn không có chữ (`...`, `「」`) | Bỏ qua, không xếp hàng đợi. 5/195 đoạn trên sách thật rơi vào ca này |
| `.ogg` cụt, Chromium không giải mã được | Bỏ qua — DB nói `ready`, IPC trả bytes, chỉ trình duyệt mới biết |
| File bị Storage Manager xoá dưới chân player | `NOT_FOUND` → bỏ qua, đi tiếp |

Mười đoạn hỏng liên tiếp vẫn chỉ là **một** lần gọi `findNextPlayable`, không
phải mười vòng sự kiện. Đoạn đã bỏ hiện thành **một dòng chữ nhỏ** ("Đã bỏ qua N
đoạn"), không phải hộp cảnh báo — user đang nghe, không cần bấm gì.

Chi tiết quyết định ở mục 4.51–4.54. Ba điểm đáng nhớ nhất:

- **`waiting` là trạng thái duy nhất user phải chờ**, và chỉ khi audio *chưa sinh
  xong*. Mọi ca khác đều đi tiếp.
- **Store không giữ vị trí phát theo ms** — thứ đó đổi 60 lần/giây. P3.4 đọc thẳng
  `sink.positionMs()` trong `rAF`.
- **Kho nạp trước giữ cả `SegmentAudio`**, không riêng bytes: giữ mỗi bytes thì lúc
  phát vẫn phải gọi IPC lần nữa để lấy timing — đúng quãng trễ nó sinh ra để xoá.

**Đã chạy thật trên app đang chạy** (`pnpm ui-check` qua CDP — jsdom không phát
audio nên đây là chỗ duy nhất chứng minh được):

| Phép kiểm | Số đo thật |
|---|---|
| Thanh player có chiều cao thật | ✅ **46 px** |
| Đủ 6 mốc tốc độ | ✅ 6 |
| Trạng thái ban đầu | ✅ `idle` |
| Nền thanh player | ✅ `rgb(23, 23, 26)` — không trong suốt |
| Nút phát | ✅ `rgb(129, 140, 248)` — không trong suốt |
| **Chromium giữ `preservesPitch`** | ✅ `true` — nền tảng của "đổi tốc độ ≠ regenerate" |
| `playbackRate` đặt được | ✅ `1.5` |
| Bấm mốc 1.5× thì mốc sáng lên | ✅ đi qua đúng chuỗi store → sink → thẻ audio |
| Màu mốc đang chọn | ✅ `rgb(129, 140, 248)` |

`pnpm ui-check` nay có **33 phép kiểm** (24 → 33), **33/33 đạt** ở bản dev.

Tìm ra **1 lỗi thật** mà 1793 unit test suýt không lộ — xem mục 4.53. Lỗi này bị
bắt bởi một test tích hợp ở `ReaderScreen`, không phải test đơn vị của store: nó
chỉ tồn tại ở **chỗ nối** giữa `reader-store` và `player-store`.

### Phase 3 — P3.5 Phiên âm tên riêng Nhật ✅ (trừ UI tầng 3)

**Vấn đề user nêu:** LN dịch trang nào cũng có tên Nhật (Tokyo, Shinkansen,
Asuka…). Piper VI chạy trên phoneme tiếng Việt nên ánh xạ chữ cái theo chính tả
VI → chuỗi âm vô nghĩa. User yêu cầu rõ: **app phải tự xử lý, không bắt user
soạn từ điển.**

| File | Vai trò | Test |
|---|---|---|
| `sidecar/app/text/mapping.py` | `Span`/`NormalizedText`, `apply_replacements`, `compose`, `diff_to_normalized` | 34 |
| `sidecar/app/text/romaji_vi.py` | Bảng ~100 mora + `looks_like_romaji` + ghép âm tiết | 117 |
| `sidecar/app/text/data/lexicon_jp.json` | Từ điển ship sẵn, 193 mục | (qua lexicon) |
| `sidecar/app/text/lexicon_jp.py` | Nạp từ điển + ghép 3 tầng + `transcribe_japanese` | 88 |
| `sidecar/app/text/normalize_vi.py` | `+normalize_vi_mapped` — pipeline trả kèm mapping | (hiện có) |
| `sidecar/app/text/__init__.py` | `+normalize_mapped` theo ngôn ngữ | — |
| `sidecar/app/audio/timings.py` | `+remap_to_source` — quy offset về text gốc | 13 |
| `sidecar/app/main.py` | `/synthesize` dùng `normalize_mapped` + remap trước khi trả | (qua API) |
| `sidecar/app/schemas.py` | `+pronunciations` trong `SynthesizeRequest` (≤500 mục) | — |
| `db/migrations.ts` | v3 `pronunciation_overrides` + 2 unique index một phần | +1 |
| `db/repositories/pronunciations.ts` | CRUD + `lookupTable` gộp toàn cục/theo sách | 22 |
| `services/queue.ts` + `index.ts` | `getPronunciations` đọc lúc chạy, nối vào synthesize | (hiện có) |
| `shared/src/types.ts` | `+PronunciationOverride`, làm rõ ngữ nghĩa `WordTiming` | — |

**Ba tầng, không tầng nào bắt user cấu hình** (đúng yêu cầu user):

1. **Từ điển ship sẵn** (193 mục) — địa danh, xưng hô, thuật ngữ LN.
2. **Luật romaji tự suy** — phủ tên nhân vật từ điển không có. Đo thật:
   **65/65** tên Nhật nhận đúng, **51/51** từ tiếng Anh từ chối đúng.
3. **Override theo sách** — DB + repository + đường truyền tới sidecar đã xong,
   **chưa có UI** (xem mục 8).

**Bốn quyết định đáng nhớ** (chi tiết ở mục 4.59–4.62):

- **Trả nợ `charStart` có sẵn từ P2.4.** Timing vốn bám text *đã chuẩn hoá*,
  còn UI tô chữ trên text *gốc*. Với số thì lệch hiếm nên trước đây bỏ qua được;
  tên riêng xuất hiện mọi trang nên không né được nữa. Nay `normalize_mapped`
  trả bảng ánh xạ, `remap_to_source` quy offset ngược. **Kiểu `WordTiming`
  không đổi** — chỉ làm nó đúng như docstring đã hứa.
- **Suy mapping bằng `difflib` thay vì viết lại 8 hàm regex.** Các luật chuẩn
  hoá đều là `str -> str`, không tự khai báo được mình đổi khoảng nào.
  `diff_to_normalized` so chuỗi vào/ra → luật thêm sau tự động có mapping đúng.
- **Lớp chặn tiếng Việt quan trọng hơn lớp chặn tiếng Anh.** Text LN *là* tiếng
  Việt, nên nuốt nhầm từ Việt xảy ra thường xuyên hơn. Đo lúc đang làm: luật
  romaji nuốt **20/97** từ Việt không dấu (`mua` → "mư-a"). Chặn bằng hai lớp:
  luật tầng 3 chỉ áp cho token **viết hoa**, cộng danh sách âm tiết Việt thông
  dụng (bắt cả từ Việt đứng đầu câu). Sau đó: **0/51** bị nuốt.
- **Từ điển dùng gạch nối, không dùng dấu cách.** `Tô-ki-ô` giữ nhịp một-từ;
  `Tô ki ô` khiến Piper chèn khoảng nghỉ giữa các âm tiết, nghe rời rạc.

**Chỉ có unit test — chưa nghe thật.** Toàn bộ P3.5 xanh ở mức unit test và đã
soi tay kết quả phiên âm trên câu LN thật, nhưng **chưa chạy Piper thật để
nghe**. Chất lượng phát âm cuối cùng phải *nghe* mới biết — vẫn còn nợ sau khi
P3.4 xong, xem mục 8.

**Bổ sung ở P3.4:** user đưa danh sách **291 tên LN thật** để đo lại. Lộ ra một
lỗi chặn thừa (`ao`/`eo`) làm mất 6 tên, đã sửa — chi tiết ở mục 4.67. Sau sửa:
222/291 nhận, 0/73 từ Anh và 0/83 từ Việt bị nuốt nhầm. 69 ca còn lại gần như
toàn tên phương Tây (`Edward`, `Levi`, `Emilia`…) — giữ nguyên là **đúng**.

### Phase 3 — P3.3 Player UI đầy đủ ✅

Phần còn lại của player theo plan.md, cộng hai thứ **user yêu cầu trực tiếp**:
icon next/previous xấu (emoji), và thêm mốc tốc độ 2.5×/3×.

| File | Vai trò | Test |
|---|---|---|
| `player/icons.tsx` | 5 icon SVG inline thay emoji `⏮ ▶ ⏸ ⏭` | (qua PlayerBar) |
| `player/SegmentProgress.tsx` | Thanh tiến độ trong đoạn + đồng hồ + bấm/kéo để tua | 9 |
| `player/useSegmentProgress.ts` | Vòng `rAF` ghi thẳng DOM qua `ref` | (chung ở trên) |
| `player/RateMenu.tsx` | Menu tốc độ 8 mốc, mở lên | (qua PlayerBar) |
| `player/usePlayerShortcuts.ts` | Space, ←/→, J/K, `[`/`]` — gắn ở `window` | 18 |
| `player/format.ts` | `+stepRate`, `+formatClock`, 8 mốc tốc độ | +11 |
| `player/PlayerBar.tsx` | Bố cục lại: 2 hàng, thêm đường tắt Giọng đọc | 26 |
| `stores/player-store.ts` | `+playerPositionMs`, `+applyStoredRate`, `+persistRate` | +6 |
| `reader/ReaderScreen.tsx` | Nối settings ↔ tốc độ, truyền `onOpenVoices` | +8 |
| `App.tsx` | Đường tắt phải **đóng sách** rồi mới đổi màn | +1 |
| `shared/constants.ts` | `PLAYBACK_RATE_MAX` 2 → **3** | +2 |

**Bốn quyết định đáng nhớ** (chi tiết ở mục 4.55–4.58):

- **Icon là SVG, không phải emoji.** Emoji là *ký tự* — hình dạng do font quyết
  định, không ăn theo `currentColor`, nên nút phát có nền accent mà icon vẫn đen.
  Không thêm thư viện icon (CLAUDE.md cấm thêm dependency): 5 hình là 5 `path`.
- **Tốc độ chuyển sang menu thả xuống** (user chọn). 8 mốc bày ngang thì thanh
  player chật và trên cửa sổ hẹp sẽ xuống dòng đè lên thanh tiến độ.
- **Thanh tiến độ không đi qua state React.** `rAF` → ghi thẳng `style.width` và
  `textContent` qua `ref`, có bộ nhớ giá trị đã vẽ để không đụng DOM khi con số
  không đổi. Vòng lặp **dừng hẳn** khi không phát.
- **Tốc độ giờ mới thật sự được nhớ.** `settings.playbackRate` đã có trong DB từ
  Phase 0 nhưng **chưa bao giờ được đọc hay ghi** — mở lại app là về 1×. Xem 4.58.

**Đã chạy thật trên app đang chạy** (`pnpm ui-check`, 25 phép kiểm player):

| Phép kiểm | Số đo thật |
|---|---|
| Thanh player có chiều cao thật | ✅ **69 px** (46 → 69 vì thêm hàng tiến độ) |
| Icon điều khiển vẽ ra hình thật | ✅ 3/3 có kích thước ≥ 10 px |
| Icon ăn theo màu chữ của nút | ✅ `rgb(244,244,245)` · `rgb(15,15,17)` · `rgb(244,244,245)` |
| Không còn emoji trong nút | ✅ `textContent` cả ba nút đều rỗng |
| Thanh tiến độ có bề ngang/chiều cao thật | ✅ **1349 × 6 px** |
| Đồng hồ đúng dạng `m:ss` | ✅ `0:00 / 0:00` |
| Menu tốc độ đủ 8 mốc, có 2.5× và 3× | ✅ `0.75× 1×✓ 1.25× 1.5× 1.75× 2× 2.5× 3×` |
| Menu **mở lên**, nằm trọn trong màn hình | ✅ `true` — thanh player sát đáy cửa sổ |
| **Tốc độ 3× tới được thẻ `<audio>` thật** | ✅ `3` |
| **`preservesPitch` vẫn bật ở 3×** | ✅ `true` |
| Phím `[` đổi tốc độ khi đang đọc | ✅ `3× → 2.5×` |
| Phím tắt **nhường** khi đang gõ trong ô nhập | ✅ `true` |

`pnpm ui-check` nay có **47 phép kiểm** (33 → 47). **45/47 đạt**; 2 phép kiểm đỏ
là **lỗi có sẵn từ trước P3.3**, không phải do phần này — xem mục 8.

**Ba lỗi tìm ra khi kiểm trên app thật**, cả ba đều vô hình với 1863 unit test:

1. **Phép kiểm `preservesPitch` trước nay vô nghĩa** (mục 4.56). Thẻ `<audio>`
   nằm ngoài DOM nên `querySelector('audio')` không thấy gì, và script tự tạo
   `new Audio()` để đo — luôn xanh kể cả khi player không dựng được thẻ nào.
2. **`isContentEditable` không có trong jsdom** (mục 4.57) — nhánh "nhường phím
   khi user đang gõ" không kiểm được, mà đó đúng là nhánh hỏng âm thầm tệ nhất.
3. **Đường tắt Giọng đọc phải đóng sách**, không chỉ đổi `screen`: màn đó chỉ
   render khi `opened === null`. Chỉ đổi `screen` thì bấm xong không thấy gì đổi.

### Phase 3 — P3.4 Subtitle pane + highlight từng chữ ✅

Phần cuối của Phase 3. Phần lớn hạ tầng đã sẵn từ P3.1–P3.3 (`playerPositionMs`,
`wordIndexAt`, `seekMsForChar`, khuôn `rAF` của `useSegmentProgress`), nên P3.4
chủ yếu là **ghép** — trừ một chỗ phải sửa lại vì P3.5 đổi ngữ nghĩa `charStart`.

| File | Vai trò | Test |
|---|---|---|
| `player/subtitle.ts` | Cắt text gốc thành từ + map timing → từ trên màn | 11 |
| `player/useWordHighlight.ts` | Vòng `rAF` bật/tắt `data-active`, chỉ đụng 2 phần tử | (qua SubtitlePane) |
| `player/SubtitlePane.tsx` | Phụ đề, click-to-seek, nút "theo từ đang đọc" | 12 |
| `reader/PaneSplitter.tsx` | Thanh kéo tỉ lệ, tách `onDrag` khỏi `onCommit` | 7 |
| `reader/ReaderScreen.tsx` | Chia dọc viewer/phụ đề, nối `viewerPaneRatio` | +7 |
| `shared/timings.ts` | **Sửa lỗi** `seekMsForChar` (xem 4.63) | +1 |
| `styles/theme.css` | 3 biến phụ đề hex → kênh RGB rời | (ui-check) |
| `tailwind.config.js` | Thêm 3 màu `subtitle-*` vào palette | — |
| `scripts/ui-check.mjs` | +3 nhóm phép kiểm phụ đề/splitter | — |

**Bốn quyết định đáng nhớ** (chi tiết ở mục 4.63–4.66):

- **Không lấy `timings` làm danh sách từ để vẽ.** Sau P3.5 nhiều timing liên tiếp
  trỏ **cùng** một khoảng gốc (`Tokyo` = `Tô`+`ki`+`ô`). Vẽ theo `timings` thì
  màn hình hiện bản đọc chứ không phải chữ trong sách. Nên cắt từ `Segment.text`
  rồi map ngược qua **giao khoảng** — xem `subtitle.ts`.
- **Phụ đề bám segment ĐANG PHÁT, không phải đang chọn.** Bấm một đoạn để xem nó
  ở trang nào là thao tác thường; phụ đề nhảy theo lúc đó thì chữ và tiếng lệch.
- **Splitter tách `onDrag` khỏi `onCommit`.** Kéo chuột bắn hàng chục sự kiện mỗi
  giây, mỗi `onCommit` là một lượt IPC + ghi SQLite. Chỉ ghi khi nhả chuột.
- **3 biến `--subtitle-*` phải đổi sang kênh RGB rời.** Chúng lưu hex từ Phase 0,
  đúng hình thái lỗi 4.23 — `bg-subtitle-current/15` sẽ ra trong suốt. Đây là lỗi
  vitest không thể thấy, đã thêm phép kiểm vào `ui-check`.

**Một lỗi thật tìm ra khi viết test** (mục 4.63): `seekMsForChar` trả mốc của
**mảnh cuối** thay vì mảnh đầu khi nhiều timing cùng khoảng gốc — bấm vào `Tokyo`
sẽ nhảy vào giữa lúc đang đọc dở chính cái tên đó. Hàm này viết ở P3.1 khi mỗi từ
còn đúng một timing; P3.5 phá giả định đó mà không ai để ý vì **chưa có UI nào
gọi tới**. P3.4 là lần đầu nó được dùng thật.

⚠️ **Chưa chạy `pnpm ui-check`** cho phần này — phép kiểm đã viết nhưng chưa chạy
được trong phiên. Chiều cao pane, tỉ lệ splitter và màu `data-active` **đều là
loại lỗi vitest không thấy**. Xem mục 8.

### Phase 5 — P5.1 Thêm giọng VI + nghe thử giọng ✅

Phần đầu Phase 5, làm theo **yêu cầu trực tiếp của user**: catalog chỉ có 1 giọng
VI + 1 giọng EN nên user không có gì để chọn, và tải xong cũng không biết giọng
nghe ra sao trước khi đem generate cả cuốn sách.

| File | Vai trò | Test |
|---|---|---|
| `resources/voices/catalog.json` | +`vi_VN-25hours_single-low`, sha256 **tải thật rồi tính** | (qua catalog) |
| `sidecar/app/schemas.py` | `PreviewRequest` / `PreviewResponse` (base64) | — |
| `sidecar/app/main.py` | `POST /preview` — tổng hợp **không ghi đĩa** | +8 |
| `main/services/sidecar-client.ts` | `preview()`, giải base64 → `Uint8Array` | — |
| `main/ipc/handlers/voices.ts` | `voices:preview`, chọn câu mẫu theo `lang` | +6 |
| `shared/constants.ts` | `VOICE_PREVIEW_TEXT` — câu mẫu VI/EN | — |
| `shared/ipc.ts` | `VoicePreview` + kênh `voices:preview` | — |
| `renderer/features/voices/preview-player.ts` | Thẻ `<audio>` riêng + kỷ luật thu hồi Blob URL | (qua VoiceManager) |
| `renderer/stores/voice-store.ts` | `previewing` / `playing`, chặn bấm trùng | — |
| `renderer/features/voices/VoiceRow.tsx` | Nút "Nghe thử" / "Đang tạo…" / "Dừng" | +6 |

**Bốn quyết định đáng nhớ:**

- **`/preview` là route RIÊNG, không dùng lại `/synthesize`.** Route kia bắt buộc
  có `outPath` trong `audioDir` và luôn ghi file — nghe thử qua đó thì mỗi lần
  bấm đẻ một file rác mà Storage Manager đếm thành dung lượng sách, và user không
  có cách nào xoá vì nó không thuộc chương nào. `engine.synthesize` vốn đã trả
  bytes trong RAM nên chỉ cần **bỏ** bước ghi, không phải viết lại gì.
- **Câu mẫu do main chọn, renderer không gửi text.** Cho renderer gửi chuỗi tuỳ ý
  là mở một đường tổng hợp không giới hạn không đi qua hàng đợi. Câu mẫu **có chủ
  đích**: chứa tên riêng Nhật (`Tokyo`, `Asuka`) và chữ số (`17`) — đúng hai thứ
  đi qua đường chuẩn hoá khác nhau, nghe thử mà thiếu chúng thì không kiểm được
  ba tầng phiên âm của P3.5.
- **Chỉ thêm giọng MỘT người nói.** Piper có 3 giọng VI nhưng `vi_VN-vivos-x_low`
  là 65 người nói — cần `speaker_id` lúc tổng hợp mà schema catalog lẫn
  `/synthesize` đều chưa có. Thêm vào sẽ luôn đọc bằng người nói số 0. Còn nợ.
- **`sampleRate` không bắt buộc 22050.** Giọng mới là **16 kHz**; engine đọc tần
  số thật từ config của model rồi tự chọn đích Opus, và 16000 vốn đã nằm trong
  danh sách Opus nên **bỏ qua resample hoàn toàn**. Không phải sửa code nào.

**Một lỗi thật tìm ra khi viết test** (mục 4.69): cảnh báo `act(...)` của React
chỉ xuất hiện ở bộ test mới. Nguyên nhân **không** phải thiếu cờ môi trường như
tưởng ban đầu, mà là `userEvent.click` bọc thao tác trong `asyncWrapper` riêng và
trả cờ act về `undefined` trước khi chuỗi `IPC → play() → setPlaying` kịp chạy.

⚠️ **Chưa nghe thử bằng tai và chưa chạy `pnpm ui-check`** cho phần này — nút,
trạng thái và kỷ luật thu hồi Blob URL đều mới chỉ có unit test. Xem mục 8.

### Phase 5 — P5.2 UI sửa cách đọc ✅

Trả nợ treo từ **P3.5**: DB (`pronunciation_overrides`, schema v3), repository
(22 test) và đường truyền tới sidecar (`getPronunciations` → `/synthesize`) đã
xong từ hai phase trước, nhưng **không có IPC channel lẫn màn hình nào** — nghĩa
là suốt P3.5 → P5.1, user không sửa được cách đọc dù backend đã sẵn sàng.

| File | Vai trò | Test |
|---|---|---|
| `shared/schemas.ts` | `pronunciationTerm/Replacement`, `savePronunciation` | (qua handler) |
| `shared/ipc.ts` | `SavePronunciationRequest` + 3 kênh `pronunciations:*` | — |
| `main/ipc/handlers/pronunciations.ts` | 3 handler, gộp mục toàn cục + theo sách | 12 |
| `renderer/stores/pronunciation-store.ts` | Danh sách + cờ `dirty` | 8 |
| `renderer/features/player/PronunciationDialog.tsx` | Hộp sửa cách đọc | 13 |
| `renderer/features/player/SubtitlePane.tsx` | `onContextMenu` trên từng từ | +3 |
| `renderer/features/reader/ReaderScreen.tsx` | Nạp phiên âm khi mở sách, dựng hộp | — |

**Bốn quyết định đáng nhớ:**

- **Chuột phải, không thêm nút cạnh mỗi từ.** Phụ đề là chỗ để *đọc*; nhồi thêm
  một nút vào từng chữ sẽ phá mặt chữ mà user đang bám theo. Mỗi từ vốn đã là
  `<button>` từ P3.4 (click-to-seek) nên chỉ cần thêm `onContextMenu`.
- **Mặc định lưu THEO SÁCH, không toàn cục.** Cách đọc một cái tên thường chỉ
  đúng trong bộ truyện đó — `Kaguya` ở truyện này là tên người, truyện khác có
  thể là địa danh đọc khác hẳn. Muốn toàn cục thì tích thêm một ô.
- **Chuẩn hoá `term` về chữ thường ngay ở biên** (`zod.transform`). Sidecar tra
  bảng theo khoá đã thường hoá, nên để `"Tokyo"` và `"tokyo"` thành hai mục là
  dựng sẵn một mục không bao giờ khớp. Làm ở schema chứ không nhắc UI nhớ.
- **Cấm khoảng trắng trong cách đọc, có câu giải thích cho user.** `Tô ki ô`
  khiến Piper chèn khoảng nghỉ giữa các âm tiết, nghe rời rạc thành ba tiếng
  (mục 4.62). Nhắc ngay dưới ô nhập chứ không đợi tới lúc báo lỗi.

**Hai cái bẫy đã chặn sẵn:**

- **`save` trả về bản trong DB, không phải bản vừa dựng.** `upsert` ghi đè khi
  trùng `term`, nên `id` vừa sinh KHÔNG phải id thật trong DB. Renderer dùng id
  đó cho nút xoá — trả nhầm thì xoá trượt. Có test khoá lại.
- **Store nạp LẠI sau khi lưu** thay vì tự chèn vào mảng, cùng lý do trên: chèn
  thêm sẽ ra hai dòng cùng một `term` mà DB thật không bao giờ có.

**Không tự generate lại sau khi sửa.** Audio cũ vẫn nằm trên đĩa với cách đọc cũ,
mà một cuốn là hàng nghìn đoạn — tự động tạo lại là đúng thứ CLAUDE.md cấm (phải
hiện ước lượng trước khi generate hàng loạt). Hộp thoại **nói rõ** điều đó, vì
đây là hiểu nhầm chắc chắn xảy ra: sửa xong mà đoạn đang nghe vẫn đọc như cũ.

⚠️ **Chưa chạy trên app thật.** Toàn bộ P5.2 mới ở mức unit test — chưa mở app để
bấm chuột phải, và **chưa nghe** một đoạn generate lại sau khi sửa để xác nhận
cách đọc mới thật sự tới được Piper. Xem mục 8.

### Phase 5 — P5.3 Màn Cài đặt + trả 3 nợ mức TB ✅

Phần này **một nửa là trả nợ**. Ba nợ mức TB trong mục 8 đều có chung một hình
dạng: *code đã xong và có test, nhưng không có đường nào chạm tới*.

| File | Vai trò | Test |
|---|---|---|
| `renderer/features/settings/SettingsScreen.tsx` | Màn Cài đặt (mới) | 9 |
| `renderer/features/settings/SubtitleFontSetting.tsx` | Cỡ chữ + **xem thử tại chỗ** | ↑ |
| `renderer/features/settings/AppInfoPanel.tsx` | Phiên bản + thư mục dữ liệu | ↑ |
| `renderer/features/player/SubtitlePane.tsx` | Nhận `fontSizePx` — thôi hardcode `text-lg` | +1 |
| `renderer/features/storage/StorageBookRow.tsx` | Nút **"Xoá phần đã đọc"** | +4 |
| `renderer/features/storage/DeleteAudioDialog.tsx` | `scopeNote` cho ca không biết trước số byte | ↑ |
| `renderer/features/import/ChapterConfirm.tsx` | Ô **chọn ngôn ngữ sách** | +2 |
| `renderer/stores/import-store.ts` | `save(title, lang)` — bỏ `lang: 'vi'` hardcode | +1 |
| `renderer/App.tsx` + `LibraryGrid.tsx` | Điều hướng + nút vào Cài đặt | +3 |
| `apps/main/tsconfig.probe.json` | **Typecheck cho `probe/`** (mới) | — |
| `scripts/ui-check.mjs` | 5 phép kiểm mới | — |

**Ba nợ TB đã trả:**

| Nợ | Vì sao nó nguy hiểm | Cách trả |
|---|---|---|
| `subtitleFontSize` **không component nào đọc** | Setting chết từ Phase 0: có trong schema, có trong DB, user không đổi được. Cùng hình dạng với `playbackRate` (trả ở P3.3) và `viewerPaneRatio` (P3.4) | `SubtitlePane` nhận `fontSizePx`; thanh trượt 10–48 bước 2px kèm **xem thử** |
| `lang` hardcode `'vi'` | Sách EN nhận `voiceVi` → Piper đọc văn bản Anh bằng ánh xạ chữ cái tiếng Việt, ra âm vô nghĩa. Đổi sau khi lưu thì phải **xoá sách nhập lại** | Ô chọn ở màn xác nhận chương, cạnh ô tên sách |
| `deleteReadAudio` không có nút | Handler + service + store + 5 test có từ P2.7. plan.md nhắc đích danh. Thiếu chỗ bấm thì **tính năng không tồn tại với user** | Nút "Xoá phần đã đọc" cạnh "Xoá audio", qua cùng hộp xác nhận |

**Ba quyết định đáng nhớ:**

- **KHÔNG gom hết thiết lập về màn Cài đặt.** Thư mục audio, bitrate và ngưỡng
  cảnh báo vẫn ở Storage Manager — đó là chỗ user đang nhìn con số dung lượng và
  muốn đổi nó ngay. Dựng lại các ô đó ở đây là **hai chỗ chỉnh cùng một thứ mà
  chỉ một chỗ hiện hậu quả**. Màn Cài đặt chỉ trỏ sang, có test khoá lại.
- **Cỡ chữ có xem thử ngay tại chỗ.** Con số px không nói lên gì cho tới khi nhìn
  thấy; không có preview thì user phải vào trình đọc → quay ra chỉnh → vào lại,
  ba lần chuyển màn cho một lần thử. Preview dùng đúng biến màu của phụ đề thật
  (`--subtitle-past`), vì nhìn thử khác màu thì kết luận rút ra cũng sai.
- **Hộp xoá "phần đã đọc" KHÔNG hiện con số.** Chương nào tính là đã đọc do main
  quyết theo vị trí đọc dở — renderer không đủ dữ liệu để tính bytes. Hiện `0 B`
  sẽ khiến user tưởng bấm cũng không xoá gì, nên thay hai con số bằng một câu mô
  tả phạm vi (`scopeNote`). Có test khoá lại rằng `delete-bytes` **không** xuất hiện.

**`apps/main/probe/` nay có lưới.** Đây là nợ nguy hiểm nhất trong ba cái: probe
nằm ngoài `pnpm test`, ngoài CI, **và** ngoài `tsconfig` — không lưới nào cả, và
đó chính là lý do lỗi 4.50 nằm im qua hai commit. Không gộp được vào
`tsconfig.json` vì đó là config *build* (`rootDir: ./src`); nới `include` sẽ đẩy
mọi thứ trong `dist/` đổi chỗ. Nên tách `tsconfig.probe.json`, nối vào `typecheck`
của `@ln/main`. **Đã kiểm chứng bằng cách phá thật**: đổi `segment?.audioBytes`
thành `segment?.XXaudioBytes` → `error TS2551` đúng như mong đợi, rồi khôi phục.

**Đã chạy thật trên app** (`pnpm ui-check`, user chạy ngay sau commit):

| Phép kiểm | Kết quả |
|---|---|
| Thanh cỡ chữ có giá trị thật | ✅ 18 px |
| **Xem thử khớp cỡ chữ đang chọn** | ✅ thanh 18 px = xem thử 18 px |
| Chữ xem thử không trong suốt | ✅ `rgb(113, 113, 122)` |
| Có nút xoá audio phần đã đọc | ✅ 106×24 px |
| Màn dung lượng vẫn nguyên vẹn | ✅ tổng + thanh 6 px |

Lượt chạy đó cũng xác nhận **toàn bộ P3.4** (nợ treo từ lâu): 2 pane chia đúng
80% đo được, kéo thanh thì phụ đề cao lên **thật** 147→162 px, ẩn phụ đề thì
viewer lấy hết chỗ 588→864 px, hiện lại về đúng 147 px.

⚠️ Nhưng **hai phép kiểm màu phụ đề đỏ giả** ở lượt này — lỗi của chính phép
kiểm, không phải app. Xem mục 4.72.

### Phase 5 — P5.4 Dấu trang + thống kê đọc + bảng hàng đợi ✅

Cả ba phần đều cùng một hình dạng với P5.3: **hạ tầng đã có sẵn, thiếu đường
gọi**. Bảng `bookmarks` nằm trong schema **v1** — bốn phase liền user không đánh
dấu được chỗ nào dù DB đã sẵn sàng. `queue:listPending` + `queue:cancelJob` có
handler, có zod schema, có test từ **P2.6** mà chưa lần nào được gọi từ UI.

| File | Vai trò | Test |
|---|---|---|
| `main/db/repositories/bookmarks.ts` | Repository đầu tiên cho bảng schema v1 (mới) | 20 |
| `main/ipc/handlers/bookmarks.ts` | 4 kênh `bookmarks:*` (mới) | 22 |
| `main/ipc/handlers/library.ts` | `getStats` — suy số từ dữ liệu đã có | +6 |
| `main/db/repositories/segments.ts` | `bookStats` + `countBefore` | +7 |
| `renderer/stores/bookmark-store.ts` | Dấu trang **và** thống kê chung một store (mới) | 18 |
| `renderer/features/bookmarks/BookmarkButton.tsx` | Nút đánh dấu + ô ghi chú (mới) | 13 |
| `renderer/features/bookmarks/BookmarkList.tsx` | Danh sách theo mạch đọc (mới) | 11 |
| `renderer/features/bookmarks/ReadingStatsPanel.tsx` | Hai thanh tiến độ (mới) | ↑ |
| `renderer/features/bookmarks/stats-format.ts` | Hàm thuần: %, nhãn vị trí (mới) | 13 |
| `renderer/features/generate/QueueTable.tsx` | Bảng hàng đợi + huỷ từng job (mới) | 10 |
| `renderer/features/generate/job-format.ts` | Nhãn ưu tiên/trạng thái job (mới) | 10 |
| `renderer/stores/queue-store.ts` | `loadPending` + `cancelJob` | +6 |
| `renderer/features/reader/ReaderScreen.tsx` | Panel phải thành **3 tab** | +10 |
| `scripts/ui-check.mjs` | 10 phép kiểm mới | — |

**Năm quyết định đáng nhớ:**

- **Thống kê KHÔNG có bảng theo dõi hành vi.** Đây là lựa chọn có ý thức, không
  phải cắt gọt: mọi con số suy từ thứ DB đã lưu vì việc khác (`last_segment_id`,
  `segments.status`). Muốn biết "đọc bao lâu mỗi ngày" thì phải ghi mốc từng
  phiên — đó là telemetry cục bộ, mà CLAUDE.md cấm thu thập. "Thống kê đọc" ở
  đây nghĩa là *đọc tới đâu rồi*, không phải *đọc thế nào*.
- **Hai thanh tiến độ riêng, không gộp.** Tiến độ *đọc* và tiến độ *generate*
  thường lệch nhau rất nhiều (đọc chương 2 mà đã generate cả sách, hoặc ngược
  lại). Gộp một thanh là nói dối về cả hai.
- **Phần trăm tính theo segment, không theo chương.** Sách 8 chương thì đếm theo
  chương nhảy 12,5% một nấc rồi đứng im suốt cả chương — vô dụng đúng lúc user
  cần nhất. `countBefore` đếm xuyên chương bằng SQL (`c.idx < ? OR (c.idx = ? AND
  s.idx < ?)`); so `s.idx` đơn thuần thì đoạn đầu chương 5 ra "0 đoạn đứng trước"
  vì chỉ số segment đếm lại từ 0 ở mỗi chương.
- **Dấu trang và thống kê chung MỘT store.** Chúng luôn đổi cùng nhau — thêm hay
  xoá dấu trang là `bookmarkCount` lệch ngay. Tách hai store thì mỗi thao tác
  phải nhớ gọi hai lượt nạp, quên một chỗ là con số sai âm thầm. Cũng **không tự
  cộng trừ** `bookmarkCount` ở renderer: `add` có thể là *cập nhật* một mục đã
  có, đoán sai chiều thì con số trôi dần mà không lượt nạp nào sửa lại.
- **Đánh dấu neo vào đoạn ĐANG CHỌN, không phải đoạn đang phát.** Hai thứ này
  lệch nhau khi user bấm một đoạn để xem nó ở trang nào trong lúc đang nghe chỗ
  khác — và lúc đó thứ họ muốn đánh dấu là đoạn vừa bấm, thứ đang nhìn.

**Bảng hàng đợi không hỏi vòng.** Danh sách tới 200 job và **không có event nào
đẩy nó xuống** (khác `status` vốn tự cập nhật qua `queue:statusChanged`). Nạp một
lần khi mở tab, thêm nút "Nạp lại". Có test khoá lại rằng `listPending` **không**
được gọi khi tab hàng đợi chưa mở.

**Không thêm migration cho `bookmarks`.** Bảng schema v1 không có
`UNIQUE(book_id, segment_id)`, nhưng "đánh dấu lại đúng đoạn thì cập nhật ghi
chú" làm được bằng `upsert` tự tra trong một transaction. Đổi một migration lấy
một ràng buộc mà cú bấm của người vốn không chạy song song là không đáng.

**Một lỗi thật bắt được trong lúc viết test:** `cancelJob` gọi `loadPending` ngay
sau đó, mà `call()` mặc định **xoá lỗi khi thành công** — nên thông báo "job này
đã xong rồi" biến mất trong cùng một nhịp, trước khi user kịp đọc. Store đã có
sẵn quy ước `clearOnSuccess: false` cho đúng ca này (lượt gọi *phụ* sau một hành
động); thêm tham số `keepError` cho `loadPending`. Test khoá lại cả hai chiều:
huỷ hỏng thì **giữ** lỗi, huỷ được thì **xoá** lỗi cũ.

✅ **Đã chạy trên app thật.** `pnpm ui-check` sau P5.4: 10 phép kiểm P5.4 xanh
hết. Hai phép đỏ trong lượt đó là **đỏ giả của chính phép kiểm** (mục 4.74).

### Phase 5 — P5.5a Icon app + latest.yml + log rotate ✅

| Việc | Kết quả |
|---|---|
| `scripts/make-icon.mjs` | Vẽ `icon.ico` 7 cỡ (16→256) + `icon.png`, **chỉ dùng stdlib** |
| `resources/icon.ico` | 12.3 KB, Pillow đọc được đủ 7 cỡ, sinh lại ra **đúng từng byte** |
| `electron-builder.yml` | `win.icon`, 3 icon NSIS, `publish:` tường minh, **sửa `artifactName`** |
| `apps/main/src/services/icon-paths.ts` | Resolver thuần + 5 test, cùng khuôn `sidecar-paths.ts` |
| `apps/main/src/window.ts` | Nhận `iconPath`, spread có điều kiện vì `exactOptionalPropertyTypes` |
| `scripts/sidecar-preflight.mjs` | Kiểm thêm icon (tồn tại + header 6 byte), **chạy trước** phần sidecar |
| Log rotate | **Đã có sẵn và chạy đúng** — chỉ thêm 2 test còn thiếu |

**Quyết định: tự vẽ icon thay vì thêm dependency.** Xem `scripts/README.md`.
`.ico` = header 6 byte + mục 16 byte mỗi ảnh + PNG nối đuôi; PNG = vài chunk bọc
`zlib.deflate` có sẵn trong `node:zlib`. Pillow có trong Python hệ thống nhưng
**không** có trong `sidecar/.venv` — dựa vào nó là dựng bẫy cho máy khác.

**Vẽ xong phải NHÌN, không chỉ đo.** Bản đầu qua hết mọi phép kiểm số (7 cỡ, góc
trong suốt, tâm đúng màu accent) nhưng render ra thì "cuốn sách" là một **khối
trắng phẳng** — rãnh giữa quá mảnh nên hai trang dính làm một, ở 16 px thành đốm
trắng vô nghĩa. Bản hai lại để ba vạch sóng âm to choán hết trang phải, đọc ra
"hai trang kẻ sọc". Phải render ra ảnh và nhìn ở **đúng cỡ thật, trên cả nền tối
lẫn nền sáng** mới thấy. Cùng một bài học với 4.74: số đo xanh không có nghĩa
thứ user nhìn thấy là đúng.

**Log rotate hoá ra đã xong từ trước.** `services/logger.ts` có xoay theo kích
thước (2 MB), giữ 5 file, và **đã nối thật** vào `logsDir(userData)` ở
`index.ts:90` — kiểm bằng grep trước khi viết gì, đúng bài học 4.71/4.73 (đừng
tin "chưa có" mà không tra). Chỉ thiếu test cho **giới hạn 5 file** (phần chặn
log phình vô hạn) và cho việc **lỗi fs khác ENOENT phải nổi lên**; đã bổ sung.

### Phase 5 — P5.5b Auto-update: `electron-updater` + IPC contract ✅

| Việc | Kết quả |
|---|---|
| `electron-updater` 6.8.9 | Dependency mới của `@ln/main` — **đã hỏi user trước khi thêm** |
| `services/update-policy.ts` | Phần **thuần**: chặn dev/portable, so version, kẹp phần trăm. 19 test |
| `services/update-service.ts` | Máy trạng thái + 6 sự kiện, cùng khuôn `sidecar-supervisor.ts`. 20 test |
| `ipc/handlers/update.ts` | 4 channel, mỏng có chủ ý. 6 test |
| `packages/shared` | `UpdateStatus`/`UpdateState`, 4 channel + 1 event, `autoCheckUpdates` |
| `apps/preload/src/api.ts` | `window.api.update.*` — 4 hàm + `onStatusChanged` |

**`autoDownload` và `autoInstallOnAppQuit` đều TẮT.** Mặc định của
`electron-updater` là tải ngay khi thấy bản mới rồi cài lúc thoát. Bản cài này
~150 MB — tự tải nền cho một app đọc sách **offline** là ngốn băng thông của user
mà không hỏi, và thay app sau lưng họ. Chỉ **kiểm tra** là tự động; tải và cài
đều do user bấm. Có test khoá riêng cả hai cờ này.

**Chặn tụt phiên bản — `shouldOfferUpdate`.** Không tin thẳng sự kiện
`update-available`: nó bắn theo `latest.yml`, mà file đó là thứ **người** upload.
Publish nhầm một release cũ đè lên (`latest.yml` của 0.1.0 ghi lên chỗ của 0.2.0)
sẽ đẩy **toàn bộ** user đang ở bản mới lùi về bản cũ, và họ không có cách nào
quay lại ngoài tải tay. Một phép so ở main chặn hẳn ca đó.

**`unsupported` là trạng thái riêng, không phải `error`.** Bản portable và bản
dev không cài đè được — file gốc user tải về nằm chỗ khác hẳn, ghi đè thư mục tạm
không đổi được gì. Gộp vào `error` thì UI hiện chữ đỏ cho một tình huống hoàn
toàn bình thường mà user không làm gì được để "sửa". Phân biệt portable với NSIS
bằng **sự có mặt của `app-update.yml`** trong `resources/`, không phải
`app.isPackaged` — cả hai bản đều `isPackaged === true`.

**Bẫy bundle: `require()` trần lọt qua vite mà không ai báo.** Bản đầu tôi
`require('electron-updater')` trong hàm (định nạp muộn). Build xanh, nhưng
`grep` bundle cho thấy nó **lọt nguyên vào `index.cjs` dưới dạng `require` trần**
— vite chỉ bundle được thứ nó phân tích **tĩnh**, mà `vite.config.ts` đặt
`noExternal: true` chính vì asar **không có `node_modules` đầy đủ`**. Kiểm asar
của bản build trước: `electron-updater` không có trong đó → bản cài sẽ crash
"Cannot find module" trong khi bản dev chạy tốt. Đổi sang `import` tĩnh: 815 →
1043 module, bundle +570 KB, `NsisUpdater` xuất hiện 15 chỗ trong bundle.
`autoUpdater` là **lazy getter** nên instance vẫn chỉ dựng lúc `start()` chạy,
sau `app.setName()` — đã đọc mã thư viện và kiểm lại trong bundle đã build.

✅ **Đã chạy trên app thật** (CDP, không phải unit test): `window.api.update` đủ 5
hàm; `getStatus()` trả `state: 'unsupported'` với đúng câu cho bản dev;
`quitAndInstall()` trả `false` chứ không ném. Chứng minh `electron-updater` nạp
được trong Electron thật và cả chuỗi main → preload → renderer thông suốt.

### Phase 5 — P5.5c UI auto-update + README phát hành ✅

| Việc | Kết quả |
|---|---|
| `stores/update-store.ts` | Bản sao trạng thái + 4 lượt IPC, cùng khuôn `queue-store.ts`. 17 test |
| `features/settings/update-format.ts` | Hàm **thuần** dựng nhãn/mô tả/nút từ `UpdateStatus`. 21 test |
| `features/settings/UpdatePanel.tsx` | Ô đầy đủ trong màn Cài đặt + ô tick `autoCheckUpdates`. 11 test |
| `features/settings/UpdateBanner.tsx` | Dải báo dưới titlebar, **một** nút + nút đóng. 10 test |
| `App.tsx` | Đăng ký `onStatusChanged`, dựng dải. +6 test ở `App.test.tsx` |
| `SettingsScreen.tsx` | Nối `UpdatePanel`, ô lỗi cập nhật **riêng**. +4 test |
| `README.md` | Bảng phase đúng thực tế, mục cài đặt / SmartScreen / cập nhật / dữ liệu |
| `scripts/ui-check.mjs` | +5 phép kiểm (3 ô cập nhật + `fg`/`fgMuted` ở **cả hai** theme) |

**Trạng thái tới qua event, không qua giá trị trả về.** `check()` và `download()`
đều **kết thúc trước khi việc thật xong**: `checkForUpdates()` trả về rồi sự kiện
`update-available` mới bắn, còn tải thì chạy hàng phút. Chỉ đọc giá trị trả về
thì UI đứng im ở `checking` mãi mãi. `onStatusChanged` là đường chính; giá trị
trả về chỉ dùng bắt ca hỏng ngay lập tức. Có test cho đúng chỗ này ở `App.test`.

**Đăng ký listener TRƯỚC khi `load()`.** Lượt kiểm tự động ở main chạy sau 5 giây
kể từ khởi động (P5.5b), nhưng không có gì bảo đảm renderer luôn sẵn sàng trước
mốc đó. Đăng ký sau `await` là để hở một khe mà event rơi vào đúng khe đó là mất
hẳn — user không bao giờ thấy dải báo.

**Dải báo chỉ hiện ở `available` và `downloaded`.** Hai trạng thái user **làm
được gì đó**. `error` **cố tình** không báo ra dải: đây là app đọc sách offline,
mỗi lần mở máy không có mạng lại hiện một dải đỏ thì user học cách bỏ qua dải đó
— và khi đó nó vô dụng cả ở lần đáng nghe. Lỗi vẫn đọc được trong màn Cài đặt.

**`dismissed` chỉ sống trong bộ nhớ, không ghi vào settings.** Đóng dải là "để
tôi yên lúc này", không phải "đừng bao giờ báo nữa" — mở lại app thì báo lại, vì
bản cập nhật vẫn còn đó và vẫn đáng cài. Bấm "Tải" thì `dismissed` **mở lại**:
không mở lại thì user đóng dải rồi vào Cài đặt bấm tải sẽ không bao giờ thấy lời
mời cài lúc tải xong.

**`autoCheckUpdates` hết là setting chết.** Cờ này có trong `AppSettings` từ
P5.5b mà chưa màn nào đọc — đúng hình dạng mục 4.71, thứ dự án đã mắc một lần với
`subtitleFontSize`. Giờ có ô tick trong `UpdatePanel`, có test đường ghi xuống
settings, **và** có phép kiểm trong `ui-check` để nó không chết lại lần nữa.

✅ **`pnpm ui-check` chạy sau P5.5c — 87/87 đạt, không có phép nào đỏ.** Ô cập
nhật có mặt, tiêu đề không trong suốt, ô tick có mặt, bản dev ra `unsupported` và
**không** mời user bấm nút vô nghĩa.

**Phép kiểm màu thiếu `fg`/`fgMuted` suốt từ đầu dự án.** Viết xong `UpdatePanel`
tôi định kết luận "màu an toàn vì dùng `text-fg`, đã đo rồi" — kiểm lại thì
`measureColors` **chưa bao giờ đo hai token đó**. Mọi phép kiểm màu chữ khác đều
chạy trên màn Cài đặt, mà script cố ý về dark trước khi vào đó → nhánh light của
`--fg` chưa từng có ai đo. Đã thêm cả hai; giờ mất màu chữ ở một theme là đỏ
ngay. Mất biến đó ở một theme là **mất chữ toàn app**, không riêng ô nào.

### Số liệu hiện tại

| Chỉ số | Giá trị |
|---|---|
| Unit test TypeScript | **2253 passed** (+69 ở P5.5c — format 21, store 17, panel 11, banner 10, App 6, SettingsScreen 4) |
| Unit test sidecar (pytest) | **646 passed** (không đổi ở P5.5c — phần này không đụng sidecar) |
| Chạy thật sidecar (probe, ngoài `pnpm test`) | **14 kịch bản**, có typecheck từ P5.3 |
| **Kiểm UI thật (`pnpm ui-check`)** | **87 phép kiểm** — lần chạy gần nhất **sau P5.5c: 87/87 đạt, không phép nào đỏ**. Hai phép đỏ giả của lượt P5.4 đã đóng (mục 4.74). P5.1 (nghe thử) và P5.2 (chuột phải) vẫn cần **bấm tay** — CDP không đọc được tiếng |
| Icon app | **7 cỡ** (16→256) trong `resources/icon.ico`, sinh từ `pnpm build:icon`, tái lập đúng byte |
| Giọng đọc trong catalog | **3** (2 VI + 1 EN) — xem mục 8 về giọng nhiều người nói |
| Schema DB | **v3** — P5.4 **không** thêm migration, xem lý do ở mục 4.73 |
| Typecheck | Sạch (5 package) |
| Lint | Sạch (0 warning) |
| Sidecar `.exe` (onedir) | **145 MB** (29 → 145 vì ONNX Runtime + espeak data) |
| Installer NSIS / portable | **143.0 / 142.8 MB** (80.8 MB trước khi có sidecar) |

---

## 3. Việc tiếp theo — Phase 5

**Phase 4 đã bỏ.** User nghe thật một chương ở P3.4 và xác nhận highlight bám
đúng từng chữ, không thấy vấn đề nào. CTC aligner đổi lại là model ~300 MB đẩy
installer từ 143 MB lên ~450 MB — quá đắt cho thứ không ai thấy thiếu. Lý do đầy
đủ và **điều kiện mở lại** ở mục 4.68.

Phase 5 chia **năm phần** (thống nhất với user — mỗi phần một commit):

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P5.1 | Thêm giọng VI thứ hai vào catalog + nghe thử giọng sau khi tải | ✅ Xong |
| P5.2 | UI tầng 3 phiên âm: sửa cách đọc từ menu chuột phải trên phụ đề (nợ mục 8) | ✅ Xong |
| P5.3 | Màn Cài đặt (cỡ chữ phụ đề) + trả 3 nợ mức TB | ✅ Xong |
| P5.4 | Dấu trang + thống kê đọc; bảng hàng đợi (`queue:listPending` chưa ai gọi) | ✅ Xong |
| P5.5 | Đóng gói + phát hành — chia nhỏ thành **a/b/c**, xem bảng dưới | ✅ Xong |

**P5.5 chia ba, mỗi phần một commit** (thống nhất với user — mỗi phần xong thì
commit và dừng phiên):

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P5.5a | Icon app + metadata installer; `latest.yml` sinh ra đúng; log rotate | ✅ Xong |
| P5.5b | Auto-update: `electron-updater` ở main + IPC contract | ✅ Xong |
| P5.5c | UI auto-update (báo có bản mới, tải, cài lại) + README qua SmartScreen | ✅ Xong |

✅ **P5.5a đã qua `pnpm build:win` thật (user chạy 2026-07-31).** Cả hai câu treo
đều có lời đáp: icon **có** nhúng vào `.exe` (thấy trong Explorer), và `latest.yml`
ghi `LN-Reader-0.1.0-x64.exe` **khớp đúng** tên file thật, size 149993965 khớp
từng byte — **lỗi 4.75 đã đóng, xác nhận trên bản đóng gói thật.**

⚠️ **`release/` còn bộ file cũ, phải xoá trước khi publish.** electron-builder
**không dọn thư mục output**, nó chỉ ghi đè file trùng tên. P5.5a đổi
`artifactName` nên bộ mới (`LN-Reader-…`) không trùng tên bộ cũ (`LN Reader-…`,
có dấu cách) → cả hai cùng nằm đó. `latest.yml` chỉ trỏ bộ mới; upload nhầm file
có dấu cách là updater 404 trở lại. Xoá tay `release/` trước khi build bản phát
hành.

✅ **`pnpm ui-check` đã chạy sau P5.4 — 71/73 đạt.** Toàn bộ P5.3 **và P5.4**
xanh: mỗi tab panel cao 664 px thật, hai thanh tiến độ ra màu thật,
`queue:listPending` trả lời được.

2 phép đỏ còn lại **đều là đỏ giả của chính phép kiểm** (mục 4.74, đã sửa) — mốc
`rows >= floor(khung / 64)` ngầm giả định chương dài hơn khung, mà chương đang mở
chỉ có 5 đoạn. **Không có lỗi app nào trong lượt này.** Hai nợ virtualizer ghi ở
lượt trước cũng chính là hai phép đỏ giả này, nay đã đóng.

⚠️ **Còn lại phải bấm tay** — `ui-check` không thay được: nút "Nghe thử" giọng
(P5.1) và chuột phải sửa cách đọc (P5.2). CDP không đọc được đầu ra âm thanh.

**DoD Phase 5** (`plan.md`): installer `.exe` cài trên máy sạch chạy được, không
cần cài Python.

✅ **P5.5c xong → Phase 5 đủ 5/5 phần.** Toàn bộ mã theo kế hoạch ban đầu đã
viết xong. Việc còn lại của Phase 5 **không phải việc code**: publish một release
thật lên GitHub rồi tự cài và bấm cập nhật — xem mục 8, đó là cách duy nhất
chứng minh nhánh cập nhật.

### Phase 6 — đổi engine TTS (mới, sau P5.5c)

**User thấy giọng Piper VI không phù hợp để đọc LN.** Không phải lỗi kỹ thuật —
app chạy đúng, chỉ là giọng nghe máy móc, thiếu ngữ điệu kể chuyện. Đây là phản
hồi về **sản phẩm**, và nó lớn hơn mọi nợ kỹ thuật còn lại.

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P6.1 | Cải tiến `estimate_word_timings` + probe đo lệch so với Piper | ⬅️ **tiếp theo** |
| P6.2 | Engine thứ hai (VieNeu-TTS) + catalog đa engine | Chờ số liệu P6.1 |

**Thứ tự này bắt buộc, không đảo được.** Lý do đầy đủ ở mục 4.79: Piper cho
alignment `phoneme` thật, nên **bây giờ** là lúc duy nhất còn thước đo khách quan
để biết `estimate` tốt tới đâu. Đổi engine trước là tự bịt mắt.

Kế hoạch chi tiết + DoD định lượng ở [plan.md](plan.md) mục 9, Phase 6.

### Phase 3 — đã xong

Phase 3 chia **năm phần** (thống nhất với user — mỗi phần một commit, không dồn).
Giữ nguyên quy ước **logic thuần trước, UI sau**:

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P3.1 | Tầng dữ liệu: `reader:getSegmentAudio`, ước lượng timing, tra từ theo mốc | ✅ Xong |
| P3.2 | Playback engine: máy trạng thái play/pause/next/prev, nối segment liên tục, `playbackRate` + `preservesPitch`, segment sắp phát nhảy đầu hàng đợi | ✅ Xong |
| P3.3 | Player UI đầy đủ: thanh tiến độ trong đoạn, phím tắt, đường tắt tới màn Giọng đọc, icon SVG, mốc 2.5×/3× | ✅ Xong |
| P3.5 | Phiên âm tên riêng Nhật + `charStart` quy về text gốc (xem plan.md mục 8.1) | ✅ Xong (trừ UI tầng 3) |
| P3.4 | Subtitle pane + highlight từng chữ (`rAF` + `ref`) + click-to-seek + splitter `viewerPaneRatio` | ✅ Xong |

**Phase 3 đủ 5/5 phần và DoD đã đạt.** User đã **nghe thật một chương** và xác
nhận chữ sáng đúng nhịp — đó cũng là căn cứ để bỏ Phase 4 (mục 4.68). Còn lại
`pnpm ui-check` vẫn là nợ chưa trả.

P3.2 đã kèm sẵn một `PlayerBar` chạy được (nút phát/trước/sau + 6 mốc tốc độ) vì
không có nút thì không kiểm được máy trạng thái trên app thật. P3.3 đã làm phần
còn lại của plan.md.

### Vì sao P3.5 chen lên trước P3.4

Đánh số 3.5 nhưng **làm trước** 3.4 — giữ số cũ để khỏi phải sửa mọi tham chiếu
"P3.4" đã rải khắp file này.

Lý do đảo thứ tự: P3.4 là phần **đọc** `charStart` để tô chữ, còn P3.5 **đổi
ngữ nghĩa** của `charStart` (từ "trỏ vào text đã normalize" thành "trỏ vào
`Segment.text` gốc"). Làm P3.4 trước thì phải quay lại sửa subtitle pane vừa
viết xong.

Vấn đề gốc user nêu: LN dịch trang nào cũng có tên Nhật (Tokyo, Shinkansen,
Asuka…), Piper VI đọc ra âm vô nghĩa vì ánh xạ chữ cái theo chính tả VI. Ba
tầng xử lý (từ điển ship sẵn → luật romaji → override theo sách), **không tầng
nào bắt user cấu hình** — yêu cầu rõ ràng của user là app phải tự giải quyết.

Chi tiết thiết kế ở [plan.md](plan.md) mục 8.1.

### Những gì P3.3 để lại sẵn cho P3.4

- **`playerPositionMs()`** (export từ `player-store`) là đường đọc vị trí phát mà
  P3.2 còn thiếu. Ghép với `wordIndexAt` của P3.1 là đủ để highlight từng từ —
  không cần đụng vào `sink`.
- **`useSegmentProgress` là khuôn mẫu sẵn cho highlight**: `rAF` → so với giá trị
  đã vẽ → chỉ đụng DOM khi khác → dừng vòng lặp khi không phát. Subtitle pane làm
  y hệt, chỉ đổi thứ ghi ra (`className` của `<span>` thay vì `style.width`).
  Test `KHÔNG re-render React dù chạy hàng chục khung hình` copy được nguyên.
- **`seek(ms)` + `seekMsForChar` (P3.1)** là xong đường click-to-seek. `SegmentProgress`
  đã có mẫu quy đổi toạ độ chuột → ms, gồm cả `setPointerCapture` để kéo ra ngoài
  vẫn tua tiếp.
- **Phím tắt đã có khung loại trừ** (`isTyping`, `isActivatable`). Thêm phím mới
  chỉ là thêm một `case`; đừng bỏ qua hai hàm đó — xem mục 4.57.
- **`viewerPaneRatio` vẫn chưa ai dùng.** Đã có trong settings + zod schema
  (0.2–0.8) từ Phase 0, splitter là việc của P3.4.

**DoD Phase 3** (`plan.md`): nghe liên tục hết chương, chữ sáng đúng nhịp.

### Những gì P3.2 để lại sẵn cho P3.3 / P3.4

- **Timing của đoạn đang phát nằm sẵn trong `player-store`**: `timings` +
  `durationMs`, cập nhật mỗi lần đổi segment. P3.4 chỉ cần đọc, không phải gọi IPC.
- **Vị trí phát KHÔNG có trong store** — cố ý. Đọc `sink.positionMs()` trong
  `requestAnimationFrame` rồi ghi thẳng vào DOM qua `ref`. Đưa vào state là
  re-render 60 lần/giây, đúng thứ CLAUDE.md cấm.
- **`wordIndexAt` (P3.1) + `positionMs()` (P3.2) là đủ để highlight**: mỗi khung
  hình gọi `wordIndexAt(timings, sink.positionMs())`, so với chỉ số lần trước, chỉ
  đụng DOM khi khác. ~~Nhưng `sink` không expose ra ngoài store~~ — **P3.3 đã thêm
  `playerPositionMs()`**, dùng thẳng được.
- **`seek(positionMs)` đã có** cho click-to-seek; ghép với `seekMsForChar` của P3.1
  là xong đường "bấm vào chữ để nghe lại từ đó".
- **`skipped` đã đủ dữ liệu để hiện chi tiết**: mỗi mục có `segmentId`, `index`,
  `reason`. Hiện đang gộp thành một dòng; muốn danh sách bấm được thì không cần
  đổi store.
- **`PLAYBACK_LOOKAHEAD_SEGMENTS = 5` chưa được đo trên sách thật.** Con số suy ra
  từ RTF 0.24: sinh ~2s, phát ~10s. P3.3 **vẫn chưa đo được** — phải *nghe* mới
  biết có hụt không, mà CDP không đọc được tiếng. Để lại cho lượt nghe thử ở P3.4.
- ~~**Phím tắt chưa có**~~ — **P3.3 đã làm**: Space, ←/→, J/K, `[`/`]`. Không chỉ
  là "gắn listener" như ghi ở đây: phần khó là **loại trừ** đúng chỗ (mục 4.57).

### Những gì P3.1 để lại sẵn cho P3.2

- **Lấy audio của một segment chỉ là một lượt gọi**:
  `window.api.reader.getSegmentAudio(id)` trả bytes `.ogg` + `durationMs` +
  `timings[]` + `timingSource`. Renderer bọc bytes thành Blob URL cho `<audio>`
  và **phải `URL.revokeObjectURL`** khi đổi segment — không thì mỗi câu rò ~30 KB,
  cả chương 1353 segment là 40 MB.
- **`timings` không bao giờ rỗng** với segment có audio và có chữ: main tự ước
  lượng khi thiếu file `.json`. P3.2 không cần nhánh riêng cho ca đó.
- **`wordIndexAt(timings, ms)`** là hàm thuần, tìm nhị phân — gọi được mỗi khung
  hình trong `rAF` ở P3.4 mà không tốn kém. Trả `-1` khi chưa tới từ nào hoặc đã
  qua từ cuối; giữ nguyên từ vừa đọc khi rơi vào khe im lặng giữa hai từ phoneme.
- **`seekMsForChar(timings, charOffset)`** cho click-to-seek ở P3.4, đã xử lý ca
  bấm trúng khoảng trắng (trả về từ đứng trước).
- **`NOT_FOUND` là tín hiệu, không phải lỗi**: segment chưa generate *và* segment
  bị Storage Manager xoá dưới chân player đều trả cùng mã. P3.2 bắt mã đó để gọi
  `enqueueSegments` với `JOB_PRIORITY_URGENT` (100) rồi chờ `queue:segmentUpdated`,
  chứ **không** hiện hộp lỗi. Lỗi đĩa thật (mất quyền, ổ rút ra) vẫn ném lên.
- **`getAudioDir` là hàm** trong handler nên user đổi thư mục audio giữa phiên
  vẫn đọc đúng chỗ — đã có test riêng.

---

## 3b. Phase 2 — đã xong

**Phase 1 đã xong đủ 8/8 phần** (P1.1–P1.6c). DoD Phase 1 đạt: mở PDF & DOCX,
thấy danh sách chương đúng, sửa được, thấy segment — kiểm trên bản đóng gói
với 2 sách thật (PDF 270 trang/4817 segment, DOCX 388 khối/430 segment), cả
dark lẫn light.

Phase 2 chia bảy phần (thống nhất với user, vì 2 tuần trong `plan.md` là quá
dài cho một phiên). Vẫn giữ quy ước **logic thuần trước, UI sau**:

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P2.1 | Sidecar skeleton: FastAPI, token, bắt tay, text normalize VI/EN | ✅ Xong |
| P2.2 | Supervisor bên main: spawn/kill, health check 5s, restart 3 lần | ✅ Xong |
| P2.3 | Voice manager: catalog, download + verify SHA256, progress UI | ✅ Xong |
| — | *(kèm P2.3)* Đóng gói sidecar `.exe` + catalog vào installer | ✅ Xong |
| P2.4 | Piper engine + `/synthesize` → ogg, bitrate configurable | ✅ Xong |
| P2.5 | Job queue persist SQLite: priority, pause/resume/cancel | ✅ Xong |
| P2.6 | Generate theo chương + prefetch + ước lượng "cả sách" | ✅ Xong |
| P2.7 | Storage Manager: xem/xoá theo sách-chương, đổi thư mục, cảnh báo | ✅ Xong |
| P2.8 | Trả hết nợ mức **Cao**: `ui-check` CDP, sidecar vào `build:win` + CI | ✅ Xong |

**DoD Phase 2 — đạt đủ, kiểm trên app đang chạy** (không chỉ unit test):

| Mục DoD | Trạng thái |
|---|---|
| Generate chương 1 → có audio | ✅ 190/195 đoạn trên sách DOCX thật, file `.ogg` magic `OggS` |
| Phát được | ✅ file giải mã được, có timing từng từ (`source: "phoneme"`). **UI player là Phase 3** |
| Xem được dung lượng | ✅ theo sách và theo chương, số DB khớp đĩa từng byte |
| Xoá được dung lượng | ✅ xoá 380 file qua UI, tiến độ đọc và cấu trúc chương còn nguyên |

Mục "kiểm trên **bản đóng gói**" đã làm ở **P2.8**: `pnpm build:win` (nay tự đóng
gói sidecar) rồi `pnpm ui-check --packaged` trên `.exe` — đường đi mà bản dev không
lộ được lỗi đường dẫn kiểu asar. Xem mục 4.44, 4.45.

### Ghi chú Phase 2 để lại cho Phase 3 (viết trước khi làm P3.1)

Vẫn còn đúng; phần trùng với P3.1 đã được giải quyết ở mục 3.

What Phase 2 leaves ready:

- **Audio and timings are both on disk and both verified against reality.** For a
  `ready` segment there is always `{audioDir}/{bookId}/{segmentId}.ogg` plus a
  `.json` next to it holding `WordTiming[]` with `source: "phoneme"`. Measured on
  the running app: 253 `.ogg` + 252 `.json`, and `audioBytesOnDisk` matched the
  real byte total exactly. The player does **not** need to re-derive timings.
- **Reading `timings` is already written**: `timings-store.read()` validates the
  file and returns `undefined` for missing or corrupt content rather than
  throwing, so the player can fall back to interpolation without a try/catch.
- **Changing the current segment is one call**: `setActiveSegment(id)` on
  `reader-store`. Both viewers scroll to it and highlight it, and `SegmentList`
  brings the row into view. The player only has to call that per segment.
- **Priority queue is wired for "the segment about to play"**:
  `JOB_PRIORITY_URGENT` (100) beats prefetch (10) and normal (0), and
  `enqueueSegments` only *raises* the priority of a job already queued instead of
  duplicating it. plan.md's "segment about to play jumps the queue" needs no new
  machinery.
- **`playbackRate` and `viewerPaneRatio` already exist in `AppSettings`** (with
  `PLAYBACK_RATE_MIN/MAX` and `VIEWER_PANE_RATIO_MIN/MAX`) but nothing reads
  them yet. CLAUDE.md forbids regenerating audio when speed changes — use
  `playbackRate` + `preservesPitch`.
- **A deleted segment can lose its audio underneath the player.** Storage Manager
  cancels the book's jobs and sets segments back to `pending`, and it pushes
  `queue:segmentUpdated`. The player must react to that event rather than trusting
  the segment list it loaded — otherwise it tries to play a file just deleted.
- **Highlight must not re-render per frame** — CLAUDE.md: `requestAnimationFrame`
  plus direct DOM writes through a `ref`, never `useState` for the word index.
- **Two debts are still open and belong near Phase 3** (see section 8): there is
  no UI for the queue table (`queue:listPending`, `queue:cancelJob` have no
  caller), and no cover-image generation.

### Ghi chú cho Phase 2 (TTS + player)

Những gì P1.6c để lại sẵn cho Phase 2:

- **Đổi segment đang đọc chỉ là gọi `setActiveSegment(id)`** ở `reader-store`.
  Cả hai viewer đã tự cuộn tới và tô đúng chỗ, `SegmentList` tự đưa dòng vào
  tầm nhìn. Player chỉ cần gọi hàm đó mỗi lần audio sang segment kế.
- **Tiến độ đọc tự ghi** khi `activeSegmentId` đổi (`ReaderScreen`), có chặn
  ghi trùng. Player không phải lo.
- `windowing.ts` là hàm thuần, dùng lại được cho danh sách job của queue.
- Subtitle pane + splitter 2/3–1/3 **chưa dựng**. `viewerPaneRatio` đã có sẵn
  trong `AppSettings` (kèm `VIEWER_PANE_RATIO_MIN/MAX`) nhưng chưa ai đọc.
- `scoreCandidates()` → điểm **từng tín hiệu**, vẫn chưa dùng ở UI. Để dành cho
  chế độ "vì sao chương này được nhận" nếu user cần soi.

### Dữ liệu thật đã có — cấu trúc quan sát được

4 file trong `samples/` (không commit). Đã đo bằng `probe/`:

| File | Trang | Outline | Header/footer | Font thân bài |
|---|---|---|---|---|
| `A1-A3-vietnamese-withbookmark.pdf` | 270 | ✅ 10 mục | số trang ở `y≈625` | 10pt, trang 432×648 |
| `A2-A3-english-withoutbookmark.pdf` | 259 | ❌ không | `Page N \| Kuku Moms House` ở `y≈773` | 13pt, trang 612×792 |
| `A4-docx-vietnamese.docx` | 381 đoạn | 2 × `<h1>` | không có | heading style |
| `B3-docx-noheading.docx` | 217 đoạn | ❌ không | không có | chỉ `<p>`, nhận bằng regex |

Đo được ở DOCX (đã dùng cho P1.4):

- mammoth chỉ sinh `<p>`, `<h1>`, `<img>`, `<br>` — **không** có `<strong>`
  đứng riêng, nên tín hiệu "paragraph in đậm" mà plan.md nêu vô dụng với 2
  file này. Vẫn cài đặt vì file khác có thể dùng.
- File B3 có tiêu đề `"Chương 4 - Brocon và Siscon"` là `<p>` thường → chỉ
  regex cứu được, đúng như PDF EN.
- File A4 có `<p>` khớp regex nhưng là **false positive**:
  `"Phần còn lại, tốt, cô ấy có…"` — lý do phải neo `^` + `looksLikeProse`.

Điều đáng chú ý cho P1.3:

- File VI có outline **10 mục**, gồm cả `"Bản quyền"`, `"Lời tác giả"`,
  `"Lời bạt"` — tức outline **không chỉ chứa chương**. Detector phải giữ
  nguyên rồi để user loại ở màn xác nhận (P1.5), đừng tự đoán mục nào là chương.
- Tiêu đề chương trong outline có dạng `"Chương Một: ..."`, `"Mở đầu: ..."`,
  `"Kết: ..."` — số chương viết **bằng chữ**, không phải chữ số.
- Trang mục lục (trang 2) có dòng `"Chương Hai: Đá văng ảo tưởng77"` — số trang
  dính liền tiêu đề, không có khoảng trắng. Regex bắt tiêu đề dễ khớp nhầm ở đây.
- File EN không outline → phải dựa font size. Thân bài đồng đều 13pt nên tiêu
  đề chương sẽ nổi rõ; cần kiểm lại bằng `probe/` khi viết P1.3.

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

### 4.9 Luật "dòng ngắn" — giả định sai, chỉ lộ ra trên PDF thật

Đây là ví dụ điển hình cho lý do phải chạy trên dữ liệu thật.

**Giả định ban đầu (sai):** "dòng bị wrap giữa câu thì đã chạy hết bề ngang
nên không thể ngắn — ngắn tức là tiêu đề." Từ đó cho dòng ngắn đứng riêng
hẳn một khối, chặn cả hai phía.

**Thực tế:** dòng **cuối mỗi đoạn văn** cũng ngắn y hệt tiêu đề. Kết quả là
câu bị xé làm đôi giữa chừng:

```
▸ …chẳng ai đi trực nhật hay sinh hoạt cuối ngày. Tất cả vẫn ngồi
▸ trong lớp chờ đợi.        ← phải nối vào khối trên
```

**Sửa:** dòng ngắn chỉ tách khối khi khối đang mở **đã trọn ý**
(`current.length === 0 || endsSentence(current)`). Đoạn dở câu vẫn được nối
tiếp bình thường.

Trên file mẫu VI: 602 → **488 khối** (bớt 114 câu bị xé sai).

Test khoá ở `merge-lines.test.ts` mục "dòng ngắn cuối đoạn vẫn được nối vào
câu đang dở", dùng đúng câu văn gặp trong file thật.

### 4.10 Chapter detector — chấm điểm song song, không phải thác nước

`plan.md` mô tả "outline → font size → regex → vị trí → fallback" nghe như
thác nước: có tín hiệu mạnh thì bỏ qua tín hiệu yếu. **Không làm vậy.**

Lý do đến từ đo đạc thật: file mẫu EN **không có outline lẫn font lớn hơn
thân bài** (97.1% dòng đều 13pt, tiêu đề `"Chapter 1 :"` cũng 13pt). Thác
nước sẽ rơi thẳng xuống fallback chia theo trang. Chấm điểm song song thì
regex (1.5) + vị trí (0.6) = 1.86 vượt ngưỡng 1.4 → nhận đúng 3/3 chương.

Trọng số và ngưỡng 1.4 chọn để:
- regex mạnh **một mình** đủ qua (1.0 × 1.5 = 1.5)
- font lớn **một mình** đủ qua (1.0 × 1.5 = 1.5)
- vị trí + trang thưa **một mình KHÔNG** đủ (0.6 + 0.4 = 1.0) — nếu không thì
  mọi trang đều thành chương, vì trang nào cũng có dòng đầu tiên

### 4.11 Ba bẫy của chapter detector, phát hiện nhờ file thật

**a) Outline không chỉ chứa chương.** File mẫu VI có 10 mục gồm cả
`"Bản quyền"`, `"Lời tác giả"`, `"Lời bạt"`. Detector **giữ nguyên tất cả**,
để user loại ở màn xác nhận (P1.5). Tự đoán mục nào là chương sẽ xoá nhầm
`"Ngoại truyện"`, `"Truyện ngắn"` — vốn là nội dung thật cần đọc.

**b) Tên chương phải lấy từ outline, không lấy dòng text trên trang.**
Khi outline trỏ tới trang mà text không khớp, chương lấy nhầm tên thành câu
văn đầu trang (`"Câu văn thân bài thứ 0."`). Xem `titleFor()` trong
`detector.ts`.

**c) Trang mục lục ăn điểm y hệt tiêu đề chương** (font lớn + đầu trang).
File mẫu VI cho `"Mục lục"` 19pt điểm 1.99, vượt ngưỡng → sinh chương rỗng.
Đã thêm `signals/toc.ts` làm **bộ lọc loại trừ** (không phải tín hiệu điểm):
trang có > 50% số dòng kết thúc bằng số trang thì bỏ qua. Ngoại lệ: outline
trỏ đích danh vào trang đó thì vẫn giữ — outline là chân lý.

Dấu hiệu nhận biết mục lục lấy từ quan sát thật: `"Chương Hai: Đá văng ảo
tưởng77"` — số trang **dính liền** tiêu đề, không có khoảng trắng.

### 4.12 Regex tiêu đề bắt buộc neo `^`

Không neo thì `"…the last part left, most of the important decisions…"` khớp
`part\b` ngay giữa câu văn — lỗi thật gặp khi thử trên file mẫu EN. Ngoài neo
`^` còn có `looksLikeProse()` chặn dòng quá dài và dòng có dấu kết câu ở giữa.

Test khoá ở `pattern.test.ts` mục "không khớp nhầm văn xuôi", dùng đúng câu
gặp trong file thật.

### 4.14 CI — lỗi lần chạy đầu tiên

Lần đầu workflow thật sự chạy (2026-07-25) và fail ngay ở bước setup.

**a) Khai pnpm version ở hai chỗ.** `pnpm/action-setup` có `version: 9`,
package.json có `packageManager: pnpm@9.15.9` → `ERR_PNPM_BAD_PM_VERSION`.

→ **Bỏ `version` khỏi workflow.** Action tự đọc `packageManager` — giữ một
nguồn duy nhất. Đừng thêm `version` lại, kể cả khi thấy ví dụ trên mạng có.

**b) Action chạy trên Node 20 đã deprecated.** Đây là Node chạy *bản thân
action*, không phải Node build project (cái đó vẫn ghim 22 qua `.nvmrc`).

→ Nâng `checkout@v4→v7`, `setup-node@v4→v7`, `upload-artifact@v4→v7`,
`pnpm/action-setup@v4→v6` (v5 là bản chuyển sang Node 24).

**c) `scripts/sqlite-abi.mjs` hardcode đường dẫn Electron.** Dòng cũ trỏ
thẳng `node_modules/.pnpm/electron@33.4.11/...`. Máy dev có sẵn thư mục đó
nên không ai thấy, nhưng CI cài sạch — chỉ cần pnpm resolve bản patch khác
là `Cannot find module`.

→ Đổi sang `require.resolve('electron/package.json', { paths: [root] })`.
Đã kiểm bằng cách xoá `.abi-cache/` rồi chạy lại đường đi lạnh.

**d) Smoke test dùng `Start-Sleep 25` cứng** rồi gọi CDP ngay. Runner chậm
thì fail giả, runner nhanh thì phí thời gian.

→ Đổi thành vòng lặp thử lại 2s × 30 lần, thoát ngay khi renderer sẵn sàng.
Chạy thật: sẵn sàng sau **2 giây**, tiết kiệm 23s mỗi lần build.

**e) Smoke test không chạy được trên máy dev** vì `ELECTRON_RUN_AS_NODE=1`
(mục 5.2). App chết ngay, không kịp ghi cả crash log — rất khó đoán nếu
không biết trước.

→ Thêm `Remove-Item Env:\ELECTRON_RUN_AS_NODE` vào bước smoke test. Runner
không đặt biến này nên đây là phòng vệ, nhưng nhờ nó mà **kiểm chứng được
smoke test trên máy dev** trước khi push.

**Đã chạy thật toàn bộ job `build` dưới máy local:** `pnpm build:win` →
NSIS + portable → smoke test PASS. Nghĩa là logic đã đúng; chỉ còn chờ CI
xác nhận trên môi trường sạch.

### 4.16 P1.4 — ba lỗi chỉ lộ ra khi nối các phần lại

Từng phần đều xanh test riêng, nhưng ghép lại thì hỏng. Đây là lý do phải
chạy trọn đường đi trên file thật.

**a) `\n` lọt vào giữa segment.** Cleaner trả text nhiều khối ngăn bằng `\n`,
nhưng segmenter (viết ở P1.1) chưa từng coi `\n` là ranh giới — nó nhận text
liền mạch. Kết quả: một segment ôm cả khối nhiều dòng, TTS đọc dính tiêu đề
vào thân bài.

→ Sửa ở **cả ba tầng**: `splitSentences` cắt câu tại `\n`; `segmentText` xả
buffer khi qua ranh giới đoạn; `mergeShortSegments` không gộp qua `\n` (nếu
không nó dán lại đúng cái vừa tách).

Đổi hợp đồng có chủ ý: test cũ ở P1.1 khẳng định `"Dòng một\ndòng hai."` là
**một** câu. Hồi đó splitter nhận text THÔ nên `\n` là ngắt dòng ngẫu nhiên
của PDF. Giờ `mergeLines` của cleaner đã lo việc nối dòng, nên `\n` còn sót
tới segmenter chỉ có thể là ranh giới đoạn cố ý. Test đã cập nhật kèm lý do.

**b) Cleaner vẫn nhả text mục lục.** Detector đã biết bỏ trang mục lục
(mục 4.11c) nhưng cleaner thì không, nên segment đầu của sách VI là
`"Mục lục / Bản quyền11 / Lời tác giả14…"` — TTS sẽ đọc to "Bản quyền mười
một, Lời tác giả mười bốn".

→ `cleanPages` dùng chung `isTableOfContents`, trả text rỗng + cờ
`isTableOfContents`. Vẫn giữ trang để `pageNumber` không lệch. Tắt được bằng
`skipTableOfContents: false`.

**c) Gom dòng theo bucket cứng tách đôi một dòng chữ.** `round(y/3)` khiến
hai item cách nhau 1pt vẫn rơi khác bucket nếu nằm sát ranh giới.

→ Gom theo **khoảng cách thực tế** giữa các item đã sắp xếp. Test khoá cả ba
độ lệch 0/1/2pt.

### 4.17 pdfjs v6 đã bỏ `disableWorker` và `isEvalSupported`

Hai tuỳ chọn này có ở bản cũ, v6 không còn. Đặt vào thì **typecheck báo lỗi**
chứ không im lặng bỏ qua — may, vì nếu im lặng sẽ tưởng đã tắt worker.

Danh sách hợp lệ trong `DocumentInitParameters` v6 (phần liên quan):
`useSystemFonts`, `worker`, `useWorkerFetch`, `useWasm`, `wasmUrl`.

Hiện chỉ đặt `useSystemFonts: true`. Bản `legacy` bắt buộc — bản mặc định
cần `DOMMatrix`/`Path2D` mà Node và Electron main không có.

**Chưa kiểm ở bản đóng gói** — asar có thể không nạp được worker file. Xem
mục 8.

### 4.19 pdfjs trong Electron đã đóng gói — hai lỗi, 716 test không lộ

Đây là lần kiểm chứng nợ kỹ thuật "pdfjs chưa kiểm ở bản đóng gói". Kết quả:
**mọi file PDF đều hỏng** ở bản build, trong khi unit test và `probe/` đều xanh.
DOCX không sao — nên nếu chỉ thử DOCX sẽ tưởng đã xong.

**a) `ReferenceError: DOMMatrix is not defined` ngay lúc `import()`.**

Bản `legacy` của pdfjs *có* tự polyfill `DOMMatrix`/`Path2D`, nhưng chỉ chạy
khi nó nhận ra đang ở Node. Trong Electron main thì `process.type === 'browser'`
nên pdfjs tưởng mình ở trình duyệt và bỏ qua — mà Electron main lại **không**
có `DOMMatrix` thật (đã đo: `typeof DOMMatrix === 'undefined'`).

Module pdfjs có `const SCALE_MATRIX = new DOMMatrix()` ở cấp cao nhất, nên
thiếu nó là ném ngay lúc import, trước khi chạm tới file PDF nào.

→ `ensureDomMatrix()` trong `node-parsers.ts` cài một `DOMMatrix` tối thiểu
trước khi import. Cố ý **không** cài `@napi-rs/canvas` (thêm ~40 MB native chỉ
để dựng một ma trận mà parser không bao giờ dùng — nó chỉ trích text).

**b) `Setting up fake worker failed: Cannot find module 'pdf.worker.mjs'`.**

pdfjs đặt `workerSrc = "./pdf.worker.mjs"` — tương đối với **file bundle**.
Vite gộp phần code của pdfjs vào bundle được, nhưng worker thì nó nạp bằng
`import()` lúc chạy nên phải là file thật nằm cạnh. Mà `electron-builder.yml`
chỉ đóng gói `apps/main/dist/**` — **không có `node_modules`**, nên
`require.resolve('pdfjs-dist')` cũng vô nghĩa ở bản đóng gói.

→ Hai phần: `scripts/copy-pdf-worker.mjs` chép worker vào `apps/main/dist/`
lúc build (đã gắn vào `pnpm --filter @ln/main build`), và `findWorkerSrc()`
tìm **cạnh bundle trước**, rồi mới tới `node_modules` (đường đi lúc dev/test).

Phải gán đè `GlobalWorkerOptions.workerSrc`, **không** dùng `||=`: giá trị mặc
định kia đã là chuỗi không rỗng nên `||=` bỏ qua và lỗi còn nguyên. Mất một
vòng thử mới nhận ra.

**c) Lỗi parse không để lại dấu vết nào.** `wrapHandler` chỉ ghi log khi
handler **ném**, mà `ParseError` được chuyển thành `Result` nên đi vòng qua.
Bản đóng gói chỉ trả về "File có thể đã hỏng" — vô dụng để chẩn đoán, mà đây
lại đúng là loại lỗi khó tìm nhất.

→ `import.ts` nhận `logError` và đưa `cause` vào `AppError.detail`. Chính nhờ
bước này mới đọc được nguyên nhân thật ở (b).

Test khoá ở `node-parsers.test.ts` (thứ tự tìm worker) và `import.test.ts`
(giữ `detail`, có ghi log).

**Cách kiểm lại khi sửa pdfjs:** build `.exe` rồi gọi thẳng IPC qua CDP —
`Start-Process ... --remote-debugging-port=9222`, sau đó
`Runtime.evaluate` với `window.api.import.parseFile(...)`. Truyền đường dẫn
bằng `JSON.stringify` chứ đừng nội suy chuỗi: backslash Windows bị nuốt sẽ ra
lỗi "file hỏng" giả, mất thời gian đuổi nhầm hướng.

### 4.20 Nhãn tin cậy phải so theo bối cảnh, không phải mốc cứng

Bản đầu chấm mốc tuyệt đối (≥3 "Chắc chắn", ≥2 "Có thể đúng"). Chạy thật trên
bản đóng gói thì file EN cho **5/5 chương đều "Nên kiểm lại"** — vì không có
outline nên mất luôn hai tín hiệu mạnh nhất (outline 3.0, font lớn 1.5), trần
thực tế chỉ còn 2.5.

Cảnh báo hiện ở mọi dòng thì không còn là cảnh báo: user chỉ học cách phớt lờ.

→ `confidenceLevel(confidence, hasOutline)` đổi mốc theo việc tài liệu có
outline hay không (1.8/1.5 khi không có). Sau khi sửa, đúng "Prologue :" bị
gắn cờ — chương này thật sự chỉ có 1 trang nên đáng ngờ thật.

Bài học chung: điểm của detector chỉ có nghĩa **tương đối trong cùng một tài
liệu**. Đừng so điểm giữa hai file có bộ tín hiệu khác nhau.

Kèm một lỗi CSS chỉ thấy bằng mắt: ô tên chương dùng `hover:border-border`,
mà sau khi bấm thì chuột vẫn nằm trên ô nên viền bám lại, trông như chương đó
đang được chọn. Đổi sang `group-hover` trên cả hàng.

### 4.21 Dựng segment theo TRANG, và cách tìm lại toạ độ

**Dựng theo trang, không ghép cả chương.** `buildChapterSegments` chạy
segmenter trên từng `CleanedPage` rồi nối kết quả, thay vì ghép cả chương
thành một chuỗi dài. Lý do là **neo**: ghép cả chương thì offset của segment
trỏ vào chuỗi ghép, muốn biết segment nằm trang nào phải dò ngược qua bảng
offset — thêm một chỗ sai mà không có gì kiểm chứng. Chạy theo trang thì
`anchor.page` đúng **theo cấu trúc**, không phải suy luận.

Đánh đổi: câu bị PDF ngắt qua hai trang thành hai segment. Chấp nhận được —
segment là đơn vị ~10s audio, không phải đơn vị ngữ nghĩa.

**Tìm `rects` phải dò trên chuỗi cả trang, không dò từng dòng.**

Bản đầu dò theo từng dòng: so phần đầu segment với dòng thứ nhất, khớp thì
sang dòng kế. Chạy trên sách thật thì **226/4817 segment không khớp được**.
Nhìn vào chúng mới thấy giả định sai ở đâu:

```
"Chitose trở về Trái Đất đi!!!”"     ← dấu đóng nhưng không có dấu mở
"khi cô vui vẻ vẫy tay."             ← chữ thường ở đầu
```

Đây là segment **bắt đầu giữa một dòng**. Cleaner nối nhiều dòng thành một
khối, rồi segmenter cắt lại theo ranh giới **câu** — hai ranh giới đó gần như
không bao giờ trùng nhau. Chỉ segment nào tình cờ trùng đầu dòng mới khớp.

→ Ghép cả trang thành một chuỗi kèm bảng tra ngược `ký tự → dòng`, rồi
`indexOf`. Đoạn khớp chạm dòng nào thì lấy rect dòng đó. Kết quả trên sách
thật: **0/4817 thiếu rects**.

Test khoá ở `chapter-segments.test.ts` mục "khớp segment bắt đầu GIỮA một
dòng", dùng đúng câu hội thoại gặp trong file thật.

### 4.18 TypeScript project references — đã bỏ

`@ln/shared` trỏ thẳng vào `src/*.ts` (không build ra `dist`), nên project
references gây lỗi `TS6305`. Đã bỏ `composite` và `references`, để TS resolve
qua `node_modules`.

### 4.22 pdfjs ở renderer cũng phải dùng bản `legacy` — nhưng vì lý do khác

Kế hoạch ban đầu (ghi ở mục 4.19) là: renderer dùng bản **thường** vì có
`DOMMatrix`/`Path2D` thật của Chromium. Suy luận đó đúng nhưng **chưa đủ**.

Bản đóng gói mở PDF nào cũng lỗi:

```
Không mở được file PDF: a.toHex is not a function
```

Dò trong app đang chạy:

| API | Chromium 130 (Electron 33) |
|---|---|
| `Uint8Array.prototype.toHex` | ❌ `undefined` |
| `Uint8Array.fromHex` | ❌ `undefined` |
| `Uint8Array.prototype.toBase64` | ❌ `undefined` |
| `Promise.withResolvers` | ✅ có |

pdfjs 6 gọi **thẳng** `Uint8Array.prototype.toHex()` (ES2025, mãi Chromium 140
mới có). So hai bản build:

```bash
grep -c toHex build/pdf.min.mjs         # 0  → không polyfill, gọi trần
grep -c toHex legacy/build/pdf.min.mjs  # 1  → "toHex||!function(...)"
```

Bản `legacy` có kiểm tra rồi mới bù. → renderer cũng import từ
`pdfjs-dist/legacy/build/pdf.mjs`, worker lấy `legacy/build/pdf.worker.min.mjs`.
`DOMMatrix` không thành vấn đề vì renderer là Chromium thật.

**Bài học lặp lại lần thứ ba:** "Electron là Chromium nên API web đều có" là
suy luận sai. Electron khoá ở một phiên bản Chromium **cũ hơn** trình duyệt
người dùng đang chạy nhiều tháng. Thư viện nhắm "trình duyệt hiện đại" vẫn có
thể dùng API Electron chưa có. Cách duy nhất biết chắc là **dò trong app đang
chạy**, không phải đọc bảng tương thích.

Kèm theo: jsdom cũng không có `DOMMatrix`, mà `pdf-document.ts` chỉ cần được
*import* là nổ — `App.test.tsx` fail dù không đụng gì tới PDF. Đã bù trong
`test/setup.ts` cùng nhóm với `ResizeObserver` / `scrollIntoView` / `scrollTo`.

### 4.23 Biến màu phải lưu KÊNH RGB, không phải hex — `bg-accent/30` âm thầm mất màu

Lỗi nặng nhất của P1.6c, và nó đã nằm sẵn trong code từ P1.6b mà không ai thấy.

Ô highlight trên trang PDF **không hiện gì**. Kiểm trong app đang chạy:

```js
getComputedStyle(hl).backgroundColor  // "rgba(0, 0, 0, 0)"  ← trong suốt hoàn toàn
```

Nguyên nhân: `theme.css` lưu `--accent: #818cf8`, mà Tailwind cần **kênh rời**
mới ghép được `<alpha-value>`. Gặp hex, `bg-accent/30` sinh ra CSS không hợp lệ
rồi trình duyệt bỏ qua — **không lỗi, không cảnh báo, chỉ là màu biến mất**.

Cả 5 chỗ dùng `/opacity` trong app đều đã hỏng sẵn, gồm hai chỗ của P1.6b mà
tôi đã "kiểm bằng ảnh chụp" và không nhận ra:

| Lớp | Chỗ dùng | Hậu quả |
|---|---|---|
| `bg-accent/30` | Ô highlight trang PDF | Vô hình |
| `bg-accent/10` | Dòng segment đang chọn, nhãn "Đang đọc" | Không nền |
| `bg-accent/5` | Chương đọc dở ở mục lục | Không nền |
| `bg-bg/80` | Nền mờ hộp thoại xoá sách | **Không mờ** |

→ Đổi sang kênh rời (`--accent: 129 140 248`) + `rgb(var(--accent) / <alpha-value>)`
trong `tailwind.config.js`. Chỗ nào dùng biến trong CSS thường phải bọc
`rgb(var(--x))`; muốn màu mờ thì `rgb(var(--x) / 0.18)` thay cho `color-mix`.

Hai bài học:

1. **Màu trong suốt không báo lỗi.** Test đếm được class `bg-accent/30` có mặt,
   nhưng không ai kiểm màu *tính ra được*. Muốn chắc phải đọc `getComputedStyle`
   trong app thật.
2. **Nhìn ảnh chụp không đủ để coi là đã kiểm.** P1.6b tôi xem ảnh hộp thoại
   xoá và thấy "ổn" — trong khi nền mờ hoàn toàn không hoạt động. Nền tối làm
   một lớp phủ mất tích trông chẳng khác gì có.

### 4.25 Số hiệu lớp học trong LN khớp regex ngày tháng — lỗi nặng nhất của P2.1

Lại một lần nữa dữ liệu thật lộ ra thứ 90 unit test không thấy. Chạy normalize
trên 2429 segment lấy từ sách mẫu:

```
"Sau giờ học hôm ấy, lớp 11-5 kết thúc sinh hoạt."
  → "lớp ngày mười một tháng năm kết thúc sinh hoạt"   ← SAI

"In Class 2-5, we were having a homeroom..."
  → "In Class February fifth, we were having..."        ← SAI
```

LN Nhật ghi lớp học kiểu **khối-lớp** (`11-5` = khối 11 lớp 5), khớp regex
ngày `d-m` y hệt. **Cả hai cuốn mẫu đều dính**, mỗi cuốn nhiều chỗ.

→ Dấu `-` **chỉ tính là ngày khi có năm 4 chữ số** đi kèm (`5-6-2024`). Dạng
`11-5` trong LN gần như luôn là lớp, tỉ số hay khoảng; còn ngày viết bằng `-`
mà thiếu năm thì hiếm. Dấu `/` vẫn nhận cả khi không có năm — `12/3` hầu như
chỉ là ngày.

Sửa ở **cả hai** normalizer: VI và EN có regex riêng (VI ngày/tháng, EN
tháng/ngày) nên phải sửa hai chỗ. Test khoá ở `test_normalize_vi.py` và
`test_normalize_en.py` mục "gạch ngang không năm KHÔNG phải ngày".

Hai lỗi nhỏ hơn cũng chỉ lộ ra khi chạy thật, không phải unit test:

**a) Lặp chữ "ngày".** `"Hẹn ngày 12/3"` → `"Hẹn ngày ngày mười hai tháng ba"`.
Test ban đầu chỉ đưa vào chuỗi ngày trơ trọi nên không thấy. Nay kiểm phía
trước đã có chữ "ngày" chưa.

**b) Dấu chấm cuối câu bị nuốt.** `"...học sinh của TP."` → mất hẳn dấu chấm,
vì `TP.` khớp cả dấu chấm. Mất ranh giới câu là TTS đọc dính sang câu sau.
Nay trả lại dấu chấm khi viết tắt nằm **cuối chuỗi**.

Cố ý **không** đoán theo "chữ sau viết hoa": `TP. Hồ Chí Minh` và `sống ở TP.
Rồi đi.` giống hệt nhau ở dấu hiệu đó, đoán sai vế đầu thì chẻ đôi một địa danh.
Segmenter đã cắt theo câu trước khi tới đây nên "cuối chuỗi" gần như luôn là
cuối câu thật.

### 4.26 Sidecar — bốn quyết định về giao tiếp với main

**a) Bắt tay qua stdout, không phải cổng cố định hay file tạm.** Sidecar bind
cổng `0` (OS cấp cổng trống) rồi in đúng một dòng
`LN_SIDECAR_READY {...}`. Cổng cố định thì hai bản app chạy song song đụng
nhau và tiến trình khác đoán được; file tạm thì phải dọn và cũng đè nhau.
stdout là ống có sẵn giữa cha-con, tự đóng khi tiến trình chết.

Log uvicorn đẩy hết sang **stderr** để stdout chỉ còn đúng dòng bắt tay.
`flush()` bắt buộc — stdout nối vào pipe thì đệm theo khối, không theo dòng;
quên flush thì main chờ mãi rồi giết một sidecar đang chạy bình thường.

**b) Bind socket bằng tay TRƯỚC khi giao cho uvicorn.** Để uvicorn tự bind thì
cổng chỉ biết được qua log của nó — phải parse ngược log, đúng thứ hay vỡ khi
nâng phiên bản.

**c) Cố ý KHÔNG đặt `SO_REUSEADDR`.** Trên Windows nó cho phép hai tiến trình
cùng bind một cổng mà không ai báo lỗi — request sẽ đi lung tung giữa hai bản
sidecar. Thà bind hỏng và biết ngay.

**d) Token qua biến môi trường, không qua tham số dòng lệnh.** Trên Windows
mọi tiến trình đều đọc được command line của tiến trình khác
(`wmic process get CommandLine`). Env của tiến trình con thì chỉ nó và cha đọc được.

So token bằng `secrets.compare_digest`, không phải `==`: `==` thoát sớm ở byte
đầu khác nhau, đo thời gian phản hồi đủ nhiều lần là dò ra token từng byte.

`/health` là route **duy nhất** không cần token — main phải chẩn đoán được
sidecar sống ngay cả khi token hai bên lệch. Trang `/docs` tắt hẳn vì đó là
đường duy nhất phục vụ request không kèm token.

### 4.27 Khử trùng lặp báo hỏng theo TRẠNG THÁI làm supervisor treo mãi ở `restarting`

Lỗi nặng nhất của P2.2. **71 unit test xanh, chạy thật với sidecar Python là lộ.**

Sidecar chết được báo từ **hai nguồn** bắn gần như cùng lúc cho cùng một cái
chết: sự kiện `exit` của tiến trình, và health check thất bại. Phải khử trùng
lặp, nếu không một cái chết ăn hai lượt restart.

**Cách khử ban đầu (sai):** đang ở `restarting` thì bỏ qua báo hỏng mới.

```ts
if (status.state === 'restarting' || status.state === 'failed') return;  // SAI
```

Nghe hợp lý, nhưng lần chết **kế tiếp** cũng rơi đúng vào trạng thái đó và bị
nuốt luôn. Hậu quả: sidecar chết liên tục thì supervisor đứng im ở `restarting`
**vĩnh viễn** — không đếm lượt, không bao giờ tới `failed`, UI treo mãi ở "đang
khởi động" mà không có thông báo nào.

**Vì sao unit test không thấy:** tiến trình giả trong test luôn bắt tay thành
công rồi mới chết, nên lần chết thứ hai luôn xuất phát từ trạng thái `ready`.
Kịch bản "chết liên tiếp **ngay lúc khởi động**, chưa kịp bắt tay lần nào"
không dựng được bằng tiến trình giả mặc định.

**Sửa:** khử theo **số hiệu lần chạy** (`generation`), tăng mỗi lần spawn. Mỗi
lần chạy chỉ được tính một lượt hỏng, nhưng lần chạy mới thì vẫn tính.

Cùng cơ chế này vá luôn một lỗi thứ hai chưa kịp xảy ra: health check kéo dài
vài giây, trong lúc đó sidecar chết và được dựng lại — báo hỏng theo kết quả cũ
sẽ **giết oan tiến trình mới** hoàn toàn khoẻ mạnh. Nay `checkHealth` chốt số
hiệu trước khi gọi và bỏ qua kết quả nếu số hiệu đã đổi.

Test khoá ở `sidecar-supervisor.test.ts` mục "chết LIÊN TIẾP ngay lúc khởi động"
và "health check trả về muộn KHÔNG giết oan tiến trình đã dựng lại". **Đã kiểm
chứng test bắt được lỗi**: khôi phục lại dòng cũ thì test đỏ đúng chỗ.

Kèm ba quyết định nhỏ cùng nhóm:

**a) Không tìm thấy sidecar thì `failed` NGAY, không đốt ba lượt.** Thiếu file
là hỏng cố định — thử lại chỉ tổ chậm và rác log.

**b) Bộ đếm restart reset sau `SIDECAR_STABLE_MS` (60s).** Không có nó thì chết
3 lần rải rác trong nhiều giờ cũng bị coi là hỏng hẳn y như chết 3 lần trong 10
giây, trong khi cái đầu đã tự phục hồi.

**c) `shell: false` khi spawn là bắt buộc.** Shell sinh thêm một tiến trình
trung gian và `kill()` chỉ giết cái vỏ — Python bên trong sống sót, giữ nguyên
cổng. Ngoài ra đường dẫn Windows có khoảng trắng sẽ bị shell tách sai.

### 4.28 Catalog voice — sha256 phải tự tính, HF chỉ công bố md5

Hugging Face có `voices.json` liệt kê mọi voice Piper kèm `md5_digest` và
`size_bytes`. Nhưng plan.md và CLAUDE.md đều yêu cầu verify **SHA256**, mà md5
thì không dùng để chống sửa đổi có chủ ý được nữa.

→ Tải thật cả 4 file (2 voice × model + config) rồi tự tính sha256. Đối chiếu
md5 với con số HF công bố **trước** để chắc bytes đúng gốc, rồi mới lấy sha256
tính từ chính bytes đó. Cả hai đều khớp, và `size_bytes` cũng khớp.

**Quy tắc khi thêm voice mới:** phải tải file thật rồi tính sha256. Để rỗng hay
đoán thì bước verify thành vô nghĩa — user nhận file hỏng mà không có gì báo,
và lỗi chỉ lộ ra ở tận lúc nạp engine.

Voice chọn: `vi_VN-vais1000-medium` (63.2 MB) và `en_US-lessac-medium`. Đều
`medium` — `low` nghe rõ tệ hơn mà chỉ nhẹ hơn chút.

**Voice tính là "đã cài" khi đủ MỌI file và kích thước khớp**, không phải khi
thư mục tồn tại. Lần tải trước đứt giữa chừng để lại `.onnx` dở dang; chỉ kiểm
thư mục thì engine sẽ nạp file hỏng ở tận P2.4 — xa chỗ gây lỗi tới mức không
lần ra. Kiểm kích thước bắt đúng ca đó mà không phải băm lại 63 MB mỗi lần.

### 4.29 Đóng gói sidecar — một lỗi mà 245 test không lộ

Nợ "sidecar chưa đóng gói" ở mức Cao đã đóng. Và đúng như dự đoán, nhánh `.exe`
hỏng ngay lần chạy đầu tiên trong khi mọi unit test vẫn xanh.

**a) `ImportError: attempted relative import with no known parent package`.**

PyInstaller chạy script đích như **module cấp cao nhất** (`__name__ ==
"__main__"`, không có package cha). Mà `app/server.py` dùng import tương đối
(`from .config import ...`) — thứ chỉ hợp lệ bên trong một package. `.exe` build
thành công, kích thước hợp lý, rồi chết ngay khi khởi động.

Vì sao không chỗ nào khác lộ ra:

| Đường chạy | Vì sao vẫn đúng |
|---|---|
| `pnpm dev` | main spawn bằng `-m app.server` → Python nạp `app` thành package trước |
| `pytest` | `pythonpath = .` cho phép `import app.server` |
| `probe/` | Cũng đi qua venv, cùng đường với dev |

→ Thêm `sidecar/entry.py` **ở ngoài** package, import tuyệt đối
(`from app.server import main`), và trỏ PyInstaller vào đó. Test khoá ở
`test_build.py`: có `entry.py`, entry không dùng import tương đối, và `build.py`
không trỏ vào `app/server.py`.

**b) `httpx` từng là dependency chỉ-dành-cho-test.** Nó nằm ở
`requirements-dev.txt` từ P2.1 (cho `TestClient`). Nhưng P2.3 dùng nó để tải
voice — tức là **runtime**. Để nguyên thì `.exe` thiếu httpx và lỗi chỉ lộ ra
lúc user bấm nút tải. Đã chuyển lên `requirements.txt`; test khoá lại.

**c) Hidden imports của uvicorn.** uvicorn nạp `uvicorn.loops.auto`,
`uvicorn.protocols.http.auto`… **động** lúc chạy, PyInstaller dò import tĩnh nên
không thấy. Đã khai tường minh trong `build.py`.

**d) `onedir` chứ không `onefile`.** onefile giải nén cả bộ vào thư mục tạm mỗi
lần khởi động — chậm thêm vài giây và bị antivirus soi kỹ hơn. Sidecar khởi
động cùng app nên độ trễ đó user thấy ngay.

**e) `--console` chứ không `--windowed`.** `--windowed` biến stdout/stderr
thành thiết bị rỗng trên Windows, mà **bắt tay lại đi qua stdout** (mục 4.26a).
Ẩn cửa sổ là việc của `windowsHide` bên main, không phải của PyInstaller.

**f) `extraResources` chứ không `files`.** Sidecar phải là file thật trên đĩa vì
nó được `spawn` như tiến trình riêng — Windows không chạy `.exe` nằm trong asar.
Đích (`resources/sidecar/`, `resources/voices/`) phải khớp `sidecar-paths.ts`;
đổi một bên mà quên bên kia thì bản đóng gói không tìm thấy gì trong khi unit
test vẫn xanh. `test_build.py` khoá cả hai chiều.

Installer: 82 → **94 MB** (sidecar onedir 29 MB). Vẫn xa mốc 200 MB của plan.

### 4.30 Piper xuất 22050 Hz mà Opus không nhận — phải tự resample

Ràng buộc không né được: Piper xuất **22050 Hz** (nằm trong model `.onnx` đã
train, đổi là đổi cao độ giọng), còn libsndfile chỉ mã hoá Opus ở
**8/12/16/24/48 kHz**. Không resample thì `sf.SoundFile` ném ngay lúc mở file.

**Đã thống nhất với user: tự viết polyphase, không thêm scipy.**
`scipy.signal.resample_poly` làm sẵn đúng việc này nhưng wheel ~45 MB sẽ kéo
installer từ 94 MB lên ~140 MB — cho đúng một hàm. Chọn 24000 Hz làm đích (không
phải 48000: giọng nói không có gì trên 12 kHz để giữ, mà 48 kHz thì gấp đôi số
mẫu phải mã hoá; cũng không phải 16000: cắt mất âm xát /s/, /t/ nghe đục).

Đổi lại là phải tự chịu trách nhiệm về chất lượng — và **hai lỗi đã bị bắt bằng
chính test đo tính chất tín hiệu**, cả hai đều không ném exception nào:

**a) Chuẩn hoá bộ lọc sai — audio nhỏ đi 160 lần.** Mỗi mẫu đầu ra chỉ chạm
**một pha** của bộ lọc, nên điều kiện giữ nguyên biên độ là "tổng **mỗi pha**
= 1", không phải "tổng cả bộ lọc = 1". Chuẩn hoá nhầm về 1 thì audio gần như câm.

**b) Tần số cắt lấy `1/up` thay vì `1/max(up, down)` — 4 kHz gập xuống 2 kHz.**
Khi giảm mẫu thì Nyquist đích thấp hơn Nyquist nguồn; cắt theo `up` để lọt đúng
phần bị gập ngược thành aliasing. Đo được: sine 4000 Hz ra đỉnh ở 2050 Hz.

Bài học chung: **resample hỏng không báo lỗi.** Audio vẫn phát được, chỉ là nhỏ
tiếng / méo / lệch cao độ. Nên test đo **hệ số khuếch đại RMS, tần số đỉnh, độ
dài** chứ không so mảng với số chép cứng.

Bản đầu chạy vòng lặp Python cho từng mẫu đầu ra: đúng nhưng **1.2 s** cho một
segment 10 s — thêm ~1.6 giờ cho cuốn 4818 segment, nhiều hơn cả thời gian Piper
tổng hợp. Vector hoá bằng numpy còn **114 ms** (10×).

### 4.31 Bitrate Opus phải ĐO, không suy ra từ công thức

libsndfile không cho đặt bitrate trực tiếp — chỉ có `compression_level` trong
[0, 1], **ngược chiều** với bitrate. Công thức tuyến tính `1 - kbps/256` nghe
hợp lý nhưng lệch tới **+7 kbps** ở vùng 16–32 kbps, mà đó đúng là vùng dự án
này chạy. Bảng trong `encode.py` lấy từ đo thật trên tín hiệu giọng nói 30 s:

| Bitrate muốn | `compression_level` | Đo được |
|---|---|---|
| 16 | 0.962 | 16.4 kbps |
| 24 | 0.933 | 23.6 kbps |
| 32 | 0.900 | 32.0 kbps |

**Thêm bitrate mới thì phải ĐO lại**, đừng nội suy — đường cong không tuyến
tính, nhất là khi tiến gần 1.0 (0.99 → 8 kbps, 1.0 → 6.3 kbps).

Kèm hai quyết định nhỏ:

- **`duration_ms` tính từ số mẫu ĐẦU VÀO**, không đọc lại file đã mã hoá. Opus
  đệm mẫu im lặng ở đầu (pre-skip) nên đọc lại ra dài hơn thật vài chục ms — đủ
  để timing từng từ trôi lệch dần về cuối segment.
- **Ghi qua `.part` rồi đổi tên** (cùng lý lẽ với tải voice ở 4.28): tiến trình
  chết giữa chừng để lại `.ogg` dở dang mà lần sau nhìn vào tưởng đã xong.

### 4.32 Timing từ phoneme của Piper — chính xác hơn hẳn ước lượng theo ký tự

Piper 1.6 trả về **số mẫu audio cho từng phoneme** (`include_alignments=True`),
gộp theo ranh giới từ là ra mốc thời gian sát thực tế. Đã thống nhất với user
dùng đường này thay vì chỉ chia theo độ dài ký tự như `plan.md` mô tả.

**Cần package `onnx` (17 MB)** để piper vá model trong bộ nhớ. Model tải từ HF
**không** có sẵn đầu ra alignment — đã kiểm: thiếu `onnx` thì
`phoneme_alignments` là `None`.

**Cạm bẫy: piper KHÔNG ném lỗi khi thiếu `onnx`** — nó chỉ ghi log cảnh báo rồi
trả `None`. Nghĩa là bản `.exe` thiếu package đó vẫn chạy bình thường nhưng
timing **âm thầm** rơi hết về ước lượng theo ký tự. Đó là lý do `test_engine.py`
khoá lại việc `import onnx` phải chạy được, và vì sao API trả về `timingSource`.

**Lỗi thật đã bắt được khi chạy trên câu mẫu:** Piper tổng hợp **mỗi câu một
chunk**. Bản đầu nhận một mảng phoneme phẳng rồi so với số từ của **cả segment**,
nên `"Ừ. À. Ồ."` (3 chunk, mỗi chunk 1 từ) luôn lệch và rơi về ước lượng — trong
khi alignment hoàn toàn dùng được. Nay nhận `list[PhonemeChunk]` và cộng dồn
xuyên qua ranh giới chunk.

**Không khớp thì trả rỗng để rơi về ước lượng, không cố đoán.** Chữ số đọc thành
nhiều từ (`"30"` → "ba mươi") nên số nhóm phoneme lệch số từ; gán lệch một nhịp
sẽ sai cho **mọi** từ phía sau, tệ hơn hẳn ước lượng đều. Đo trên câu thật:

| Câu | Nguồn timing |
|---|---|
| `"Cô ấy vẫy tay chào tạm biệt."` | `phoneme` 7/7 từ |
| `"Ừ. À. Ồ."` | `phoneme` 3/3 từ (3 chunk) |
| `"Lớp 11-5 có 30 học sinh."` | `estimate` — đúng như thiết kế |

### 4.33 `outPath` đến từ request HTTP — phải chặn ghi ra ngoài `audioDir`

Sidecar nghe loopback, nhưng bất kỳ tiến trình nào trên máy đoán được cổng +
token đều gọi thẳng `/synthesize` được. Không kiểm thì một request đặt `outPath`
thành `.../LN Reader/ln-reader.db` sẽ **ghi đè cả thư viện sách** bằng dữ liệu
Opus. Cùng lý lẽ với `is_safe_voice_id` ở 4.28: tin biên trên kiểm hộ là bỏ
trống đúng cửa mà kẻ tấn công đi vào.

→ `app/audio/paths.py` `resolve()` cả hai vế **trước** khi so (`..`, symlink,
đường dẫn tương đối đều quy về dạng chuẩn), rồi dùng `is_relative_to` chứ không
so chuỗi tiền tố — so chuỗi thì `/audio-khac` khớp tiền tố `/audio` và lọt qua.

Thư mục cho phép đi qua env `LN_SIDECAR_AUDIO_DIR`. Bên main, `audioDir` là
**hàm** chứ không phải chuỗi: user đổi được trong Settings, chốt giá trị lúc
dựng supervisor thì đổi xong sidecar vẫn ghi vào chỗ cũ tới khi khởi động lại
app. Thiếu env thì sidecar **từ chối** mọi lượt generate (400) chứ không ghi bừa
ra thư mục làm việc — quên truyền là hỏng ngay, không âm thầm.

### 4.34 PyInstaller 6.11 không gói nổi numpy 2.5 — `.exe` build xong vẫn chết

Đúng như dự đoán ghi ở phiên trước ("ONNX Runtime có DLL native, đúng loại thứ
PyInstaller hay bỏ sót"), nhánh `.exe` hỏng ngay lần build đầu của P2.4 trong
khi **340 test vẫn xanh**.

```
ModuleNotFoundError: No module named 'numpy._core._exceptions'
ImportError: Importing the numpy C-extensions failed.
```

Hook numpy của PyInstaller 6.11.1 viết **trước** numpy 2.5, nên chỉ mang theo
các file `.pyd` mà bỏ hết submodule Python thuần. `.exe` build **thành công**,
kích thước hợp lý (145 MB), rồi chết ngay dòng import đầu tiên.

→ Nâng `pyinstaller` 6.11.1 → **6.21.0**. Test khoá ở `test_build.py`: phiên bản
phải ≥ 6.21.

**Kèm một lỗi tự gây ra khi đang đuổi lỗi trên:** khai `--hidden-import numpy`
tường minh sẽ **ĐÈ** hook numpy của PyInstaller và cho ra đúng triệu chứng y
hệt. Để hook tự lo mới đúng; `test_build.py` khoá luôn việc **không** được khai
`numpy` trong `HIDDEN_IMPORTS`.

Ba thứ **phải** khai tường minh vì hook không phủ:

- `--collect-binaries onnxruntime soundfile` — DLL native
- `--collect-data piper` — `espeak-ng-data` (gồm `vi_dict`); thiếu thì model nạp
  được nhưng không phiên âm nổi chữ nào
- `--hidden-import onnx` — cho `include_alignments` (xem 4.32)

Sidecar onedir: 29 → **145 MB**. Phần lớn là ONNX Runtime + espeak data.

### 4.35 Huỷ hàng loạt quên dọn segment — 1319 unit test không lộ, probe lộ ngay

`cancelJob` (huỷ một job) làm đúng: huỷ job **và** đưa segment về `pending`.
Nhưng `cancelAll`/`cancelByBook` chỉ chạy một câu `UPDATE jobs` rồi thôi.

Hậu quả: segment kẹt ở `queued` **vĩnh viễn**. UI quay vòng cho một việc không
còn ai làm, mà bấm generate lại cũng không cứu được — job cũ đã `cancelled` nên
`enqueue` tạo job mới, nhưng trạng thái segment thì không ai sửa.

**Vì sao unit test không thấy.** Test của `cancelAll` kiểm đúng thứ nó nghĩ là
kết quả — `jobs.counts().cancelled === 2` — và điều đó **đúng**. Nó không kiểm
`segments`, vì lúc viết test tôi đang nghĩ về bảng `jobs`. Cả 1319 test xanh.

Probe với sidecar thật bắt được ngay lượt chạy đầu, vì nó kiểm cái mà **user**
nhìn thấy chứ không phải cái mà hàm vừa gọi trả về:

```
Trạng thái segment sau huỷ: pending, queued, queued   ← hỏng
Trạng thái segment sau huỷ: pending, pending, pending ← đã sửa
```

**Cách sửa.** `cancelByBook`/`cancelAll` trả về **danh sách segment ID** bị ảnh
hưởng thay vì con số, để nơi gọi còn dọn. Phải đọc danh sách **trước** khi
`UPDATE` (trong cùng transaction) — sau đó thì không còn `queued`/`running` nào
để lọc ra nữa. Đã khoá lại bằng 3 unit test ở tầng nhanh.

**Bài học lặp lại lần thứ ba** (sau 4.19 pdfjs và 4.34 numpy): test xanh chứng
minh hàm làm đúng thứ nó được viết để làm, không chứng minh tính năng chạy.

### 4.36 Giọng đọc lưu theo NGÔN NGỮ, không phải một giá trị duy nhất

Hàng đợi cần biết dùng voice nào, mà trước P2.5 không có chỗ nào lưu lựa chọn
đó — `AppSettings` có `bitrate`, `audioDir`, nhưng không có `voiceId`.

Chọn `voiceVi` + `voiceEn` chứ không phải một `voiceId`: thư viện có cả sách VI
lẫn sách EN, mà một cuốn thì không đổi ngôn ngữ giữa chừng. Một giá trị duy nhất
nghĩa là user phải vào Settings đổi giọng mỗi lần chuyển sách — và nếu quên thì
sách EN bị đọc bằng giọng Việt, ra âm thanh vô nghĩa mà vẫn "generate thành
công".

Mặc định là **chuỗi rỗng**, không phải một voiceId đoán sẵn. Đoán sẵn
`vi_VN-vais1000-medium` thì máy chưa tải model sẽ hỏng ở tận lớp engine với lỗi
khó hiểu, trong khi rỗng cho ra đúng câu user cần đọc: *"Chưa cài giọng đọc nào.
Vào màn Giọng đọc để tải."* — và hàng đợi **dừng hẳn** thay vì đốt sạch 3 lượt
thử của từng job vào cùng một nguyên nhân.

### 4.37 Prefetch progress is measured in segments, not scroll position

`plan.md` says "prefetch the next chapter when reading reaches 80%", which sounds
like a scroll ratio. It is not implemented that way.

`activeSegmentId` is the position the app already tracks and already persists to
`book.lastSegmentId`. Using it means one pure function
(`nextChapterToPrefetch`) works identically for PDF and DOCX, and it is unit
testable without mounting a viewer. Scroll position would have needed plumbing
`onScroll` through both viewers, and each measures differently — `PdfViewer` on a
cumulative-offset virtual list, `DocxViewer` on real DOM blocks.

It is also the more honest signal: scrolling fast to the end of a chapter to look
at an illustration is not the same as having read it, but selecting a segment is a
deliberate act.

The count is `(segmentIndex + 1) / segmentCount`. The `+1` matters — without it a
10-segment chapter never reaches 100%, so its successor is prefetched one segment
later than intended, and a 1-segment chapter never triggers at all.

### 4.38 Every generate goes through the estimate dialog, chapter included

CLAUDE.md only requires the estimate before "generate whole book". Both buttons go
through it anyway.

A single LN chapter measured on real files is 300–1350 segments — at ~0.24 RTF
that is minutes of CPU and tens of MB. There is no meaningful line between "a
chapter" and "a book" that would justify asking about one and not the other, and a
user who has seen the numbers once can dismiss the dialog in one click.

The dialog also covers the *nothing to do* case explicitly: when everything is
already generated it says so and offers only "Đóng", rather than showing a
"Bắt đầu tạo" button that would queue zero jobs and look broken.

### 4.39 Deleting audio removes files first, updates the DB second

The order is deliberate and it is the opposite of what feels natural.

Updating the DB first would mean a crash between the two steps leaves the DB
saying "no audio" while the files are still on disk. Nothing would ever notice:
regenerating just overwrites them, the size report stays permanently low, and the
bytes are unreclaimable through the UI.

With files first, the worst case is the DB still claiming `ready` for a file that
is gone — and that is exactly what `orphanBytes` surfaces and what the next delete
cleans up. One direction is silently unrecoverable, the other is self-healing.

For the same reason `library:removeBook` deletes the DB row **before** the files:
a book row pointing at a missing file cannot be opened and cannot be repaired,
whereas a leftover file is just an orphan the Storage Manager can sweep.

### 4.40 `rmdir`, not `rm` — caught by a test, not by review

`rm(dir, { recursive: false })` does not remove an empty directory; Node rejects
every directory with `ERR_FS_EISDIR`. So the "clean up the now-empty book folder"
step silently never worked, and the comment above it claimed it did.

`recursive: true` would have "fixed" it while also deleting any file of the user's
that happened to sit in the folder. `rmdir` is the right call: it removes the
directory when empty and throws `ENOTEMPTY` when not, which is precisely the
intended behaviour.

Worth recording because the wrong version passed review and typecheck — only an
assertion on `existsSync` after the call caught it.

### 4.41 The handler cancels the book's jobs before deleting its files

`storage:delete*Audio` calls `queue.cancelBook()` first. Without it the worker
rewrites the very files just removed: `clearAudioBy*` has already run, so the DB
says `pending` for a file that exists, the user sees the size not drop, and there
is no way to tell from the UI what happened.

Cancelling by *book* when deleting one *chapter* is slightly heavy-handed — the
queue has no `cancelByChapter`. Accepted on purpose: jobs for other chapters write
to different files so keeping them would be safe, but there is no cheap way to be
sure a job for *this* chapter is not in flight, and the cost of over-cancelling is
one re-queue while the cost of under-cancelling is a corrupt size report.

`clearAudioBy*` deliberately targets only `status = 'ready'` and leaves
`generating` rows alone, so a job that slips through mid-flight still finishes
consistently rather than racing `markReady`.

Verified in the probe with a job genuinely in flight: all segments ended
`pending`, disk went to 0 B, no orphans.

### 4.42 `error_count` is a column, not a count-on-read

`generateStatus` has three values, and a chapter of 1058 segments with 3 broken
ones lands on `partial` — identical to a chapter that is genuinely half done. The
user cannot tell why the chapter never reaches "Đủ audio", and re-running generate
will never fix it: almost every failure is a segment that is only punctuation or
symbols (`"???,,,...."`), which Piper cannot voice at all.

Stored as a column rather than counted when needed because the book detail screen
shows 10–30 chapters at once, and `COUNT(*) WHERE status='error'` per chapter is
N+1 queries over a 5000-row table on every open.

It is **recomputed, never incremented** — same rule as `audio_bytes`. A job
retries up to 3 times, so `markError` fires repeatedly for one segment; adding
would turn one broken segment into three. `refreshChapter` now runs inside the
transaction of `markReady`, `markError` **and** `resetToPending`, because the count
has to move in both directions with the segment that caused it.

Migration v2 backfills with a single `UPDATE`: users already have `error` segments
from P2.6, and leaving them at the `DEFAULT 0` would show a wrong number until the
next generate — which for a finished chapter never comes.

The Storage Manager label also had to change: when `ready + error === total` there
is nothing left to generate, so it now reads "Đủ audio · 3 đoạn lỗi" instead of
"1055/1058 đoạn", which invited the user to keep retrying forever.

### 4.43 The cut-off segment list was two bugs stacked, and the second one is the real lesson

Symptom the user reported: open a chapter and the segment list is cut off halfway;
toggle "Ẩn đoạn" then "Hiện đoạn" and it renders in full.

**First bug — layout.** The scroll box inside `SegmentList` is `h-full`, but its
parent `<aside>` is a flex column and the box was a plain flex item with no
`flex-1 min-h-0`. So its height came from its own content, not from the panel.

**Second bug — and this is the one that mattered.** Fixing the layout raised the
box to the right size (measured: 764 of 811 px) but the list still rendered only
**4 rows**. The `useEffect` doing the measurement had `[]` as its dependency, so it
ran once on the first render — when `segments` was still empty and the flex box had
not been laid out, giving `clientHeight === 0`. `ResizeObserver` then never fired
again, because the box's own size never changes after that first layout. `height`
stayed 0 and `visibleRange` kept returning a handful of rows.

Observing the *parent* as well does not help: the parent is already at full height
from the start. The fix is `[segments.length]` — re-measure exactly when the list
goes from empty to populated, and again on chapter change.

Two things worth keeping from this:

- Toggling "worked" purely because unmount/remount re-ran the effect after layout
  had settled. A workaround that looks like a fix is a strong hint the real cause
  is initialisation order, not the thing being toggled.
- jsdom computes no layout, so `clientHeight` is always 0 there and **no unit test
  can catch this class of bug**. The tests added here lock the structural contract
  (`flex-1 min-h-0` on the wrapper) and were verified to fail without the fix; the
  row-count proof came from measuring the running app over CDP.

### 4.24 Highlight trên nền trắng: không dùng `mix-blend-multiply`

Sau khi sửa 4.23, ô highlight vẫn nhạt. `mix-blend-multiply` nhân màu phủ với
nền — nền trang PDF là **trắng** (1.0) nên phép nhân gần như không đổi gì.
Đổi sang phủ thẳng `bg-accent/[0.28]`: thấy rõ mà chữ bên dưới vẫn đọc được.

### 4.44 `pnpm build:win` tự đóng gói sidecar, và preflight chặn bản thiếu

Nợ mức Cao "đóng gói sidecar chưa vào CI" có hai nửa, và nửa nguy hiểm hơn không
phải nửa CI: **electron-builder không coi `extraResources` trỏ vào thư mục không
tồn tại là lỗi.** Nó chép được gì thì chép rồi báo build thành công. Bản cài mở
lên vẫn đọc được sách, chỉ tới lúc user bấm generate mới lộ ra là không có sidecar.

Vì vậy `build:win` giờ là chuỗi bốn bước, không còn dựa vào việc ai đó nhớ:

```
build:sidecar → sidecar-preflight → build → abi:electron → electron-builder
```

`scripts/sidecar-preflight.mjs` kiểm **ba** cách hỏng đã gặp thật, không chỉ một:

| Kiểm | Cách hỏng tương ứng |
|---|---|
| có `ln-sidecar.exe` | chưa build, hoặc PyInstaller trả 0 mà file vẫn thiếu |
| có `_internal/` | onedir không đầy đủ → chết ngay lúc khởi động |
| `.exe` **mới hơn** mọi `.py` | sửa sidecar rồi quên build lại |

Cái thứ ba là cái duy nhất mắt thường không thấy được, và cũng là cái đã kiểm
chứng bằng cách `touch app/config.py` rồi chạy lại: preflight đỏ đúng như mong đợi.

**Preflight chỉ kiểm phía nguồn.** Phía đích — electron-builder có thật sự chép
trọn 145 MB onedir vào `resources/sidecar/` hay không — là chỗ hỏng **khác**, nên
có bước riêng ở CI kiểm `release/win-unpacked/resources/sidecar/`. Cả `catalog.json`
cũng kiểm ở đó, vì cùng đi qua `extraResources`.

CI giờ dựng venv Python 3.12 ở **cả hai** job: `check` để `pnpm test:sidecar` thật
sự chạy (trước đây thiếu venv thì nó thoát 0 và pytest im lặng không chạy — job vẫn
xanh), và `build` để PyInstaller chạy được.

### 4.45 `ui-check.mjs` — đo số thật trong app đang chạy, và bốn cái bẫy của nó

Hai nợ mức Cao cùng cần một thứ: một script CDP chạy bằng một lệnh. Lý do là
jsdom không làm hai việc mà vitest không thể bù được — **không tính CSS thật**
(lỗi 4.23) và **không tính layout**, nên `clientHeight` luôn 0 (lỗi 4.43).

Nguyên tắc: mọi phép kiểm phải là **số đo lấy từ Chromium thật**, không phải sự
có mặt của một class. Test cấu trúc (`flex-1 min-h-0` có mặt) vẫn giữ ở tầng
nhanh — hai lưới chặn hai tầng khác nhau, không thay thế nhau.

Viết script này mất bốn lượt chạy, và cả bốn cái bẫy đều đáng ghi lại vì lần sau
sẽ gặp lại:

1. **Thiếu `abi:electron`.** Chạy `dev.mjs` thẳng bỏ mất bước tráo ABI mà
   `pnpm dev` vẫn làm. Hậu quả rất dễ chẩn đoán sai: `/json/version` **vẫn** trả
   lời (tiến trình browser sống) trong khi `/json/list` rỗng — trông y như renderer
   nạp chậm. Lý do thật chỉ nằm ở `crash.log`. Script giờ tự tráo ABI, và khi hết
   hạn chờ thì **tự in 20 dòng cuối của `crash.log`**.
2. **Tailwind JIT không sinh class ta tự nghĩ ra.** Probe đo `bg-accent/30` — một
   class **không có trong `src/**`** — nên luôn ra `rgba(0, 0, 0, 0)` và đỏ giả,
   trông hệt như lỗi 4.23 thật. Chỉ được đo class có thật: `bg-accent/10`,
   `bg-accent/5`. Kiểm bằng `grep` trước khi viết vào probe.
3. **`element.click()` luôn "thành công"** ngay cả khi React chưa gắn handler, nên
   một cú bấm có thể rơi vào khoảng trống mà không có gì xảy ra. Mọi bước điều
   hướng phải **bấm lại tới khi màn hình đổi thật**, không bấm một lần rồi tin.
4. **`Page.captureScreenshot` treo vô hạn** khi cửa sổ bị che hoặc thu nhỏ. Ảnh chỉ
   là bằng chứng, kết luận nằm ở số đo — nên chụp ảnh có hạn 15s và **không** được
   phép làm đỏ phép kiểm nào.
5. **Số dòng render không so được qua hai vị trí cuộn khác nhau.** Ở đầu danh sách
   overscan bị cắt một phía (đo được 13 dòng), ở giữa thì đủ cả hai phía (10 dòng)
   — cả hai đều **đúng**. Phép kiểm "ẩn/hiện lại cho cùng kết quả" vì vậy so
   `clientHeight` (đại lượng mà 4.43 làm sai, không phụ thuộc vị trí cuộn), rồi
   kiểm riêng "số dòng đủ so với khung" ở mỗi vị trí.

### 4.46 Audio và timing về trong MỘT lượt IPC

`reader:getSegmentAudio` trả cả bytes `.ogg` lẫn `timings[]`, không tách hai kênh.

Tách ra thì có một cửa sổ thời gian mà hai đầu **không cùng một lần generate**:
hàng đợi có thể sinh lại đúng segment đó giữa hai lượt gọi (user bấm generate lại,
hoặc job retry sau lỗi tạm thời), và renderer nhận `.ogg` bản mới ghép với mốc của
bản cũ. Hậu quả là highlight lệch hẳn một câu — mà không có gì báo, vì cả hai lượt
gọi đều `ok`. Gộp một lượt thì hai thứ luôn đọc từ cùng một trạng thái đĩa.

Đổi lại là không cache riêng được phần timing. Chấp nhận vì cả hai đều nhỏ và
luôn dùng cùng nhau — chưa có ca nào cần timing mà không cần audio.

### 4.47 Bytes qua IPC chứ không phải path, kể cả khi file nhỏ

Cùng lý do với `BookFileBytes` ở P1.6c: đưa path ra renderer là mở đường cho nó
đọc file tuỳ ý, và CLAUDE.md cấm renderer chạm `fs`.

Cân nhắc `protocol.handle('ln-audio://')` — Chromium tự stream, tự cache, hỗ trợ
`Range` sẵn. Không chọn vì ba lý do: (a) đó là một bề mặt tấn công mới phải tự
validate lại từ đầu, (b) timings vẫn cần một kênh IPC riêng nên thành hai đường
đọc, đúng thứ mục 4.46 vừa loại bỏ, (c) segment ~10s ở 24 kbps chỉ khoảng 30 KB —
structured clone không đáng kể, khác hẳn `getBookFile` phải chuyển cả file PDF
vài chục MB.

Cái giá: renderer **phải** `URL.revokeObjectURL` khi đổi segment. Đã ghi vào ghi
chú cho P3.2 ở mục 3 vì đây là thứ dễ quên và chỉ lộ ra sau khi nghe vài trăm câu.

### 4.48 Thiếu file timing thì MAIN ước lượng, không đẩy việc sang renderer

Segment `ready` mà không có file `.json` là ca có thật: sidecar ghi hỏng, user xoá
tay trong Explorer, hoặc file cụt vì mất điện giữa lúc ghi (`timings-store` trả
`undefined` cho cả ba).

Có thể để renderer tự ước lượng khi thấy mảng rỗng. Không làm vậy vì như thế mọi
nơi tiêu thụ timing về sau — player, subtitle pane, và cả CTC aligner ở Phase 4 —
đều phải nhớ kiểm nhánh đó. Ước lượng ngay ở main thì hợp đồng đơn giản hơn hẳn:
**segment có audio và có chữ thì `timings` không bao giờ rỗng.**

`timingSource` vẫn nói thật là `estimate`, nên UI vẫn phân biệt được để báo user
vì sao highlight chưa khớp hẳn, và Phase 4 vẫn biết segment nào đáng chạy aligner.

Thời lượng ưu tiên lấy từ file timing (số sidecar đo từ số mẫu lúc encode), rơi
về `segment.durationMs` trong DB khi file mất — hai chỗ giữ cùng một con số, đã
kiểm khớp trên probe.

### 4.49 Ranh giới từ theo KHOẢNG TRẮNG, không phải `\w+`

`splitWords` cắt theo `\s`, không dùng `\w+` hay `\p{L}+`.

`\w` của regex JS không cờ `u` **không** bao gồm chữ có dấu tiếng Việt — `nghiêng`
bị chẻ thành `nghi` + `ng`. Đổi sang `\p{L}+` thì hết lỗi đó nhưng lại cắt đôi
`Wi-Fi` và `John's`. Cả hai cách đều làm highlight nhảy giữa thân một từ user đang
nhìn, mà đó chính là thứ Phase 3 tồn tại để làm cho đúng.

Cắt theo khoảng trắng còn khớp với cách sidecar gộp phoneme thành từ (mục 4.32),
nên mảng ước lượng và mảng thật có cùng số phần tử trên cùng một câu — đã kiểm:
13 từ ở cả hai đường trên câu probe.

Trọng lượng thời gian dùng `độ dài + 1.5` chứ không phải độ dài thuần: giữa hai từ
luôn có quãng chuyển, nên từ một ký tự không bao giờ ngắn bằng 1/8 từ tám ký tự.
Chia đều theo **số từ** thì `"Ừ"` và `"nghiêng"` bằng nhau — lệch thấy rõ ngay câu
đầu.

### 4.50 Probe đã hỏng từ P2.7b mà không ai biết — migration v2 không chạm tới nó

Chạy probe P3.1 lần đầu thì **cả 14 kịch bản** đỏ với
`NOT NULL constraint failed: chapters.error_count`.

Nguyên nhân: P2.7b thêm cột `chapters.error_count` (migration v2, mục 4.42) và sửa
mọi chỗ dựng `Chapter` trong `src/**` — nhưng `probe/queue-real.test.ts` dựng một
`Chapter` literal của riêng nó, và probe **không nằm trong `pnpm test`** (config
gốc loại `**/probe/**`).

Nghĩa là từ P2.7b tới nay, **mọi kết luận "đã chạy thật" của P2.8 đều không đi qua
probe** — P2.8 chỉ chạy `ui-check`, không chạy probe, nên không ai phát hiện.

Bài học không phải "nhớ sửa probe khi migrate". Là: **lớp kiểm chứng nằm ngoài
`pnpm test` sẽ mục đi trong im lặng.** `ui-check` cùng chỗ đó — nó chưa vào CI (nợ
mục 8) nên đang có đúng rủi ro này.

**Vì sao typecheck không bắt.** `apps/main/tsconfig.json` khai
`"include": ["src/**/*.ts"]` — thư mục `probe/` **nằm ngoài** hoàn toàn. Đã kiểm
chứng chứ không suy đoán: đổi `errorCount` thành `XXerrorCount` rồi chạy
`tsc --noEmit -p apps/main/tsconfig.json` vẫn **xanh**. Probe khai
`const chapter: Chapter = {...}` nên nếu được phủ thì TS đã bắt ngay — vấn đề
thuần tuý là phạm vi `include`.

Vậy probe hiện **không có lưới nào cả**: không ở `pnpm test`, không ở `pnpm
typecheck`, không ở CI. Ba tầng cùng hụt một chỗ.

Cách chặn rẻ nhất: thêm `probe/**/*.ts` vào `include` của `apps/main/tsconfig.json`
(hoặc một `tsconfig.probe.json` riêng nối vào `pnpm typecheck`). Chưa làm ở P3.1 vì
`rootDir: "./src"` sẽ phải nới theo, mà `outDir` của main lại dùng cho bản build —
đụng vào là chạm đường đóng gói, không đáng gộp chung một commit với tầng dữ liệu
player. Đã ghi thành nợ mức **TB** ở mục 8.

Bài học rộng hơn: **lớp kiểm chứng nằm ngoài `pnpm test` sẽ mục đi trong im lặng.**
`ui-check` đang ở đúng chỗ đó — chạy tay được, chưa vào CI (nợ mục 8). Lần sau thêm
một lớp kiểm chứng "chạy riêng", phải hỏi ngay: cái gì báo cho ta biết khi nó hỏng?

**Số đo thật của một lượt chạy** (bản dev, sách DOCX 388 khối, theme dark + light):
ô cuộn **428/475 px = 90%** panel, **13 dòng** khi khung chứa được ~6, canvas DOCX
cao 27 366 px. Màu ở cả hai theme: `accent` `rgb(129,140,248)`/`rgb(79,70,229)`,
`bg-accent/10` ra đúng `rgba(…, 0.1)` — nhánh alpha còn sống, tức 4.23 chưa quay lại.

Bấm nút theme thật (`[data-theme-resolved]`) chứ không sửa `classList`: cần biết
cả đường đi nút → IPC → settings → biến CSS có ra đúng màu không.

`StorageManager` được thêm `data-testid="storage-back"` — dò nút bằng chữ
("Thư viện") đã đỏ giả một lượt vì nhãn thật là "← Quay lại".

### 4.51 "Bỏ qua đoạn hỏng" là một quyết định về TRẠNG THÁI, nên nó là hàm thuần

User đặt ra ràng buộc: *đoạn nào lỗi thì bỏ qua luôn, không làm gián đoạn audio.*

Cách dễ là rải `if (segment.status === 'error') continue` vào từng chỗ gọi. Không
làm vậy vì có **năm** đường tới cùng câu hỏi đó — bấm phát, hết đoạn, nút sau, nút
trước, hàng đợi báo xong — và một chỗ quên là một chỗ nhạc đứng lại.

Thay vào đó `decideSegment()` trả một trong bốn việc: `play` / `skip` / `wait` /
`request`. Mọi đường phát dồn về `playAt()`, và `playAt` là chỗ **duy nhất** đọc
quyết định đó. Thêm một ca bỏ qua mới về sau chỉ sửa một hàm.

Được thêm một thứ quan trọng: quy tắc này kiểm được **không cần `<audio>`**. jsdom
không phát audio, nên nếu logic nằm lẫn trong component thì mỗi ca lại phải dựng
một thẻ media giả. Tách ra thì 34 test chạy trong 8ms.

`findNextPlayable` trả luôn **mảng `skipped`** thay vì dừng ở từng đoạn hỏng: mười
đoạn hỏng liên tiếp là một lần gọi, không phải mười vòng sự kiện. Đây chính là chỗ
lời hứa "không gián đoạn" được giữ — dừng lại từng cái một thì mỗi lần là một
quãng lặng.

### 4.52 Bốn kiểu hỏng khác nhau, cùng một cách xử lý

Audio "không phát được" đến từ bốn nguồn, và ban đầu tôi định xử lý riêng từng cái:

| Nguồn | Lộ ra ở đâu |
|---|---|
| `status === 'error'` | DB — hàng đợi đã cháy hết lượt retry |
| Đoạn không có chữ (`...`, `「」`) | Chính text — Piper không sinh nổi audio |
| File `.ogg` bị xoá dưới chân player | IPC trả `NOT_FOUND` |
| File `.ogg` cụt vì mất điện lúc ghi | **Chromium** — DB nói `ready`, IPC trả bytes, chỉ lúc giải mã mới biết |

Cả bốn đều quy về một việc: **đi tiếp**. Gộp lại thì `handleAudioError` chỉ là
`noteSkipped` rồi `playAt(index + 1)` — cùng hai dòng với ca `status === 'error'`.

Điểm đáng nói là ca thứ tư: nó **không thể** phát hiện trước lúc phát. Không có nó
thì một file cụt làm player đứng im mà mọi chỉ báo đều nói "đang phát".

Ngược lại, `error` **không** được thử lại tự động. Hàng đợi đã thử tới hết
`JOB_MAX_ATTEMPTS` mới đặt trạng thái đó; xếp lại là bắt user chờ đúng chuỗi thất
bại ấy lần nữa, ngay giữa lúc đang nghe.

### 4.53 Player đứng chờ mãi vì danh sách segment chưa kịp cập nhật

Lỗi thật, và là loại chỉ tồn tại ở **chỗ nối** giữa hai store.

Đường đi: player đứng ở `waiting` chờ segment `s1`. Main đẩy
`queue:segmentUpdated` báo `s1` đã `ready`. `ReaderScreen` gọi hai thứ trong cùng
một lượt — `applySegmentUpdate` (cho `reader-store`) và
`player.handleSegmentUpdate`. Nhưng `player-store` đọc segment qua
`getSegments()`, mà hàm đó trỏ vào một `ref` chỉ được cập nhật khi **React render
lại**. Trong cùng lượt đó nó vẫn trả danh sách cũ, nơi `s1` còn là `pending`.

Kết quả: `findNextPlayable` lại quyết định `wait`, player đứng nguyên. Audio đã
sẵn sàng trên đĩa mà UI báo "đang tạo audio…" vĩnh viễn.

Sửa: `playAt(from, fresher?)` nhận chính segment vừa nhận từ event và **vá nó vào**
danh sách trước khi quyết định. Không đi đường "chờ một tick rồi thử lại" — nó biến
một lỗi tất định thành một lỗi theo thời điểm, loại khó chẩn đoán nhất.

Điều đáng ghi nhất không phải bản sửa mà là **cái gì bắt được lỗi**: 44 test đơn
vị của `player-store` đều xanh, vì chúng tự sửa danh sách giả rồi mới gọi
`handleSegmentUpdate` — tức là chúng giả định đúng cái điều kiện đang sai. Chỉ test
tích hợp ở `ReaderScreen`, đi qua `fake-api` và React thật, mới lộ ra. Nay có thêm
một test đơn vị **cố ý không sửa danh sách** để khoá lại.

### 4.54 Bốn thứ jsdom không có, và vì sao giả ở `setup.ts` chứ không bọc `?.`

Player là phần đầu tiên của app chạm tới media API, và jsdom thiếu cả bốn:
`HTMLMediaElement.play` (không tồn tại), `pause`/`load` (ném "Not implemented"),
`URL.createObjectURL`/`revokeObjectURL` (không tồn tại).

Giả ở `src/test/setup.ts` cùng chỗ với `matchMedia`, `DOMMatrix`, `ResizeObserver`
— cùng bản chất: **jsdom thiếu, Chromium thật luôn có.** Bọc `?.` quanh chúng
trong `audio-element.ts` thì code sản phẩm mang theo nhánh không bao giờ chạy trên
Electron, và tệ hơn là che mất lỗi thật nếu sau này gọi nhầm lúc thẻ đã bị gỡ.

Bản giả `createObjectURL` **đếm số url chưa thu hồi** và xuất
`countOpenObjectUrls()`. Nhờ đó rò rỉ Blob URL trở thành thứ test bắt được: phát
ba đoạn liên tiếp phải còn đúng **một** url mở, và rời trình đọc phải về **không**.
Không có bộ đếm thì "nhớ gọi `revokeObjectURL`" chỉ là một dòng comment — mà mỗi
segment là ~30 KB, một chương 1353 segment là ~40 MB.

Còn một thứ **không** giả được: có nghe thấy tiếng hay không. CDP cũng không đọc
được đầu ra âm thanh. Thứ gần nhất `ui-check` kiểm được là Chromium có thật sự giữ
`preservesPitch` — nền tảng của lời hứa "đổi tốc độ không regenerate audio" trong
CLAUDE.md. Việc nghe thử vẫn phải do người làm.

### 4.55 Icon phải là SVG, không phải emoji — và không đáng một thư viện

User nói thẳng nút next/previous "khá xấu". Nguyên nhân không phải chọn sai hình
mà là chọn sai **loại thứ**: `⏮ ▶ ⏸ ⏭` là *ký tự*, nên ba hệ quả đi kèm và không
cái nào sửa được bằng CSS:

1. **Hình dạng do font quyết định.** Trên Windows chúng rơi vào Segoe UI Emoji →
   khối màu đặc, nét dày mỏng không đồng bộ với phần còn lại của giao diện.
2. **Không ăn `currentColor`.** Nút phát có nền accent và chữ `text-accent-fg`,
   nhưng emoji giữ nguyên màu của nó → icon đen sì trên nền tím.
3. **Cỡ không đều nhau.** `⏸` và `▶` có bề rộng khác nhau nên nút nhảy kích thước
   mỗi lần đổi trạng thái.

Thay bằng SVG inline `fill="currentColor"`: cả ba hệ quả biến mất cùng lúc, và
icon tự đổi màu theo theme. **Không thêm thư viện icon** (`lucide-react`,
`react-icons`…) — CLAUDE.md cấm tự thêm dependency, và 5 hình này là 5 `path`.

Test khoá lại bằng `textContent === ''` trên cả ba nút: nếu ai đó lỡ quay lại dùng
emoji thì test đỏ ngay. `ui-check` đo thêm kích thước thật và màu thật.

### 4.56 Phép kiểm `preservesPitch` của P3.2 trước nay **luôn xanh một cách vô nghĩa**

Đây là lỗi đáng nhớ nhất của P3.3, và nó nằm trong chính công cụ dùng để chứng
minh mọi thứ khác.

`usePlayer` dựng thẻ `<audio>` bằng `document.createElement` và **không gắn vào
DOM** — thẻ rời vẫn phát được nên P3.2 để vậy. Nhưng `ui-check` dò bằng:

```js
const el = document.querySelector('audio') ?? new Audio();   // ← fallback
```

`querySelector` không bao giờ thấy gì, nên mọi lượt chạy đều đo **một thẻ
`new Audio()` do chính script vừa tạo**. Thẻ đó tất nhiên nhận `preservesPitch` và
`playbackRate` — nên phép kiểm xanh kể cả khi player không dựng nổi thẻ nào, hoặc
khi chuỗi store → sink → thẻ audio đứt hoàn toàn. Suốt P3.2 nó không chứng minh
điều gì cả.

Sửa hai đầu:

- `usePlayer` gắn thẻ vào `document.body` (ẩn) với `data-testid="player-audio"`,
  và **gỡ khi rời trình đọc** — gắn vào DOM là mở thêm một đường rò. Ba test khoá
  lại chuyện gỡ; đã kiểm chúng đỏ thật bằng cách bỏ `element.remove()`.
- `ui-check` **bỏ hẳn fallback**. Không thấy thẻ thật thì đỏ.

Bài học rộng hơn: **trong phép kiểm, đừng bao giờ fallback sang thứ mình tự tạo.**
Thứ tự tạo luôn cho kết quả đẹp, nên fallback biến phép kiểm thành hằng số `true`.
Nếu không tìm thấy thứ cần đo thì đó *chính là* thứ cần báo đỏ.

Kết quả sau khi sửa: `tốc độ 3× tới được thẻ audio thật — 3`, đo trên thẻ mà
player thật sự phát.

### 4.57 Phím tắt gắn ở `window` — phần khó là loại trừ, không phải gắn listener

Ghi chú của P3.2 nói phím tắt "chỉ là chuyện gắn listener". Sai. Gắn ở `window`
nghĩa là **cướp phím của cả app**, và có ba chỗ phải trả lại:

| Chỗ | Vì sao |
|---|---|
| `input` / `textarea` / `select` | user gõ dấu cách trong ô đổi tên chương → phải ra dấu cách, không phải tạm dừng nhạc |
| Vùng `contenteditable` (và **thẻ con** của nó) | cùng lý do, nhưng `tagName` chỉ là `DIV` |
| `button` / `a` đang có tiêu điểm | Space trên một nút là "bấm nút đó" theo chuẩn web — cướp là hỏng thao tác bàn phím của cả app |

Cộng thêm: tổ hợp có `Ctrl`/`Alt`/`Meta` thuộc về app/OS, không đụng.

**`isContentEditable` không có trong jsdom** — trả `undefined` dù thuộc tính có
mặt (đã dựng test dò để xác nhận, chứ không đoán). Nếu chỉ dựa vào property đó thì
nhánh này *không kiểm được bằng test*, mà nó đúng là nhánh hỏng âm thầm tệ nhất:
hỏng thì user gõ chữ trong ô soạn thảo lại thành đổi tốc độ. Nên đọc **cả** property
**lẫn** thuộc tính qua `closest('[contenteditable]:not([contenteditable="false"])')`
— vừa kiểm được, vừa bắt luôn ca tiêu điểm nằm ở thẻ con.

`←`/`→` tua **trong** đoạn 5s chứ không nhảy đoạn: đoạn chỉ ~10s nên nhảy đoạn là
bước quá thô cho thao tác "nghe lại chỗ vừa rồi". Nhảy đoạn là J/K.

### 4.58 `settings.playbackRate` có trong DB từ Phase 0 mà chưa bao giờ được dùng

Phát hiện khi đọc lại đường đi của tốc độ để thêm mốc 2.5×/3×: `playbackRate` có
trong `AppSettings`, có trong zod schema, có trong `DEFAULT_SETTINGS`, có cột
trong DB — nhưng `grep` cho thấy **không nơi nào đọc hay ghi nó**. Player
hardcode `playbackRate: 1` và reset về 1× mỗi lần mở app. Một thiết lập tồn tại
đầy đủ trên giấy tờ và không có tác dụng gì.

User chọn sửa luôn trong P3.3. Hai chiều phải **tách riêng**, và đây là chỗ dễ sai:

- `setRate` (user bấm) → áp vào sink **và** ghi xuống settings.
- `applyStoredRate` (đọc từ settings) → chỉ áp vào sink, **không** ghi ngược.

Gộp làm một thì lượt đọc lúc mở trình đọc sẽ tự ghi đè lên chính thứ vừa đọc —
vô hại về giá trị nhưng là một lượt IPC + ghi SQLite thừa mỗi lần mở sách. Có
test riêng cho việc "đọc thì không ghi".

Thêm hai chốt nữa:

- `setRate` **thoát sớm khi giá trị không đổi**. Phím `[`/`]` ở hai đầu danh sách
  trả về chính mốc cũ, nên không có chốt này thì mỗi lần bấm ở đầu/cuối là một
  lượt ghi SQLite cho thứ không đổi.
- Áp tốc độ đã lưu phải nằm ở **effect riêng**, không gộp vào effect dựng player:
  effect đó chạy đúng một lần lúc mở trình đọc, mà `settings` thường về sau đó một
  nhịp → gộp vào là mãi mãi 1×. Kèm cờ `applied` để lần sau `settings` đổi vì lý
  do khác (đổi theme) không kéo tốc độ về giá trị cũ, đè lên thứ user vừa chọn.

**Nới `PLAYBACK_RATE_MAX` 2 → 3 là thay đổi an toàn một chiều** với settings đã
lưu: mọi giá trị cũ vẫn hợp lệ nên không cần migration. Hạ trần thì ngược lại —
sẽ làm settings đang lưu 2.5× không parse được. Có test khoá điều này.

### 4.59 `charStart` trước P3.5 trỏ vào text đã chuẩn hoá, không phải text gốc

Nợ có sẵn từ P2.4, `main.py` ghi rõ trong comment và chấp nhận: timing tính trên
`normalize(request.text)` chứ không phải `request.text`. Với chữ số thì lệch
hiếm nên đánh đổi được.

P3.5 làm nó thành không né được: `Shinkansen` → `Sin-can-xên` đổi độ dài chuỗi ở
**mọi trang** LN, nên highlight sẽ trôi liên tục chứ không phải thi thoảng.

Cách trả nợ **không đổi kiểu `WordTiming`** — `charStart`/`charEnd` vốn đã được
docstring hứa là "trỏ vào `Segment.text`", chỉ là chưa đúng. Nay:
`normalize_mapped` trả `NormalizedText { source, spoken, spans }`, engine vẫn
sinh timing trên `spoken` như cũ, rồi `remap_to_source` quy offset ngược ngay
trước khi trả response.

**Hệ quả cần nhớ cho P3.4:** nhiều `WordTiming` liên tiếp có thể trỏ về *cùng
một* khoảng gốc (`"Tô"`, `"ki"`, `"ô"` đều về `"Tokyo"`). Đó là chủ ý — cả từ
gốc sáng lên suốt thời gian đọc mọi mảnh của nó, thay vì tô nham nhở từng phần.
Subtitle pane phải chịu được việc này, đừng giả định một từ = một timing.

### 4.60 Suy mapping bằng `difflib` thay vì viết lại tám hàm regex

Tám hàm chuẩn hoá (`expand_numbers`, `expand_dates`…) đều là `str -> str` viết
bằng regex. Muốn có mapping offset thì hoặc sửa cả tám để chúng trả span, hoặc
suy ngược bằng cách so chuỗi vào với chuỗi ra.

Chọn cách thứ hai (`diff_to_normalized`, dùng `difflib.SequenceMatcher` trong
stdlib — không thêm dependency). Lý do: sửa tám hàm là việc lớn, dễ sai, và
**luật thêm về sau lại phải nhớ làm tiếp**. Suy ngược thì đúng tự động cho mọi
luật, kể cả luật chưa viết. Segment ≤ 300 ký tự nên chi phí `diff` không đáng kể.

Riêng `transcribe_japanese` tự sinh mapping chính xác (nó biết chính xác mình
thay khoảng nào) nên dùng thẳng, không qua diff — đây cũng là bước gây sai lệch
nhiều nhất nên đáng để chính xác.

`compose` nối các chặng thành **một** bảng đi thẳng từ text gốc tới text đọc
cuối. Chỗ này có một bẫy đã sập lúc làm: chỉ giữ ranh giới span của chặng sau
thì khi chặng sau không đổi gì, nó chỉ có một span phủ cả chuỗi, span đó chạm
vùng chặng trước đã thay nên bị đánh `replaced` → **mọi** mốc bung ra toàn
chuỗi, mất sạch độ chính xác. Phải cắt theo ranh giới của **cả hai** chặng.
Test `test_doan_da_thay_o_luot_dau_van_giu_co` khoá ca này.

### 4.61 Lớp chặn tiếng Việt quan trọng hơn lớp chặn tiếng Anh

Luật romaji ban đầu chỉ lo không nuốt nhầm tiếng Anh. Đo lúc đang làm mới lộ ra
vấn đề lớn hơn: nó nuốt **20/97** từ tiếng Việt không dấu thông dụng — `mua` →
"mư-a", `nhin`, `hieu`, `ngoi`… Text LN *là* tiếng Việt nên ca này gặp thường
xuyên hơn tiếng Anh nhiều, mà hậu quả thì nặng hơn hẳn.

Chặn bằng **hai** lớp, vì một lớp không đủ:

1. Luật tầng 3 chỉ áp cho token **viết hoa** (`lexicon_jp.lookup`). Tên riêng
   Nhật trong LN luôn viết hoa; từ Việt giữa câu thì không. Từ điển tầng 1–2
   không vướng ràng buộc này vì đã chốt cứng mặt chữ (`senpai`, `bentou`).
2. Danh sách âm tiết Việt thông dụng (`_VIETNAMESE_SYLLABLES`). Cần vì lớp 1
   không cứu được từ Việt **đứng đầu câu** — `Mua sách…`.

Sau hai lớp: **0/51** từ Việt bị nuốt, cả thường lẫn hoa.

Cùng lý do, đã phải **bỏ mục `hai`** khỏi từ điển (tiếng Nhật là "vâng"): trong
LN dịch nó gần như luôn là số 2. Đã ghi cảnh báo ngay trong `lexicon_jp.json`
để người sau không thêm lại — cùng nhóm rủi ro: `ba`, `ma`, `ta`, `nam`, `con`.

### 4.62 Phiên âm dùng gạch nối, không dùng dấu cách

`Tô-ki-ô` chứ không phải `Tô ki ô`. Dấu cách khiến Piper coi mỗi âm tiết là một
từ riêng và chèn khoảng nghỉ giữa chúng → nghe như đánh vần. Gạch nối giữ được
nhịp một-từ.

Ba luật ghép âm tiết đi kèm, đều để tránh đọc rời (`_join_mora`):
`n` mũi dính vào âm trước (`Côn-ni-chi-goa`, không phải `Cô-n-ni…`); nguyên âm
đôi gộp (`xên-pai`, không phải `xên-pa-i`); sokuon nhân đôi phụ âm
(`Hôc-cai-đô`, giữ nhịp ngắt đặc trưng của `Hokkaido`).

Có test khoá cả ba — đổi bảng mora mà làm hỏng nhịp sẽ đỏ ngay.

### 4.63 `seekMsForChar` hỏng âm thầm từ P3.5, lộ ra ở P3.4

Hàm này viết ở P3.1 với giả định **mỗi từ đúng một timing**:

```ts
for (const timing of timings) {
  if (timing.charStart > charOffset) break;
  candidate = timing;          // ghi đè liên tục
}
```

P3.5 phá giả định đó: `Tokyo` sinh ba timing cùng `charStart`, vòng lặp ghi đè
hai lần rồi trả mốc của mảnh **cuối** (`ô`). Hệ quả: bấm vào một cái tên trên
phụ đề thì nhảy vào **giữa lúc đang đọc dở chính cái tên đó** — nghe hụt phần đầu.

Không ai phát hiện ở P3.5 vì **chưa có UI nào gọi tới hàm này**. Nó chỉ có test
đơn vị, mà test đó viết theo giả định cũ nên vẫn xanh. Đây là ví dụ rõ: đổi ngữ
nghĩa của một kiểu dữ liệu thì phải **rà hết nơi tiêu thụ**, kể cả nơi chưa dùng.

Sửa: dừng vòng lặp khi ứng viên hiện tại đã **phủ** `charOffset`. Đã thêm test
khoá ở `timings.test.ts` với đúng ba mảnh `Tô`/`ki`/`ô`.

### 4.64 Không vẽ phụ đề theo `timings` — phải cắt lại từ text gốc

Cách hiển nhiên là `timings.map(t => <span>{t.w}</span>)`. Sai sau P3.5: `w` là
từ **đã đọc**, nên màn hình sẽ hiện `Tô ki ô` trong khi sách viết `Tokyo`.

Nên phụ đề cắt từ `Segment.text` bằng `splitWords` (đúng hàm `estimateWordTimings`
dùng, nên ở `alignStatus='estimated'` ranh giới trùng khít), rồi map timing → từ
qua **giao khoảng** chứ không so `charStart` bằng nhau. Giao khoảng chịu được cả
ba kiểu lệch: nhiều mảnh một từ (P3.5), CTC gộp nhiều từ thành một mốc, và
`splitWords` cắt khác aligner.

### 4.65 Ba biến `--subtitle-*` lưu hex — đúng hình thái lỗi 4.23

Chúng đặt từ Phase 0 dạng `#4f46e5`, trong khi mọi màu khác lưu kênh RGB rời
(`79 70 229`). Chưa ai dùng nên chưa lộ. Vừa dùng tới `bg-subtitle-current/15` là
lỗi 4.23 tái diễn ngay: `rgb(#4f46e5 / 0.15)` không phải CSS hợp lệ → trong suốt.

Đã đổi cả hai theme sang kênh rời + thêm vào `tailwind.config.js` + thêm phép
kiểm màu vào `ui-check`. Bài học lặp lại lần thứ hai: **biến màu mới phải theo
đúng quy ước kênh rời ngay từ lúc đặt**, kể cả khi chưa ai dùng.

### 4.66 Highlight chỉ đụng hai phần tử mỗi lần đổi từ

Cách dễ là tô màu "đã đọc / đang đọc / chưa đọc" cho mọi từ theo mốc hiện tại.
Nhưng thế thì mỗi khung hình phải duyệt **toàn bộ** `<span>` đứng trước con trỏ —
một segment ~60 từ, 60 lần/giây.

`useWordHighlight` giữ chỉ số đã tô trong `ref`, mỗi lần đổi chỉ `removeAttribute`
ở từ cũ và `setAttribute` ở từ mới. Màu "đã đọc" bỏ hẳn — nó cần duyệt cả mảng mà
chỉ để trang trí.

Bẫy đã xử: đổi segment thì React thay hết `<span>`, chỉ số cũ không còn trỏ đúng
đâu cả. Phải xoá `painted` theo `segmentId`, nếu không hook tưởng đã tô rồi và
đứng im. Có test riêng cho ca này.

### 4.67 Đo phiên âm trên 291 tên LN thật — bỏ chặn `ao`/`eo`

User đưa danh sách **291 tên nhân vật** gom từ LN/anime phổ biến để kiểm trước
khi làm P3.4. Kết quả lượt đầu: 219 nhận (75%), 72 bỏ sót.

Phân loại 72 ca bỏ sót cho thấy phần lớn là **đúng**: `Edward`, `Alphonse`,
`Levi`, `Emilia`, `Beatrice`, `Frieren`, `Darkness`, `Stark`… là tên **phương
Tây** trong tác phẩm Nhật, không phải romaji, và phải giữ nguyên. Tương tự `Rem`,
`Ram`, `Ryuk`, `Mob` — kết thúc bằng phụ âm không phải `n`, bất khả trong tiếng
Nhật.

Nhưng lộ ra **một lỗi thật**: `_NON_ROMAJI_VOWEL_PAIRS` chặn `ao` và `eo` vì
trông "rất Tây". Thực ra đó là hai nguyên âm **rời** hoàn toàn hợp lệ, và chặn
chúng làm mất 6 tên thật: `Aoi`, `Naoki`, `Kaori`, `Naofumi`, `Reo`, `Kaoru`
(cùng `Naomi`, `Aoyama`, `Aoba` không có trong danh sách). Phần lớn từ Tây có
`ao`/`eo` (`chaos`, `people`, `video`, `theory`) đã chết ở ải 4 rồi.

Bỏ chặn thì 16 từ lọt lưới, nhưng cổng chữ hoa (mục 4.61) đã chặn hầu hết —
`radio` giữa câu không bị đụng. Đã thêm phần còn lại vào `_ENGLISH_WORDS`, và
thêm 18 âm tiết `-ao` tiếng Việt (`nào`, `bao`, `gạo`, `dao`…) vào danh sách chặn
vì chúng đứng đầu câu sẽ viết hoa.

Kết quả sau sửa: **222/291 nhận**, tiếng Anh vẫn **0/73** nuốt nhầm, tiếng Việt
**0/83** (cả viết thường lẫn viết hoa đầu câu).

Một ca **cố tình bỏ**: `Nao` — trùng hoàn toàn với `nào` không dấu, mà `nào` là
một trong những từ tiếng Việt hay gặp nhất. Đây là loại đánh đổi đã ghi ở 4.61:
thà bỏ sót một tên còn hơn phá một từ của chính ngôn ngữ đang đọc.

### 4.68 Bỏ Phase 4 (CTC forced alignment) — quyết định của user

**Căn cứ:** user nghe thật một chương sau khi P3.4 xong và xác nhận highlight
bám đúng từng chữ, không thấy vấn đề nào. Đây là kiểm chứng bằng tai — thứ mà
`ui-check` qua CDP **không** làm được (nợ "chưa nghe thử bằng tai" nay đã trả).

**Cái giá của Phase 4:** model `wav2vec2` ONNX-quantized ~300 MB. Sidecar `.exe`
hiện đã 145 MB và installer 143 MB; thêm aligner sẽ đẩy lên ~450 MB, vượt xa mốc
200 MB của plan.md. Rất đắt cho thứ không ai thấy thiếu.

**Cần biết cho phiên sau — vì sao "nghe thấy ổn" chưa phải là "timing hoàn hảo":**
DoD Phase 4 nhắm đúng vào câu có **số và tên riêng**, mà đó lại là ca `phoneme`
**cố ý rơi về `estimate`** (chia đều theo ký tự). Xem `TimingSource` ở
`shared/types.ts`: khi số nhóm phoneme không khớp số từ (`"30"` → "ba mươi",
`"Tokyo"` → `"Tô-ki-ô"`) thì timing phoneme bị bỏ. Nên chương user nghe hoặc ít
số/tên riêng, hoặc lệch nhỏ tới mức mắt không bắt được ở tốc độ đọc thường.

**Điều kiện mở lại Phase 4** (đừng làm nếu chưa gặp): user thật báo highlight
lệch **ở câu nhiều số hoặc tên riêng**, và đo được `timingSource === 'estimate'`
chiếm tỉ lệ đáng kể trên sách đó. Lúc đó cân nhắc trước phương án rẻ hơn: cải
thiện cách gộp phoneme → từ cho ca chữ số, thay vì kéo về cả một model 300 MB.

**Hạ tầng đã dựng sẵn cho Phase 4 thì GIỮ NGUYÊN**, không gỡ: `AlignStatus` ba
trạng thái (DB → repo → IPC → UI), `JobType` có `'align'`, và
`AppSettings.alignmentEnabled`. Chúng vô hại và gỡ ra sẽ tốn một migration.
Lưu ý `alignmentEnabled` hiện **chưa ai đọc** — cùng hình thái với `playbackRate`
trước P3.3 và `viewerPaneRatio` trước P3.4.

⚠️ **Hàng đợi chưa rẽ nhánh theo `job.type`.** `queue.ts` gọi `jobs.claimNext()`
rồi xử lý mọi job như `synthesize`. Không phải lỗi hiện tại (chỉ có job
`synthesize` được tạo), nhưng ai định enqueue job `'align'` phải thêm dispatch
trước, nếu không worker sẽ đem nó đi tổng hợp audio lại.

### 4.69 Cảnh báo `act(...)` đến từ `userEvent`, không phải thiếu cờ môi trường

Bộ test mới của P5.1 in ra `The current testing environment is not configured to
support act(...)` trong khi 1923 test cũ thì không. Test vẫn **xanh**, nên rất
dễ bỏ qua — nhưng nó có nghĩa là một số cập nhật state không được gom vào lượt
render nào, tức test đang khẳng định trên DOM chưa chắc đã ổn định.

Hai lần chẩn đoán **sai** trước khi tìm ra, đáng ghi lại để khỏi lặp:

1. *"Thiếu `globalThis.IS_REACT_ACT_ENVIRONMENT = true` trong `setup.ts`"* — đặt
   vào **không đổi gì**. `react-dom` đọc biến global trần chứ không qua
   `globalThis`, và `@testing-library/react` vốn đã tự bật/tắt cờ quanh `act()`.
2. *"Thiếu `await` cho chuỗi bất đồng bộ"* — thêm một vòng macrotask trong `act`
   cũng không đổi gì.

Nguyên nhân thật, truy ra bằng cách in stack trong `console.error`: stack chỉ
thẳng vào `zustand/vanilla.mjs → handleStoreChange`. `userEvent.click` bọc thao
tác trong `asyncWrapper` **riêng của nó**, và wrapper đó trả cờ act về
`undefined` **trước khi** chuỗi `IPC → play() → setPlaying` kịp chạy xong.

Cách sửa: dùng `fireEvent.click` cho đúng những cú bấm khởi động chuỗi bất đồng
bộ dài, rồi tự `await` trong `act` của mình. `userEvent` vẫn giữ nguyên ở mọi chỗ
khác — nó mô phỏng thao tác thật sát hơn, chỉ không hợp ở ca này.

Bài học chung: **cảnh báo chỉ xuất hiện ở bộ test mới thì đừng cho là nợ có sẵn.**
Đã kiểm chứng bằng `git stash` rồi chạy `ReaderScreen.test.tsx` — 0 cảnh báo.

### 4.70 Đo `vivos`: vì sao KHÔNG thêm giọng VI thứ ba

User xin thêm "3–4 giọng VI nữa". **Không làm được bằng cách sửa catalog:**
`rhasspy/piper-voices` chỉ có đúng **3 giọng VI** — `vais1000` (đã có),
`25hours_single` (P5.1), và `vivos`. Không có giọng thứ tư nào tồn tại.

`vivos` lại là **65 người nói**, tức mở nó ra sẽ được 65 lựa chọn giọng chứ
không phải 1 — nhiều hơn hẳn thứ user xin. Nên trước khi bỏ công code `speakerId`
xuyên 4 tầng, đã tải model 26 MB về **đo thật**.

**Phát hiện quyết định — thiếu phoneme thanh điệu.** So bảng `phoneme_id_map`:

| | Số phoneme |
|---|---|
| `vais1000` | 154 |
| `vivos` | 130 |

24 phoneme `vivos` thiếu gồm `0`–`9` và `↑ ↓` — **đó chính là các dấu thanh**.
Piper log `Missing phoneme from id map: 2/4/5/6` mỗi lần tổng hợp. Tiếng Việt là
ngôn ngữ có thanh điệu, nên đây không phải chi tiết nhỏ.

**Đo F0 trên sáu thanh của cùng âm tiết** (autocorrelation, khung 40 ms):

| Thanh | `vivos` dốc F0 | `vais1000` dốc F0 |
|---|---|---|
| `má` (sắc — phải đi LÊN) | **+30 Hz** | **+88 Hz** |
| `mà` (huyền — đi xuống) | −32 Hz | −28 Hz |
| `mạ` (nặng — rơi mạnh) | **−20 Hz** | **−69 Hz** |

`vivos` **có** tạo thanh điệu và đúng hướng, nhưng biên độ bị ép còn khoảng **một
phần ba**. Cộng thêm `x_low` ở 16 kHz (so với `medium` 22 kHz), trên một chương
LN dài thì đó là khác biệt giữa giọng Việt tự nhiên và giọng nghe phèn phẹt.

**Quyết định của user: bỏ `vivos`, giữ 2 giọng VI.** Thêm 65 giọng nghe kém hơn
thứ đang có chỉ làm user chọn nhầm rồi tưởng app tệ.

Ghi chú `peak = 1.000` gây hiểu nhầm: cả `vais1000` **lẫn** `vivos` đều đạt đỉnh
1.0, nên đó là chuẩn hoá của Piper chứ không phải `vivos` bị méo. Đừng dùng con
số đó làm bằng chứng chê model nào.

**Muốn nhiều giọng VI thật thì phải đổi engine** — việc lớn, thuộc Phase 6
(`plan.md` đã ghi kiến trúc `TTSEngine` cho phép cắm engine khác mà không đụng
core). Không phải việc của Phase 5.

### 4.72 `ui-check` đỏ giả: class **variant** cần cả thuộc tính mới khớp

Lượt chạy `ui-check` đầu tiên sau P5.3 đỏ 4 phép kiểm. **Hai trong bốn là lỗi của
chính phép kiểm**, không phải lỗi app — user chạy `pnpm dev` không thấy vấn đề gì,
và user đúng.

Triệu chứng: `subtitleCurrentAlpha15` đo ra `rgba(0, 0, 0, 0)` ở **cả hai** theme,
tức trông y hệt lỗi 4.23 (biến màu lưu hex nên nhánh alpha mất màu).

Nguyên nhân thật: trong `SubtitlePane` class đó là **variant**
`data-[active]:bg-subtitle-current/15`. Tailwind sinh ra:

```css
.data-\[active\]\:bg-subtitle-current\/15[data-active]{background-color:rgb(var(--subtitle-current) / .15)}
```

`[data-active]` là **một phần của selector**. Probe `<div>` không mang thuộc tính
đó → không rule nào khớp → `rgba(0,0,0,0)`. Màu hoàn toàn lành lặn:
`--subtitle-current: 79 70 229` vẫn đúng dạng kênh RGB.

Sửa: `read`/`readColor` nhận thêm `variantAttr`, đặt thuộc tính trước khi đo.

**Đây là biến thể của cái bẫy đã ghi sẵn ngay phía trên hàm đó** ("CHỈ dùng class
CÓ THẬT trong mã nguồn"). Lần trước là class *không tồn tại*; lần này class có
tồn tại nhưng **chỉ dưới dạng variant**. Quy tắc đầy đủ hơn:

> Class đo được phải khớp **nguyên văn** thứ có trong `src/**`, kèm **mọi điều
> kiện** mà variant của nó đòi (thuộc tính, class cha, trạng thái).

**Bài học lặp lại lần thứ hai:** `ui-check` đỏ **không** đồng nghĩa app hỏng. Cả
hai lần đỏ giả đều tốn một lượt chạy. Trước khi sửa app, hãy hỏi: *phép kiểm này
có đang đo đúng thứ nó tưởng không?*

⚠️ **jsdom không thay được lượt chạy này.** Đã thử dựng lại phép đo bằng jsdom để
tự xác nhận: nó **không parse nổi** bundle CSS thật ("Could not parse CSS
stylesheet") và **không tính** `rgb(var(--x) / .15)` — cho `rgba(0,0,0,0)` ở cả
hai nhánh, tức không phân biệt được đúng/sai. Đó chính là lý do `ui-check` tồn
tại. Xác nhận cuối cùng phải là một lượt `pnpm ui-check` thật.

### 4.75 Dấu cách trong `artifactName` làm hỏng auto-update — không lộ ra khi build

Bản build trước (0.1.0) sinh ra hai thứ **không khớp nhau**:

| Nơi | Tên |
|---|---|
| File thật trên đĩa | `LN Reader-0.1.0-x64.exe` (**dấu cách**) |
| `latest.yml` trỏ tới | `LN-Reader-0.1.0-x64.exe` (**gạch nối**) |

Nguyên nhân: `artifactName: ${productName}-...` mà `productName` là "LN Reader".
electron-builder chuẩn hoá tên trong metadata nhưng **không đổi tên file thật**,
còn GitHub Releases lại tự thay dấu cách khi upload — ba cách viết cho cùng một
file. `electron-updater` tải theo `latest.yml`, nên nó xin một URL không tồn tại.

**Vì sao nguy hiểm:** build xanh, cài tay xong chạy tốt, `latest.yml` nhìn hợp
lệ. Lỗi chỉ lộ khi user bấm cập nhật ở **bản đã phát hành** — tức sau khi đã
publish, và với đúng những người đang dùng bản cũ.

Sửa: bỏ `${productName}`, ghi thẳng `LN-Reader-${version}-${arch}.${ext}` cho cả
NSIS lẫn portable. Tên phát hành **không được có dấu cách**, chấm hết.

> Cùng họ với 4.19/4.29a/4.73: thứ chỉ hỏng ở ranh giới đóng gói/phát hành, nơi
> unit test không với tới. Khác ở chỗ nó còn qua được cả bước cài đặt thủ công.

**Đồng thời khai tường minh `publish:`.** `app-update.yml` của bản build trước đã
có đúng `gumarr/LightnovelReader` mà **không có dòng cấu hình nào** —
electron-builder tự suy từ `git remote`. Tiện, nhưng nghĩa là đích phát hành phụ
thuộc máy đang build: ai clone từ fork sẽ build ra `latest.yml` trỏ về repo của
họ và không có gì báo. Nay ghi rõ trong `electron-builder.yml`.

### 4.74 `ui-check` đỏ giả lần thứ ba: mốc kiểm ngầm giả định chương dài

Lượt chạy `ui-check` sau P5.4 đỏ 2 phép kiểm — **cả hai lại là lỗi của phép kiểm**,
không phải lỗi app (lần thứ ba liên tiếp, xem 4.72).

Triệu chứng: `5 dòng, khung chứa được ~10` ở cả `checkSegmentLayout` lẫn
`checkSegmentToggle`. Trông y hệt lỗi 2 của 4.43 (`height` kẹt ở 0 → render thiếu
dòng).

Nguyên nhân thật: chương đang mở là **"Bản quyền", cả chương chỉ có 5 đoạn**.
Render đủ 5/5 là **đúng**. Ảnh chụp `dev-reader-dark.png` cho thấy rõ: nhãn thanh
đầu ghi "Bản quyền · 5 đoạn", 5 dòng hiện đủ, dưới còn khoảng trống. Các phần
khác của 4.43 vẫn lành: ô cuộn 664/742 px = 89%.

Mốc cũ `rows >= floor(khung / 64)` **ngầm giả định chương luôn dài hơn khung**.
Nó chỉ xanh từ trước tới nay vì mọi lượt chạy đều tình cờ rơi vào chương dài. Mốc
đúng là:

```
expected = min(sức chứa khung, số đoạn thật của chương)
```

Số đoạn thật lấy từ hai nguồn, kiểm chéo nhau: `scrollHeight` của ô cuộn (chiều
cao nội dung) và nhãn "N đoạn" ở thanh đầu (`data-testid="reader-subtitle"`, thêm
ở lượt này). Hai nguồn vì nếu chính khối ảo hoá dựng sai `totalHeight` thì nguồn
thứ nhất hỏng theo.

**Đã kiểm phép kiểm mới không bị nhờn:** ca lỗi 4.43 gốc (4 dòng / khung 764 px /
chương 1353 đoạn) vẫn **đỏ**, và vẫn đỏ cả khi không đọc được nhãn. Phép kiểm chặt
hơn chứ không lỏng đi.

> Đánh đổi có ý thức: `min()` nghĩa là `scrollable` sai *nhỏ đi* sẽ che được lỗi
> thật. Chọn vậy vì `max()` dựng lại đúng cái đỏ giả đang sửa, và nhãn "N đoạn" là
> lưới thứ hai cho đúng ca đó.

**Bài học lặp lại lần thứ ba, nay đã đủ thành quy tắc:** ba lượt `ui-check` đỏ gần
nhất, **cả ba** là lỗi phép kiểm. Trước khi sửa app vì `ui-check` đỏ, bắt buộc mở
`artifacts/ui-check/*.png` xem app **thật sự** trông thế nào — ảnh chụp lần này
trả lời trong 5 giây thứ mà đọc mã nguồn không trả lời được.

### 4.71 "Setting chết": ba lần cùng một hình dạng, và cách nhận ra lần thứ tư

`subtitleFontSize` có trong `AppSettings`, trong zod schema, trong
`DEFAULT_SETTINGS`, được ghi xuống `electron-store` — và **không component nào
đọc nó** suốt từ Phase 0 tới P5.3. Đây là lần **thứ ba** cùng một chuyện:

| Setting | Khai từ | Thật sự dùng từ | Nằm chết |
|---|---|---|---|
| `playbackRate` | Phase 0 | P3.3 | ~3 phase |
| `viewerPaneRatio` | Phase 0 | P3.4 | ~3 phase |
| `subtitleFontSize` | Phase 0 | **P5.3** | ~5 phase |
| `alignmentEnabled` | Phase 0 | **chưa bao giờ** | Phase 4 đã bỏ (4.68) |

Vì sao nguy hiểm: cả bốn đều **typecheck sạch, test xanh, và có mặt trong DB**.
Không có lưới nào bắt được "field này không ai đọc" — `noUnusedLocals` chỉ xét
trong một file, còn đọc từ store bằng selector thì tsc không truy ngược được.

**Cách nhận ra:** một field trong `AppSettings` mà `grep` cả repo chỉ thấy nó ở
`types.ts` / `schemas.ts` / `constants.ts` / file test — không có ở `.tsx` nào —
là setting chết. Lệnh này đủ dùng:

```bash
grep -rn "tênField" --include=*.tsx apps/renderer/src
```

Rỗng nghĩa là user không đổi được thứ đó dù DB vẫn lưu.

`alignmentEnabled` là ca **cố ý giữ**: Phase 4 đã bỏ nên không có gì để bật/tắt,
mà gỡ khỏi schema thì tốn một migration đổi lấy hư không. Đừng dựng UI cho nó.

### 4.73 "Hạ tầng chết" — cùng bệnh với 4.71 nhưng ở tầng IPC

P5.4 nối **ba** thứ đã dựng sẵn mà chưa có đường gọi. Đây là cùng một bệnh với
mục 4.71, chỉ khác chỗ nó nằm: không phải một field trong `AppSettings` mà là cả
một bảng DB hoặc cả một kênh IPC.

| Thứ chết | Dựng từ | Nối ở | Nằm chết |
|---|---|---|---|
| Bảng `bookmarks` | **schema v1** | P5.4 | ~5 phase |
| `queue:listPending` | P2.6 | P5.4 | ~3 phase |
| `queue:cancelJob` | P2.6 | P5.4 | ~3 phase |
| `pronunciations:*` | P3.5 | P5.2 | ~2 phase |
| `app:getInfo` | Phase 0 | P5.3 | ~5 phase |

Nguy hiểm hơn setting chết ở một điểm: chúng **có test riêng và test đều xanh**.
`queue:cancelJob` có 4 test ở `queue.test.ts`, bảng `bookmarks` có ràng buộc
CASCADE đúng — nhưng không ai gọi tới thì với user chúng không tồn tại.

**Cách nhận ra**, tương tự 4.71 nhưng grep ở tầng khác:

```bash
# Kênh IPC khai trong hợp đồng mà renderer không gọi
grep -rn "queue.listPending" --include=*.tsx --include=*.ts apps/renderer/src

# Bảng DB không có repository nào đọc
grep -rn "bookmarks" --include=*.ts apps/main/src
```

Chỉ thấy ở `ipc.ts` / `api.ts` / `migrations.ts` / file test = chưa nối.

⚠️ Có một lưới đã bắt được ca này nhưng **chỉ ở nửa đường**: test "phủ hết mọi
channel đã khai báo — không có channel chết" ở `apps/preload/src/api.test.ts`
buộc mọi kênh phải có mặt trong `api.ts`. Nó bắt được kênh thiếu hàm bọc, **nhưng
không bắt được hàm bọc mà không component nào gọi** — đó chính là chỗ
`listPending` nằm im ba phase.

### 4.76 `require()` trần lọt qua vite: bản dev chạy, bản đóng gói crash

P5.5b thêm `electron-updater`. Bản đầu tôi cố ý gọi `require('electron-updater')`
**trong hàm** để nạp muộn. Build **xanh**, typecheck xanh, test xanh.

Nhưng `vite.config.ts` của `apps/main` đặt `noExternal: true` để **bundle mọi
dependency vào `index.cjs`** — có ghi rõ lý do ngay tại đó: *"bản đóng gói asar
không có node_modules đầy đủ → app crash với Cannot find module"*. Mà vite chỉ
bundle được thứ nó phân tích **tĩnh**. Một `require()` trần đi thẳng vào bundle
nguyên dạng:

```bash
grep -c 'require("electron-updater")' apps/main/dist/index.cjs   # 1  ← lọt
grep -c "NsisUpdater" apps/main/dist/index.cjs                   # 0  ← không bundle
```

Kiểm tiếp asar của bản build trước cho câu trả lời dứt điểm: nó **có**
`node_modules` (307 mục — electron-builder tự thêm dependency của `external`),
nhưng **không có `electron-updater`**, vì package này không nằm trong `external`
nên không được coi là dependency runtime. Bản cài sẽ crash ngay lúc khởi động,
trong khi `pnpm dev` chạy hoàn hảo.

Đổi sang `import` tĩnh: 815 → **1043 module**, bundle +570 KB, `NsisUpdater` xuất
hiện 15 chỗ, không còn `require` trần nào.

**Lý do "nạp muộn" ban đầu cũng sai.** Tôi sợ `electron-updater` đọc
`app.getVersion()` lúc nạp module, trước `app.setName()` ở đầu `index.ts`. Đọc mã
thư viện thì `autoUpdater` là **lazy getter** (`Object.defineProperty` + `get`),
instance chỉ dựng khi truy cập lần đầu — và bundle đã build cho thấy vite giữ
nguyên tính chất đó: `mainExports.autoUpdater` được đọc **tại chỗ dùng** trong
`start()`, không phải lúc nạp.

**Bài học:** với package mới ở `apps/main`, `pnpm build` xanh **không** chứng minh
gì. Phải grep bundle:

```bash
grep -o 'require("[^"]*")' apps/main/dist/index.cjs | sort -u
```

Mọi tên **không phải** builtin Node hoặc `electron`/`better-sqlite3` (hai thứ duy
nhất trong `external`) đều là một crash chờ sẵn ở bản đóng gói.

### 4.77 Script tự chạy app dev phải tráo ABI trước — nếu không sẽ chẩn đoán nhầm

Probe CDP của tôi ở P5.5b treo 60 s rồi báo *"Không thấy target CDP"*. Trông y
hệt "renderer nạp chậm" hoặc "`electron-updater` làm chết app" — tức là đổ tội
cho đúng thứ vừa thêm.

Lý do thật nằm ở `crash.log`: `pnpm test` chạy `abi:node` nên `better_sqlite3.node`
đang ở **NODE_MODULE_VERSION 127**, còn Electron cần **130**. App chết ở
`initDatabase`, không liên quan gì tới P5.5b.

Cái khiến nó khó đoán: tiến trình browser **vẫn sống**, `/json/version` vẫn trả
lời, chỉ `/json/list` rỗng. Từ ngoài không phân biệt được với renderer chậm.

`ui-check.mjs` đã giải bài này từ trước — có `ensureElectronAbi()` **và**
`printCrashLog()` khi hết giờ chờ. Script mới của tôi bỏ cả hai. Đã ghi lại vào
`scripts/README.md` để lần sau không mất thêm một lượt.

### 4.78 Dấu backtick trong **comment** làm chết cả `ui-check.mjs`

Thêm phép kiểm màu ở P5.5c, tôi viết một comment có ``--fg`` trong dấu backtick.
Cả khối `measureColors` là **một template literal** — dấu backtick trong comment
vẫn đóng chuỗi như thường, vì JS phân tích chuỗi trước khi biết đâu là comment.
Kết quả: `SyntaxError` ở dòng 410, script chết **trước khi chạy phép kiểm nào**.

Đáng ghi vì hai lẽ. Một, lỗi báo ở dòng mở template (410) chứ không ở dòng có
backtick — nhìn dòng 410 thì không thấy gì sai. Hai, đây là loại lỗi mà **thói
quen viết comment tốt lại gây ra**: dự án này quy ước đặt tên biến/CSS trong
backtick, và quy ước đó đúng ở mọi file `.ts` — chỉ sai bên trong template literal.

Cách tránh: trong mọi khối chuỗi CDP của `ui-check.mjs`, viết tên biến **trần**
(`--fg` không có backtick). `node --check scripts/ui-check.mjs` bắt được ngay,
rẻ hơn nhiều so với chờ hết một lượt chạy app.

### 4.79 Đổi engine TTS: vì sao phải sửa `estimate` TRƯỚC, không phải sau

User thấy giọng Piper VI không hợp đọc LN và muốn giọng như các kênh review
phim/anime YouTube. Tra ra giọng đó là **Vbee AIVoice** — dịch vụ thương mại,
tính phí theo ký tự, **không có model tải về**. Không dùng được, và cũng phá
nguyên tắc TTS local / đọc offline. Bản mã nguồn mở đạt tầm đó: **VieNeu-TTS**
(Apache 2.0, torch-free trên CPU, 14 giọng, có style `doc_truyen`). User đã nghe
example và xác nhận đúng giọng cần.

**Cái giá: VieNeu không trả word alignment, và không thể trả.** Codec
MOSS-Audio-Tokenizer chạy **12,5 token/giây** — mỗi token là 80 ms *audio đã
nén*, ranh giới của nó không tương ứng ranh giới từ. Khác hẳn Piper: Piper phát
âm **theo phoneme** nên số sample mỗi phoneme là thông tin có thật. Đây là khác
biệt **kiến trúc**, không phải tính năng thiếu — đừng tốn thời gian đi tìm cờ
bật nào đó.

**Forced alignment đã tra và loại.** Model VI đúng việc này (`lyric-alignment`,
wav2vec2-large) mang license **CC BY-NC 4.0** — phi thương mại, không tương thích
MIT của dự án. Không có bản ONNX → kéo PyTorch → phá ràng buộc 250 MB user đặt.
Đây cũng chính là Phase 4 đã bỏ, quay lại từ hướng khác.

**Vì sao thứ tự P6.1 → P6.2 không đảo được.** Piper cho `phoneme` alignment
thật, tức là **hiện tại còn một chuẩn vàng để đo `estimate` sai bao nhiêu ms**.
Sau khi chuyển sang VieNeu thì mọi segment đều `estimate`, không còn gì để so —
chỉ còn cảm giác "hình như lệch". Làm P6.2 trước là **vứt bỏ vĩnh viễn** khả
năng đo. Đây là lý do duy nhất và đủ.

**Lỗi gốc của `estimate` — đã đo, không phải phỏng đoán.** Hàm hiện chia theo
**độ dài ký tự**. Với tiếng Việt (đơn âm tiết) đó là sai đơn vị: `"nghiêng"` và
`"à"` đều là **một âm tiết**, đọc mất thời gian gần bằng nhau, nhưng được cấp
13.0% vs 1.9% thời lượng — lệch **5.8 điểm phần trăm**, tức **~580 ms** trên
segment 10 giây. LN tiếng Việt đầy `à`/`ừ`/`ồ`/`nhé` xen giữa từ dài.

Ba thứ **đã đúng sẵn**, đừng "sửa" lại: chia theo độ dài từng từ (không chia đều
số từ), dấu câu gộp vào từ đứng trước (mốc nối liền, không khe hở), và từ cuối
chốt đúng `duration_ms` (sai số không tích luỹ vô hạn).

**Không áp dụng trọng số âm tiết cho tiếng Anh.** `"international"` (5 âm tiết)
vs `"a"` (1) thì độ dài ký tự lại là xấp xỉ **tốt hơn**. Hàm phải nhận `lang` —
đây là lý do nó tách thành hàm thuần riêng chứ không sửa tại chỗ.

**Ghi chú về `vivos`:** đừng đề xuất lại "thêm speakerId để có 65 giọng VI". Mục
4.70 đã đo F0 thật trên sáu thanh: `vivos` ép biên độ thanh điệu còn ~1/3 so với
`vais1000`. User đã quyết bỏ. Đường đó đóng rồi.

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

### 5.5 Tiến trình mồ côi sau khi ngắt `pnpm dev` / `pnpm ui-check`

Ngắt hai lệnh này giữa chừng (Ctrl-C, hoặc công cụ gọi bị huỷ) thì khối dọn dẹp
không chạy tới nơi, để lại **hai loại** tiến trình mồ côi gây ra **hai lỗi khác
nhau ở lượt sau**. Cả hai đều báo lỗi đúng nhưng không chỉ ra thủ phạm.

**Loại 1 — `electron.exe` giữ `.node` → `EBUSY`:**

```
Error: EBUSY: resource busy or locked, copyfile
  '.abi-cache\better_sqlite3-electron.node' -> '...\better_sqlite3.node'
```

**Loại 2 — `node.exe` chạy Vite giữ cổng → `Port 5273 is already in use`:**

```
[dev] Lỗi khởi động: Error: Port 5273 is already in use
```

Cổng 5273 đặt `strictPort: true` trong `apps/renderer/vite.config.ts` — **cố ý**,
vì `dev.mjs` trỏ Electron vào đúng URL đó, Vite nhảy cổng khác thì cửa sổ mở ra
trắng trơn. Nên trùng cổng phải là lỗi cứng.

Tìm thủ phạm của loại 2:

```powershell
netstat -ano | findstr :5273      # cột cuối là PID
taskkill /F /PID <PID> /T
```

⚠️ **Đừng `taskkill /IM node.exe`** — trong đó có editor, terminal, và chính
lệnh đang chạy. Luôn giết theo **PID** cho `node.exe`; chỉ `electron.exe` mới an
toàn để giết theo tên.

`ui-check` nay tự dọn **cả hai** loại trước khi chạy, nên hầu như không phải làm
tay nữa. Phần còn lại của mục này nói về loại 1.

**Nguyên nhân luôn là một:** còn `electron.exe` từ lượt chạy trước đang **nạp**
file `.node` đó. Windows khoá DLL đang dùng, không cho ghi đè. Xảy ra khi
`pnpm dev` hoặc `pnpm ui-check` bị ngắt giữa chừng — khối dọn dẹp không chạy tới
nơi nên để lại 4–5 tiến trình con mồ côi.

Thông báo gốc của Node chỉ nói về `copyfile` kèm hai đường dẫn dài, **không hề
gợi ý** rằng thủ phạm là tiến trình còn sống — đã tốn một lượt để lần ra. Nay
`scripts/sqlite-abi.mjs` bắt `EBUSY`/`EPERM` và in thẳng số `electron.exe` đang
chạy cùng lệnh sửa; `ui-check` còn **tự dọn** trước khi tráo ABI.

Sửa tay:

```powershell
taskkill /F /IM electron.exe /T
```

Chỉ giết `electron.exe`. **Đừng** giết `node.exe` hàng loạt — trong đó có thể có
dev server, editor, hoặc chính terminal đang chạy.

### 5.4 Sidecar dùng Python 3.12, KHÔNG phải 3.11 như plan.md ghi

Máy dev có 3.12 và 3.14, **không có 3.11**. Đã thống nhất với user dùng 3.12
thay vì cài thêm runtime: mọi thư viện sidecar cần đều có wheel cho 3.12.

```bash
cd sidecar
py -3.12 -m venv .venv        # 3.14 CHƯA kiểm, đừng dùng
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
```

- venv nằm ở `sidecar/.venv/` (đã gitignore), **không** dùng chung với Node
- Code không dùng cú pháp riêng 3.12 → vẫn chạy được 3.11 nếu bản đóng gói cần
- `requirements.txt` có `fastapi` + `uvicorn` + `pydantic` + `httpx`, và từ P2.4
  thêm `piper-tts` + `soundfile` + `onnx` (kéo theo `onnxruntime` + `numpy`).
  **Mọi thứ ở đó đi vào bản `.exe`** — thêm dòng nào cũng phải chạy lại
  `pnpm build:sidecar` rồi khởi động thử `.exe`, không chỉ pytest (mục 4.34)
- `pyinstaller` nằm ở `requirements-dev.txt` — chỉ cần lúc đóng gói, máy user
  không có Python nên không bao giờ chạy `pip` ở đó. **Bắt buộc ≥ 6.21**, bản cũ
  hơn không gói nổi numpy 2.5 (mục 4.34)
- Cài lại sau khi kéo code P2.4: `.venv/Scripts/python.exe -m pip install -r
  requirements-dev.txt` (kéo cả `requirements.txt`) — khoảng 200 MB wheel
- Chạy pytest từ gốc: `pnpm test:sidecar`. Chưa dựng venv thì script **bỏ qua
  và thoát 0**, không làm đỏ oan `pnpm test` của người chỉ đụng TypeScript
- Trên Windows phải thêm `-X utf8` khi chạy python trực tiếp, nếu không tên
  test tiếng Việt in ra bị mã hoá lung tung

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
  chapter-draft.ts Bản nháp chương user sửa ở màn xác nhận (hàm thuần)
  ipc.ts          IPC contract (in/out có kiểu) + whitelist channel
  result.ts       Result<T> — handler không throw qua IPC
  schemas.ts      zod, validate ở biên IPC
  estimate.ts     Ước lượng thời lượng/dung lượng trước khi generate
  timings.ts      Ước lượng mốc từng từ + tra từ theo mốc (hàm thuần, mục 4.48–4.49)
                  PLAYBACK_LOOKAHEAD_SEGMENTS ở constants.ts (P3.2)
  constants.ts    SEGMENT_MAX_CHARS, bitrate, ngưỡng job…

packages/parsers/src/
  segmenter/
    sentence-splitter.ts   Tách câu VI/EN (xử lý 「」『』, viết tắt, số thập phân)
    segmenter.ts           Gom câu → segment ≤ 300 ký tự
    chapter-segments.ts    Segment theo trang + neo về tài liệu gốc (mục 4.21)
  cleaner/
    types.ts               TextLine + Page (đầu vào có toạ độ, từ parser PDF)
    header-footer.ts       Loại running head / số trang lặp (khớp theo phần chữ)
    dehyphenate.ts         Nối từ bị ngắt cuối dòng
    merge-lines.ts         Nối dòng bị PDF ngắt giữa câu
    columns.ts             Detect rãnh giữa 2 cột → sắp lại thứ tự đọc
    cleaner.ts             Pipeline 4 bước (thứ tự bắt buộc — mục 4.7)
  chapter-detector/
    types.ts               OutlineEntry, ScoredCandidate, DetectedChapter
    signals/outline.ts     Mục outline (tín hiệu mạnh nhất, trọng số 3.0)
    signals/font-size.ts   Cỡ chữ so với thân bài
    signals/pattern.ts     Regex tiêu đề VI/EN (neo `^` — xem mục 4.12)
    signals/position.ts    Đầu trang + khoảng trắng + trang thưa
    signals/toc.ts         Bộ lọc loại trang mục lục (xem mục 4.11c)
    detector.ts            Cộng điểm có trọng số, dựng chương, fallback
  parser/
    types.ts               DocumentParser, ParsedDocument, ParseError
    pdf.ts                 pdfjs → Page[], outline, phát hiện PDF scan
    docx.ts                mammoth → khối → Page[] (hasRealPages = false)
    registry.ts            Chọn parser theo đuôi file
    node-parsers.ts        Nối thư viện thật — KHÔNG export từ index.ts.
                           Bù DOMMatrix + trỏ workerSrc (xem mục 4.19)
  probe/                   Script khảo sát trên file thật (KHÔNG chạy trong
                           pnpm test — xem probe/README.md)
                           dump-segments: xuất segment thật ra JSON cho
                           sidecar chạy normalize lên (mục 4.25)

samples/                   File PDF/DOCX mẫu (KHÔNG commit — xem samples/README.md)

apps/main/src/
  index.ts                 Entry: settings → logger → DB → IPC → cửa sổ
  window.ts                BrowserWindow frameless, cấu hình bảo mật
  db/migrations.ts         Schema SQL theo version (KHÔNG sửa migration đã phát hành).
                           v1 schema gốc · v2 thêm chapters.error_count (4.42)
  db/migrator.ts           Runner theo PRAGMA user_version
  db/connection.ts         Instance dùng chung, WAL
  db/repositories/         MỌI SQL nằm ở đây — books / chapters / segments / jobs
                           / bookmarks (P5.4 — bảng có từ schema v1, tới đây mới
                           có repository)
                           segments: pendingStats* đếm ký tự bằng SQL, không kéo
                           text lên (một vol ~4800 segment). bookStats +
                           countBefore cho thống kê đọc (P5.4)
  ipc/wrap.ts              Bọc handler → Result lỗi (test được, không cần Electron)
  ipc/registry.ts          Gắn vào ipcMain, từ chối channel chưa khai báo
  ipc/handlers/            app / settings / window / import / library / sidecar
                           / voices (tải chạy nền, chặn tải trùng, nghe thử)
                           / queue (9 channel, handler mỏng — policy ở service)
                           / reader (nội dung sách + getSegmentAudio cho player)
                           / pronunciations (tầng 3 phiên âm — P5.2)
                           / bookmarks (dấu trang — P5.4). Thống kê đọc nằm
                           trong library:getStats, không có handler riêng
  services/import-session.ts  Giữ tài liệu đã parse giữa lúc phân tích và xác nhận
  services/library.ts      Copy file + hash + dựng segment + lưu DB
  services/queue.ts        Hàng đợi generate: MỘT worker tuần tự, persist SQLite
  services/timings-store.ts Đọc/ghi {segmentId}.json cạnh file .ogg
  services/paths.ts        NGUỒN DUY NHẤT sinh path + chặn path traversal
  services/sidecar-paths.ts      Tìm sidecar: venv (dev) vs .exe (đóng gói)
  services/sidecar-process.ts    Spawn + bắt tay stdout + kill (hợp đồng 4.26)
  services/sidecar-client.ts     HTTP client — chỗ DUY NHẤT dựng URL sidecar
  services/sidecar-supervisor.ts Health check + chính sách restart (mục 4.27)
  services/sidecar-spawn.ts      Nối child_process thật (chỗ DUY NHẤT chạm nó)
  probe/                   Chạy thật với sidecar Python (KHÔNG trong pnpm test
                           — xem apps/main/probe/README.md). Có typecheck riêng
                           qua tsconfig.probe.json từ P5.3 (mục 8)
  services/storage.ts      CHỖ DUY NHẤT xoá file của user (audio, timing, bản copy
                           sách). Xoá file trước, DB sau — mục 4.39
  services/settings.ts     electron-store, file hỏng → rơi về mặc định từng field
  services/logger.ts       Log file + xoay vòng (2 MB × 5 file)
  services/icon-paths.ts   Tìm icon.ico: repo (dev) vs resources/ (đóng gói)
  services/update-policy.ts  Phần THUẦN của auto-update: chặn dev/portable, so
                           version (chặn tụt bản), kẹp phần trăm. Không import
                           electron nên vitest chạy thẳng
  services/update-service.ts Máy trạng thái auto-update + 6 sự kiện của
                           electron-updater. autoDownload/autoInstallOnAppQuit
                           đều TẮT — tải và cài do user bấm (mục P5.5b)

apps/preload/src/
  api.ts                   window.api.* — không lộ ipcRenderer

apps/renderer/src/
  App.tsx                  Điều hướng: thư viện / nhập sách / chi tiết / đọc /
                           giọng đọc / dung lượng / cài đặt
  lib/theme.ts             Logic theme thuần
  features/theme/          use-theme + ThemeToggle
  features/titlebar/       TitleBar + WindowControls
  features/import/
    ImportScreen.tsx       Chọn file → xác nhận (có nút về thư viện — 2.7b)
    ChapterConfirm.tsx     Danh sách chương + nút xác nhận
    ChapterRow.tsx         Một hàng: tên, khoảng trang, preview, tách/gộp/xoá
    confidence.ts          Điểm detector → nhãn; "trang" vs "đoạn"
  features/settings/       Màn Cài đặt (P5.3) — CHỈ phần đọc. Thư mục audio,
                           bitrate, ngưỡng vẫn ở Storage Manager; đây chỉ trỏ
                           sang, không dựng lại (mục P5.3)
    SettingsScreen.tsx     Khung màn + nạp app:getInfo
    SubtitleFontSetting.tsx  Thanh cỡ chữ + xem thử tại chỗ
    AppInfoPanel.tsx       Phiên bản + thư mục dữ liệu (app:getInfo, kênh có từ
                           Phase 0 mà tới P5.3 mới có UI gọi)
    UpdatePanel.tsx        Ô cập nhật ĐẦY ĐỦ: kiểm/tải/cài + ô tick
                           autoCheckUpdates (P5.5c)
    UpdateBanner.tsx       Dải dưới titlebar, MỘT nút. Chỉ hiện ở available và
                           downloaded — error cố ý không báo ra đây (P5.5c)
    update-format.ts       Hàm thuần: tiêu đề, mô tả, nút, có nên báo ra ngoài
  features/bookmarks/      Dấu trang + thống kê đọc (P5.4). Thống kê **suy từ
                           dữ liệu đã có**, không có bảng theo dõi hành vi
    BookmarkButton.tsx     Nút đánh dấu + ô ghi chú (neo vào đoạn ĐANG CHỌN)
    BookmarkList.tsx       Danh sách xếp theo mạch đọc, không theo lúc tạo
    ReadingStatsPanel.tsx  Hai thanh riêng: tiến độ đọc vs tiến độ generate
    stats-format.ts        Hàm thuần: %, nhãn vị trí, ngày mở gần nhất
  features/library/
    LibraryGrid.tsx        Grid sách, nút đọc tiếp
    BookCard.tsx           Thẻ sách + bìa tạm suy từ tên
    BookDetailView.tsx     Mục lục chương, đánh dấu chương đọc dở
    format.ts              Thời gian tương đối, chữ cái bìa
  stores/settings-store.ts Zustand, có bắt rejection IPC
  stores/import-store.ts   Bản nháp chương + hoàn tác
  stores/library-store.ts  Danh sách sách + sách đang mở
  stores/voice-store.ts    Catalog + tiến độ tải theo voiceId + nghe thử
  stores/pronunciation-store.ts  Phiên âm user sửa + cờ dirty (audio cũ chưa đổi)
  stores/queue-store.ts    Hàng đợi generate + chống prefetch trùng.
                           loadPending/cancelJob cho bảng hàng đợi (P5.4)
  stores/bookmark-store.ts Dấu trang VÀ thống kê chung một store — chúng luôn
                           đổi cùng nhau (P5.4)
  stores/update-store.ts   Bản sao UpdateStatus. Trạng thái tới qua EVENT chứ
                           không qua giá trị trả về — xem P5.5c (P5.5c)
  stores/storage-store.ts  Dung lượng + xoá; giữ lỗi qua lượt nạp lại
  stores/player-store.ts   Máy trạng thái phát: idle/playing/paused/waiting.
                           KHÔNG giữ vị trí ms (đổi 60 lần/giây) — đọc qua
                           playerPositionMs() trong rAF. Tốc độ: setRate ghi
                           settings, applyStoredRate thì KHÔNG (4.58)
  features/player/
    playback-plan.ts       "Đoạn này làm gì với nó": play/skip/wait/request.
                           Chỗ DUY NHẤT quyết định bỏ qua đoạn hỏng (4.51)
    audio-element.ts       Bọc <audio> + Blob URL + kho nạp trước.
                           Chỗ DUY NHẤT chạm DOM audio; tự thu hồi url (4.54)
    usePlayer.ts           Dựng thẻ audio (gắn ẩn vào body — 4.56), nối
                           window.api, dọn khi rời
    usePlayerShortcuts.ts  Space/←→/JK/[]. Phần khó là LOẠI TRỪ (4.57)
    useSegmentProgress.ts  Vòng rAF ghi thẳng DOM qua ref — khuôn mẫu P3.4
                           dùng lại để highlight từng từ
    SegmentProgress.tsx    Thanh tiến độ trong đoạn + đồng hồ + bấm/kéo tua
    RateMenu.tsx           Menu 8 mốc tốc độ (0.75×–3×), mở LÊN
    icons.tsx              5 icon SVG inline — KHÔNG emoji, KHÔNG thư viện (4.55)
    PlayerBar.tsx          Nút phát/trước/sau + menu tốc độ + đường tắt Giọng đọc
    subtitle.ts            Cắt text GỐC thành từ, map timing qua giao khoảng (4.64)
    useWordHighlight.ts    rAF bật/tắt data-active, chỉ đụng 2 phần tử (4.66)
    SubtitlePane.tsx       Phụ đề + click-to-seek + chuột phải sửa cách đọc (P5.2)
    PronunciationDialog.tsx  Sửa cách đọc một từ. Mặc định theo SÁCH, không
                           toàn cục; nói rõ audio cũ không tự đổi
    format.ts              Nhãn trạng thái, mốc tốc độ, stepRate, formatClock (thuần)
  features/generate/
    GenerateControls.tsx   Nút tạo audio chương/cả sách (chỗ DUY NHẤT gọi queue:*)
    GenerateEstimateDialog.tsx  Hộp ước lượng BẮT BUỘC trước khi generate (4.38)
    QueueProgress.tsx      Thanh tiến độ + tạm dừng/huỷ
    format.ts              queuePercent, nhãn, mốc prefetch (thuần — 4.37)
  features/storage/
    StorageManager.tsx     Màn Dung lượng (chỗ DUY NHẤT gọi storage:*)
    DeleteAudioDialog.tsx  Hộp xác nhận BẮT BUỘC trước khi xoá audio
    StorageBookRow.tsx     Hàng sách, mở ra xem từng chương (tải khi bấm)
    StorageSettings.tsx    Thư mục audio, bitrate, ngưỡng cảnh báo
    format.ts              warnPercent, usageLevel, nhãn chương (thuần)
  features/voices/
    VoiceManager.tsx       Màn quản lý giọng đọc
    VoiceRow.tsx           Một voice: thông tin + tải/huỷ/xoá/nghe thử + tiến trình
    SidecarBadge.tsx       Trạng thái sidecar (chỗ ĐẦU TIÊN user thấy được)
    preview-player.ts      Thẻ <audio> riêng cho nghe thử; luôn <= 1 Blob URL sống
    format.ts              Dung lượng, phần trăm, nhãn trạng thái (thuần)
  styles/theme.css         CSS variables — mọi màu lấy từ đây

resources/voices/catalog.json  Catalog voice — sha256 LẤY THẬT (mục 4.28).
                           Đóng gói qua extraResources, KHÔNG vào asar

sidecar/                   Dịch vụ TTS Python (venv riêng — mục 5.4)
  entry.py                 Điểm vào PyInstaller — import TUYỆT ĐỐI (mục 4.29a)
  build.py                 PyInstaller onedir → ln-sidecar.exe
  app/voices/catalog.py    Đọc catalog + soi đĩa (thuần, không mạng)
  app/voices/download.py   Tải + băm theo dòng chảy + dọn sạch khi hỏng
  app/audio/resample.py    Polyphase 22050→24000 — Opus không nhận 22050 (4.30)
  app/audio/encode.py      Opus trong .ogg; bảng bitrate ĐO thật (4.31)
  app/audio/timings.py     Phoneme alignment → WordTiming, có lưới an toàn (4.32)
  app/audio/paths.py       Chặn ghi ra ngoài audioDir (4.33)
  app/engines/piper.py     Chỗ DUY NHẤT import piper. Cache model, tự khoá luồng
  app/config.py            Đọc env do main đặt lúc spawn; models dir BẮT BUỘC
  app/auth.py              Middleware X-Session-Token, so token thời gian hằng
  app/main.py              FastAPI: /health (không token), /normalize, /voices*,
                           /synthesize (một SEGMENT mỗi lần, chạy thread riêng),
                           /preview (nghe thử — trả bytes, KHÔNG ghi đĩa)
  app/server.py            Bind socket + bắt tay stdout (hợp đồng — mục 4.26)
  app/schemas.py           pydantic cho mọi biên vào-ra
  app/text/normalize_vi.py 8 luật, mỗi luật một hàm thuần (thứ tự bắt buộc)
  app/text/normalize_en.py Như trên; ngày tháng kiểu MỸ — không dùng chung VI
  app/text/numbers_vi.py   Đọc số VI ("lăm"/"mốt"/"tư"/"lẻ" — mục dễ sai nhất)
  app/text/numbers_en.py   Đọc số EN + năm kiểu Anh
  app/text/__init__.py     Registry chọn normalizer theo lang
  tests/                   pytest — KHÔNG chạy trong `pnpm test`

scripts/
  copy-pdf-worker.mjs      Chép pdf.worker.mjs vào dist (BẮT BUỘC — mục 4.19)
  sidecar-test.mjs         Chạy pytest từ gốc; thiếu venv thì bỏ qua, thoát 0
  sidecar-build.mjs        Đóng gói sidecar; thiếu venv là LỖI (khác test.mjs)
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
| CI job `build` chưa chạy tới nơi | TB | Job `check` đã chạy và lộ 2 lỗi (xem mục 4.14). Job `build` (đóng gói + smoke test) vẫn chưa xác nhận lần nào vì `check` fail trước |
| `@electron/rebuild` là dependency thừa | Thấp | electron-builder đã có sẵn; giữ lại vô hại |
| Ngưỡng cleaner mới kiểm trên 2 file | Thấp | `minRatio` 0.6, `maxLength` 80, `shortLineRatio` 0.6 đã chạy đúng trên 1 file VI + 1 file EN (60 trang). `minGutterRatio` 0.04 **vẫn chưa kiểm** — chưa có file 2 cột |
| Chưa có file mẫu nhóm B/C | Thấp | Còn thiếu **PDF 2 cột (B1)** — user xác nhận không có mẫu, `minGutterRatio` 0.04 vẫn chưa được kiểm lần nào. C1 (PDF scan) **đã có** và đã kiểm ở bản đóng gói: báo `PDF_NO_TEXT_LAYER` đúng như thiết kế |
| Detector chỉ kiểm trên 2 file PDF | TB | Cả hai đều là LN dịch bố cục 1 cột, đánh số kiểu phương Tây. Chưa biết hành xử với sách đánh số kiểu `第一章`, sách nhiều chương nhỏ, hay chương không có tiêu đề |
| ~~pdfjs chưa kiểm ở bản đóng gói~~ | ✅ Xong | Đã kiểm ở P1.5 và **lộ ra 2 lỗi thật** (mục 4.19). Nay chạy đúng trên `.exe` với cả 5 file mẫu, gọi qua IPC thật |
| ~~Kiểm bản đóng gói vẫn làm thủ công~~ | ✅ Xong | `scripts/ui-check.mjs` + `pnpm ui-check` (thêm `--packaged` cho bản đã build). Đo số thật trong Chromium: màu ở cả 2 theme gồm nhánh có alpha, `clientHeight` + số dòng, pixel khác trắng của canvas PDF. Chạy thật ở bản dev **và** bản đóng gói — xem mục 4.45. **Chưa vào CI**, xem hàng dưới |
| Không có test nào chặn lỗi màu trong suốt | **TB** | Lỗi 4.23 nằm im từ P1.6b. Test hiện chỉ kiểm class có mặt, không kiểm màu tính ra được. jsdom không tính CSS thật nên phải kiểm ở app đang chạy |
| Viewer PDF chưa có text layer | TB | Neo highlight vẽ bằng `rects` nên **không cần** text layer. Nhưng vậy user không bôi chọn hay copy chữ được. plan.md có nhắc "canvas + text layer" — để lại tới khi thật sự cần |
| Chưa có zoom / xoay trang | Thấp | Scale tính vừa bề ngang khung, trần 2×. Đủ đọc nhưng chưa cho user phóng to |
| HTML DOCX cache một sách trong RAM | Thấp | `reader.ts` giữ đúng một `BookHtml`; mở sách khác là convert lại (~200ms). Đổi lại là không phình `.db`, không migrate schema |
| Ảnh trong DOCX bị bỏ khi render | Thấp | `sanitizeDocxHtml` bỏ `<img>` (danh sách trắng không có). LN có minh hoạ sẽ mất ảnh ở viewer DOCX — PDF không bị vì vẽ cả trang |
| `import:*` chưa chặn đường dẫn tuỳ ý | TB | Renderer gọi `parseFile` với path bất kỳ và main sẽ đọc. Hiện chưa lộ ra ngoài (chỉ dialog gọi tới), nhưng khi thêm kéo-thả thì phải kiểm path qua `services/paths.ts` |
| ~~Ngôn ngữ sách hardcode `'vi'`~~ | ✅ Xong | P5.3: ô chọn ngôn ngữ ở màn xác nhận chương, cạnh ô tên sách. `save(title, lang)` bắt buộc truyền — không còn giá trị mặc định lẩn trong store. Mặc định UI là `vi` (app là trình đọc LN dịch) nhưng user đổi được trước khi lưu, và đó là **lúc duy nhất** đổi được: sau khi lưu thì phải xoá sách nhập lại |
| ~~Xoá sách không xoá file đã copy~~ | ✅ Xong | P2.7: `library:removeBook` gọi `storage.removeBookFiles()` — xoá bản copy trong `libraryDir` **và** cả thư mục audio. Xoá DB trước, file sau (mục 4.39). Lỗi xoá file không làm hỏng lượt xoá sách |
| Chưa sinh ảnh bìa | Thấp | `Book.coverPath` có trong schema nhưng chưa ai ghi. Grid đang dùng bìa tạm (chữ cái đầu + sắc độ suy từ tên) |
| Segment dựng đồng bộ trong main | Thấp | 4817 segment mất ~400ms, chấp nhận được. Sách lớn hơn nhiều lần thì sẽ thấy đơ — lúc đó chuyển sang worker thread |
| DOCX chưa xử lý ảnh và bảng | Thấp | `extractBlocks` chỉ nhận `<h1>`–`<h6>` và `<p>`. File mẫu A4 có 2 `<img>` bị bỏ qua — chấp nhận được vì TTS không đọc ảnh, nhưng bảng có nội dung thì sẽ mất |
| DOCX không có outline | Thấp | mammoth không đọc bookmark/TOC field của Word. Chương chỉ nhận được qua heading style hoặc regex — đã đủ với 2 file mẫu |
| Sidecar chưa vào `pnpm test` chung | Thấp | pytest cần venv Python mà CI chưa dựng. `pnpm test:sidecar` chạy riêng, thiếu venv thì bỏ qua. Nối vào job `check` khi dựng venv trên CI (cùng lúc với `build.py`) |
| Probe chạy thật sidecar chưa vào CI | TB | `apps/main/probe/` đã tìm ra lỗi 4.27 nhưng phải gọi tay. Cần venv nên chưa nối vào CI được — nối cùng lúc với hàng trên. Đây là lần thứ tư "unit test xanh mà đường nối thật hỏng" |
| ~~Sidecar chưa đóng gói~~ | ✅ Xong | `build.py` + `extraResources` đã có. **Đã kiểm thật ở bản đóng gói**: sidecar `.exe` lên `ready`, tải voice 63 MB xong trong app đã build. Lộ ra 1 lỗi thật (mục 4.29a). Phần **CI** vẫn còn nợ — xem hàng dưới |
| ~~Renderer chưa hiện trạng thái sidecar~~ | ✅ Xong | `SidecarBadge` hiện ở màn Giọng đọc, có cả 5 trạng thái. Đã đo màu thật trong app đóng gói ở cả dark lẫn light |
| ~~Đóng gói sidecar chưa vào CI~~ | ✅ Xong | `pnpm build:win` giờ tự gọi `build:sidecar` rồi `scripts/sidecar-preflight.mjs` — không còn phải nhớ. Preflight chặn cả 3 cách hỏng (thiếu `.exe`, thiếu `_internal/`, `.exe` cũ hơn `.py`), đã kiểm chứng bằng `touch` một file `.py`. CI dựng venv 3.12 ở **cả hai** job + kiểm phía đích `resources/sidecar/` sau khi đóng gói. Xem mục 4.44 |
| ~~Chưa dựng lại installer sau P2.4/P2.5~~ | ✅ Xong | P2.8 chạy lại `pnpm build:win`: NSIS **143.0 MB**, portable **142.8 MB** (trước khi có sidecar là 80.8 MB). electron-builder **có** chép trọn onedir — đo được `resources/sidecar/` **147 MB** đủ cả `_internal/`, và `resources/voices/catalog.json` cũng có. Vượt mốc 200 MB của plan.md thì chưa, nhưng đã dùng hết 71% |
| ~~Chỉ có 2 voice trong catalog~~ | ✅ Xong (một phần) | P5.1 thêm `vi_VN-25hours_single-low` (16 kHz, sha256 **tải thật rồi tính**, md5 đối chiếu khớp `voices.json` của HF). Nay **3 giọng**: 2 VI + 1 EN. Piper chỉ có đúng 3 giọng VI và giọng thứ ba (`vivos`) là nhiều người nói — xem hàng dưới. Giọng EN thì Piper có 38 cái, chưa thêm vì app là LN tiếng Việt; thêm = sửa JSON, không sửa code |
| ~~UI tầng 3 phiên âm chưa có~~ | ✅ Xong | P5.2: 3 kênh `pronunciations:*` + hộp sửa cách đọc mở bằng **chuột phải** trên từ ở phụ đề. Mặc định lưu theo sách, tích ô để áp toàn cục. `term` tự hạ chữ thường ở biên, cấm khoảng trắng trong cách đọc kèm câu giải thích. 33 test mới. **Chưa chạy trên app thật** — xem hàng dưới |
| ~~Phiên âm Nhật chưa nghe thật lần nào~~ | ✅ Xong | User đã nghe hết một chương và xác nhận cả hai vế của DoD Phase 3: nghe liên tục được, chữ sáng đúng nhịp. Đây cũng là căn cứ **bỏ Phase 4** (mục 4.68). P5.1 thêm nút nghe thử với câu mẫu **có sẵn tên riêng Nhật** nên từ nay kiểm lại được bất cứ lúc nào mà không phải generate cả chương |
| ~~**`ui-check` chưa chạy suốt P3.4 → P5.3**~~ | ✅ Xong | User đã chạy sau P5.3. **59/63 đạt.** Toàn bộ P3.4 xanh (2 pane chia đúng 80% đo được, kéo thanh thì phụ đề cao lên **thật** 147→162 px, ẩn/hiện về đúng chiều cao cũ) và toàn bộ P5.3 xanh (cỡ chữ 18 px, xem thử **khớp** thanh trượt, chữ không trong suốt, nút xoá phần đã đọc 106×24 px). 4 phép đỏ: **2 là đỏ giả của chính phép kiểm** (mục 4.72, đã sửa) và 2 là "nợ virtualizer" — mà lượt chạy sau P5.4 cho thấy **cũng là đỏ giả** (mục 4.74): chương chỉ có 5 đoạn thật. Tức **cả 4 phép đỏ lượt đó đều là lỗi phép kiểm, không có lỗi app nào** |
| Phụ đề chưa giới hạn 3 dòng như plan.md | Thấp | plan.md ghi "subtitle pane 3 dòng". Bản này cho pane cuộn tự do theo tỉ lệ splitter thay vì chốt cứng 3 dòng — user kéo được nên tự chọn được số dòng, và chốt cứng thì đoạn dài bị cắt mất chữ. Nếu thấy vướng thì thêm chế độ "gọn" sau |
| Không tô màu "đã đọc" cho từ phía trước | Thấp | Chỉ từ **đang đọc** đổi màu. Tô cả phần đã đọc thì mỗi khung hình phải duyệt toàn bộ `<span>` đứng trước (mục 4.66). Làm được nếu cần: đặt một class ở container rồi dùng CSS sibling selector, nhưng chưa ai thấy thiếu |
| Từ điển Nhật mới 193 mục | Thấp | Phủ địa danh, xưng hô, thuật ngữ LN phổ biến. Tên nhân vật lạ do luật romaji lo (đo được 65/65 nhận đúng), nên thiếu mục không làm hỏng gì — chỉ là cách đọc kém tự nhiên hơn ở vài tên. Thêm mục = sửa `sidecar/app/text/data/lexicon_jp.json`, có cảnh báo sẵn về việc tránh âm tiết trùng tiếng Việt |
| Danh sách chặn tiếng Việt/Anh là thủ công | Thấp | `_VIETNAMESE_SYLLABLES` (~80 mục) và `_ENGLISH_WORDS` (~60 mục) trong `romaji_vi.py` liệt kê tay vì `mua`/`game` trùng hình thái romaji hoàn toàn, không luật nào tách được. Đo hiện tại: 0/51 từ Việt và 0/51 từ Anh bị nuốt. Từ ngoài danh sách mà trùng hình thái vẫn lọt — cố ý giữ danh sách ngắn, vì dài quá lại tăng rủi ro chặn nhầm tên nhân vật |
| Tải voice không resume được | TB | Đứt giữa chừng là mất cả 63 MB, tải lại từ đầu. HF có hỗ trợ `Range` nên làm được, nhưng phải giữ trạng thái băm dở — băm theo dòng chảy hiện tại không nối tiếp được. Để lại tới khi thấy người dùng thật kêu |
| Nút "Giọng đọc" chỉ có ở màn thư viện | Thấp | Vào đọc sách rồi thì phải quay ra mới tải voice được. Hợp lý cho tới khi có nút generate trong reader (P2.6) |
| Supervisor chưa có backoff luỹ tiến | Thấp | Chờ cố định `SIDECAR_RESTART_DELAY_MS` (1s) giữa các lần thử. Với trần 3 lượt thì đủ; nếu sau này nới trần thì nên tăng dần để không dội liên tục |
| ~~**`timings` chưa ghi ra đĩa**~~ | ✅ Xong | `services/timings-store.ts` ghi `{audioDir}/{bookId}/{segmentId}.json` (ghi `.part` rồi rename). **Đã kiểm thật**: 3 segment × 13–14 từ, `durationMs` khớp DB |
| ~~Chưa có màn hình nào gọi `queue:*`~~ | ✅ Xong | `GenerateControls` gọi 8/12 channel từ trình đọc và màn chi tiết sách. Còn `queue:listPending` và `queue:cancelJob` chưa có UI — xem hàng dưới |
| ~~Chưa có UI chọn giọng đọc~~ | ✅ Xong | Nút "Dùng giọng này" ở `VoiceRow`, chỉ hiện với voice **đã cài**. Xoá voice đang chọn thì tự bỏ chọn, nên settings không bao giờ trỏ tới model đã mất |
| ~~P2.6 UI chưa mở app thật lần nào~~ | ✅ Xong | P2.7 đã kiểm ở `pnpm dev` bằng CDP: hộp ước lượng, thanh tiến độ, generate 190 đoạn thật, prefetch, xoá 380 file. Đo `getComputedStyle` ở **cả dark lẫn light** — không màu nào trong suốt. Phần **bản đóng gói** vẫn còn nợ, xem hàng dưới |
| ~~UI Phase 2 chưa kiểm trên bản đóng gói~~ | ✅ Xong | P2.8: `pnpm build:win` (tự đóng gói sidecar) rồi `pnpm ui-check --packaged` trên `.exe`. Đo được sidecar `.exe` lên `ready`, catalog đọc từ `resources/voices/`, màu ở cả 2 theme, bố cục danh sách đoạn — tức đã đi qua đúng đường dẫn kiểu asar mà bản dev không lộ |
| ~~Không test nào bắt được lỗi bố cục/chiều cao~~ | ✅ Xong | `pnpm ui-check` đo `clientHeight` của ô cuộn, tỉ lệ so với panel, số dòng render, và so số dòng giữa hai đường "lần đầu mở" vs "ẩn rồi hiện lại" — chính chênh lệch đã lộ ra lỗi 4.43. Test cấu trúc ở tầng vitest **vẫn giữ**: hai lưới chặn hai tầng, không thay nhau |
| ~~Quy trình kiểm UI bằng CDP vẫn viết tay mỗi lần~~ | ✅ Xong | `scripts/ui-check.mjs` là script cố định, `pnpm ui-check`. Có `scripts/README.md` ghi kiểm những gì và bắt được lỗi loại nào |
| `pnpm ui-check` chưa vào CI | **TB** | Chạy tay được rồi, nhưng runner sạch thiếu hai thứ: venv Python (để sidecar lên `ready`) và **ít nhất một sách trong thư viện** — phần reader/storage tự bỏ qua nếu thư viện rỗng, nên nối vào CI lúc này chỉ kiểm được nửa đầu. Cần một sách mẫu nhỏ commit được (`samples/` hiện không commit) hoặc bước import qua IPC trước khi kiểm |
| Ảnh chụp trong `ui-check` hay bị bỏ qua | Thấp | `Page.captureScreenshot` treo khi cửa sổ bị che (chạy nền là ca thường gặp), nên script bỏ ảnh sau 15s thay vì đỏ. Số đo vẫn đủ để kết luận, chỉ mất bằng chứng nhìn bằng mắt. Muốn chắc có ảnh thì chạy với cửa sổ hiện lên trước |
| Xoá 1 chương huỷ job của CẢ sách | Thấp | Hàng đợi không có `cancelByChapter` nên `storage:deleteChapterAudio` gọi `cancelBook` (mục 4.41). Quá tay: job của chương khác bị huỷ oan rồi phải xếp lại. Đổi được nếu thêm `cancelByChapter` vào `jobs.ts` |
| ~~`deleteReadAudio` chưa có nút trong UI~~ | ✅ Xong | P5.3: nút "Xoá phần đã đọc" ở mỗi hàng sách trong Storage Manager, đặt **trước** nút "Xoá audio" vì đây là cách dọn chỗ ít mất mát nhất. Qua cùng hộp xác nhận, nhưng dùng `scopeNote` thay vì hai con số — số byte do main tính theo vị trí đọc dở, renderer không biết trước (4 test mới) |
| Ngưỡng cảnh báo nhỏ nhất là 2 GB | Thấp | Nhánh `near`/`over` chỉ tới được khi user có >1.6 GB audio. Đúng với app này (1 vol ≈ 97 MB → cảnh báo ở ~16 vol) nhưng nghĩa là đường cảnh báo hiếm khi chạy thật. Đã kiểm bằng cách hạ ngưỡng qua IPC: thanh 100%, fill đổi đỏ, câu cảnh báo đúng |
| Lớp phủ hộp thoại chỉ mờ 70% | Thấp | `bg/0.7` nên chữ dưới vẫn lộ quanh mép hộp, hơi nhiễu mắt — thấy rõ trên ảnh chụp dark. Cả `GenerateEstimateDialog` (P2.6) lẫn `DeleteAudioDialog` dùng cùng mẫu nên ít nhất là nhất quán |
| `getUsage` quét cả thư mục audio mỗi lần gọi | Thấp | Một vol có ~9600 file; `stat` từng file để so DB với đĩa. Với 1–2 sách thì tức thời, nhưng thư viện 50 vol sẽ thấy chậm khi mở màn Dung lượng. Lúc đó nên cache theo `mtime` của thư mục hoặc chỉ quét khi user bấm "dọn rác" |
| ~~Không có UI cho bảng hàng đợi~~ | ✅ Xong | P5.4: tab **Hàng đợi** ở panel phải trình đọc. Hiện trạng thái + mức ưu tiên + số lần đã thử + lỗi của từng job, huỷ được **từng job**. Nạp một lần khi mở tab (có nút nạp lại), **không hỏi vòng** — danh sách tới 200 job và không có event nào đẩy nó xuống. Có test khoá lại rằng `listPending` không bị gọi khi tab chưa mở |
| Prefetch không huỷ khi rời sách | Thấp | Đọc tới 80% chương 3 rồi đóng sách thì chương 4 vẫn generate xong trong nền. Không sai — audio đó vẫn dùng được sau này — nhưng tốn CPU cho việc user không còn cần. `queue:cancelBook` đã có sẵn nếu muốn đổi |
| `prefetched` mất khi reload renderer | Thấp | Danh sách chương đã prefetch giữ trong store, không persist. Reload thì prefetch lại chương đó — nhưng `enqueueChapter` tự lọc segment đã `ready` nên chỉ tốn một lượt IPC, không sinh job trùng |
| ~~Bitrate trong settings chưa ai đọc~~ | ✅ Xong | Hàng đợi truyền `AppSettings.bitrate` xuống mỗi job. **Đo trên file thật**: 16 kbps → 6797 B, 32 kbps → 12574 B cho cùng một câu |
| Sidecar `.exe` 29 → 145 MB | TB | ONNX Runtime + espeak-ng data (mọi ngôn ngữ, gồm `ru_dict` 9 MB) + numpy. Installer sẽ vượt mốc 200 MB của plan.md. Cắt được: loại bớt `espeak-ng-data/*_dict` không dùng (chỉ cần `vi`, `en`) — nhưng phải chắc piper không nạp động cái nào khác trước khi cắt |
| Hàng đợi không tự chạy lại sau khi sidecar hồi phục | TB | `index.ts` gọi `queue.resume()` khi sidecar về `ready`, nhưng **chưa kiểm thật** đường này: probe dựng queue riêng chứ không qua `index.ts`. Kiểm khi P2.6 có UI để giết sidecar giữa lúc generate |
| Retry không có backoff | Thấp | Job hỏng quay lại hàng đợi và có thể được `claimNext` ngay lượt sau — 3 lượt thử cháy hết trong vài chục ms nếu lỗi là tức thời (sidecar từ chối luôn). Đủ dùng vì `markError` vẫn đếm đúng, nhưng lỗi tạm thời (mạng, khoá file) sẽ không kịp qua cơn |
| Nút "Giọng đọc" vẫn phải quay ra thư viện | Thấp | Trình đọc đã có nút generate (P2.6) nhưng khi báo "chưa chọn giọng" thì user phải tự quay ra màn thư viện rồi vào Giọng đọc. Nên có đường tắt ngay từ thông báo đó |
| Job `align` khai trong schema nhưng chưa dùng | Thấp | `JobType` có `'align'` từ schema v1, hàng đợi chỉ tạo job `'synthesize'`. **Phase 4 đã bỏ** (mục 4.68) nên nhiều khả năng không bao giờ dùng tới — giữ lại vì gỡ đi tốn một migration mà chẳng được gì. ⚠️ Ai định enqueue job `'align'` phải thêm **dispatch theo `job.type`** vào `queue.ts` trước: hiện `claimNext()` trả job nào cũng bị xử lý như `synthesize` |
| Engine chỉ giữ MỘT voice trong RAM | Thấp | Sách VI và EN xen kẽ sẽ nạp lại model mỗi lần đổi (~1.5 s). Giữ hai model là ~400 MB RAM. Chấp nhận được vì generate thường chạy theo cả chương cùng một giọng |
| Timing chưa kiểm trên giọng EN | TB | Cách gộp phoneme → từ mới đo thật trên `vi_VN-vais1000-medium`. Voice EN chưa tải nên chưa biết espeak tách từ tiếng Anh có khớp regex `\w+` không (viết tắt `Mr.`, sở hữu cách `John's`). Có lưới an toàn nên không vỡ, nhưng có thể rơi về `estimate` nhiều hơn cần thiết |
| ~~`SYNTHESIS_RTF_ESTIMATE` chưa hiệu chỉnh~~ | ✅ Xong | Đã đối chiếu với số đo thật ở P2.6: ước 1680 ms vs thật 2045 ms (**RTF thật 0.24** gồm nạp model). Lệch +22% → giữ nguyên 0.15. Dung lượng lệch −15%, thời lượng −24%. Probe khoá lại ngưỡng 0.25–4× để hằng số không âm thầm sai bản chất |
| Normalize chưa kiểm trên sách EN gốc | Thấp | 2429 segment thật đã chạy qua, nhưng phần EN lấy từ **LN dịch** (`A2`), không phải văn bản Anh bản ngữ. Số thứ tự, `Mr./Mrs.`, năm kiểu Anh mới chỉ có unit test |
| Chưa có luật normalize cho ký tự Nhật còn sót | Thấp | LN dịch đôi khi giữ nguyên `〜`, furigana trong ngoặc. Chưa gặp ở 2429 segment mẫu nên chưa viết luật — đợi thấy thật rồi làm |
| ~~**`apps/main/probe/` nằm ngoài typecheck**~~ | ✅ Xong | P5.3: `apps/main/tsconfig.probe.json` nối vào `typecheck` của `@ln/main`. Tách riêng chứ không nới `include` của `tsconfig.json` — đó là config *build* (`rootDir: ./src`), nới ra sẽ đẩy mọi thứ trong `dist/` đổi chỗ. **Đã kiểm chứng bằng cách phá thật**: `segment?.XXaudioBytes` → `error TS2551`, rồi khôi phục. Probe vẫn ngoài `pnpm test` và ngoài CI (cần venv) — nhưng nay lệch kiểu không còn lọt |
| ~~Renderer phải tự `revokeObjectURL` cho audio~~ | ✅ Xong | P3.2: việc tạo và thu hồi gom vào `audio-element.ts`, không có đường nào tạo url mà không đi qua chỗ thu hồi. `setup.ts` **đếm** url chưa nhả và xuất `countOpenObjectUrls()` — test khoá lại: phát 3 đoạn liên tiếp còn đúng 1 url mở, rời trình đọc về 0 (mục 4.54) |
| ~~`PLAYBACK_LOOKAHEAD_SEGMENTS = 5` chưa đo trên sách thật~~ | ✅ Xong | Lượt nghe cả chương của user không báo đứt tiếng giữa các câu → 5 là đủ với RTF 0.24. Giữ nguyên hằng số |
| ~~Chưa nghe thử bằng tai~~ | ✅ Xong | User nghe hết một chương ở P3.4: audio liên tục, highlight bám đúng từng chữ. `ui-check` vẫn không thay được lượt nghe này (CDP không đọc được đầu ra âm thanh) nên mọi thay đổi đụng tới timing sau này vẫn phải nghe lại tay |
| ~~Player chưa có phím tắt~~ | ✅ Xong | P3.3: Space, ←/→, J/K, `[`/`]`. Phần khó hoá ra không phải gắn listener mà là **loại trừ** — ô nhập, vùng `contenteditable`, nút đang có tiêu điểm, tổ hợp có phím bổ trợ (mục 4.57) |
| ~~Danh sách đoạn chỉ render 5 dòng cho khung chứa được ~10~~ | ✅ **đã đóng — chẩn đoán sai, không có lỗi** | Ghi nhầm thành nợ **TB** suốt từ trước P3.3. Sự thật: chương đang mở ("Bản quyền") **chỉ có 5 đoạn**, render đủ 5/5 là đúng — xem 4.74. Virtualizer chưa bao giờ hỏng ở đây. ⚠️ **Bài học về cách xác nhận:** lần đó "xác nhận" bằng cách stash P3.3 rồi chạy lại, thấy baseline cũng 5 dòng nên kết luận "lỗi có sẵn từ trước". Phép thử đó **không phân biệt được hai giả thuyết** — thứ giữ nguyên giữa hai lượt chạy là **chương đang mở**, không phải mã nguồn. Chạy lại cùng một tình huống chỉ tái hiện được triệu chứng, không chứng minh được nguyên nhân. Một lượt mở `artifacts/ui-check/dev-reader-dark.png` (nhãn ghi rõ "5 đoạn") đã trả lời trong 5 giây |
| Thanh tiến độ chưa kiểm khi audio **đang chạy thật** | Thấp | `ui-check` đo được kích thước, màu, và dạng chuỗi `0:00 / 0:00` — nhưng lúc đó player `idle` nên chưa chứng minh được thanh **chạy** đúng nhịp. Unit test có kiểm (giả `positionMs`), còn trên app thật thì cùng chung nợ với "chưa nghe thử bằng tai" |
| Bấm đoạn lúc player `idle` không tự phát | Thấp | Cố ý: bấm đoạn để xem nó ở trang nào là thao tác thường gặp, tự phát tiếng lúc đó là bất ngờ khó chịu. Đang phát rồi thì bấm đoạn khác mới nhảy tới. Đổi được nếu user thấy ngược |
| `getSegmentAudio` chưa kiểm trên sách EN | Thấp | Probe chạy trên giọng VI. Cách gộp phoneme → từ của espeak với tiếng Anh chưa đo (đã là nợ sẵn ở hàng "Timing chưa kiểm trên giọng EN"); đường ước lượng thì độc lập ngôn ngữ vì chỉ đếm ký tự |
| Cleaner chưa xử lý cột đôi trải qua nhiều trang | Thấp | `detectColumnLayout` xét từng trang độc lập; sách đổi bố cục giữa chương vẫn đúng, nhưng trang có đúng 1 dòng mỗi cột thì rơi về `single` |
| **UI sửa cách đọc chưa chạy trên app thật** | **TB** | P5.2 mới ở mức unit test. Hai thứ chưa xác nhận: (1) bấm chuột phải trên phụ đề trong Chromium thật có mở hộp không, và menu ngữ cảnh hệ thống có bị chặn đúng không — jsdom không có menu đó; (2) **chưa nghe** một đoạn generate lại sau khi sửa để xác nhận cách đọc mới thật sự tới được Piper. Đường truyền `getPronunciations` → `/synthesize` có từ P3.5 và có test, nhưng chưa lần nào chạy với dữ liệu do user nhập từ UI |
| **Nghe thử giọng chưa chạy trên app thật** | **TB** | P5.1 mới có unit test: nút, ba trạng thái (`Nghe thử`/`Đang tạo…`/`Dừng`), và kỷ luật thu hồi Blob URL đều xanh ở jsdom — nhưng **jsdom không phát được audio** (`HTMLMediaElement.play` là bản giả trong `setup.ts`). Nghĩa là chưa có gì chứng minh câu mẫu thật sự kêu thành tiếng, hay `/preview` trả về file `.ogg` Chromium giải mã được. Chạy `pnpm ui-check` + bấm thử bằng tay là việc đầu tiên của phiên sau |
| Không hỗ trợ voice nhiều người nói | Thấp | 8 giọng VI/EN của Piper có `num_speakers > 1` (`vivos` 65, `libritts_r` 904). Cần `speakerId` xuyên 4 tầng + UI chọn người nói. **Mức hạ từ TB xuống Thấp** sau khi đo `vivos`: nó là đường duy nhất thêm giọng VI, nhưng thanh điệu bị ép phẳng (xem 4.70) nên không đáng làm chỉ vì nó. Còn giá trị cho giọng EN nhiều người nói nếu sau này cần |
| Câu nghe thử cố định, user không tự gõ được | Thấp | `VOICE_PREVIEW_TEXT` chọn sẵn theo `lang`, có tên riêng Nhật + chữ số để phủ đúng hai đường chuẩn hoá dễ sai. Cho user gõ câu riêng sẽ hữu ích để thử tên nhân vật cụ thể trong sách họ đang đọc — nhưng phải giới hạn độ dài và chặn đường dùng nó thay hàng đợi generate |
| Dấu trang không sửa được từ ngoài trình đọc | Thấp | Chỉ xem/sửa được khi đang mở sách. Màn chi tiết sách không có tab dấu trang — muốn xem lại chỗ đã đánh dấu phải vào đọc trước. Đủ dùng vì dấu trang vốn để **quay lại chỗ đọc**, mà quay lại thì đằng nào cũng phải mở sách |
| Đánh dấu lại đoạn cũ mà bỏ trống ghi chú thì **xoá** ghi chú | Thấp | `upsert` ghi `note = NULL` khi không truyền. Đúng với đường UI hiện tại (`BookmarkButton` luôn điền sẵn ghi chú cũ vào ô nên user thấy trước khi lưu), nhưng nếu sau này có đường gọi `bookmarks:add` không qua ô đó thì nó xoá ghi chú lặng lẽ. Cả bản thật lẫn bản giả trong test đều hành xử giống nhau — đã khoá lại |
| ~~P5.5a chưa qua `pnpm build:win`~~ | ~~TB~~ | ✅ **Đóng 2026-07-31** — user chạy `build:win` thật. Icon **có** nhúng vào `.exe`; `latest.yml` ghi `LN-Reader-0.1.0-x64.exe` khớp đúng tên file thật, size khớp từng byte. Lỗi 4.75 xác nhận đã sửa trên bản đóng gói |
| **P5.5b chưa chạy trên bản NSIS đã cài** | **TB** | Đã kiểm CDP trên **bản dev** (ra `unsupported`, đúng) và kiểm bundle có `NsisUpdater` (mục 4.76). Nhưng nhánh **cập nhật được** — `checking` → `available` → tải → cài — chỉ chạy khi có `app-update.yml`, tức **chỉ bản NSIS đã cài** mới đi tới. Kiểm đầy đủ cần: publish một release thật lên GitHub rồi cài bản cũ hơn và bấm cập nhật. Không có đường tắt nào chứng minh được nhánh này |
| **`release/` không tự dọn giữa các lần build** | **Thấp** | electron-builder chỉ ghi đè file trùng tên. Đổi `artifactName` ở P5.5a nên bộ cũ (`LN Reader-…`, có dấu cách) vẫn nằm cạnh bộ mới. Vô hại khi build thử, **nguy khi publish**: upload nhầm file có dấu cách là updater 404 trở lại (lỗi 4.75). Cách xử: xoá tay `release/` trước khi build bản phát hành. Chưa tự động hoá vì xoá thư mục output tự động là thao tác phá huỷ, cần user quyết |
| **Nhánh cập nhật được của P5.5c chưa ai bấm** | **TB** | Cùng gốc với nợ P5.5b ngay trên. `ui-check` chứng minh được ô cập nhật dựng đúng và bản dev ra `unsupported`, nhưng `available` → tải → `downloaded` → cài **chỉ tới được khi GitHub có release mới hơn bản đang chạy**. Nghĩa là dải báo, thanh tiến độ và nút "Khởi động lại & cài" mới chỉ chạy với dữ liệu giả trong vitest. Đóng nợ này và nợ P5.5b là **cùng một việc**: publish release rồi cài bản cũ hơn và bấm |
| Không kiểm được `ui-check` ở theme sáng cho các màn sau titlebar | Thấp | Script cố ý về dark trước khi vào màn Cài đặt để ảnh chụp nhất quán, nên mọi phép đo trên màn đó chỉ có nhánh dark. P5.5c bù bằng cách đo `fg`/`fgMuted` ở **cả hai** theme trong `measureColors` — đủ bắt lỗi mất biến màu, nhưng không bắt được lỗi chỉ xảy ra ở bố cục màn Cài đặt trong theme sáng |
| Bảng hàng đợi hiện `segmentId` chứ không hiện text đoạn | Thấp | Job chỉ mang id; tra text cho tới 200 hàng là 200 lượt truy vấn cho một bảng chẩn đoán. Id đủ để đối chiếu với danh sách đoạn, nhưng không đọc được bằng mắt. Sửa được bằng một truy vấn JOIN trả kèm text nếu thấy cần |
| ~~P5.4 chưa chạy trên app thật~~ | ✅ **đã đóng** | Đã chạy `pnpm ui-check` thật: 10 phép kiểm P5.4 **xanh hết**. Xác nhận trong Chromium: mỗi tab panel cao 664 px thật (không dựng lại 4.43), hai thanh tiến độ ra màu thật (`rgb(129,140,248)` / `rgb(113,113,122)` — không rơi vào bẫy `bg-success` của 4.23), `queue:listPending` trả lời được |
| ~~Màn Cài đặt chưa chạy trên app thật~~ | ✅ **đã đóng** | Cùng lượt chạy trên: 5 phép kiểm P5.3 xanh. Cỡ chữ preview khớp thanh trượt (18 px vs 18 px), chữ preview không trong suốt, cả dark lẫn light đều ra màu khác nhau thật |
| Chọn ngôn ngữ sách chỉ đổi được lúc nhập | Thấp | Lưu xong thì `lang` cố định; chọn nhầm phải xoá sách nhập lại (mất luôn cấu trúc chương đã sửa tay). Sửa được: thêm `library:setLang` + ô chọn ở màn chi tiết sách, nhưng phải xoá audio đã sinh vì chúng theo giọng cũ. Chưa làm vì chọn nhầm ngay ở màn xác nhận là ca hiếm — ô nằm cạnh ô tên sách, khó bỏ sót |
| Không có UI cho `alignmentEnabled` | Thấp | **Cố ý**, xem 4.71. Phase 4 đã bỏ nên không có gì để bật/tắt; giữ field vì gỡ khỏi schema tốn một migration đổi lấy hư không. Đừng dựng UI cho nó |
| Giọng `25hours` chưa nghe thử lần nào | TB | sha256/size đã đối chiếu thật với HF, và đường 16 kHz đã lần theo code (`target_rate_for_opus` trả 16000 → **bỏ qua resample**), nhưng **chưa tải model 63 MB về để nghe**. Chất lượng `low` + 16 kHz nghe ra sao so với `vais1000` (`medium`, 22 kHz) thì chưa ai biết. Nếu tệ hơn hẳn thì nên ghi chú vào catalog để user khỏi mất công tải |
