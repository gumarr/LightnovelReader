# LN Reader — Plan phát triển

Ứng dụng desktop đọc Light Novel với TTS local (Tiếng Việt / Tiếng Anh), phụ đề đồng bộ theo từ, hiển thị song song trang gốc.

- **Nền tảng:** Windows x64
- **License:** MIT (mã nguồn mở, dự án cá nhân, không kinh doanh)
- **Code signing:** Không mua cert. Chấp nhận SmartScreen warning, README hướng dẫn "More info → Run anyway"

---

## 1. Quyết định kiến trúc

| Hạng mục | Lựa chọn | Lý do |
|---|---|---|
| Shell | **Electron 32+** | Cần render PDF gốc, WebAudio, dễ bundle sidecar |
| UI | React 18 + TypeScript + Vite + Tailwind + shadcn/ui | Dark/Light mode sẵn |
| State | Zustand + TanStack Query | Nhẹ, đủ dùng |
| DB | **SQLite (better-sqlite3)** | Metadata sách, chương, segment, timing, job queue |
| Parse PDF | `pdfjs-dist` (text layer + render canvas) | Vừa lấy text vừa render trang |
| Parse DOCX | `mammoth` → HTML → normalize | Giữ heading để chia chương |
| EPUB (phase 6) | `epubjs` + `jszip` | Cắm vào cùng interface Parser |
| TTS backend | **Python sidecar** (FastAPI + ONNX Runtime) | Linh hoạt đổi model |
| TTS model VI | **Piper** `vi_VN-vais1000-medium` | CPU realtime, ~63MB |
| TTS model EN | **Piper** `en_US-libritts_r-medium`, `en_US-amy-medium` | Chất lượng tốt trên CPU |
| Forced alignment | **CTC aligner** (`wav2vec2` MMS, ONNX quantized) | MFA quá nặng để bundle |
| Audio | Opus trong `.ogg`, bitrate configurable (16/24/32 kbps) | Nhỏ, seek tốt |
| Đóng gói | electron-builder NSIS + portable, Python embed | Không cần user cài Python |

### Vì sao Piper thay vì Kokoro/XTTS/F5-TTS
- **Kokoro-82M**: chất lượng cao hơn nhưng **chưa có voice Tiếng Việt chính thức** → loại cho VI.
- **XTTS-v2 / F5-TTS**: cần GPU để realtime, XTTS license phi thương mại → loại.
- **Piper**: ONNX thuần, RTF ~0.05–0.15 trên CPU desktop, có voice VI/EN sẵn, MIT license, model nhỏ dễ tải trong app.
- Kiến trúc `TTSEngine` interface → có thể thêm Kokoro cho EN ở phase sau mà không đổi core.

### Forced alignment — phương án thực tế
MFA (Montreal Forced Aligner) cần Kaldi + conda, ~2GB → không hợp bundle desktop.

**Giải pháp:** CTC forced alignment bằng model `wav2vec2` đa ngôn ngữ (`MahmoudAshraf/mms-300m-1130-forced-aligner`, ONNX-quantized ~300MB) chạy CPU.

Pipeline:
1. Piper synth từng **segment** (1–3 câu) → wav 22050Hz
2. Timing ước lượng theo tỉ lệ độ dài từ → dùng được **ngay lập tức**
3. CTC aligner chạy background → word timestamps chính xác, ghi đè timing ước lượng
4. Lưu `timings.json`, `alignStatus` cập nhật realtime lên UI

> Aligner degrade nghiêm trọng với audio > 30s → đây là lý do segment phải nhỏ.
> User có thể tắt alignment trong Settings (chế độ "Fast") hoặc không tải model aligner.

---

## 2. Chiến lược chia nhỏ nội dung (quan trọng nhất)

Một vol LN 200–300 trang ≈ 8–10 giờ audio. **Không bao giờ generate cả file một lúc.**

### Ba tầng chia

| Tầng | Kích thước | Vai trò |
|---|---|---|
| **Chapter** | 10–30 trang | Đơn vị **UI/quản lý**: chọn generate, xóa audio, xem tiến độ. KHÔNG phải đơn vị audio |
| **Segment** | 1–3 câu, ≤ 300 ký tự (~10s audio) | Đơn vị **generate + align + seek**. 1 file `.ogg` + 1 `timings.json` |
| **Word** | 1 từ | Đơn vị **highlight** |

Một chương 20 trang ≈ 400–600 segment.

**Tại sao segment nhỏ, không phải một file/chương:**
- Aligner CTC chính xác với audio ~10s, degrade mạnh khi > 30s
- Resume tức thì: thoát giữa chương, mở lại phát đúng segment
- Generate incremental: đang nghe segment 50 thì 51–60 sinh nền, không chờ 20 phút cả chương
- Lỗi 1 segment mất 10s, không mất cả chương
- Sửa typo 1 câu → regenerate 1 segment

