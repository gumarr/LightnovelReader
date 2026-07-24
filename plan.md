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

Segmenter: `pysbd` cho EN, rule-based + regex cho VI.

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
- Subtitle pane 3 dòng, highlight từng chữ, click-to-seek
- Sync viewer: scroll + highlight vùng đang đọc
- Priority queue: segment sắp phát nhảy đầu hàng

**DoD:** Nghe liên tục hết chương, chữ sáng đúng nhịp.

### Phase 4 — Forced Alignment (1 tuần)
- CTC aligner ONNX, background worker
- Tải model aligner optional trong app
- Cache `timings.json`, `alignStatus` realtime lên UI
- Settings: bật/tắt alignment, precision mode

**DoD:** Highlight chính xác với câu có số/tên riêng.

### Phase 5 — Polish & Ship (1 tuần)
- Settings: theme, font size/family subtitle, tỉ lệ pane, thư mục audio, bitrate, xóa cache
- Bookmark, tiến độ đọc, thống kê
- Keyboard shortcuts (Space, ←/→, J/K, F11)
- electron-builder: NSIS + portable, auto-update (electron-updater + GitHub Releases)
- README: hướng dẫn qua SmartScreen warning
- Crash reporting, log rotate

**DoD:** Installer `.exe` cài trên máy sạch chạy được, không cần cài Python.

### Phase 6 — EPUB + mở rộng
- EPUB parser cắm vào interface Parser
- Gộp segment thành container `.ogg` theo chương (nếu đo thấy cần)
- Multi-voice per character (heuristic dialogue detection)
- Export audiobook M4B + chapters
- Kokoro engine cho EN

---

## 10. Rủi ro & giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Chapter detection sai trên PDF lạ | **Cao** | Màn hình xác nhận bắt buộc; fallback chia theo trang |
| Audio chiếm hết ổ đĩa | **Cao** | Storage manager từ Phase 2; cảnh báo ngưỡng; xóa theo chương |
| PDF text layer lộn xộn (2 cột, header/footer) | Cao | Cleaner heuristic + cho user preview & sửa |
| Aligner model 300MB tải chậm | TB | Optional; app dùng estimated timing vẫn chạy |
| Antivirus flag sidecar `.exe` | TB | Không code sign → README hướng dẫn; dùng python.exe + script thay PyInstaller onefile nếu bị flag nặng |
| Giọng VI Piper chưa thật tự nhiên | TB | Catalog cho phép thêm voice; kiến trúc engine-agnostic |
| Sidecar chết giữa chừng | TB | Supervisor retry 3 lần, báo UI, queue persist SQLite |
| 600 file/chương gây chậm | Thấp | Đo trước; nếu chậm → container `.ogg` ở Phase 6 |

---

## 11. Ước lượng

- Tổng: **~7–8 tuần** (1 dev full-time)
- MVP dùng được (hết Phase 3): **~4.5 tuần**
