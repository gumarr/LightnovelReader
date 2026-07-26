# Tiến độ — LN Reader

> File này ghi lại **trạng thái công việc** để phiên làm việc sau tiếp tục được ngay.
> Kế hoạch tổng thể ở [plan.md](plan.md), quy tắc code ở [CLAUDE.md](CLAUDE.md).
>
> **Cập nhật lần cuối:** 2026-07-26 · commit `ed799cf`
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

# Chạy thật supervisor + sidecar Python (ngoài pnpm test — xem apps/main/probe/)
npx vitest run -c apps/main/probe/vitest.config.ts

# Đóng gói sidecar thành .exe (BẮT BUỘC chạy TRƯỚC pnpm build:win — mục 4.29)
pnpm build:sidecar
```

Nếu `pnpm dev` không mở được cửa sổ: xem **mục 5.2** (biến `ELECTRON_RUN_AS_NODE`).

**Việc tiếp theo:** P2.4 — Piper engine + `/synthesize` (xem mục 3).
**Phase 1 xong. P2.1, P2.2, P2.3 xong.**

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

### Số liệu hiện tại

| Chỉ số | Giá trị |
|---|---|
| Unit test TypeScript | **1180 passed** (+99 ở P2.3) |
| Unit test sidecar (pytest) | **245 passed** (+80 ở P2.3) |
| Chạy thật sidecar (probe, ngoài `pnpm test`) | 5 kịch bản |
| Typecheck | Sạch (5 package) |
| Lint | Sạch (0 warning) |
| Installer | **94 MB** (đã gồm sidecar `.exe` 29 MB) |

---

## 3. Việc tiếp theo — Phase 2

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
| P2.4 | Piper engine + `/synthesize` → ogg, bitrate configurable | ⬅️ **Tiếp theo** |
| P2.5 | Job queue persist SQLite: priority, pause/resume/cancel | Chưa |
| P2.6 | Generate theo chương + prefetch + ước lượng "cả sách" | Chưa |
| P2.7 | Storage Manager: xem/xoá theo sách-chương, đổi thư mục, cảnh báo | Chưa |

**DoD Phase 2:** Generate chương 1 → có audio, phát được, xem & xoá được dung lượng.

### Ghi chú cho P2.4 (Piper engine + `/synthesize`)

Những gì P2.3 để lại sẵn:

- **Voice đã cài tra ở đâu**: `sidecar/app/voices/catalog.py` có
  `is_installed()` và `voice_dir()`. Engine nạp model thì lấy đường dẫn từ đó,
  **đừng** tự ghép `models_dir / voices / id` lần nữa.
- `is_installed()` chỉ kiểm **kích thước**, không băm lại (63 MB băm mỗi lần mở
  màn hình là quá đắt). Engine nạp file hỏng vẫn có thể xảy ra nếu user sửa tay
  — bắt lỗi lúc nạp và báo rõ, đừng giả định file luôn đúng.
- **`engineReady` vẫn đang `false` cứng** trong `sidecar/app/main.py`. P2.4 phải
  đổi nó thành trạng thái thật, vì supervisor và UI đều đã đọc sẵn field này.
- `requirements.txt` giờ có `httpx`. Thêm `piper-tts` + `onnxruntime` vào **đó**
  (không phải `requirements-dev.txt`), nếu không bản `.exe` thiếu — xem 4.29b.
- **Thêm dependency Python xong phải build lại `.exe` và chạy thử**, không chỉ
  chạy pytest: `pnpm build:sidecar` rồi chạy `ln-sidecar.exe` xem nó còn bắt tay
  được không. ONNX Runtime có DLL native, đúng loại thứ PyInstaller hay bỏ sót.
- Bitrate 16/24/32 đã có trong `AppSettings.bitrate`, chưa ai đọc.

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

### 4.24 Highlight trên nền trắng: không dùng `mix-blend-multiply`

Sau khi sửa 4.23, ô highlight vẫn nhạt. `mix-blend-multiply` nhân màu phủ với
nền — nền trang PDF là **trắng** (1.0) nên phép nhân gần như không đổi gì.
Đổi sang phủ thẳng `bg-accent/[0.28]`: thấy rõ mà chữ bên dưới vẫn đọc được.

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
- `requirements.txt` có `fastapi` + `uvicorn` + `pydantic` + `httpx` (httpx là
  **runtime** từ P2.3 — tải voice, xem 4.29b). Piper và ONNX Runtime thêm ở
  **P2.4**, cố ý chưa khai để `pip install` không kéo về 200 MB wheel chưa dùng
- `pyinstaller` nằm ở `requirements-dev.txt` — chỉ cần lúc đóng gói, máy user
  không có Python nên không bao giờ chạy `pip` ở đó
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
  db/migrations.ts         Schema SQL theo version (KHÔNG sửa migration đã phát hành)
  db/migrator.ts           Runner theo PRAGMA user_version
  db/connection.ts         Instance dùng chung, WAL
  db/repositories/         MỌI SQL nằm ở đây — books / chapters / segments
  ipc/wrap.ts              Bọc handler → Result lỗi (test được, không cần Electron)
  ipc/registry.ts          Gắn vào ipcMain, từ chối channel chưa khai báo
  ipc/handlers/            app / settings / window / import / library / sidecar
                           / voices (tải chạy nền, chặn tải trùng)
  services/import-session.ts  Giữ tài liệu đã parse giữa lúc phân tích và xác nhận
  services/library.ts      Copy file + hash + dựng segment + lưu DB
  services/paths.ts        NGUỒN DUY NHẤT sinh path + chặn path traversal
  services/sidecar-paths.ts      Tìm sidecar: venv (dev) vs .exe (đóng gói)
  services/sidecar-process.ts    Spawn + bắt tay stdout + kill (hợp đồng 4.26)
  services/sidecar-client.ts     HTTP client — chỗ DUY NHẤT dựng URL sidecar
  services/sidecar-supervisor.ts Health check + chính sách restart (mục 4.27)
  services/sidecar-spawn.ts      Nối child_process thật (chỗ DUY NHẤT chạm nó)
  probe/                   Chạy thật với sidecar Python (KHÔNG trong pnpm test
                           — xem apps/main/probe/README.md)
  services/settings.ts     electron-store, file hỏng → rơi về mặc định từng field
  services/logger.ts       Log file + xoay vòng

apps/preload/src/
  api.ts                   window.api.* — không lộ ipcRenderer

apps/renderer/src/
  App.tsx                  Điều hướng 3 màn: thư viện / nhập sách / chi tiết
  lib/theme.ts             Logic theme thuần
  features/theme/          use-theme + ThemeToggle
  features/titlebar/       TitleBar + WindowControls
  features/import/
    ImportScreen.tsx       Chọn file → xác nhận
    ChapterConfirm.tsx     Danh sách chương + nút xác nhận
    ChapterRow.tsx         Một hàng: tên, khoảng trang, preview, tách/gộp/xoá
    confidence.ts          Điểm detector → nhãn; "trang" vs "đoạn"
  features/library/
    LibraryGrid.tsx        Grid sách, nút đọc tiếp
    BookCard.tsx           Thẻ sách + bìa tạm suy từ tên
    BookDetailView.tsx     Mục lục chương, đánh dấu chương đọc dở
    format.ts              Thời gian tương đối, chữ cái bìa
  stores/settings-store.ts Zustand, có bắt rejection IPC
  stores/import-store.ts   Bản nháp chương + hoàn tác
  stores/library-store.ts  Danh sách sách + sách đang mở
  stores/voice-store.ts    Catalog + tiến độ tải theo voiceId
  features/voices/
    VoiceManager.tsx       Màn quản lý giọng đọc
    VoiceRow.tsx           Một voice: thông tin + tải/huỷ/xoá + thanh tiến trình
    SidecarBadge.tsx       Trạng thái sidecar (chỗ ĐẦU TIÊN user thấy được)
    format.ts              Dung lượng, phần trăm, nhãn trạng thái (thuần)
  styles/theme.css         CSS variables — mọi màu lấy từ đây

resources/voices/catalog.json  Catalog voice — sha256 LẤY THẬT (mục 4.28).
                           Đóng gói qua extraResources, KHÔNG vào asar

sidecar/                   Dịch vụ TTS Python (venv riêng — mục 5.4)
  entry.py                 Điểm vào PyInstaller — import TUYỆT ĐỐI (mục 4.29a)
  build.py                 PyInstaller onedir → ln-sidecar.exe
  app/voices/catalog.py    Đọc catalog + soi đĩa (thuần, không mạng)
  app/voices/download.py   Tải + băm theo dòng chảy + dọn sạch khi hỏng
  app/config.py            Đọc env do main đặt lúc spawn; models dir BẮT BUỘC
  app/auth.py              Middleware X-Session-Token, so token thời gian hằng
  app/main.py              FastAPI: /health (không token), /normalize, /voices*
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
| Kiểm bản đóng gói vẫn làm thủ công | **Cao** | Quy trình CDP ở mục 4.19 chạy tay. P1.6c lại lộ thêm 2 lỗi nữa mà 1008 test không thấy (4.22, 4.23) — đây là lần thứ ba. Nên có ít nhất một script CDP chạy được bằng một lệnh, kiểm: mở PDF ra canvas có pixel, `getComputedStyle` của lớp `/opacity` khác `rgba(0,0,0,0)` |
| Không có test nào chặn lỗi màu trong suốt | **TB** | Lỗi 4.23 nằm im từ P1.6b. Test hiện chỉ kiểm class có mặt, không kiểm màu tính ra được. jsdom không tính CSS thật nên phải kiểm ở app đang chạy |
| Viewer PDF chưa có text layer | TB | Neo highlight vẽ bằng `rects` nên **không cần** text layer. Nhưng vậy user không bôi chọn hay copy chữ được. plan.md có nhắc "canvas + text layer" — để lại tới khi thật sự cần |
| Chưa có zoom / xoay trang | Thấp | Scale tính vừa bề ngang khung, trần 2×. Đủ đọc nhưng chưa cho user phóng to |
| HTML DOCX cache một sách trong RAM | Thấp | `reader.ts` giữ đúng một `BookHtml`; mở sách khác là convert lại (~200ms). Đổi lại là không phình `.db`, không migrate schema |
| Ảnh trong DOCX bị bỏ khi render | Thấp | `sanitizeDocxHtml` bỏ `<img>` (danh sách trắng không có). LN có minh hoạ sẽ mất ảnh ở viewer DOCX — PDF không bị vì vẽ cả trang |
| `import:*` chưa chặn đường dẫn tuỳ ý | TB | Renderer gọi `parseFile` với path bất kỳ và main sẽ đọc. Hiện chưa lộ ra ngoài (chỉ dialog gọi tới), nhưng khi thêm kéo-thả thì phải kiểm path qua `services/paths.ts` |
| Ngôn ngữ sách hardcode `'vi'` | **TB** | `import-store.save()` luôn gửi `lang: 'vi'`. Sách EN sẽ nhận voice sai ở Phase 2. Cần cho user chọn ở màn xác nhận — xem ghi chú P1.6b |
| Xoá sách không xoá file đã copy | TB | `library:removeBook` xoá bản ghi DB (chương/segment theo CASCADE) nhưng để lại file trong `libraryDir`. Cố ý dồn cho Storage Manager (Phase 2) xử lý cùng audio — một chỗ duy nhất chịu trách nhiệm dọn file |
| Chưa sinh ảnh bìa | Thấp | `Book.coverPath` có trong schema nhưng chưa ai ghi. Grid đang dùng bìa tạm (chữ cái đầu + sắc độ suy từ tên) |
| Segment dựng đồng bộ trong main | Thấp | 4817 segment mất ~400ms, chấp nhận được. Sách lớn hơn nhiều lần thì sẽ thấy đơ — lúc đó chuyển sang worker thread |
| DOCX chưa xử lý ảnh và bảng | Thấp | `extractBlocks` chỉ nhận `<h1>`–`<h6>` và `<p>`. File mẫu A4 có 2 `<img>` bị bỏ qua — chấp nhận được vì TTS không đọc ảnh, nhưng bảng có nội dung thì sẽ mất |
| DOCX không có outline | Thấp | mammoth không đọc bookmark/TOC field của Word. Chương chỉ nhận được qua heading style hoặc regex — đã đủ với 2 file mẫu |
| Sidecar chưa vào `pnpm test` chung | Thấp | pytest cần venv Python mà CI chưa dựng. `pnpm test:sidecar` chạy riêng, thiếu venv thì bỏ qua. Nối vào job `check` khi dựng venv trên CI (cùng lúc với `build.py`) |
| Probe chạy thật sidecar chưa vào CI | TB | `apps/main/probe/` đã tìm ra lỗi 4.27 nhưng phải gọi tay. Cần venv nên chưa nối vào CI được — nối cùng lúc với hàng trên. Đây là lần thứ tư "unit test xanh mà đường nối thật hỏng" |
| ~~Sidecar chưa đóng gói~~ | ✅ Xong | `build.py` + `extraResources` đã có. **Đã kiểm thật ở bản đóng gói**: sidecar `.exe` lên `ready`, tải voice 63 MB xong trong app đã build. Lộ ra 1 lỗi thật (mục 4.29a). Phần **CI** vẫn còn nợ — xem hàng dưới |
| ~~Renderer chưa hiện trạng thái sidecar~~ | ✅ Xong | `SidecarBadge` hiện ở màn Giọng đọc, có cả 5 trạng thái. Đã đo màu thật trong app đóng gói ở cả dark lẫn light |
| Đóng gói sidecar chưa vào CI | **Cao** | `pnpm build:win` **không** tự gọi `pnpm build:sidecar` — quên chạy thì installer ra vẫn thành công nhưng thiếu sidecar, hỏng lặng lẽ. Cố ý chưa nối vào vì PyInstaller cần venv Python mà CI chưa dựng; nối cùng lúc với `pnpm test:sidecar`. Trong lúc chờ: **luôn chạy `pnpm build:sidecar` trước `pnpm build:win`** |
| Chỉ có 2 voice trong catalog | Thấp | VI (`vais1000`) + EN (`lessac`), đều `medium`. Đủ cho P2.4, nhưng user muốn giọng khác thì phải sửa file — chưa có đường thêm voice từ UI |
| Tải voice không resume được | TB | Đứt giữa chừng là mất cả 63 MB, tải lại từ đầu. HF có hỗ trợ `Range` nên làm được, nhưng phải giữ trạng thái băm dở — băm theo dòng chảy hiện tại không nối tiếp được. Để lại tới khi thấy người dùng thật kêu |
| Nút "Giọng đọc" chỉ có ở màn thư viện | Thấp | Vào đọc sách rồi thì phải quay ra mới tải voice được. Hợp lý cho tới khi có nút generate trong reader (P2.6) |
| Supervisor chưa có backoff luỹ tiến | Thấp | Chờ cố định `SIDECAR_RESTART_DELAY_MS` (1s) giữa các lần thử. Với trần 3 lượt thì đủ; nếu sau này nới trần thì nên tăng dần để không dội liên tục |
| Normalize chưa kiểm trên sách EN gốc | Thấp | 2429 segment thật đã chạy qua, nhưng phần EN lấy từ **LN dịch** (`A2`), không phải văn bản Anh bản ngữ. Số thứ tự, `Mr./Mrs.`, năm kiểu Anh mới chỉ có unit test |
| Chưa có luật normalize cho ký tự Nhật còn sót | Thấp | LN dịch đôi khi giữ nguyên `〜`, furigana trong ngoặc. Chưa gặp ở 2429 segment mẫu nên chưa viết luật — đợi thấy thật rồi làm |
| Cleaner chưa xử lý cột đôi trải qua nhiều trang | Thấp | `detectColumnLayout` xét từng trang độc lập; sách đổi bố cục giữa chương vẫn đúng, nhưng trang có đúng 1 dòng mỗi cột thì rơi về `single` |
