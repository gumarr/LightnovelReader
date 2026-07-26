# Tiến độ — LN Reader

> File này ghi lại **trạng thái công việc** để phiên làm việc sau tiếp tục được ngay.
> Kế hoạch tổng thể ở [plan.md](plan.md), quy tắc code ở [CLAUDE.md](CLAUDE.md).
>
> **Cập nhật lần cuối:** 2026-07-26 · commit `a48f3fc`
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

# Đóng gói sidecar thành .exe (BẮT BUỘC chạy TRƯỚC pnpm build:win — mục 4.29)
pnpm build:sidecar
```

Nếu `pnpm dev` không mở được cửa sổ: xem **mục 5.2** (biến `ELECTRON_RUN_AS_NODE`).

**Việc tiếp theo:** Phase 3 — Player & Subtitle sync (xem mục 3).
**Phase 1 xong. Phase 2 xong đủ 7/7 phần — DoD đạt, đã kiểm trên app đang chạy.**

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

### Số liệu hiện tại

| Chỉ số | Giá trị |
|---|---|
| Unit test TypeScript | **1594 passed** (+140 ở P2.7) |
| Unit test sidecar (pytest) | **345 passed** (không đổi — P2.7 không đụng sidecar) |
| Chạy thật sidecar (probe, ngoài `pnpm test`) | 13 kịch bản (+2 ở P2.7) |
| Typecheck | Sạch (5 package) |
| Lint | Sạch (0 warning) |
| Sidecar `.exe` (onedir) | **145 MB** (29 → 145 vì ONNX Runtime + espeak data) |

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
| P2.4 | Piper engine + `/synthesize` → ogg, bitrate configurable | ✅ Xong |
| P2.5 | Job queue persist SQLite: priority, pause/resume/cancel | ✅ Xong |
| P2.6 | Generate theo chương + prefetch + ước lượng "cả sách" | ✅ Xong |
| P2.7 | Storage Manager: xem/xoá theo sách-chương, đổi thư mục, cảnh báo | ✅ Xong |

**DoD Phase 2 — đạt đủ, kiểm trên app đang chạy** (không chỉ unit test):

| Mục DoD | Trạng thái |
|---|---|
| Generate chương 1 → có audio | ✅ 190/195 đoạn trên sách DOCX thật, file `.ogg` magic `OggS` |
| Phát được | ✅ file giải mã được, có timing từng từ (`source: "phoneme"`). **UI player là Phase 3** |
| Xem được dung lượng | ✅ theo sách và theo chương, số DB khớp đĩa từng byte |
| Xoá được dung lượng | ✅ xoá 380 file qua UI, tiến độ đọc và cấu trúc chương còn nguyên |

Còn một mục **chưa** làm: kiểm trên **bản đóng gói** (`pnpm build:win`). Lần này
kiểm ở `pnpm dev`, tức đã thấy CSS thật và IPC thật nhưng chưa thấy lỗi đường
dẫn kiểu asar. Xem mục 8.

### Ghi chú cho Phase 3 (Player & Subtitle sync)

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
  db/repositories/         MỌI SQL nằm ở đây — books / chapters / segments / jobs
                           segments: pendingStats* đếm ký tự bằng SQL, không kéo
                           text lên (một vol ~4800 segment)
  ipc/wrap.ts              Bọc handler → Result lỗi (test được, không cần Electron)
  ipc/registry.ts          Gắn vào ipcMain, từ chối channel chưa khai báo
  ipc/handlers/            app / settings / window / import / library / sidecar
                           / voices (tải chạy nền, chặn tải trùng)
                           / queue (9 channel, handler mỏng — policy ở service)
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
                           — xem apps/main/probe/README.md)
  services/storage.ts      CHỖ DUY NHẤT xoá file của user (audio, timing, bản copy
                           sách). Xoá file trước, DB sau — mục 4.39
  services/settings.ts     electron-store, file hỏng → rơi về mặc định từng field
  services/logger.ts       Log file + xoay vòng

apps/preload/src/
  api.ts                   window.api.* — không lộ ipcRenderer

apps/renderer/src/
  App.tsx                  Điều hướng: thư viện / nhập sách / chi tiết / đọc /
                           giọng đọc / dung lượng
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
  stores/queue-store.ts    Hàng đợi generate + chống prefetch trùng
  stores/storage-store.ts  Dung lượng + xoá; giữ lỗi qua lượt nạp lại
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
  app/audio/resample.py    Polyphase 22050→24000 — Opus không nhận 22050 (4.30)
  app/audio/encode.py      Opus trong .ogg; bảng bitrate ĐO thật (4.31)
  app/audio/timings.py     Phoneme alignment → WordTiming, có lưới an toàn (4.32)
  app/audio/paths.py       Chặn ghi ra ngoài audioDir (4.33)
  app/engines/piper.py     Chỗ DUY NHẤT import piper. Cache model, tự khoá luồng
  app/config.py            Đọc env do main đặt lúc spawn; models dir BẮT BUỘC
  app/auth.py              Middleware X-Session-Token, so token thời gian hằng
  app/main.py              FastAPI: /health (không token), /normalize, /voices*,
                           /synthesize (một SEGMENT mỗi lần, chạy thread riêng)
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
| ~~Xoá sách không xoá file đã copy~~ | ✅ Xong | P2.7: `library:removeBook` gọi `storage.removeBookFiles()` — xoá bản copy trong `libraryDir` **và** cả thư mục audio. Xoá DB trước, file sau (mục 4.39). Lỗi xoá file không làm hỏng lượt xoá sách |
| Chưa sinh ảnh bìa | Thấp | `Book.coverPath` có trong schema nhưng chưa ai ghi. Grid đang dùng bìa tạm (chữ cái đầu + sắc độ suy từ tên) |
| Segment dựng đồng bộ trong main | Thấp | 4817 segment mất ~400ms, chấp nhận được. Sách lớn hơn nhiều lần thì sẽ thấy đơ — lúc đó chuyển sang worker thread |
| DOCX chưa xử lý ảnh và bảng | Thấp | `extractBlocks` chỉ nhận `<h1>`–`<h6>` và `<p>`. File mẫu A4 có 2 `<img>` bị bỏ qua — chấp nhận được vì TTS không đọc ảnh, nhưng bảng có nội dung thì sẽ mất |
| DOCX không có outline | Thấp | mammoth không đọc bookmark/TOC field của Word. Chương chỉ nhận được qua heading style hoặc regex — đã đủ với 2 file mẫu |
| Sidecar chưa vào `pnpm test` chung | Thấp | pytest cần venv Python mà CI chưa dựng. `pnpm test:sidecar` chạy riêng, thiếu venv thì bỏ qua. Nối vào job `check` khi dựng venv trên CI (cùng lúc với `build.py`) |
| Probe chạy thật sidecar chưa vào CI | TB | `apps/main/probe/` đã tìm ra lỗi 4.27 nhưng phải gọi tay. Cần venv nên chưa nối vào CI được — nối cùng lúc với hàng trên. Đây là lần thứ tư "unit test xanh mà đường nối thật hỏng" |
| ~~Sidecar chưa đóng gói~~ | ✅ Xong | `build.py` + `extraResources` đã có. **Đã kiểm thật ở bản đóng gói**: sidecar `.exe` lên `ready`, tải voice 63 MB xong trong app đã build. Lộ ra 1 lỗi thật (mục 4.29a). Phần **CI** vẫn còn nợ — xem hàng dưới |
| ~~Renderer chưa hiện trạng thái sidecar~~ | ✅ Xong | `SidecarBadge` hiện ở màn Giọng đọc, có cả 5 trạng thái. Đã đo màu thật trong app đóng gói ở cả dark lẫn light |
| Đóng gói sidecar chưa vào CI | **Cao** | `pnpm build:win` **không** tự gọi `pnpm build:sidecar` — quên chạy thì installer ra vẫn thành công nhưng thiếu sidecar, hỏng lặng lẽ. Cố ý chưa nối vào vì PyInstaller cần venv Python mà CI chưa dựng; nối cùng lúc với `pnpm test:sidecar`. Trong lúc chờ: **luôn chạy `pnpm build:sidecar` trước `pnpm build:win`**. P2.4 lại xác nhận rủi ro này: `.exe` hỏng mà 340 test vẫn xanh (mục 4.34) |
| Chưa dựng lại installer sau P2.4/P2.5 | TB | `.exe` sidecar **đã** build và chạy thật (bắt tay, `/synthesize`, `.ogg` nghe được). Nhưng `pnpm build:win` chưa chạy lại nên chưa biết installer mới bao nhiêu MB và electron-builder có chép trọn 145 MB onedir không. P2.5 không đụng sidecar nên rủi ro không tăng thêm |
| Chỉ có 2 voice trong catalog | Thấp | VI (`vais1000`) + EN (`lessac`), đều `medium`. Đủ cho P2.4, nhưng user muốn giọng khác thì phải sửa file — chưa có đường thêm voice từ UI |
| Tải voice không resume được | TB | Đứt giữa chừng là mất cả 63 MB, tải lại từ đầu. HF có hỗ trợ `Range` nên làm được, nhưng phải giữ trạng thái băm dở — băm theo dòng chảy hiện tại không nối tiếp được. Để lại tới khi thấy người dùng thật kêu |
| Nút "Giọng đọc" chỉ có ở màn thư viện | Thấp | Vào đọc sách rồi thì phải quay ra mới tải voice được. Hợp lý cho tới khi có nút generate trong reader (P2.6) |
| Supervisor chưa có backoff luỹ tiến | Thấp | Chờ cố định `SIDECAR_RESTART_DELAY_MS` (1s) giữa các lần thử. Với trần 3 lượt thì đủ; nếu sau này nới trần thì nên tăng dần để không dội liên tục |
| ~~**`timings` chưa ghi ra đĩa**~~ | ✅ Xong | `services/timings-store.ts` ghi `{audioDir}/{bookId}/{segmentId}.json` (ghi `.part` rồi rename). **Đã kiểm thật**: 3 segment × 13–14 từ, `durationMs` khớp DB |
| ~~Chưa có màn hình nào gọi `queue:*`~~ | ✅ Xong | `GenerateControls` gọi 8/12 channel từ trình đọc và màn chi tiết sách. Còn `queue:listPending` và `queue:cancelJob` chưa có UI — xem hàng dưới |
| ~~Chưa có UI chọn giọng đọc~~ | ✅ Xong | Nút "Dùng giọng này" ở `VoiceRow`, chỉ hiện với voice **đã cài**. Xoá voice đang chọn thì tự bỏ chọn, nên settings không bao giờ trỏ tới model đã mất |
| ~~P2.6 UI chưa mở app thật lần nào~~ | ✅ Xong | P2.7 đã kiểm ở `pnpm dev` bằng CDP: hộp ước lượng, thanh tiến độ, generate 190 đoạn thật, prefetch, xoá 380 file. Đo `getComputedStyle` ở **cả dark lẫn light** — không màu nào trong suốt. Phần **bản đóng gói** vẫn còn nợ, xem hàng dưới |
| UI Phase 2 chưa kiểm trên bản đóng gói | **Cao** | Đã kiểm ở `pnpm dev` (thấy CSS thật + IPC thật) nhưng **chưa** `pnpm build:win`. Bản dev không lộ được lỗi đường dẫn kiểu asar — đúng loại lỗi 4.19 và 4.29a. Phải chạy `pnpm build:sidecar` trước rồi `pnpm build:win`, mở `.exe` và đi lại luồng: nhập sách → generate → xem/xoá dung lượng |
| Quy trình kiểm UI bằng CDP vẫn viết tay mỗi lần | **TB** | P2.7 lái app qua `--remote-debugging-port=9222` + `Runtime.evaluate`, nhưng script là file tạm rồi xoá. Lần thứ năm làm lại từ đầu. Nên có `scripts/ui-check.mjs` cố định: mở app, đi luồng, đo `getComputedStyle` những token màu, chụp ảnh cả 2 theme |
| Xoá 1 chương huỷ job của CẢ sách | Thấp | Hàng đợi không có `cancelByChapter` nên `storage:deleteChapterAudio` gọi `cancelBook` (mục 4.41). Quá tay: job của chương khác bị huỷ oan rồi phải xếp lại. Đổi được nếu thêm `cancelByChapter` vào `jobs.ts` |
| `deleteReadAudio` chưa có nút trong UI | TB | Handler + service + 5 test đã có (xoá chương **trước** chương đang đọc), nhưng `StorageManager` chưa gọi. plan.md có nhắc nút "Xoá audio các chương đã đọc xong" — thiếu chỗ bấm thì tính năng không tồn tại với user |
| Ngưỡng cảnh báo nhỏ nhất là 2 GB | Thấp | Nhánh `near`/`over` chỉ tới được khi user có >1.6 GB audio. Đúng với app này (1 vol ≈ 97 MB → cảnh báo ở ~16 vol) nhưng nghĩa là đường cảnh báo hiếm khi chạy thật. Đã kiểm bằng cách hạ ngưỡng qua IPC: thanh 100%, fill đổi đỏ, câu cảnh báo đúng |
| Lớp phủ hộp thoại chỉ mờ 70% | Thấp | `bg/0.7` nên chữ dưới vẫn lộ quanh mép hộp, hơi nhiễu mắt — thấy rõ trên ảnh chụp dark. Cả `GenerateEstimateDialog` (P2.6) lẫn `DeleteAudioDialog` dùng cùng mẫu nên ít nhất là nhất quán |
| `getUsage` quét cả thư mục audio mỗi lần gọi | Thấp | Một vol có ~9600 file; `stat` từng file để so DB với đĩa. Với 1–2 sách thì tức thời, nhưng thư viện 50 vol sẽ thấy chậm khi mở màn Dung lượng. Lúc đó nên cache theo `mtime` của thư mục hoặc chỉ quét khi user bấm "dọn rác" |
| Không có UI cho bảng hàng đợi | TB | `queue:listPending` (trần 200 job) và `queue:cancelJob` (huỷ **một** job) vẫn chưa ai gọi. Hiện chỉ huỷ được cả sách hoặc tất cả. Đủ dùng cho P2.6 nhưng user không thấy được job nào đang hỏng |
| Prefetch không huỷ khi rời sách | Thấp | Đọc tới 80% chương 3 rồi đóng sách thì chương 4 vẫn generate xong trong nền. Không sai — audio đó vẫn dùng được sau này — nhưng tốn CPU cho việc user không còn cần. `queue:cancelBook` đã có sẵn nếu muốn đổi |
| `prefetched` mất khi reload renderer | Thấp | Danh sách chương đã prefetch giữ trong store, không persist. Reload thì prefetch lại chương đó — nhưng `enqueueChapter` tự lọc segment đã `ready` nên chỉ tốn một lượt IPC, không sinh job trùng |
| ~~Bitrate trong settings chưa ai đọc~~ | ✅ Xong | Hàng đợi truyền `AppSettings.bitrate` xuống mỗi job. **Đo trên file thật**: 16 kbps → 6797 B, 32 kbps → 12574 B cho cùng một câu |
| Sidecar `.exe` 29 → 145 MB | TB | ONNX Runtime + espeak-ng data (mọi ngôn ngữ, gồm `ru_dict` 9 MB) + numpy. Installer sẽ vượt mốc 200 MB của plan.md. Cắt được: loại bớt `espeak-ng-data/*_dict` không dùng (chỉ cần `vi`, `en`) — nhưng phải chắc piper không nạp động cái nào khác trước khi cắt |
| Hàng đợi không tự chạy lại sau khi sidecar hồi phục | TB | `index.ts` gọi `queue.resume()` khi sidecar về `ready`, nhưng **chưa kiểm thật** đường này: probe dựng queue riêng chứ không qua `index.ts`. Kiểm khi P2.6 có UI để giết sidecar giữa lúc generate |
| Retry không có backoff | Thấp | Job hỏng quay lại hàng đợi và có thể được `claimNext` ngay lượt sau — 3 lượt thử cháy hết trong vài chục ms nếu lỗi là tức thời (sidecar từ chối luôn). Đủ dùng vì `markError` vẫn đếm đúng, nhưng lỗi tạm thời (mạng, khoá file) sẽ không kịp qua cơn |
| Nút "Giọng đọc" vẫn phải quay ra thư viện | Thấp | Trình đọc đã có nút generate (P2.6) nhưng khi báo "chưa chọn giọng" thì user phải tự quay ra màn thư viện rồi vào Giọng đọc. Nên có đường tắt ngay từ thông báo đó |
| Job `align` khai trong schema nhưng chưa dùng | Thấp | `JobType` có `'align'` từ schema v1, hàng đợi hiện chỉ tạo job `'synthesize'`. Dành cho CTC forced alignment ở Phase 4 — `findActiveBySegment` đã nhận `type` nên không phải sửa gì thêm lúc đó |
| Engine chỉ giữ MỘT voice trong RAM | Thấp | Sách VI và EN xen kẽ sẽ nạp lại model mỗi lần đổi (~1.5 s). Giữ hai model là ~400 MB RAM. Chấp nhận được vì generate thường chạy theo cả chương cùng một giọng |
| Timing chưa kiểm trên giọng EN | TB | Cách gộp phoneme → từ mới đo thật trên `vi_VN-vais1000-medium`. Voice EN chưa tải nên chưa biết espeak tách từ tiếng Anh có khớp regex `\w+` không (viết tắt `Mr.`, sở hữu cách `John's`). Có lưới an toàn nên không vỡ, nhưng có thể rơi về `estimate` nhiều hơn cần thiết |
| ~~`SYNTHESIS_RTF_ESTIMATE` chưa hiệu chỉnh~~ | ✅ Xong | Đã đối chiếu với số đo thật ở P2.6: ước 1680 ms vs thật 2045 ms (**RTF thật 0.24** gồm nạp model). Lệch +22% → giữ nguyên 0.15. Dung lượng lệch −15%, thời lượng −24%. Probe khoá lại ngưỡng 0.25–4× để hằng số không âm thầm sai bản chất |
| Normalize chưa kiểm trên sách EN gốc | Thấp | 2429 segment thật đã chạy qua, nhưng phần EN lấy từ **LN dịch** (`A2`), không phải văn bản Anh bản ngữ. Số thứ tự, `Mr./Mrs.`, năm kiểu Anh mới chỉ có unit test |
| Chưa có luật normalize cho ký tự Nhật còn sót | Thấp | LN dịch đôi khi giữ nguyên `〜`, furigana trong ngoặc. Chưa gặp ở 2429 segment mẫu nên chưa viết luật — đợi thấy thật rồi làm |
| Cleaner chưa xử lý cột đôi trải qua nhiều trang | Thấp | `detectColumnLayout` xét từng trang độc lập; sách đổi bố cục giữa chương vẫn đúng, nhưng trang có đúng 1 dòng mỗi cột thì rơi về `single` |