**Nhược điểm & xử lý:** ~600 file nhỏ/chương. V1 để file rời (NTFS xử lý tốt). Nếu đo thấy chậm, phase sau gộp thành container: nối segment vào 1 `.ogg` liên tục theo chương + lưu byte/time offset trong DB.

### Chia chapter — DOCX

Độ tin cậy cao, theo thứ tự ưu tiên:
1. **Heading style** (`Heading 1` / `Heading 2`) — tin cậy nhất
2. Không có heading: paragraph ngắn + in đậm + đứng riêng, regex `^(Chương|Chapter|Vol|Tập|Phần)\s*\d+`
3. Page break thủ công (`w:br w:type="page"`)

### Chia chapter — PDF

Chấm điểm tổng hợp từ nhiều tín hiệu:

1. **Outline/bookmark** (`pdf.getOutline()`) — nếu có, dùng luôn, chính xác ~95%
2. **Font size heuristic** — tính median font size của body; dòng có size > 1.3× median, ngắn (< 80 ký tự), đứng đầu trang hoặc sau khoảng trắng lớn → ứng viên tiêu đề
3. **Regex tiêu đề** — VI: `Chương|Chương thứ|Phần|Hồi|Tập`; EN: `Chapter|Part|Prologue|Epilogue|Interlude`; kèm số Ả Rập / La Mã / chữ
4. **Vị trí dọc** — text bắt đầu ở 1/3 trên trang, sau một trang gần trống
5. **Fallback** — không phát hiện được gì → chia theo trang (mặc định 15 trang), đặt tên "Phần 1", "Phần 2"

### Màn hình "Xác nhận cấu trúc chương" — BẮT BUỘC

Sau khi detect, **luôn** cho user xem và sửa trước khi generate:
- Danh sách chương: tên, khoảng trang, số segment ước tính, preview 2 dòng đầu
- Thao tác: merge, split, đổi tên, xóa chương
- Loại trừ: bìa, mục lục, lời bạt, quảng cáo
- Preview & sửa text thô nếu PDF parse lỗi

Một lần setup 30 giây, tránh generate sai 10 giờ audio.

### Làm sạch text trước segment

- **Header/footer lặp**: text xuất hiện cùng vị trí trên > 60% số trang → page number / tên sách chạy đầu trang → loại
- **De-hyphenate**: từ bị ngắt cuối dòng (`nhân-\nvật`) → nối lại
- **Merge dòng**: dòng không kết thúc bằng dấu câu → nối với dòng sau
- **Cột đôi**: detect theo x-position, sắp xếp lại thứ tự đọc

### Chiến lược generate

- **Mặc định**: generate chương hiện tại + prefetch chương kế tiếp khi đọc đến 80%
- **Nút "Generate cả sách"**: có, nhưng kèm ước lượng — "~9.2 giờ audio, ~980 MB, ~45 phút xử lý"
- **Queue persist trong SQLite**: đóng app mở lại vẫn tiếp tục
- **Priority queue**: segment sắp phát nhảy lên đầu hàng đợi
- **Pause/resume/cancel** job bất cứ lúc nào

---

## 3. Kích thước & quản lý dung lượng

### Installer

| Thành phần | Size | Trong installer? |
|---|---|---|
| Electron + Chromium | ~180 MB | ✅ |
| Renderer bundle + pdfjs | ~15 MB | ✅ |
| better-sqlite3 native | ~5 MB | ✅ |
| Python 3.11 embed + FastAPI | ~40 MB | ✅ |
| ONNX Runtime CPU | ~50 MB | ✅ |
| piper-phonemize + espeak-ng data | ~25 MB | ✅ |
| **Tổng** | **~315 MB** (nén NSIS **~130–160 MB**) | |
| Voice VI medium | ~63 MB | ⬇️ tải sau |
| Voice EN medium | ~63 MB | ⬇️ tải sau |
| CTC aligner quantized | ~300 MB | ⬇️ tải sau, optional |

**Mục tiêu: installer < 200 MB nén.** Model tải riêng từ Hugging Face (`rhasspy/piper-voices`) — băng thông của họ, không phải của mình. User chỉ đọc VI không cần tải voice EN. Update app không phải tải lại model.

### Audio — mới là phần lớn

1 vol LN ≈ 8–10 giờ ≈ **800 MB – 1.2 GB** ở Opus 24 kbps.

**Storage Manager (Phase 2, không để sau):**
- Bitrate configurable: 16 / 24 / 32 kbps, mặc định 24
- Xem dung lượng theo sách / theo chương
- Xóa audio từng chương, giữ metadata & tiến độ đọc
- Cảnh báo khi thư mục audio vượt ngưỡng user đặt
- Đổi thư mục lưu audio sang ổ khác
- Nút "Xóa audio các chương đã đọc xong"

