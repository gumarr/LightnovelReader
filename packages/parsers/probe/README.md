# probe — script khảo sát trên file thật

**Không phải test sản phẩm.** Đây là công cụ chạy parser/cleaner trên file
PDF thật trong `samples/` rồi in báo cáo, dùng để chỉnh ngưỡng có căn cứ thay
vì đoán.

Đã loại khỏi `pnpm test` (xem `exclude` trong `vitest.config.ts` gốc) vì phụ
thuộc file không commit và in ra rất dài. Chạy bằng **config riêng** trong
thư mục này:

```bash
# Tất cả
npx vitest run -c packages/parsers/probe/vitest.config.ts

# Một file
npx vitest run -c packages/parsers/probe/vitest.config.ts detector-real
```

Không có file trong `samples/pdf/` thì tự bỏ qua, không báo lỗi.

> Đừng dùng `--project node ... --exclude`: CLI **cộng dồn** vào `exclude`
> của config gốc chứ không thay thế, nên `**/probe/**` vẫn bị loại.

## Các script

| File | In ra gì |
|---|---|
| `structure.test.ts` | Outline → trang, phân bố cỡ chữ, dòng lớn hơn thân bài |
| `find-titles.test.ts` | Trang ít dòng bất thường, dòng khớp regex tiêu đề |
| `docx-structure.test.ts` | Thẻ HTML mammoth sinh ra, heading, ứng viên tiêu đề |
| `cleaner-real.test.ts` | Dòng thô → sau strip header/footer → số khối; dòng bị loại; text đã sạch |
| `detector-real.test.ts` | Chương phát hiện + **bảng điểm từng tín hiệu** cho top ứng viên |
| `parser-real.test.ts` | Trọn đường đi file → parser → cleaner → detector → segmenter, cả 4 file |

## Đã tìm ra lỗi gì

Chín lỗi thật mà unit test không lộ — đây là lý do thư mục này tồn tại:

**Từ P1.2–P1.3:**

- **Luật "dòng ngắn" xé câu làm đôi** — dòng cuối mỗi đoạn văn cũng ngắn y
  hệt tiêu đề. Sửa: chỉ tách khối khi khối đang mở đã trọn ý.
- **Regex tiêu đề khớp giữa câu văn** — `"…the last part left, most of…"`.
  Sửa: neo `^` + `looksLikeProse()`.
- **Tên chương lấy nhầm dòng thân bài** khi outline trỏ tới trang mà text
  không khớp. Sửa: `titleFor()` ưu tiên tiêu đề outline.
- **Trang mục lục thành chương rỗng** — `"Mục lục"` 19pt ăn điểm y hệt tiêu
  đề thật. Sửa: thêm `signals/toc.ts` làm bộ lọc loại trừ.

**Từ P1.4 (chỉ lộ ra khi nối các phần lại):**

- **`\n` lọt vào giữa segment** — segmenter viết ở P1.1 chưa từng coi `\n` là
  ranh giới. Sửa ở cả splitter, segmenter và bước merge.
- **Cleaner vẫn nhả text mục lục** dù detector đã bỏ trang đó. Sửa:
  `cleanPages` dùng chung `isTableOfContents`.
- **Gom dòng theo bucket cứng tách đôi một dòng chữ** — `round(y/3)` khiến
  hai item cách 1pt rơi khác bucket. Sửa: gom theo khoảng cách thực tế.

**Từ P1.5 (chỉ lộ ra khi chạy bản đã đóng gói):**

- **`DOMMatrix is not defined`** — pdfjs chỉ tự polyfill khi nhận ra đang ở
  Node, mà Electron main báo `process.type === 'browser'`.
- **Không tìm được `pdf.worker.mjs`** — bản đóng gói không mang `node_modules`.

Hai lỗi này `probe/` **không** bắt được: nó chạy dưới vitest/Node nên pdfjs tự
xoay xở được. Phải build `.exe` rồi gọi IPC qua CDP — xem PROGRESS.md mục 4.19.

Mỗi lỗi đều có test khoá lại trong `src/`, dùng đúng dữ liệu gặp trong file thật.
