import type { SegmentAudio } from '@ln/shared';

/**
 * Bọc `HTMLAudioElement` — chỗ **duy nhất** trong player chạm tới DOM audio và
 * Blob URL.
 *
 * Tách ra vì hai lý do. Thứ nhất, jsdom không phát được audio: `play()` không
 * làm gì, `currentTime` không tự chạy, sự kiện `ended` không bao giờ nổ. Máy
 * trạng thái ở `player-store` phải kiểm được mà không cần thứ đó, nên nó nói
 * chuyện qua interface này chứ không qua thẻ audio thật.
 *
 * Thứ hai, và quan trọng hơn: **Blob URL phải được thu hồi.** Mỗi segment là một
 * `ArrayBuffer` ~30 KB; một chương 1353 segment là ~40 MB rò ra nếu quên
 * `revokeObjectURL`. Gom việc tạo và thu hồi vào một chỗ thì không có đường nào
 * tạo URL mà không đi qua chỗ thu hồi.
 */

export type AudioSink = {
  /**
   * Nạp bytes mới và phát từ `startMs`. Thu hồi Blob URL của lượt trước.
   *
   * Trả về khi audio **đã bắt đầu phát** (hoặc bị chặn bởi chính sách autoplay),
   * không phải khi vừa nạp xong.
   */
  play(bytes: ArrayBuffer, startMs: number): Promise<void>;
  /** Phát tiếp từ vị trí hiện tại, không nạp lại */
  resume(): Promise<void>;
  pause(): void;
  /** Vị trí hiện tại tính bằng ms. `0` khi chưa nạp gì */
  positionMs(): number;
  seek(positionMs: number): void;
  setRate(rate: number): void;
  /** Nhả Blob URL và dừng hẳn — gọi khi rời trình đọc */
  dispose(): void;
};

export type AudioSinkEvents = {
  /** Audio chạy hết segment hiện tại */
  onEnded: () => void;
  /**
   * File không giải mã được.
   *
   * Ca có thật: file `.ogg` bị cắt cụt do mất điện giữa lúc sidecar ghi. DB vẫn
   * nói `ready` và `getSegmentAudio` vẫn trả bytes, chỉ tới khi Chromium giải mã
   * mới lộ. Player phải coi đây như một đoạn hỏng và **đi tiếp**, không đứng lại.
   */
  onError: (message: string) => void;
};

/**
 * Nạp trước segment kế để phát nối liền không hở giữa hai câu.
 *
 * Giữ **cả `SegmentAudio`** chứ không riêng bytes: timing và bytes luôn dùng
 * cùng nhau (mục 4.46), và giữ mỗi bytes thì lúc phát vẫn phải gọi IPC lần nữa
 * để lấy timing — đúng quãng trễ mà việc nạp trước sinh ra để xoá bỏ.
 *
 * Chỉ giữ **một** segment: nạp trước là để bù ~50ms giải mã của segment kế, giữ
 * nhiều hơn là ôm RAM cho những câu user có thể không nghe tới.
 */
export type AudioPreloader = {
  /** Giữ sẵn audio cho một segment. Gọi lại với id khác thì bỏ cái cũ. */
  hold(segmentId: string, audio: SegmentAudio): void;
  /** Lấy ra nếu đang giữ đúng segment đó, đồng thời bỏ khỏi kho */
  take(segmentId: string): SegmentAudio | undefined;
  clear(): void;
};

export const createAudioPreloader = (): AudioPreloader => {
  let held: SegmentAudio | undefined;

  return {
    hold: (segmentId, audio) => {
      held = audio.segmentId === segmentId ? audio : { ...audio, segmentId };
    },
    take: (segmentId) => {
      if (held?.segmentId !== segmentId) return undefined;
      const audio = held;
      held = undefined;
      return audio;
    },
    clear: () => {
      held = undefined;
    },
  };
};

/**
 * `MediaError.code` → câu tiếng Việt.
 *
 * Không dùng `error.message`: Chromium để trống nó trong hầu hết trường hợp, nên
 * log sẽ chỉ có chuỗi rỗng đúng lúc cần chẩn đoán nhất.
 */