---

## 4. Cấu trúc thư mục

```
ln-reader/
├─ .claude/
│  ├─ CLAUDE.md
│  ├─ settings.json
│  └─ commands/
├─ apps/
│  ├─ main/                  # Electron main process
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ ipc/             # handlers theo domain
│  │  │  ├─ sidecar/         # spawn + health check python
│  │  │  ├─ db/              # migrations, repositories
│  │  │  ├─ queue/           # job queue persist SQLite
│  │  │  └─ services/        # paths, storage, library
│  │  └─ package.json
│  ├─ preload/               # contextBridge API
│  └─ renderer/              # React app
│     ├─ src/
│     │  ├─ features/
│     │  │  ├─ library/
│     │  │  ├─ import/       # chapter confirm screen
│     │  │  ├─ reader/       # PDF/DOCX viewer (2/3)
│     │  │  ├─ subtitle/     # subtitle pane (1/3)
│     │  │  ├─ player/       # audio controls
│     │  │  ├─ voices/       # voice manager / downloader
│     │  │  └─ storage/      # storage manager
│     │  ├─ components/ui/
│     │  ├─ stores/
│     │  └─ lib/
├─ packages/
│  ├─ shared/                # types, IPC contract, zod schemas
│  └─ parsers/               # pdf/docx/epub → Document model
│     ├─ src/
│     │  ├─ pdf/
│     │  ├─ docx/
│     │  ├─ chapter-detector/
│     │  ├─ cleaner/         # header/footer, dehyphenate
│     │  └─ segmenter/
├─ sidecar/                  # Python TTS service
│  ├─ app/
│  │  ├─ main.py             # FastAPI
│  │  ├─ engines/piper.py
│  │  ├─ align/ctc.py
│  │  ├─ text/normalize_vi.py
│  │  ├─ text/normalize_en.py
│  │  └─ jobs/
│  ├─ requirements.txt
│  └─ build.py               # PyInstaller onedir
├─ resources/
│  ├─ voices/catalog.json    # metadata, model tải runtime
│  └─ icons/
└─ electron-builder.yml
```

---

## 5. Data model

```ts
// packages/shared/src/types.ts
type Book = {
  id: string; title: string; author?: string;
  format: 'pdf' | 'docx' | 'epub';
  filePath: string; fileHash: string;
  lang: 'vi' | 'en';
  coverPath?: string; addedAt: number; lastOpenedAt?: number;
  lastSegmentId?: string;        // resume
}

type Chapter = {
  id: string; bookId: string; index: number; title: string;
  pageStart?: number; pageEnd?: number;
  segmentCount: number;
  audioBytes: number;            // cho storage manager
  generateStatus: 'none' | 'partial' | 'complete';
}

type Segment = {
  id: string; chapterId: string; index: number;
  text: string;
  anchor: { page?: number; rects?: Rect[] }        // PDF
        | { nodePath?: string; offset?: number };  // DOCX
  audioPath?: string;
  durationMs?: number;
  status: 'pending' | 'queued' | 'generating' | 'ready' | 'error';
  alignStatus: 'none' | 'estimated' | 'aligned';
  errorMessage?: string;
}

type WordTiming = {
  w: string; startMs: number; endMs: number;
  charStart: number; charEnd: number;
}
// file: {audioDir}/{bookId}/{segmentId}.json

type Job = {
  id: string; type: 'synthesize' | 'align';
  segmentId: string; priority: number;
  status: 'queued' | 'running' | 'done' | 'error';
  attempts: number; createdAt: number;
}
```

---

## 6. Sidecar API (localhost, port ngẫu nhiên + token)

```
GET  /health
GET  /voices                          → voice đã cài
GET  /voices/catalog                  → voice có thể tải
POST /voices/download {voiceId}       → SSE progress
DEL  /voices/{voiceId}

POST /synthesize
  { text, voiceId, bitrate, outPath }
  → { durationMs, sampleRate, estimatedTimings }

POST /align
  { audioPath, text, lang }
  → { words: WordTiming[] }

POST /jobs/batch                      → queue nhiều segment, SSE progress
POST /jobs/cancel {jobIds}
```

Bảo mật: bind `127.0.0.1`, port ngẫu nhiên, header `X-Session-Token` sinh mỗi lần chạy.

---

## 7. Layout UI

