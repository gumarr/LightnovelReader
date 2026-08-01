import type { UpdateStatus } from '@ln/shared';
import { errorMessage } from '@ln/shared';
import {
  normalizePercent,
  shouldOfferUpdate,
  updateBlockMessage,
  updateBlockReason,
  type UpdateSupportInput,
} from './update-policy.js';

/**
 * Máy trạng thái auto-update. Giữ `UpdateStatus` hiện hành và đẩy lên UI mỗi
 * lần đổi — cùng khuôn với `sidecar-supervisor.ts`.
 *
 * **Vì sao không gọi thẳng `autoUpdater` ở `index.ts`.** `electron-updater`
 * phát sự kiện chứ không trả Promise, nên trạng thái nằm rải giữa sáu callback.
 * Gom vào đây thì `index.ts` chỉ còn nối dây, và toàn bộ đường đi trạng thái
 * kiểm được bằng một updater giả.
 *
 * **Vì sao `autoDownload` phải tắt.** Mặc định `electron-updater` tải ngay khi
 * thấy bản mới. Bản cài này ~150 MB — tự tải nền cho một app đọc sách offline
 * là ngốn băng thông của user mà không hỏi. Tải chỉ chạy khi user bấm.
 */

export type UpdateLogger = {
  info: (message: string, detail?: string) => void;
  warn: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
};

/** Thông tin bản mới mà `electron-updater` trả về, rút gọn còn phần dùng tới */
export type UpdateInfoLike = {
  version: string;
};

export type ProgressLike = {
  transferred: number;
  total: number;
};

/**
 * Phần `electron-updater` mà service này dùng.
 *
 * Khai riêng thay vì dùng thẳng kiểu của thư viện: `AppUpdater` có ~40 thành
 * viên, mà bản giả trong test chỉ cần dựng đúng những gì thật sự được gọi.
 */
export type UpdaterLike = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
  on: ((event: 'checking-for-update', listener: () => void) => void) &
    ((event: 'update-available', listener: (info: UpdateInfoLike) => void) => void) &
    ((event: 'update-not-available', listener: (info: UpdateInfoLike) => void) => void) &
    ((event: 'download-progress', listener: (progress: ProgressLike) => void) => void) &
    ((event: 'update-downloaded', listener: (info: UpdateInfoLike) => void) => void) &
    ((event: 'error', listener: (error: Error) => void) => void);
};

export type UpdateService = {
  getStatus: () => UpdateStatus;
  /**
   * Hỏi GitHub xem có bản mới không. Không ném — hỏng thì sang `error`.
   *
   * `silent` = lượt kiểm tự động lúc khởi động: không có mạng là chuyện thường
   * với app offline, ghi log mức `info` thay vì `error` để không rác log. Lượt
   * do user bấm thì lỗi là thứ họ đang chờ nghe, ghi mức `error`.
   */
  check: (options?: { silent?: boolean }) => Promise<UpdateStatus>;
  /** Bắt đầu tải. Chỉ có tác dụng khi đang ở `available` */
  download: () => Promise<UpdateStatus>;
  /**
   * Thoát app và cài bản đã tải. Chỉ có tác dụng khi đang ở `downloaded`.
   * Trả `false` khi chưa tải xong — nơi gọi phải xử lý chứ không giả định.
   */
  quitAndInstall: () => boolean;
};

export type UpdateServiceDeps = {
  updater: UpdaterLike;
  currentVersion: string;
  support: UpdateSupportInput;
  logger: UpdateLogger;
  onStatusChanged?: (status: UpdateStatus) => void;
  now?: () => number;
};

