# probe — script khảo sát trên file thật

**Không phải test sản phẩm.** Đây là công cụ chạy parser/cleaner trên file
PDF thật trong `samples/` rồi in báo cáo, dùng để chỉnh ngưỡng có căn cứ thay
vì đoán.

Đã loại khỏi `pnpm test` (xem `exclude` trong `vitest.config.ts`) vì nó phụ
thuộc file không commit và in ra rất dài. Chạy khi cần:

```bash
npx vitest run --project node packages/parsers/probe/cleaner-real.test.ts
```

Không có file trong `samples/pdf/` thì tự bỏ qua, không báo lỗi.

## Báo cáo in ra gì

- Số dòng thô → sau khi bỏ header/footer → số khối text sau khi nối dòng
- Mẫu header/footer bắt được và các dòng bị loại (để soi có xoá nhầm không)
- Trang nào bị nhận là hai cột
- Text đã làm sạch của 2 trang đầu, để đọc bằng mắt

## Đã tìm ra lỗi gì

- **Luật "dòng ngắn" xé câu làm đôi** — dòng cuối mỗi đoạn văn cũng ngắn y
  hệt tiêu đề. Sửa: chỉ tách khối khi khối đang mở đã trọn ý.
  Test khoá ở `merge-lines.test.ts` mục "dòng ngắn cuối đoạn vẫn được nối".
