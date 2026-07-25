# Tiến độ — LN Reader

> File này ghi lại **trạng thái công việc** để phiên làm việc sau tiếp tục được ngay.
> Kế hoạch tổng thể ở [plan.md](plan.md), quy tắc code ở [CLAUDE.md](CLAUDE.md).
>
> **Cập nhật lần cuối:** 2026-07-25 · commit `(P1.6a)`
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

**Việc tiếp theo:** P1.6b — Library grid + resume (xem mục 3).

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

### Số liệu hiện tại

| Chỉ số | Giá trị |
|---|---|
| Unit test | **817 passed** (+94 từ P1.6a) |
| Typecheck | Sạch (5 package) |
| Lint | Sạch (0 warning) |
| Installer | 82 MB |

---

## 3. Việc tiếp theo — Phase 1

Thứ tự đã thống nhất: **logic thuần trước, UI sau**. Mỗi phần làm xong phải có
unit test riêng và chạy `pnpm typecheck && pnpm lint && pnpm test` trước khi commit.

| Mã | Nội dung | Trạng thái |
|---|---|---|
| P1.1 | Segmenter (tách câu, gom segment) | ✅ Xong |
| P1.2 | Cleaner — header/footer lặp, de-hyphenate, merge dòng, cột đôi | ✅ Xong |
| P1.3 | Chapter detector — mỗi tín hiệu 1 hàm thuần + test riêng, trả điểm số | ✅ Xong |
| P1.4 | Parser PDF + DOCX, interface `DocumentParser` chung | ✅ Xong |
| P1.5 | Màn hình "Xác nhận cấu trúc chương" — merge/split/rename/xóa | ✅ Xong |
| P1.6a | Lưu sách + dựng segment vào DB | ✅ Xong |
| **P1.6b** | **Library grid + resume** | ⬅️ **Tiếp theo** |
| P1.6c | Viewer (PDF canvas + text layer, DOCX HTML) | ⬜ |

**DoD Phase 1:** Mở PDF & DOCX, thấy danh sách chương đúng, sửa được, thấy segment.

### Ghi chú cho P1.6b (Library grid + resume)

Tầng dữ liệu đã xong: sách/chương/segment vào được DB và đọc lại đúng.
`library:list` đã có sẵn, trả `LibraryEntry[]` kèm số chương/segment.

Việc phải làm:

1. **Library grid** thay `SavedPanel` trong `App.tsx`. Dữ liệu lấy từ
   `window.api.library.list()`.
2. **Resume**: `books.markOpened(id, at, lastSegmentId)` đã có ở repository,
   chỉ cần thêm kênh IPC và gọi khi user mở sách.
3. Chưa có kênh **xoá sách** — `BookRepository.remove` đã viết và có test
   CASCADE, nhưng chưa expose qua IPC.

Lưu ý:

- **Ngôn ngữ sách đang hardcode `'vi'`** trong `import-store.save()`. Cần cho
  user chọn ở màn xác nhận hoặc đoán từ nội dung — ảnh hưởng trực tiếp tới
  voice TTS ở Phase 2.
- Chưa có ảnh bìa. `Book.coverPath` có trong schema nhưng chưa ai ghi vào;
  grid sẽ cần placeholder.
- `ParsedDocument.hasRealPages` = false với DOCX → **đừng hiện "trang X–Y"**.
  `features/import/confidence.ts` có sẵn `rangeLabel()` lo việc này.

### Ghi chú cho P1.6c (Viewer)

Đã thống nhất với user: **pdfjs chạy trong renderer**, main chỉ cấp bytes qua
IPC. Lý do: renderer có `DOMMatrix`/`Path2D` thật của Chromium nên không dính
hai lỗi ở mục 4.19; renderer vẫn không chạm `fs`.

- Neo đã sẵn sàng: `SegmentAnchor` PDF có `page` + `rects` (toạ độ trong không
  gian trang, gốc góc **trên**-trái). Nhân với scale của viewport là ra vị trí
  trên canvas.