export const createUpdateService = (deps: UpdateServiceDeps): UpdateService => {
  const { updater, currentVersion, support, logger, onStatusChanged, now = Date.now } = deps;

  const blocked = updateBlockReason(support);

  let status: UpdateStatus = blocked === undefined
    ? { state: 'idle', currentVersion }
    : { state: 'unsupported', currentVersion, message: updateBlockMessage(blocked) };

  /**
   * Đặt trạng thái mới **thay thế** chứ không merge.
   *
   * Merge từng phần là sai ở đây: `availableVersion` và `percent` của lượt
   * trước còn sót lại sẽ hiện "đang tải 87%" cho một lượt kiểm vừa cho kết quả
   * "đã mới nhất". Field nào cần giữ thì chép tường minh.
   */
  const setStatus = (next: UpdateStatus): void => {
    status = next;
    onStatusChanged?.(status);
  };

  updater.on('checking-for-update', () => {
    setStatus({ state: 'checking', currentVersion });
  });

  updater.on('update-available', (info) => {
    // Kiểm lại kết luận của thư viện: `latest.yml` là file người upload, publish
    // nhầm bản cũ đè lên sẽ đẩy user lùi phiên bản (xem `shouldOfferUpdate`).
    if (!shouldOfferUpdate(currentVersion, info.version)) {
      logger.warn(
        `Bỏ qua bản ${info.version} vì không mới hơn bản đang chạy ${currentVersion}`,
        'latest.yml trên GitHub có thể đã bị publish đè bằng release cũ',
      );
      setStatus({ state: 'idle', currentVersion, checkedAt: now() });
      return;
    }

    logger.info(`Có bản mới ${info.version} (đang chạy ${currentVersion})`);
    setStatus({
      state: 'available',
      currentVersion,
      availableVersion: info.version,
      checkedAt: now(),
    });
  });

  updater.on('update-not-available', () => {
    setStatus({ state: 'idle', currentVersion, checkedAt: now() });
  });

  updater.on('download-progress', (progress) => {
    // Giữ lại `availableVersion` của lượt trước: UI hiện "đang tải 0.2.0"
    // trong lúc chạy thanh tiến trình.
    setStatus({
      state: 'downloading',
      currentVersion,
      ...(status.availableVersion === undefined
        ? {}
        : { availableVersion: status.availableVersion }),
      percent: normalizePercent(progress.transferred, progress.total),
      downloadedBytes: progress.transferred,
      totalBytes: progress.total,
    });
  });

  updater.on('update-downloaded', (info) => {
    logger.info(`Đã tải xong bản ${info.version}, chờ user cài`);
    setStatus({
      state: 'downloaded',
      currentVersion,
      availableVersion: info.version,
    });
  });

  updater.on('error', (error) => {
    // Không chặn app: cập nhật hỏng thì user vẫn đọc sách được như thường.
    const message = errorMessage(error);
    logger.error('Cập nhật thất bại', message);
    setStatus({ state: 'error', currentVersion, message });
  });

  // Tải là việc user bấm, không phải việc app tự làm (xem doc đầu file).
  updater.autoDownload = false;
  // Cài lén lúc thoát cũng vậy: user phải biết app sắp bị thay.
  updater.autoInstallOnAppQuit = false;

  return {
    getStatus: () => status,

    check: async (options) => {
      if (blocked !== undefined) return status;

      try {
        await updater.checkForUpdates();
      } catch (error) {
        const message = errorMessage(error);
        // Không có mạng là chuyện thường với app offline — lượt kiểm tự động
        // không nên rác log mức error mỗi lần khởi động.
        if (options?.silent === true) {
          logger.info('Không kiểm được bản mới', message);
        } else {
          logger.error('Không kiểm được bản mới', message);
        }
        setStatus({ state: 'error', currentVersion, message });
      }
      return status;
    },

    download: async () => {
      if (blocked !== undefined) return status;
      // Chỉ tải từ `available`. Bấm hai lần sẽ khởi động hai lượt tải song song
      // ghi vào cùng một file — bản tải về hỏng mà sha512 mới bắt được.
      if (status.state !== 'available') return status;

      try {
        await updater.downloadUpdate();
      } catch (error) {
        const message = errorMessage(error);
        logger.error('Tải bản mới thất bại', message);
        setStatus({ state: 'error', currentVersion, message });
      }
      return status;
    },

    quitAndInstall: () => {
      if (status.state !== 'downloaded') return false;
      logger.info('Thoát app để cài bản mới');
      // `isSilent = false`: hiện trình cài NSIS để user thấy đang xảy ra gì.
      // `isForceRunAfter = true`: mở lại app sau khi cài, nếu không user bấm
      // "cài lại" xong lại thấy màn hình trống.
      updater.quitAndInstall(false, true);
      return true;
    },
  };
};
