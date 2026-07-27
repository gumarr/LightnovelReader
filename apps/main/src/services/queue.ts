import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { errorMessage, JOB_PRIORITY_NORMAL, type AudioBitrate, type BookLang } from '@ln/shared';
import type { QueueCounts, JobRepository } from '../db/repositories/jobs.js';
import type { SegmentRepository } from '../db/repositories/segments.js';
import type { SidecarClient } from './sidecar-client.js';
import type { TimingsStore } from './timings-store.js';
import { bookAudioDir, segmentAudioPath } from './paths.js';

/**
 * Hàng đợi generate audio: một worker chạy tuần tự, trạng thái nằm trong SQLite.
 *
 * **Vì sao chỉ MỘT worker.** `PiperEngine` bên sidecar giữ một `Lock` — mọi
 * request tổng hợp đều xếp hàng bên trong nó. Bắn song song từ main không nhanh
 * hơn (việc này CPU-bound) mà còn làm hàng đợi thật nằm ở chỗ không quan sát
 * được: job hiện `running` trong DB nhưng thực ra đang chờ sidecar, và huỷ nó
 * cũng không nhả CPU.
 *
 * **Vì sao trạng thái nằm ở DB chứ không ở biến.** Generate cả sách mất hàng
 * giờ. Đóng app giữa chừng phải chạy tiếp được — xem `requeueOrphans()`.
 *
 * Worker **không** tự khởi động: `start()` được gọi khi sidecar sẵn sàng, và
 * `pause()` khi sidecar chết. Chạy khi không có sidecar chỉ tạo ra một loạt job
 * lỗi và đốt sạch số lượt thử lại.
 */

export type QueueState = 'idle' | 'running' | 'paused';

export type QueueStatus = {
  state: QueueState;
  counts: QueueCounts;
  /** Job đang tổng hợp, `undefined` khi rỗi */
  currentJobId?: string;
  currentSegmentId?: string;
};

export type EnqueueSegmentsInput = {
  segmentIds: readonly string[];
  /** Số càng lớn càng ưu tiên. Segment sắp phát dùng `JOB_PRIORITY_URGENT`. */
  priority?: number;
};

export type GenerateQueue = {
  /** Thêm segment vào hàng đợi. Trả về số job **mới** tạo. */
  enqueueSegments(input: EnqueueSegmentsInput): number;
  /** Cho worker chạy. Gọi lại nhiều lần vô hại — đang chạy thì không làm gì. */
  start(): void;
  /**
   * Tạm dừng sau khi job hiện tại xong.
   *
   * **Không** huỷ job đang chạy: nó đã tốn công tổng hợp gần xong, vứt đi để
   * rồi generate lại từ đầu là lãng phí thật sự. Muốn cắt ngay thì `cancelAll`.
   */
  pause(): void;
  resume(): void;
  /** Huỷ một job. Đang chạy thì cắt luôn request đang bay. */
  cancelJob(jobId: string): boolean;
  cancelBook(bookId: string): number;
  cancelAll(): number;
  getStatus(): QueueStatus;
  /**
   * Đưa job `running` mồ côi về hàng đợi. Gọi **một lần lúc khởi động**, trước
   * `start()`.
   */
  recover(): number;
};

export type QueueDeps = {
  jobs: JobRepository;
  segments: SegmentRepository;
  timings: TimingsStore;
  /**
   * Lấy client mỗi lần dùng chứ không giữ lại: sidecar restart thì client cũ
   * trỏ vào cổng đã chết. `undefined` nghĩa là chưa sẵn sàng — worker nghỉ.
   */
  getClient: () => SidecarClient | undefined;
  /** Đọc lúc chạy chứ không chốt sẵn — user đổi thư mục audio trong Settings */
  getAudioDir: () => string;
  /** Bitrate từ `AppSettings`, user đổi được (16/24/32) */
  getBitrate: () => AudioBitrate;
  /** Giọng đọc đang chọn. `undefined` khi user chưa cài voice nào. */
  getVoiceId: (lang: BookLang) => string | undefined;
  /** Ngôn ngữ của sách chứa segment — quyết định voice và cách normalize */
  getBookLang: (bookId: string) => BookLang;
  /**
   * Bảng phiên âm user tự sửa cho sách này (P3.5, tầng 3 — plan.md mục 8.1).
   *
   * Đọc lúc chạy như `getAudioDir`: user sửa cách đọc giữa chừng thì những
   * segment còn trong hàng đợi phải dùng bảng mới, không phải bảng lúc enqueue.
   * Bỏ trống thì sidecar chỉ dùng từ điển ship sẵn + luật romaji — cũng là
   * đường mặc định, vì tầng 3 không bắt buộc.
   */
  getPronunciations?: (bookId: string) => Record<string, string>;
  onStatusChanged?: (status: QueueStatus) => void;
  /**
   * Một segment vừa đổi trạng thái (xong, hỏng, hoặc bắt đầu chạy).
   *
   * Tách khỏi `onStatusChanged` vì reader cần biết **segment nào** để đổi nút
   * phát, còn thanh tiến độ chỉ cần con số tổng.
   */
  onSegmentChanged?: (segmentId: string) => void;
  logger?: {
    info: (message: string, detail?: string) => void;
    warn: (message: string, detail?: string) => void;
    error: (message: string, detail?: string) => void;
  };
  now?: () => number;
  newId?: () => string;
};

