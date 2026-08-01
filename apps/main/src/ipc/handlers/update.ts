import { ok, type Result, type UpdateStatus } from '@ln/shared';
import type { UpdateService } from '../../services/update-service.js';

/**
 * Handler cho nhóm `update:*` (P5.5b).
 *
 * Mỏng có chủ ý: toàn bộ quyết định nằm ở `update-service.ts`. Chỗ này chỉ bọc
 * `Result` — thêm luật gì ở đây nữa thì nó nằm ngoài tầm test của service.
 *
 * Mọi handler đều `ok`: "không cập nhật được" và "kiểm thất bại" là **dữ liệu**
 * nằm trong `UpdateStatus.state`, không phải lỗi của lời gọi IPC. Trả `err` thì
 * renderer mất luôn thông tin vì sao và không hiện được câu giải thích.
 */

export type UpdateHandlers = {
  getStatus: () => Result<UpdateStatus>;
  check: () => Promise<Result<UpdateStatus>>;
  download: () => Promise<Result<UpdateStatus>>;
  quitAndInstall: () => Result<boolean>;
};

export type UpdateHandlerDeps = {
  service: UpdateService;
};

export const createUpdateHandlers = (deps: UpdateHandlerDeps): UpdateHandlers => ({
  getStatus: () => ok(deps.service.getStatus()),

  // Không `silent`: kênh này chỉ được gọi khi user bấm nút, và lúc đó lỗi là
  // thứ họ đang chờ nghe. Lượt kiểm nền lúc khởi động gọi thẳng service.
  check: async () => ok(await deps.service.check()),

  download: async () => ok(await deps.service.download()),

  quitAndInstall: () => ok(deps.service.quitAndInstall()),
});