const mediaErrorMessage = (error: MediaError | null | undefined): string => {
  // `null` theo chuẩn, nhưng `undefined` cũng gặp thật (jsdom, và cả Chromium
  // khi sự kiện `error` nổ trước lúc `MediaError` được gắn). Đọc `.code` của
  // `undefined` là ném ngay trong event listener — không ai bắt được, mà player
  // thì mất luôn đường bỏ qua đoạn hỏng.
  if (error === null || error === undefined) return 'Không phát được đoạn này.';

  // Số theo chuẩn HTML, không đọc qua hằng `MediaError.MEDIA_ERR_*`: đó là
  // thuộc tính tĩnh của **constructor toàn cục**, mà global đó không có ở mọi
  // môi trường (jsdom không định nghĩa). Chạm vào là `ReferenceError` ném ra
  // ngay trong event listener — không ai bắt được, và player mất luôn đường bỏ
  // qua đoạn hỏng, đúng thứ hàm này sinh ra để giữ.
  switch (error.code) {
    case 1: // MEDIA_ERR_ABORTED
      return 'Lượt phát bị huỷ giữa chừng.';
    case 2: // MEDIA_ERR_NETWORK
      return 'Không đọc được dữ liệu audio.';
    case 3: // MEDIA_ERR_DECODE — ca hay gặp nhất: .ogg cụt vì mất điện lúc ghi
      return 'File audio hỏng, không giải mã được.';
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return 'Định dạng audio không được hỗ trợ.';
    default:
      return 'Không phát được đoạn này.';
  }
};

export const createAudioSink = (element: HTMLAudioElement, events: AudioSinkEvents): AudioSink => {
  let objectUrl: string | undefined;
  /**
   * Tăng mỗi lần nạp nguồn mới. `play()` là bất đồng bộ, nên một lượt phát cũ có
   * thể trả về **sau** khi user đã bấm sang segment khác — dùng số này để bỏ kết
   * quả của lượt đã cũ thay vì để nó ghi đè lượt mới.
   */
  let generation = 0;

  const revoke = (): void => {
    if (objectUrl === undefined) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };

  element.addEventListener('ended', () => {
    events.onEnded();
  });

  element.addEventListener('error', () => {
    events.onError(mediaErrorMessage(element.error));
  });

  /**
   * `play()` reject khi bị chính sách autoplay chặn hoặc khi nguồn bị thay giữa
   * chừng. Cả hai đều **không** phải lỗi đáng dừng player:
   * - Autoplay: lượt phát đầu luôn do user bấm nên không dính, nhưng lượt nối
   *   segment thì trình duyệt coi là tự động — bắt lại thì user thấy nút vẫn ở
   *   trạng thái "đang phát" mà không có tiếng, tệ hơn là báo lỗi rồi dừng hẳn.
   * - Nguồn bị thay: chính ta vừa thay, lượt cũ chết là đúng.
   */
  const startPlayback = async (mine: number): Promise<void> => {
    try {
      await element.play();
    } catch (error) {
      if (mine !== generation) return;
      // `AbortError` = nguồn bị thay giữa chừng, không phải hỏng
      if (error instanceof DOMException && error.name === 'AbortError') return;
      events.onError('Trình duyệt chặn phát tự động. Hãy bấm nút phát.');
    }
  };

  return {
    play: async (bytes, startMs) => {
      generation += 1;
      const mine = generation;

      revoke();
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
      element.src = objectUrl;

      // `currentTime` chỉ đặt được sau khi metadata sẵn sàng; đặt sớm thì bị bỏ
      // qua im lặng. Với `startMs = 0` (đường thường gặp) thì không phải chờ.
      if (startMs > 0) {
        await new Promise<void>((resolve) => {
          const onReady = (): void => {
            element.removeEventListener('loadedmetadata', onReady);
            resolve();
          };
          element.addEventListener('loadedmetadata', onReady);
          element.load();
        });
        if (mine !== generation) return;
        element.currentTime = startMs / 1000;
      }

      await startPlayback(mine);
    },

    resume: async () => {
      generation += 1;
      await startPlayback(generation);
    },

    pause: () => {
      element.pause();
    },

    positionMs: () => element.currentTime * 1000,

    seek: (positionMs) => {
      element.currentTime = Math.max(0, positionMs) / 1000;
    },

    setRate: (rate) => {
      element.playbackRate = rate;
      // CLAUDE.md: đổi tốc độ KHÔNG được regenerate audio. `preservesPitch` giữ
      // cao độ giọng khi đổi tốc độ — không có nó thì 1.5× nghe như giọng hoạt
      // hình và user sẽ tưởng phải sinh lại audio ở tốc độ khác.
      element.preservesPitch = true;
    },

    dispose: () => {
      generation += 1;
      element.pause();
      revoke();
      // Bỏ nguồn để Chromium nhả bộ đệm giải mã; không làm thì thẻ audio giữ
      // nguyên vài MB sau khi rời trình đọc.
      element.removeAttribute('src');
      element.load();
    },
  };
};
