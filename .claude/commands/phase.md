---
description: Triển khai một phase trong plan.md
---

Đọc `plan.md`, tìm **Phase $ARGUMENTS**.

Thực hiện theo thứ tự:

1. Liệt kê đầy đủ các đầu việc của phase này và các file sẽ tạo/sửa. **Dừng lại chờ tôi xác nhận** trước khi viết code.
2. Sau khi tôi duyệt, implement từng đầu việc một. Sau mỗi đầu việc chạy `pnpm typecheck`.
3. Viết unit test cho phần logic thuần.
4. Chạy `pnpm typecheck && pnpm lint && pnpm test`. Sửa hết lỗi.
5. Kiểm tra lại DoD (Definition of Done) của phase trong plan.md và báo cáo từng mục đạt/chưa đạt.

Tuân thủ nghiêm ngặt các quy tắc trong `.claude/CLAUDE.md`, đặc biệt phần **Kiến trúc — không được vi phạm**.
