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
| `cleaner-real.test.ts` | Dòng thô → sau strip header/footer → số khối; dòng bị loại; text đã sạch |
| `detector-real.test.ts` | Chương phát hiện + **bảng điểm từng tín hiệu** cho top ứng viên |

## Đã tìm ra lỗi gì

Bốn lỗi thật mà unit test không lộ — đây là lý do thư mục này tồn tại:

- **Luật "dòng ngắn" xé câu làm đôi** — dòng cuối mỗi đoạn văn cũng ngắn y
  hệt tiêu đề. Sửa: chỉ tách khối khi khối đang mở đã trọn ý.
- **Regex tiêu đề khớp giữa câu văn** — `"…the last part left, most of…"`.
  Sửa: neo `^` + `looksLikeProse()`.
- **Tên chương lấy nhầm dòng thân bài** khi outline trỏ tới trang mà text
  không khớp. Sửa: `titleFor()` ưu tiên tiêu đề outline.
- **Trang mục lục thành chương rỗng** — `"Mục lục"` 19pt ăn điểm y hệt tiêu
  đề thật. Sửa: thêm `signals/toc.ts` làm bộ lọc loại trừ.

Mỗi lỗi đều có test khoá lại trong `src/`, dùng đúng dữ liệu gặp trong file thật.