- DOCX có `nodePath = "p:<index>"` — index chính là thứ tự paragraph mammoth
  sinh ra, viewer render theo đúng thứ tự đó là khớp.
- `scoreCandidates()` → điểm **từng tín hiệu**, chưa dùng ở UI. Để dành cho
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
  ipc/handlers/            app / settings / window / import / library
  services/import-session.ts  Giữ tài liệu đã parse giữa lúc phân tích và xác nhận
  services/library.ts      Copy file + hash + dựng segment + lưu DB
  services/paths.ts        NGUỒN DUY NHẤT sinh path + chặn path traversal
  services/settings.ts     electron-store, file hỏng → rơi về mặc định từng field
  services/logger.ts       Log file + xoay vòng

apps/preload/src/
  api.ts                   window.api.* — không lộ ipcRenderer

apps/renderer/src/
  App.tsx                  Shell → ImportScreen (Library thay vào ở P1.6)
  lib/theme.ts             Logic theme thuần
  features/theme/          use-theme + ThemeToggle
  features/titlebar/       TitleBar + WindowControls
  features/import/
    ImportScreen.tsx       Chọn file → xác nhận
    ChapterConfirm.tsx     Danh sách chương + nút xác nhận
    ChapterRow.tsx         Một hàng: tên, khoảng trang, preview, tách/gộp/xoá
    confidence.ts          Điểm detector → nhãn; "trang" vs "đoạn"
  stores/settings-store.ts Zustand, có bắt rejection IPC
  stores/import-store.ts   Bản nháp chương + hoàn tác
  styles/theme.css         CSS variables — mọi màu lấy từ đây

scripts/
  copy-pdf-worker.mjs      Chép pdf.worker.mjs vào dist (BẮT BUỘC — mục 4.19)
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
| Kiểm bản đóng gói vẫn làm thủ công | TB | Quy trình CDP ở mục 4.19 chạy tay. Nên đưa vào CI như bước smoke test hiện có, nếu không lỗi kiểu 4.19 sẽ lại lọt |
| `import:*` chưa chặn đường dẫn tuỳ ý | TB | Renderer gọi `parseFile` với path bất kỳ và main sẽ đọc. Hiện chưa lộ ra ngoài (chỉ dialog gọi tới), nhưng khi thêm kéo-thả thì phải kiểm path qua `services/paths.ts` |
| Ngôn ngữ sách hardcode `'vi'` | **TB** | `import-store.save()` luôn gửi `lang: 'vi'`. Sách EN sẽ nhận voice sai ở Phase 2. Cần cho user chọn ở màn xác nhận — xem ghi chú P1.6b |
| Chưa có kênh xoá sách | Thấp | `BookRepository.remove` đã viết + test CASCADE, nhưng chưa expose qua IPC |
| Chưa sinh ảnh bìa | Thấp | `Book.coverPath` có trong schema nhưng chưa ai ghi. Library grid sẽ cần placeholder |
| Segment dựng đồng bộ trong main | Thấp | 4817 segment mất ~400ms, chấp nhận được. Sách lớn hơn nhiều lần thì sẽ thấy đơ — lúc đó chuyển sang worker thread |
| DOCX chưa xử lý ảnh và bảng | Thấp | `extractBlocks` chỉ nhận `<h1>`–`<h6>` và `<p>`. File mẫu A4 có 2 `<img>` bị bỏ qua — chấp nhận được vì TTS không đọc ảnh, nhưng bảng có nội dung thì sẽ mất |
| DOCX không có outline | Thấp | mammoth không đọc bookmark/TOC field của Word. Chương chỉ nhận được qua heading style hoặc regex — đã đủ với 2 file mẫu |
| Cleaner chưa xử lý cột đôi trải qua nhiều trang | Thấp | `detectColumnLayout` xét từng trang độc lập; sách đổi bố cục giữa chương vẫn đúng, nhưng trang có đúng 1 dòng mỗi cột thì rơi về `single` |
