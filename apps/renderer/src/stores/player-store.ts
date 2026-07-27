import { create } from 'zustand';
import {
  errorMessage,
  JOB_PRIORITY_URGENT,
  PLAYBACK_LOOKAHEAD_SEGMENTS,
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  type Segment,
  type SegmentAudio,
  type WordTiming,
} from '@ln/shared';
import type { AudioPreloader, AudioSink } from '../features/player/audio-element.js';
import {
  findNextPlayable,
  findPreloadTarget,
  segmentsToPrioritise,
  tailSkips,
} from '../features/player/playback-plan.js';

/**
 * Máy trạng thái của player: phát segment nào, khi nào sang segment kế.
 *
 * **Ràng buộc bao trùm (user đặt ra): audio đang chạy thì không được đứt.**
 * Mọi đường đi ở đây phải trả lời được "user có nghe thấy khoảng lặng bất thường
 * không?". Cụ thể:
 *
 * - Segment hỏng → **bỏ qua ngay**, không hộp thoại, không dừng. Ghi vào
 *   `skipped` để hiện một dòng nhỏ chứ không chặn đường.
 * - File hỏng lộ ra lúc giải mã (`.ogg` cụt) → cũng là bỏ qua, cùng đường.
 * - Chỉ dừng khi thật sự phải chờ audio **chưa sinh xong**, và lúc đó nói rõ
 *   đang chờ cái gì.
 *
 * Store **không** giữ vị trí phát theo ms. Đó là thứ đổi 60 lần/giây; đưa vào
 * zustand là re-render cả cây mỗi khung hình, đúng thứ CLAUDE.md cấm. P3.4 đọc
 * thẳng `sink.positionMs()` trong `requestAnimationFrame`.
 */

/** Xem PROGRESS.md mục 4.3 — invoke vẫn reject được dù handler không throw */
const IPC_FAILED = 'Không kết nối được tiến trình chính. Hãy khởi động lại ứng dụng.';

/**
 * Trạng thái player mà UI cần phân biệt.
 *
 * `waiting` tách riêng khỏi `playing` vì đó là lúc **duy nhất** user phải chờ —
 * nút phải nói rõ "đang tạo audio" chứ không quay vòng vô nghĩa.
 */
export type PlaybackState = 'idle' | 'playing' | 'paused' | 'waiting';

/** Một segment bị bỏ qua, để hiện cho user biết chứ không chặn phát */
export type SkippedSegment = {
  segmentId: string;
  index: number;
  reason: string;
};

export type PlayerState = {
  state: PlaybackState;
  /** Segment đang phát hoặc đang chờ. `null` khi chưa bắt đầu */
  segmentId: string | null;
  /** Mốc từng từ của segment đang phát — P3.4 dùng để highlight */
  timings: WordTiming[];
  /** Thời lượng segment đang phát, ms */
  durationMs: number;
  playbackRate: number;
  /**
   * Đoạn đã bỏ qua trong lượt nghe này. Chỉ để hiển thị — player **không** dừng
   * vì danh sách này dài ra.
   */
  skipped: SkippedSegment[];
  /** Lỗi thật sự chặn nghe (mất kết nối IPC). Đoạn hỏng lẻ **không** vào đây. */
  error: string | null;

  /** Bắt đầu phát từ một segment. Segment đó hỏng thì tự nhảy tới cái phát được */
  playFrom: (segmentId: string) => Promise<void>;
  toggle: () => Promise<void>;
  pause: () => void;
  next: () => Promise<void>;
  previous: () => Promise<void>;
  /** Nhảy tới mốc trong segment đang phát — click-to-seek ở P3.4 */
  seek: (positionMs: number) => void;
  setRate: (rate: number) => Promise<void>;
  /** Áp tốc độ đọc từ settings — KHÔNG ghi ngược xuống settings */
  applyStoredRate: (rate: number) => void;
  /** Hàng đợi báo một segment vừa đổi trạng thái — có thể là thứ đang chờ */
  handleSegmentUpdate: (segment: Segment) => Promise<void>;
  /** Audio chạy hết segment hiện tại */
  handleEnded: () => Promise<void>;
  /** Chromium không giải mã được file — coi như đoạn hỏng, đi tiếp */
  handleAudioError: (message: string) => Promise<void>;
  /** Rời trình đọc: dừng, nhả Blob URL, quên hết */
  reset: () => void;
};