export const createGenerateQueue = (deps: QueueDeps): GenerateQueue => {
  const {
    jobs,
    segments,
    timings,
    getClient,
    getAudioDir,
    getBitrate,
    getVoiceId,
    getBookLang,
    getPronunciations,
    onStatusChanged,
    onSegmentChanged,
    logger,
  } = deps;
  const now = deps.now ?? (() => Date.now());
  const newId = deps.newId ?? (() => randomUUID());

  let state: QueueState = 'idle';
  /** `true` khi vòng lặp worker đang chạy — chặn hai vòng lặp chồng nhau */
  let draining = false;
  let currentJobId: string | undefined;
  let currentSegmentId: string | undefined;
  /** Huỷ request đang bay khi user dừng job đang chạy */
  let currentAbort: AbortController | undefined;

  const status = (): QueueStatus => ({
    state,
    counts: jobs.counts(),
    ...(currentJobId === undefined ? {} : { currentJobId }),
    ...(currentSegmentId === undefined ? {} : { currentSegmentId }),
  });

  const emit = (): void => {
    onStatusChanged?.(status());
  };

  const emitSegment = (segmentId: string): void => {
    onSegmentChanged?.(segmentId);
  };

  /**
   * Chạy một job từ đầu tới cuối.
   *
   * Trả `false` khi cần dừng vòng lặp (sidecar biến mất) — phân biệt với job
   * hỏng vì lý do của riêng nó, thứ chỉ nên tính vào `attempts` của job đó.
   */
  const runJob = async (jobId: string, segmentId: string): Promise<boolean> => {
    const client = getClient();
    if (client === undefined) {
      // Sidecar chết giữa chừng: trả job về hàng đợi mà **không** tính là một
      // lượt thử hỏng của nó — lỗi không phải của job này.
      jobs.requeueOrphans();
      state = 'paused';
      logger?.warn('Hàng đợi tạm dừng: sidecar chưa sẵn sàng');
      return false;
    }

    const segment = segments.findById(segmentId);
    if (segment === undefined) {
      // Sách bị xoá giữa chừng. CASCADE đã dọn job rồi, nhưng job đang chạy vẫn
      // nằm trong tay worker.
      jobs.markError(jobId, 'Segment không còn tồn tại', now());
      return true;
    }

    const bookId = segments.findBookId(segmentId);
    if (bookId === undefined) {
      jobs.markError(jobId, 'Không tra được sách của segment', now());
      segments.markError(segmentId, 'Không tra được sách của segment');
      return true;
    }

    const lang = getBookLang(bookId);
    const voiceId = getVoiceId(lang);
    if (voiceId === undefined) {
      // Không có voice thì mọi job đều hỏng như nhau — dừng hẳn thay vì đốt
      // sạch số lượt thử của cả hàng đợi vào cùng một nguyên nhân.
      const message = 'Chưa cài giọng đọc nào. Vào màn Giọng đọc để tải.';
      jobs.markError(jobId, message, now());
      segments.markError(segmentId, message);
      state = 'paused';
      logger?.warn('Hàng đợi tạm dừng', message);
      return false;
    }

    const audioDir = getAudioDir();
    const outPath = segmentAudioPath(audioDir, bookId, segment.id);

    const abort = new AbortController();
    currentAbort = abort;
    currentJobId = jobId;
    currentSegmentId = segmentId;
    segments.markGenerating(segmentId);
    emit();
    emitSegment(segmentId);

    try {
      // Sidecar ghi file `.ogg` nhưng KHÔNG tạo thư mục cha — nó chỉ được phép
      // ghi trong `audioDir`, còn tạo thư mục sách là việc của bên biết cấu
      // trúc thư viện.
      await mkdir(bookAudioDir(audioDir, bookId), { recursive: true });

      const pronunciations = getPronunciations?.(bookId);

      const result = await client.synthesize({
        text: segment.text,
        voiceId,
        outPath,
        bitrate: getBitrate(),
        lang,
        ...(pronunciations === undefined ? {} : { pronunciations }),
        signal: abort.signal,
      });

      // Ghi timing TRƯỚC khi đánh dấu ready: đánh dấu trước rồi ghi hỏng thì
      // segment mang `alignStatus: 'estimated'` mà không có file timing nào —
      // player sẽ đi tìm một file không tồn tại.
      await timings.write({
        audioDir,
        bookId,
        segmentId,
        durationMs: result.durationMs,
        source: result.timingSource,
        words: result.timings,
      });

      segments.markReady(segmentId, {
        audioPath: result.audioPath,
        durationMs: result.durationMs,
        audioBytes: result.audioBytes,
        // Cả `phoneme` lẫn `estimate` đều là 'estimated' — chỉ CTC ở Phase 4
        // mới được lên 'aligned'.
        alignStatus: 'estimated',
      });
      jobs.markDone(jobId, now());
      emitSegment(segmentId);
      return true;
    } catch (error) {
      // Bị huỷ thì job đã chuyển `cancelled` ở `cancelJob` — không ghi đè
      // thành lỗi, và cũng không tính là một lượt thử hỏng.
      if (abort.signal.aborted) {
        segments.resetToPending(segmentId);
        emitSegment(segmentId);
        return true;
      }

      const message = errorMessage(error);
      const retryable = jobs.markError(jobId, message, now());
      if (retryable) {
        // Còn lượt thì segment về `pending`: để nguyên `generating` thì UI hiện
        // vòng quay mãi cho tới lượt thử kế.
        segments.resetToPending(segmentId);
      } else {
        segments.markError(segmentId, message);
        logger?.error(`Generate segment ${segmentId} hỏng hẳn`, message);
      }
      emitSegment(segmentId);
      return true;
    } finally {
      currentAbort = undefined;
      currentJobId = undefined;
      currentSegmentId = undefined;
    }
  };

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;

    try {
      for (;;) {
        if (state !== 'running') break;

        const job = jobs.claimNext(now());
        if (job === undefined) {
          // Hết việc. `idle` chứ không `paused`: user không dừng gì cả, và lượt
          // enqueue kế tiếp phải tự chạy được.
          state = 'idle';
          break;
        }

        const keepGoing = await runJob(job.id, job.segmentId);
        emit();
        if (!keepGoing) break;
      }
    } finally {
      draining = false;
      emit();
    }
  };

  return {
    enqueueSegments(input) {
      const priority = input.priority ?? JOB_PRIORITY_NORMAL;
      const createdAt = now();

      const added = jobs.enqueueMany(
        input.segmentIds.map((segmentId) => ({
          id: newId(),
          type: 'synthesize' as const,
          segmentId,
          priority,
          createdAt,
        })),
      );

      for (const segmentId of input.segmentIds) {
        const segment = segments.findById(segmentId);
        // Segment đã có audio thì để nguyên `ready` — nó vẫn phát được trong
        // lúc chờ generate lại.
        if (segment !== undefined && segment.status !== 'ready') segments.markQueued(segmentId);
      }

      emit();
      return added;
    },

    start() {
      if (state === 'running') return;
      state = 'running';
      void drain();
    },

    pause() {
      if (state === 'paused') return;
      state = 'paused';
      emit();
    },

    resume() {
      if (state === 'running') return;
      state = 'running';
      void drain();
    },

    cancelJob(jobId) {
      const job = jobs.findById(jobId);
      const cancelled = jobs.cancel(jobId, now());
      if (!cancelled) return false;

      if (job !== undefined) segments.resetToPending(job.segmentId);
      // Job đang chạy: cắt luôn request đang bay, nếu không sidecar vẫn tổng
      // hợp nốt và giữ CPU cho tới khi xong.
      if (jobId === currentJobId) currentAbort?.abort();

      emit();
      return true;
    },

    cancelBook(bookId) {
      const affected = jobs.cancelByBook(bookId, now());
      // Đưa segment về `pending`: bỏ bước này thì chúng kẹt ở `queued` vĩnh
      // viễn — UI quay vòng cho việc không còn ai làm, mà enqueue lại cũng
      // không cứu được vì segment chưa `ready`.
      for (const segmentId of affected) {
        segments.resetToPending(segmentId);
        emitSegment(segmentId);
      }
      if (currentSegmentId !== undefined && segments.findBookId(currentSegmentId) === bookId) {
        currentAbort?.abort();
      }
      emit();
      return affected.length;
    },

    cancelAll() {
      const affected = jobs.cancelAll(now());
      for (const segmentId of affected) {
        segments.resetToPending(segmentId);
        emitSegment(segmentId);
      }
      currentAbort?.abort();
      emit();
      return affected.length;
    },

    getStatus() {
      return status();
    },

    recover() {
      const count = jobs.requeueOrphans();
      if (count > 0) {
        logger?.info(`Khôi phục ${String(count)} job dở dang từ phiên trước`);
      }
      return count;
    },
  };
};
