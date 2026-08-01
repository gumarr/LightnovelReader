import { formatBytes, type UpdateStatus } from '@ln/shared';

/**
 * Hàm thuần dựng nhãn cho UI cập nhật. Tách khỏi component để test được mà
 * không phải mount React — cùng lối với `features/storage/format.ts`.
 *
 * Bảy trạng thái của `UpdateState` không ánh xạ một-một sang bảy câu chữ: hai
 * trạng thái khác nhau có thể cần cùng một nút, và một trạng thái (`idle`) cần
 * hai câu khác nhau tuỳ đã kiểm lần nào chưa. Vì vậy nhãn, mô tả và nút được
 * tính riêng chứ không gộp thành một bảng tra.
 */

/** Tiêu đề ngắn — luôn có, kể cả khi không có gì để làm */
export const updateTitle = (status: UpdateStatus): string => {
  switch (status.state) {
    case 'checking':
      return 'Đang kiểm tra bản mới…';
    case 'available':
      return `Có bản mới ${status.availableVersion ?? ''}`.trim();
    case 'downloading':
      return 'Đang tải bản mới…';
    case 'downloaded':
      return 'Đã tải xong — khởi động lại để cài';
    case 'error':
      return 'Không kiểm tra được bản mới';
    case 'unsupported':
      return 'Bản này không tự cập nhật';
    case 'idle':
      // Chưa kiểm lần nào thì **không** được nói "đã là mới nhất": đó là khẳng
      // định app chưa có cơ sở nào để đưa ra.
      return status.checkedAt === undefined ? 'Cập nhật' : 'Đang dùng bản mới nhất';
  }
};

/**
 * Câu mô tả dưới tiêu đề. `undefined` = không có gì thêm để nói, component bỏ
 * hẳn thẻ chứ không render một dòng trống chiếm chỗ.
 */
export const updateDetail = (status: UpdateStatus): string | undefined => {
  switch (status.state) {
    case 'available':
      return `Đang dùng ${status.currentVersion}. Tải về rồi cài khi bạn muốn.`;
    case 'downloading':
      return downloadProgressLabel(status);
    case 'downloaded':
      // Nói rõ app sẽ đóng: user đang đọc dở, bấm nhầm mà mất chỗ là khó chịu.
      return 'Ứng dụng sẽ đóng, cài bản mới rồi mở lại.';
    case 'error':
    case 'unsupported':
      return status.message;
    case 'idle':
      return status.checkedAt === undefined ? undefined : `Phiên bản ${status.currentVersion}`;
    case 'checking':
      return undefined;
  }
};

/**
 * Dòng tiến độ tải: `12,3 MB / 150 MB`.
 *
 * Hiện số byte chứ không chỉ phần trăm vì bản cài ~150 MB — user cần biết còn
 * phải tải bao nhiêu để quyết định có nên chờ hay không. `undefined` khi
 * `electron-updater` chưa gửi sự kiện tiến độ nào.
 */
export const downloadProgressLabel = (status: UpdateStatus): string | undefined => {
  const { downloadedBytes, totalBytes } = status;
  if (downloadedBytes === undefined || totalBytes === undefined || totalBytes <= 0) {
    return undefined;
  }
  return `${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)}`;
};

/** Hành động chính user bấm được ở trạng thái này. `none` = không có nút nào */
export type UpdateAction = 'check' | 'download' | 'install' | 'none';

export const updateAction = (status: UpdateStatus): UpdateAction => {
  switch (status.state) {
    case 'available':
      return 'download';
    case 'downloaded':
      return 'install';
    case 'idle':
    case 'error':
      // `error` vẫn cho bấm lại: lỗi hay gặp nhất là mất mạng tạm thời, mà bắt
      // user khởi động lại app để thử lần nữa là vô lý.
      return 'check';
    case 'checking':
    case 'downloading':
      // Đang chạy — bấm nữa chỉ tạo lượt thứ hai chồng lên lượt đang chạy.
      return 'none';
    case 'unsupported':
      // Bản portable / bản dev: không có nút nào bấm được cho ra kết quả khác.
      return 'none';
  }
};

export const updateActionLabel = (action: UpdateAction): string | undefined => {
  switch (action) {
    case 'check':
      return 'Kiểm tra';
    case 'download':
      return 'Tải bản mới';
    case 'install':
      return 'Khởi động lại & cài';
    case 'none':
      return undefined;
  }
};

/**
 * Có nên đập vào mắt user ở ngoài màn Cài đặt hay không.
 *
 * Chỉ `available` và `downloaded` — hai trạng thái user **làm được gì đó**.
 * `error` cố tình không nằm ở đây: app đọc sách offline mà mỗi lần mở không có
 * mạng lại hiện một dải đỏ thì dải đỏ đó thành thứ user học cách bỏ qua.
 */
export const shouldNotify = (status: UpdateStatus): boolean =>
  status.state === 'available' || status.state === 'downloaded';