```
┌──────────────────────────────────────────────────────────┐
│  TitleBar (frameless custom)      [🌙] [⚙] [─][□][✕]      │
├────────────────────────────────┬─────────────────────────┤
│                                │  Subtitle Pane          │
│   Document Viewer  (2/3)       │  (1/3)                  │
│   - PDF: canvas + text layer   │  - segment trước (mờ)   │
│   - DOCX: styled HTML          │  - SEGMENT HIỆN TẠI     │
│   - highlight segment đang đọc │    highlight từng chữ   │
│   - auto scroll follow         │  - segment sau (mờ)     │
│                                │  - click chữ → seek     │
├────────────────────────────────┴─────────────────────────┤
│  ▶ ⏸ ⏮ ⏭  ━━━━●━━━━  1.0x  Voice ▾   00:12 / 04:31      │
└──────────────────────────────────────────────────────────┘
```

Splitter kéo được, lưu tỉ lệ. Nút toggle full-width subtitle (ẩn viewer).

### Hiệu ứng highlight từng chữ
- `requestAnimationFrame` loop đọc `audioEl.currentTime`
- Binary search vào mảng `WordTiming` → index từ hiện tại
- Transition `color` + `text-shadow` 120ms ease-out; từ đã đọc màu dịu, chưa đọc màu nhạt
- **Không** React re-render mỗi frame → ref + direct DOM class swap trên `<span data-w={i}>`

---

## 8. Xử lý text Tiếng Việt

| Vấn đề | Xử lý |
|---|---|
| Số → chữ | `2024` → "hai nghìn không trăm hai mươi tư" |
| Viết tắt | TP.HCM, TS., PGS. → bảng thay thế |
| Ký tự lạ trong LN | `…`, `—`, `「」`, `『』` → normalize hoặc bỏ |
| Ruby/furigana sót | regex strip |
| Xuống dòng giữa câu | de-hyphenate + merge dòng |
| Câu quá dài | split theo `,` `;` khi > 300 chars |
| Tiếng Anh lẫn text VI | detect token → tách segment hoặc giữ voice VI (config) |
| **Tên riêng Nhật** | phiên âm sang âm tiết Việt — xem mục 8.1 |

Segmenter: `pysbd` cho EN, rule-based + regex cho VI.

---

## 8.1. Tên riêng Nhật trong LN (Phase 3.5)

### Vấn đề

Piper VI chạy trên phoneme tiếng Việt (espeak-ng `vi`). Gặp `Shinkansen` nó ánh
xạ chữ cái theo chính tả VI → chuỗi âm vị hợp lệ nhưng vô nghĩa. Tệ hơn: tiếng
Việt có thanh điệu, từ ngoại lai không mang thanh nên bị gán thanh ngang mặc
định, nghe cụt và bẹt. LN dịch thì trang nào cũng có tên Nhật → hỏng liên tục.

**Cần chèn cách đọc, không phải sửa chữ viết.** Và cách đọc phải là chuỗi **âm
tiết tiếng Việt có dấu**, vì đó là thứ duy nhất Piper VI phát âm chuẩn.

### Ba tầng, không tầng nào bắt user cấu hình

| Tầng | Nguồn | Phủ | User phải làm gì |
|---|---|---|---|
| 1. Từ điển | ship sẵn trong app | tên phổ biến | **không gì** |
| 2. Luật romaji | suy ra tự động | tên nhân vật lạ | **không gì** |
| 3. Override | user nhập, theo sách | ca cá biệt | chỉ khi *muốn* |

Mặc định bật hết. Không có bước cấu hình nào chặn đường user — tầng 3 là van an
toàn, không phải nghĩa vụ.

**Tầng 1 — từ điển ship sẵn** (~400–600 mục): địa danh (Tokyo → `Tô-ki-ô`),
hậu tố xưng hô (senpai → `xem-pai`), thuật ngữ LN (Shinkansen → `Shin-can-xen`).

Dùng **gạch nối** chứ không phải dấu cách: `Tô-ki-ô` giữ nhịp một-từ, còn
`Tô ki ô` khiến Piper chèn khoảng nghỉ giữa các âm tiết, nghe rời rạc.

**Tầng 2 — luật romaji.** Từ điển không bao giờ phủ hết tên nhân vật. Nhưng
romaji là hệ rất đều (~100 mora), nên chuyển được bằng luật: `shi`→`si`,
`tsu`→`xư`, `fu`→`phư`, `ryu`→`ri-u`… cộng luật trường âm (`ou`/`oo`→`ô`,
`ei`→`ê`) và phụ âm kép (`kk`, `tt` → nghỉ ngắn).

Khó nhất là **biết khi nào được áp dụng** — áp bừa lên mọi từ lạ sẽ phá tiếng
Anh (`computer` không phải romaji). Bộ nhận diện: token viết hoa + không có
trong từ điển VI + khớp cấu trúc mora (phụ âm-nguyên âm xen kẽ, kết thúc bằng
nguyên âm hoặc `n`). Thà bỏ sót còn hơn nhận nhầm: bỏ sót thì nghe như hiện
tại, nhận nhầm thì phá từ đang đọc đúng.