/**
 * Thứ store cần từ bên ngoài.
 *
 * Tiêm vào thay vì gọi thẳng `window.api` để test chạy được mà không cần dựng
 * cả preload — và quan trọng hơn, để `sink` thay được bằng bản giả: jsdom không
 * phát audio nên máy trạng thái phải kiểm được mà không có thẻ `<audio>` thật.
 */
export type PlayerDeps = {
  sink: AudioSink;
  preloader: AudioPreloader;
  /** Danh sách segment của chương đang mở, theo thứ tự đọc */
  getSegments: () => readonly Segment[];
  /** Có được phép tự sinh audio không (đã chọn giọng, sidecar sống) */
  canGenerate: () => boolean;
  /** Báo cho trình đọc biết segment đang phát để cuộn + tô */
  onSegmentChanged: (segmentId: string) => void;
  fetchAudio: (segmentId: string) => Promise<SegmentAudio | undefined>;
  enqueueUrgent: (segmentIds: string[]) => Promise<void>;
  /**
   * Ghi tốc độ user vừa chọn xuống settings để phiên sau dùng lại.
   *
   * Tuỳ chọn: store vẫn chạy đúng khi không có nó, chỉ là không nhớ qua phiên.
   * Tách khỏi `window.api` để test không phải dựng preload.
   */
  persistRate?: (rate: number) => void;
};

let deps: PlayerDeps | undefined;

/** Nối store với thế giới thật. Gọi một lần khi mở trình đọc. */
export const attachPlayer = (next: PlayerDeps): void => {
  deps = next;
};

export const detachPlayer = (): void => {
  deps = undefined;
};

const emptyState = (): Pick<
  PlayerState,
  'state' | 'segmentId' | 'timings' | 'durationMs' | 'skipped' | 'error'
> => ({
  state: 'idle',
  segmentId: null,
  timings: [],
  durationMs: 0,
  skipped: [],
  error: null,
});

