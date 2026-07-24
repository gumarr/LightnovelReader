---
description: Test & tinh chỉnh chapter detection trên file thật
---

File cần test: $ARGUMENTS

1. Chạy chapter detector trên file, in ra bảng:
   - Chương phát hiện được: index, tên, trang bắt đầu/kết thúc, số segment ước tính
   - **Điểm số từng tín hiệu** (outline / font size / regex / vị trí) cho mỗi ứng viên
   - Ứng viên bị loại và lý do bị loại

2. In 3 dòng đầu của mỗi chương để tôi kiểm tra mắt thường.

3. Báo cáo phần làm sạch text:
   - Header/footer nào bị loại (kèm tần suất xuất hiện)
   - Số dòng được de-hyphenate / merge
   - Có phát hiện bố cục cột đôi không

4. Nêu rõ trường hợp nào detector **không chắc chắn** và vì sao.

Nếu kết quả sai, đề xuất chỉnh **ngưỡng hoặc thêm tín hiệu mới**, không hardcode theo riêng file này. Mỗi lần chỉnh phải thêm test case tương ứng vào `packages/parsers/src/chapter-detector/__tests__/`.