### Hệ quả bắt buộc: `charStart` phải trỏ vào text hiển thị

Hiện `main.py` tính timing trên `spoken` (bản đã normalize), không phải
`request.text`. Với số thì lệch nhẹ và hiếm. Nhưng khi tầng 1–2 đổi tên riêng ở
**mọi trang**, highlight sẽ lệch liên tục — không né được nữa.

Nên normalizer phải trả `NormalizedText { spoken, spans }` thay vì `str`, với
`spans` là mảng ánh xạ `(spokenStart, spokenEnd) → (sourceStart, sourceEnd)`.
Aligner chạy trên `spoken`, rồi quy `charStart`/`charEnd` **ngược về text gốc**.
Một từ hiển thị ứng với nhiều mora → timing của nó là `[start mora đầu, end
mora cuối]`.

Kiểu `WordTiming` **không đổi** — `charStart`/`charEnd` đã sẵn ngữ nghĩa "trỏ
vào `Segment.text`". P3.5 chỉ làm cho nó *đúng như đã hứa*.

### Vì sao P3.5 chạy trước P3.4

P3.4 là phần **đọc** `charStart` để tô chữ. Làm P3.4 trước rồi P3.5 mới đổi
ngữ nghĩa của nó thì phải sửa lại subtitle pane vừa viết xong.

---

## 9. Roadmap

### Phase 0 — Scaffold (3–4 ngày)
- Monorepo pnpm workspace, Electron + Vite + React + TS
- Custom titlebar, theme provider (dark/light/system)
- SQLite + migration runner
- CI: build Windows portable

**DoD:** `pnpm dev` mở app có titlebar + toggle theme hoạt động.

### Phase 1 — Import, Chapter Detection & Viewer (1.5 tuần)
- Drag-drop / file picker → hash → copy vào library
- PDF parser: extract text + rects theo trang, detect scan (không text layer) → báo lỗi rõ
- DOCX parser: mammoth → HTML, giữ heading
- **ChapterDetector**: outline → font size → regex → vị trí → fallback theo trang
- **Cleaner**: header/footer lặp, de-hyphenate, merge dòng, cột đôi
- **Segmenter**: 1–3 câu, ≤ 300 ký tự
- **Màn hình Xác nhận cấu trúc chương**: merge/split/rename/xóa, preview text
- Viewer: PDF canvas + text layer, DOCX styled HTML
- Library grid, resume last position

**DoD:** Mở PDF & DOCX, thấy danh sách chương đúng, sửa được, thấy segment.

### Phase 2 — TTS Sidecar & Storage (2 tuần)
- FastAPI service + Piper ONNX
- Main process spawn/kill sidecar, health check, auto-restart 3 lần
- Voice manager: catalog JSON, download + verify SHA256, progress UI
- `/synthesize` → ogg, bitrate configurable
- **Job queue persist SQLite**: priority, pause/resume/cancel, tiếp tục sau khi mở lại app
- Generate theo chương + prefetch chương kế
- Nút "Generate cả sách" kèm ước lượng thời gian/dung lượng
- **Storage Manager**: xem dung lượng theo sách/chương, xóa audio, đổi thư mục, cảnh báo ngưỡng
- Text normalize VI/EN

**DoD:** Generate chương 1 → có audio, phát được, xem & xóa được dung lượng.

### Phase 3 — Player & Subtitle sync (1 tuần)
- Player: play/pause/prev/next segment, speed 0.5–2.0x
  - Speed dùng `playbackRate` + `preservesPitch` → **không regenerate**
- Timing ước lượng theo tỉ lệ độ dài từ (dùng ngay)
- **P3.5 — phiên âm tên riêng Nhật (làm TRƯỚC P3.4, xem mục 8.1)**
  - `NormalizedText { spoken, spans }` — trả bảng ánh xạ offset, không chỉ str
  - `charStart`/`charEnd` quy ngược về `Segment.text` gốc
  - Từ điển ship sẵn + luật romaji tự động + override theo sách
- Subtitle pane 3 dòng, highlight từng chữ, click-to-seek
- Sync viewer: scroll + highlight vùng đang đọc
- Priority queue: segment sắp phát nhảy đầu hàng

**DoD:** Nghe liên tục hết chương, chữ sáng đúng nhịp. Tên Nhật đọc ra nghe
hiểu được, và highlight vẫn bám đúng chữ trên màn hình ở những câu đó.

### ~~Phase 4 — Forced Alignment (1 tuần)~~ — ĐÃ BỎ

~~CTC aligner ONNX, background worker; tải model aligner optional; cache
`timings.json`, `alignStatus` realtime; settings bật/tắt alignment.~~