export const usePlayerStore = create<PlayerState>((set, get) => {
  /**
   * Segment player đang chờ hàng đợi sinh xong.
   *
   * Ngoài state vì nó chỉ dùng để so khớp trong `handleSegmentUpdate`, không có
   * gì trên màn hình đọc nó — để trong state là thêm một lượt re-render mỗi lần
   * hàng đợi nhúc nhích.
   */
  let awaitingSegmentId: string | undefined;

  /**
   * Tăng mỗi lần user đổi ý (bấm phát chỗ khác, next, previous, reset).
   *
   * Nạp audio là `await`; không có mốc này thì một lượt nạp cũ trả về muộn sẽ
   * phát đè lên segment user vừa chọn. Kiểm tra sau **mọi** `await`.
   */
  let generation = 0;

  const indexOf = (segmentId: string): number =>
    deps?.getSegments().findIndex((s) => s.id === segmentId) ?? -1;

  /** Ghi nhận một đoạn bị bỏ qua. KHÔNG đổi `state` — phát vẫn chạy tiếp. */
  const noteSkipped = (entries: { index: number; reason: string }[]): void => {
    if (entries.length === 0) return;
    const segments = deps?.getSegments() ?? [];

    const rows = entries.flatMap<SkippedSegment>(({ index, reason }) => {
      const segment = segments[index];
      return segment === undefined ? [] : [{ segmentId: segment.id, index, reason }];
    });

    if (rows.length > 0) set((s) => ({ skipped: [...s.skipped, ...rows] }));
  };

  /**
   * Xếp ưu tiên vài segment phía trước để hàng đợi luôn đi trước đầu phát.
   *
   * Chạy nền, **không** `await` ở đường phát: chờ IPC xong mới phát là thêm một
   * quãng trễ vào đúng chỗ ta đang cố xoá bỏ. Hỏng thì im lặng — segment sẽ được
   * xếp lại khi player thật sự chạm tới nó.
   */
  const lookahead = (from: number): void => {
    if (deps === undefined || !deps.canGenerate()) return;

    const ids = segmentsToPrioritise(deps.getSegments(), from, PLAYBACK_LOOKAHEAD_SEGMENTS);
    if (ids.length === 0) return;

    void deps.enqueueUrgent(ids).catch(() => undefined);
  };

  /** Nạp sẵn segment kế để hai câu nối liền không hở */
  const preloadNext = (afterIndex: number): void => {
    if (deps === undefined) return;

    const target = findPreloadTarget(deps.getSegments(), afterIndex, deps.canGenerate());
    if (target === undefined) return;

    const segment = deps.getSegments()[target];
    if (segment === undefined) return;

    const mine = generation;
    void deps
      .fetchAudio(segment.id)
      .then((audio) => {
        // Đã đổi ý giữa chừng thì vứt — giữ lại là giữ 30 KB cho segment không
        // còn liên quan, và `take()` sau này sẽ trả nhầm.
        if (audio === undefined || mine !== generation) return;
        deps?.preloader.hold(segment.id, audio);
      })
      .catch(() => undefined);
  };

  /**
   * Phát segment ở `index`, tự nhảy qua mọi đoạn không phát được.
   *
   * Đây là đường đi duy nhất bắt đầu phát một segment — `playFrom`, `next`,
   * `handleEnded`, `handleSegmentUpdate` đều dồn về đây, nên quy tắc "bỏ qua
   * đoạn hỏng" chỉ cần đúng ở một chỗ.
   *
   * `fresher` là segment vừa được hàng đợi đẩy xuống, **mới hơn** danh sách mà
   * `getSegments()` trả về. Cần nó vì hai bên cập nhật không cùng nhịp: main gửi
   * một event, `reader-store` nhận và React render lại, nhưng player được gọi
   * ngay trong cùng lượt đó nên vẫn thấy danh sách cũ. Không có tham số này thì
   * player kết luận segment vẫn `pending` và **đứng chờ mãi** dù audio đã sẵn
   * sàng — xem PROGRESS mục 4.53.
   */
  const playAt = async (from: number, fresher?: Segment): Promise<void> => {
    if (deps === undefined) return;

    generation += 1;
    const mine = generation;
    awaitingSegmentId = undefined;

    const wantsGenerate = deps.canGenerate();
    const stored = deps.getSegments();
    // Vá bản mới vào đúng chỗ của nó thay vì tin danh sách cũ
    const segments =
      fresher === undefined
        ? stored
        : stored.map((s) => (s.id === fresher.id ? fresher : s));
    const target = findNextPlayable(segments, from, wantsGenerate);

    if (target === undefined) {
      // Hết chương — kể cả khi đuôi chương toàn đoạn hỏng. Ghi lại phần đuôi đã
      // bỏ qua rồi dừng sạch, chứ không treo ở `waiting` cho thứ không bao giờ
      // tới. `findNextPlayable` trả `undefined` nên `skipped` của nó mất theo:
      // dựng lại bằng cách duyệt đúng khoảng còn lại.
      noteSkipped(tailSkips(segments, from, wantsGenerate));
      deps.sink.pause();
      set({ state: 'idle', segmentId: null, timings: [], durationMs: 0 });
      return;
    }

    noteSkipped(target.skipped);

    // Lấy từ `segments` (đã vá bản mới) chứ không gọi lại `getSegments()`:
    // gọi lại là quay về đúng danh sách cũ mà `fresher` sinh ra để sửa.
    const segment = segments[target.index];
    if (segment === undefined) return;

    deps.onSegmentChanged(segment.id);

    if (target.decision.action !== 'play') {
      // Phải chờ hàng đợi. Nói rõ đang chờ đoạn nào, và xếp ưu tiên nếu chưa ai
      // xếp — `request` nghĩa là segment còn `pending`.
      awaitingSegmentId = segment.id;
      set({ state: 'waiting', segmentId: segment.id, timings: [], durationMs: 0 });

      if (target.decision.action === 'request') {
        await deps.enqueueUrgent([segment.id]);
      }
      lookahead(target.index);
      return;
    }

    set({ state: 'playing', segmentId: segment.id });

    // Nạp sẵn từ lượt trước thì không phải chờ IPC — đây là thứ xoá khoảng hụt
    // giữa hai câu. Kho giữ cả `SegmentAudio` nên có sẵn cả timing, không phải
    // gọi thêm lượt nào.
    const audio = deps.preloader.take(segment.id) ?? (await deps.fetchAudio(segment.id));
    if (mine !== generation) return;

    if (audio === undefined) {
      // `getSegmentAudio` trả NOT_FOUND: DB nói `ready` mà file không còn
      // (Storage Manager vừa xoá dưới chân player). Không dừng — bỏ qua rồi đi
      // tiếp như mọi đoạn thiếu audio khác.
      noteSkipped([{ index: target.index, reason: 'file audio không còn' }]);
      await playAt(target.index + 1);
      return;
    }

    set({ timings: audio.timings, durationMs: audio.durationMs });

    deps.sink.setRate(get().playbackRate);
    await deps.sink.play(audio.bytes, 0);
    if (mine !== generation) return;

    lookahead(target.index);
    preloadNext(target.index);
  };

  return {
    ...emptyState(),
    playbackRate: 1,

    playFrom: async (segmentId) => {
      const index = indexOf(segmentId);
      if (index === -1) return;
      set({ error: null });
      await playAt(index);
    },

    toggle: async () => {
      const { state, segmentId } = get();

      if (state === 'playing') {
        deps?.sink.pause();
        set({ state: 'paused' });
        return;
      }

      if (state === 'paused' && segmentId !== null) {
        set({ state: 'playing' });
        await deps?.sink.resume();
        return;
      }

      // `waiting` thì bấm nút không làm gì được ngoài dừng chờ — coi như tạm
      // dừng để user không thấy nút chết.
      if (state === 'waiting') {
        awaitingSegmentId = undefined;
        set({ state: 'paused' });
        return;
      }

      // `idle`: phát từ segment đầu chương, hoặc từ chỗ đang chọn
      const segments = deps?.getSegments() ?? [];
      if (segments.length === 0) return;
      await playAt(0);
    },

    pause: () => {
      if (get().state !== 'playing') return;
      deps?.sink.pause();
      set({ state: 'paused' });
    },

    next: async () => {
      const { segmentId } = get();
      const from = segmentId === null ? 0 : indexOf(segmentId) + 1;
      await playAt(from);
    },

    previous: async () => {
      const { segmentId } = get();
      if (segmentId === null) return;

      const index = indexOf(segmentId);
      if (index <= 0) {
        // Đã ở đoạn đầu: quay về đầu đoạn thay vì không làm gì — giống mọi
        // trình phát nhạc, và tránh cảm giác nút chết.
        deps?.sink.seek(0);
        return;
      }

      // Lùi phải bỏ qua đoạn hỏng theo chiều ngược lại, nếu không bấm "trước" ở
      // ngay sau một chuỗi đoạn hỏng sẽ nhảy về đúng chỗ vừa bỏ qua rồi lại nhảy
      // tới — trông như nút không ăn.
      const segments = deps?.getSegments() ?? [];
      const wantsGenerate = deps?.canGenerate() ?? false;

      for (let i = index - 1; i >= 0; i -= 1) {
        const found = findNextPlayable(segments, i, wantsGenerate);
        if (found !== undefined && found.index === i) {
          await playAt(i);
          return;
        }
      }

      deps?.sink.seek(0);
    },

    seek: (positionMs) => {
      deps?.sink.seek(positionMs);
    },

    setRate: async (rate) => {
      const clamped = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate));
      // Bấm lại đúng mốc đang chọn thì không ghi settings — phím tắt ở hai đầu
      // danh sách trả về chính giá trị cũ, và mỗi lần ghi là một lượt IPC + một
      // lượt ghi SQLite cho thứ không đổi.
      if (get().playbackRate === clamped) return;

      set({ playbackRate: clamped });
      deps?.sink.setRate(clamped);
      deps?.persistRate?.(clamped);
    },

    /**
     * Áp tốc độ đã lưu từ phiên trước.
     *
     * Tách khỏi `setRate` vì **không** được ghi ngược xuống settings: đây là
     * đường đọc, ghi lại là tự ghi đè chính thứ vừa đọc lên.
     */
    applyStoredRate: (rate) => {
      const clamped = Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, rate));
      set({ playbackRate: clamped });
      deps?.sink.setRate(clamped);
    },

    handleSegmentUpdate: async (segment) => {
      // Chỉ quan tâm segment player đang đứng chờ
      if (awaitingSegmentId !== segment.id) return;

      if (segment.status === 'ready') {
        awaitingSegmentId = undefined;
        // Truyền chính bản vừa nhận: danh sách trong `reader-store` có thể chưa
        // kịp cập nhật, và tin nó thì player đứng chờ mãi (mục 4.53)
        await playAt(indexOf(segment.id), segment);
        return;
      }

      if (segment.status === 'error') {
        // Thứ đang chờ hỏng hẳn: bỏ qua và đi tiếp ngay, không bắt user chờ nữa
        awaitingSegmentId = undefined;
        const index = indexOf(segment.id);
        noteSkipped([{ index, reason: segment.errorMessage ?? 'đoạn lỗi' }]);
        await playAt(index + 1);
      }
      // `queued`/`generating`: vẫn đang tới, chờ tiếp
    },

    handleEnded: async () => {
      const { segmentId, state } = get();
      // Sự kiện `ended` của lượt cũ có thể tới sau khi user đã tạm dừng
      if (segmentId === null || state !== 'playing') return;

      await playAt(indexOf(segmentId) + 1);
    },

    handleAudioError: async (message) => {
      const { segmentId, state } = get();
      if (segmentId === null || state !== 'playing') return;

      // File `.ogg` cụt: DB nói `ready`, IPC trả bytes, chỉ Chromium mới biết là
      // hỏng. Coi hệt như đoạn lỗi — bỏ qua, đi tiếp, không dừng nhạc.
      const index = indexOf(segmentId);
      noteSkipped([{ index, reason: message }]);
      await playAt(index + 1);
    },

    reset: () => {
      generation += 1;
      awaitingSegmentId = undefined;
      deps?.sink.dispose();
      deps?.preloader.clear();
      set(emptyState());
    },
  };
});

/**
 * Vị trí phát hiện tại, ms. `0` khi chưa nối player hoặc chưa nạp gì.
 *
 * **Cố ý không phải state zustand.** Giá trị này đổi 60 lần/giây; đưa vào store
 * là re-render cả cây mỗi khung hình, đúng thứ CLAUDE.md cấm. Người gọi đọc nó
 * trong `requestAnimationFrame` rồi ghi thẳng vào DOM qua `ref` — xem
 * `useSegmentProgress`. P3.4 dùng chung đường này để highlight từng từ.
 */
export const playerPositionMs = (): number => deps?.sink.positionMs() ?? 0;

/** Gói lỗi IPC thành thông điệp cho user. Dùng ở chỗ nối `window.api`. */
export const playerIpcError = (e: unknown): string => `${IPC_FAILED} (${errorMessage(e)})`;

/** Priority dùng cho segment sắp phát — plan.md: "nhảy đầu hàng đợi" */
export const PLAYER_ENQUEUE_PRIORITY = JOB_PRIORITY_URGENT;
