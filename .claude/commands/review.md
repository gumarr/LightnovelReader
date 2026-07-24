---
description: Review code theo chuẩn dự án
---

Review các thay đổi hiện tại (`git diff`) hoặc file/thư mục: $ARGUMENTS

Kiểm tra theo checklist:

**Kiến trúc**
- Renderer có gọi trực tiếp `fs` / `child_process` / sidecar không?
- IPC channel đã khai báo type trong `packages/shared/src/ipc.ts` chưa?
- Type dùng chung có bị duplicate giữa các package không?
- SQL có nằm ngoài `db/repositories/` không?

**Chất lượng**
- Có `any` không? Có TODO rỗng / stub trả mock không?
- `try/catch` có nuốt lỗi không?
- Component có > 200 dòng không?
- Màu có hardcode hex thay vì CSS variable không?

**Hiệu năng**
- Subtitle highlight có dùng `useState` trong RAF loop không? (phải dùng ref + DOM)
- Có re-render thừa, list dài thiếu virtualization không?
- Job nặng có block main/event loop không?

**Test**
- Logic thuần đã có unit test chưa?

Báo cáo theo mức: 🔴 Phải sửa / 🟡 Nên sửa / 🟢 Gợi ý. Với mỗi vấn đề nêu file:line và cách sửa cụ thể.