**Bỏ sau khi nghe thật.** User nghe hết một chương ở cuối Phase 3 và xác nhận
highlight bám đúng từng chữ — timing `phoneme` của Piper (lấy độ dài phoneme do
chính engine sinh ra) đã đủ chính xác ở quy mô segment ~10 s. Model aligner
~300 MB sẽ đẩy installer từ 143 MB lên ~450 MB, vượt xa mốc 200 MB ở mục 3.

**Điều kiện mở lại:** user thật báo highlight lệch ở câu **nhiều số hoặc tên
riêng** — đó là ca `phoneme` cố ý rơi về `estimate`. Khi đó thử phương án rẻ hơn
trước (sửa cách gộp phoneme → từ cho chữ số) rồi mới tính tới CTC.

Chi tiết đầy đủ ở PROGRESS.md mục 4.68. Hạ tầng đã dựng (`AlignStatus` ba trạng
thái, `JobType.align`, `AppSettings.alignmentEnabled`) **giữ nguyên**, không gỡ.

### Phase 5 — Polish & Ship (1 tuần)
- Settings: theme, font size/family subtitle, tỉ lệ pane, thư mục audio, bitrate, xóa cache
- Bookmark, tiến độ đọc, thống kê
- Keyboard shortcuts (Space, ←/→, J/K, F11)
- electron-builder: NSIS + portable, auto-update (electron-updater + GitHub Releases)
- README: hướng dẫn qua SmartScreen warning
- Crash reporting, log rotate

**DoD:** Installer `.exe` cài trên máy sạch chạy được, không cần cài Python.

### Phase 6 — Giọng đọc tự nhiên hơn (engine thứ hai)

**Vấn đề user nêu:** giọng Piper VI "không phù hợp" để đọc Light Novel — máy
móc, không có ngữ điệu kể chuyện. Giọng user muốn là loại nghe trên các kênh
review phim/anime YouTube; tra ra đó là **Vbee AIVoice** (dịch vụ thương mại,
tính phí theo ký tự, **không có model tải về**). Không đưa vào app này được, và
cũng phá nguyên tắc "TTS local, đọc offline".

Bản mã nguồn mở đạt tầm chất lượng đó: **VieNeu-TTS** (Apache 2.0). User đã nghe
example trong repo và xác nhận **đúng giọng cần**.

| Ràng buộc user đặt | VieNeu-TTS |
|---|---|
| Installer ≤ 250 MB | Torch-free trên CPU — chạy **ONNX Runtime đã có sẵn** trong sidecar |
| Chậm hơn vài lần vẫn chấp nhận | ~2–3× nhanh hơn thời gian thực trên CPU laptop |
| Nhiều giọng để đổi | 14 giọng preset (Bắc/Trung/Nam, nam + nữ) |
| — | Có style `doc_truyen` tách khỏi `tin_tuc` — đúng thứ Piper không có |

#### Cái giá phải trả: mất word alignment

VieNeu-TTS **không trả về mốc thời gian từng từ**, và đây không phải "chưa hỗ
trợ" mà là **kiến trúc không mang thông tin đó**. Codec MOSS-Audio-Tokenizer
chạy **12,5 token/giây** (mỗi token = 80 ms). Token là đơn vị *nén âm thanh*,
ranh giới của nó không tương ứng ranh giới từ — biết "token thứ 17" không cho
biết đang ở từ nào. Khác hẳn Piper: Piper phát âm **theo phoneme** nên số sample
mỗi phoneme là thông tin có thật.

`infer_stream()` cũng chunk theo frame codec, không theo từ. **Không có đường
moi alignment ra từ chính engine.**

Hệ quả: `timing_source` rơi từ `phoneme` xuống `estimate` cho mọi segment sinh
bằng engine mới.

#### Vì sao KHÔNG dùng forced alignment (đường đã loại)

Sinh audio bằng VieNeu rồi chạy một model CTC căn chữ vào audio — đây chính là
**Phase 4 đã bỏ**, quay lại. Đã tra và loại vì hai lý do cứng:

