import {
  err,
  ok,
  voiceIdSchema,
  type InstalledVoice,
  type Result,
  type VoiceCatalogItem,
  type VoiceDownloadProgress,
} from '@ln/shared';
import type { SidecarClient } from '../../services/sidecar-client.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler cho nhóm `voices:*` — quản lý giọng đọc.
 *
 * **Tải chạy nền, không chờ trong `invoke`.** Một lượt tải mất vài phút; giữ
 * `ipcRenderer.invoke` treo suốt thời gian đó nghĩa là renderer reload một cái
 * là mất luôn đường theo dõi, mà tiến trình tải vẫn chạy tiếp ở main. Nên
 * `download` trả về ngay sau khi nhận lệnh, tiến độ đi qua event riêng.
 *
 * **Một lượt tải mỗi voice.** Bấm hai lần vào cùng một voice thì lần sau bị từ
 * chối chứ không tải song song — hai lượt cùng ghi vào một file `.part` sẽ cho
 * ra file hỏng mà sha256 không giải thích được nguyên nhân.
 */

export type VoicesHandlers = {
  listCatalog: () => Promise<Result<VoiceCatalogItem[]>>;
  listInstalled: () => Promise<Result<InstalledVoice[]>>;
  download: (input: unknown) => Result<void>;
  cancelDownload: (input: unknown) => Result<void>;
  remove: (input: unknown) => Promise<Result<void>>;
};

export type VoicesHandlerDeps = {
  /** `undefined` khi sidecar chưa sẵn sàng — mọi handler phải xử lý nhánh này */
  getClient: () => SidecarClient | undefined;
  /** Đẩy tiến độ xuống renderer */
  onProgress: (progress: VoiceDownloadProgress) => void;
  logError?: (message: string, detail: string) => void;
};

/** Thông báo dùng chung khi sidecar chưa lên — user cần biết phải chờ hay phải sửa */
const SIDECAR_NOT_READY =
  'Dịch vụ TTS chưa sẵn sàng. Chờ vài giây rồi thử lại; nếu vẫn không được, khởi động lại ứng dụng.';

export const createVoicesHandlers = (deps: VoicesHandlerDeps): VoicesHandlers => {
  /** Lượt tải đang chạy, khoá theo voiceId. Giá trị là hàm huỷ. */
  const running = new Map<string, AbortController>();

  const parseVoiceId = (input: unknown): string => {
    const parsed = voiceIdSchema.safeParse(input);
    if (!parsed.success) throw new InvalidInputError('voiceId không hợp lệ');
    return parsed.data;
  };

  return {
    listCatalog: async () => {
      const client = deps.getClient();
      if (client === undefined) return err('SIDECAR_UNAVAILABLE', SIDECAR_NOT_READY);

      const voices = await client.listCatalog();
      return ok(
        voices.map((voice) => ({
          id: voice.id,
          lang: voice.lang,
          name: voice.name,
          quality: voice.quality,
          sampleRate: voice.sampleRate,
          license: voice.license,
          totalBytes: voice.totalBytes,
          installed: voice.installed,
        })),
      );
    },

    listInstalled: async () => {
      const client = deps.getClient();
      if (client === undefined) return err('SIDECAR_UNAVAILABLE', SIDECAR_NOT_READY);

      const voices = await client.listInstalled();
      return ok(
        voices.map((voice) => ({
          id: voice.id,
          lang: voice.lang,
          name: voice.name,
          quality: voice.quality,
          sampleRate: voice.sampleRate,
          sizeBytes: voice.sizeBytes,
        })),
      );
    },

    download: (input) => {
      const voiceId = parseVoiceId(input);

      const client = deps.getClient();
      if (client === undefined) return err('SIDECAR_UNAVAILABLE', SIDECAR_NOT_READY);

      if (running.has(voiceId)) {
        return err('ALREADY_RUNNING', 'Voice này đang được tải rồi.');
      }

      const controller = new AbortController();
      running.set(voiceId, controller);

      // Không `await`: trả về ngay để renderer không treo. Lỗi được đẩy xuống
      // renderer qua chính kênh tiến độ, vì đó là chỗ UI đang nhìn.
      void (async () => {
        try {
          await client.downloadVoice({
            voiceId,
            onProgress: deps.onProgress,
            signal: controller.signal,
          });
        } catch (error) {
          const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
          deps.logError?.(`Tải voice ${voiceId} thất bại`, detail);

          // Huỷ do user bấm dừng thì không phải lỗi — báo `error` ở đây sẽ hiện
          // hộp thoại đỏ cho một hành động user vừa chủ động làm.
          if (!controller.signal.aborted) {
            deps.onProgress({
              voiceId,
              state: 'error',
              receivedBytes: 0,
              totalBytes: 0,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        } finally {
          // Xoá ở `finally`: bỏ sót thì voice bị khoá vĩnh viễn, tải lại lần
          // sau luôn nhận "đang được tải rồi" cho tới khi khởi động lại app.
          running.delete(voiceId);
        }
      })();

      return ok(undefined);
    },

    cancelDownload: (input) => {
      const voiceId = parseVoiceId(input);
      // Không có gì đang tải cũng trả `ok`: user muốn "đừng tải nữa", mà điều
      // đó đã đúng sẵn rồi.
      running.get(voiceId)?.abort();
      return ok(undefined);
    },

    remove: async (input) => {
      const voiceId = parseVoiceId(input);

      const client = deps.getClient();
      if (client === undefined) return err('SIDECAR_UNAVAILABLE', SIDECAR_NOT_READY);

      // Đang tải dở mà xoá thì huỷ trước, nếu không thread tải bên sidecar sẽ
      // dựng lại đúng thư mục vừa xoá.
      running.get(voiceId)?.abort();

      await client.deleteVoice(voiceId);
      return ok(undefined);
    },
  };
};
