import { ok, type Result, type SidecarStatus } from '@ln/shared';

/**
 * Handler cho nhóm `sidecar:*`.
 *
 * Cố ý **chỉ đọc**: không có `start` / `stop` / `restart` lộ ra renderer.
 * Vòng đời sidecar do supervisor bên main quyết, còn renderer bấm nút restart
 * được thì user sẽ dùng nó để né chính cái cơ chế đếm lượt sinh ra nhằm chặn
 * vòng lặp khởi động vô tận.
 */

export type SidecarHandlers = {
  getStatus: () => Result<SidecarStatus>;
};

export type SidecarHandlerDeps = {
  getStatus: () => SidecarStatus;
};

export const createSidecarHandlers = (deps: SidecarHandlerDeps): SidecarHandlers => ({
  // Luôn `ok`: "sidecar đang hỏng" là dữ liệu hợp lệ nằm trong `state`, không
  // phải lỗi của lời gọi IPC. Trả `err` thì renderer mất luôn thông tin vì sao.
  getStatus: () => ok(deps.getStatus()),
});