- Model tiếng Việt đúng việc này ([lyric-alignment](https://huggingface.co/nguyenvulebinh/lyric-alignment),
  nền wav2vec2-large) mang license **CC BY-NC 4.0** — *phi thương mại*, không
  tương thích với **MIT** của dự án.
- Không có bản ONNX → kéo PyTorch → phá thẳng ràng buộc 250 MB.

Cộng thêm: chạy aligner sau mỗi segment làm generate chậm ít nhất gấp đôi.

---

### P6.1 — Cải tiến `estimate_word_timings` (làm TRƯỚC, độc lập)

**Làm trước khi đụng engine, và đây là điểm quan trọng nhất của cả Phase 6.**
Piper cho `phoneme` alignment thật, nên lúc này ta có **thước đo khách quan**:
chạy cả hai đường trên cùng một segment rồi đo lệch bao nhiêu mili-giây. Cơ hội
này **mất hẳn** khi chuyển sang VieNeu — lúc đó chỉ còn cảm giác "hình như lệch".

Phần này **độc lập hoàn toàn** với chuyện đổi engine: kể cả sau này không dùng
VieNeu, nó vẫn cải thiện những đoạn Piper đang rơi về `estimate` (câu nhiều chữ
số hoặc tên riêng — xem điều kiện mở lại Phase 4).

**Hiện trạng — đã đọc code, không phải phỏng đoán.** `estimate_word_timings`
([sidecar/app/audio/timings.py](sidecar/app/audio/timings.py)) đã làm đúng hai
việc thường bị bỏ sót:

- Chia theo **độ dài từng từ**, không chia đều số từ.
- Khoảng trắng + dấu câu gộp vào từ đứng trước → mốc nối liền, không có khe hở.
- Từ cuối chốt đúng `duration_ms` → sai số **không tích luỹ vô hạn**.

Nên phần cải tiến **không phải** ba thứ đó. Vấn đề thật nằm ở đơn vị đo.

**Lỗi gốc: đếm ký tự cho một ngôn ngữ đơn âm tiết.** Tiếng Việt mỗi từ chính tả
là **một âm tiết**, và thời gian đọc một âm tiết gần như không phụ thuộc số chữ
cái viết ra. Đo trên câu thật:

| Từ | Thời lượng được cấp (ký tự) | Đúng ra (âm tiết) | Lệch |
|---|---|---|---|
| `Nghieng` | 13.0% | 7.1% | **5.8 pp** |
| `a` | 1.9% | 7.1% | **5.3 pp** |
| `nghi` | 7.4% | 7.1% | 0.3 pp |

Trên segment 10 giây, 5.8 pp là **~580 ms cho một từ** — đủ để mắt thấy chữ sáng
sai chỗ. Và đây không phải ca hiếm: LN tiếng Việt đầy `à`, `ừ`, `ồ`, `nhé` xen
giữa các từ dài như `nghiêng`, `chuyện`, `nghiêm`.

**Ba việc, theo thứ tự giá trị:**

1. **Trọng số theo âm tiết thay vì ký tự.** Với tiếng Việt, đếm âm tiết ≈ đếm
   từ chính tả — rất rẻ. **Không** áp dụng mù cho mọi ngôn ngữ: tiếng Anh
   `"international"` (5 âm tiết) và `"a"` (1) thì độ dài ký tự lại là xấp xỉ tốt
   hơn. Hàm phải nhận `lang` và chọn cách tính; đây là lý do nó là hàm thuần
   riêng chứ không phải sửa tại chỗ.

2. **Dấu câu tạo khoảng nghỉ có trọng số riêng.** Hiện dấu câu chỉ *thuộc về* từ
   trước, nhưng **không được cấp thêm thời lượng**. Thực tế dấu phẩy tạo pause
   ~100–200 ms, dấu chấm dài hơn. Không mô hình hoá thì mọi từ sau dấu phẩy đầu
   tiên đều trôi dần.

3. **Kẹp theo câu, không chỉ theo segment.** Segment có 1–3 câu; nếu biết ranh
   giới câu thì neo được ở nhiều điểm hơn thay vì chỉ hai đầu. Chỉ làm nếu (1)
   và (2) chưa đủ — đo rồi mới quyết.

**Cách đo — bắt buộc có trước khi sửa.** Một script probe (ngoài `pytest`, cùng
lối `apps/main/probe/`) chạy trên voice thật đã cài:

- Lấy N segment thật từ sách trong thư viện.
- Với mỗi segment: sinh bằng Piper, lấy **cả** `word_timings_from_phonemes`
  (chuẩn vàng) **và** `estimate_word_timings` (bản đang có + bản mới).
- Báo cáo: lệch trung bình / lệch lớn nhất per-word (ms), và **tỉ lệ từ lệch quá
  150 ms** — mốc mắt bắt đầu thấy sai.

**DoD P6.1:** trên tập segment thật, bản mới giảm **lệch trung bình ≥ 30%** và
**không có từ nào tệ hơn** bản cũ quá 50 ms. Con số ra sao ghi vào PROGRESS —
đó là căn cứ để quyết P6.2 có đáng làm không.

⚠️ **Nếu P6.1 không đạt DoD** thì phải xem lại P6.2: mất alignment mà `estimate`
vẫn kém nghĩa là đổi giọng sẽ làm hỏng tính năng highlight — lúc đó cân nhắc giữ
Piper, hoặc chấp nhận rằng giọng mới đi kèm highlight kém hơn hẳn.

### P6.2 — Engine thứ hai (VieNeu-TTS)

Chỉ bắt đầu **sau khi P6.1 có số**.

| Việc | Ghi chú |
|---|---|
| `engines/base.py` | Interface chung. Chữ ký `synthesize` hiện tại **đã đúng sẵn** — `SynthesisResult` không mang gì của Piper |
| `engines/vieneu.py` | Implement thứ hai. `PiperEngine` giữ nguyên, không sửa |
| `EngineRegistry` | Chọn engine + cache model theo `(engine, voice_id)` |
| Catalog đa engine | Thêm trường `engine`; `baseUrl` chuyển **xuống từng voice** (hiện là một gốc HF chung); `files` co giãn (Piper cần đúng 2 file, engine khác khác) |
| UI | Bỏ `quality`/`sampleRate` cứng khỏi [VoiceRow.tsx](apps/renderer/src/features/voices/VoiceRow.tsx) — `VoiceQuality` (`x_low\|low\|medium\|high`) là thang **riêng của Piper** |
| `style` | VieNeu có `tu_nhien`/`tin_tuc`/`doc_truyen`. Mặc định `doc_truyen`, cho đổi trong Cài đặt |

**Điểm cần quyết khi tới:** `voiceVi`/`voiceEn` hiện là **hai ô, chọn theo ngôn
ngữ**. Nếu user muốn đổi giọng theo từng sách thì mô hình này phải mở rộng —
quyết định sản phẩm, không phải kỹ thuật. Chưa chốt.

**Rủi ro đóng gói:** mọi dependency mới đi vào PyInstaller. PROGRESS ghi rõ bài
học ở P2.4 — thư viện có DLL native là loại PyInstaller hay bỏ sót, và **lỗi đó
không lộ ra ở venv**. Mỗi lần thêm phải chạy `pnpm build:sidecar` rồi khởi động
thử `.exe` thật, không chỉ `pytest`.

**DoD Phase 6:** nghe hết một chương bằng giọng mới, highlight vẫn bám ở mức
chấp nhận được, installer ≤ 250 MB.

### Phase 7 — EPUB + mở rộng
- EPUB parser cắm vào interface Parser
- Gộp segment thành container `.ogg` theo chương (nếu đo thấy cần)
- Multi-voice per character (heuristic dialogue detection)
- Export audiobook M4B + chapters
- Kokoro engine cho EN — **rẻ đi nhiều sau Phase 6**: `engines/base.py` và catalog
  đa engine đã dựng sẵn, thêm Kokoro chỉ còn là một implement nữa

---

## 10. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Chapter detection sai trên PDF lạ | **Cao** | Màn hình xác nhận bắt buộc; fallback chia theo trang |
| Audio chiếm hết ổ đĩa | **Cao** | Storage manager từ Phase 2; cảnh báo ngưỡng; xóa theo chương |
| PDF text layer lộn xộn (2 cột, header/footer) | Cao | Cleaner heuristic + cho user preview & sửa |
| Aligner model 300MB tải chậm | TB | Optional; app dùng estimated timing vẫn chạy |
| Antivirus flag sidecar `.exe` | TB | Không code sign → README hướng dẫn; dùng python.exe + script thay PyInstaller onefile nếu bị flag nặng |
| ~~Giọng VI Piper chưa thật tự nhiên~~ | **Cao — đã xảy ra** | User xác nhận Piper "không phù hợp" để đọc LN. Hướng xử: **Phase 6** thêm VieNeu-TTS. Giả định cũ ("catalog cho phép thêm voice" là đủ) **sai**: catalog hiện khoá cứng cấu trúc Piper (đúng 2 file, một `baseUrl` chung, thang `quality` riêng) |
| Đổi engine làm mất word alignment | **Cao** | VieNeu không trả mốc từng từ và **không thể** trả (codec 12,5 token/s, xem Phase 6). Giảm thiểu: **P6.1 cải tiến `estimate` trước, đo bằng Piper làm chuẩn vàng** — cơ hội đo này mất hẳn sau khi đổi engine. Có DoD định lượng; không đạt thì xem lại P6.2 |
| Engine mới kéo PyTorch làm installer phình | TB | Chỉ nhận engine chạy ONNX Runtime (đã có sẵn trong sidecar 145 MB). VieNeu torch-free trên CPU. Model tải runtime như voice hiện nay, không bundle |
| Sidecar chết giữa chừng | TB | Supervisor retry 3 lần, báo UI, queue persist SQLite |
| 600 file/chương gây chậm | Thấp | Đo trước; nếu chậm → container `.ogg` ở Phase 6 |

---

## 11. Ước lượng

- Tổng: **~7–8 tuần** (1 dev full-time)
- MVP dùng được (hết Phase 3): **~4.5 tuần**
