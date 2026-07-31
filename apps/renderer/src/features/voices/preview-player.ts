/**
 * Phát thử một đoạn audio nghe thử giọng đọc.
 *
 * **Vì sao không dùng lại `AudioSink` của player.** `AudioSink` bám máy trạng
 * thái phát theo segment: nó có preloader, có sự kiện `onEnded` để nhảy sang
 * đoạn kế, và giữ Blob URL sống qua nhiều lượt đổi segment. Nghe thử là một
 * đoạn rời, phát xong là hết — dùng lại `AudioSink` sẽ phải tắt gần hết những
 * thứ đó rồi vẫn phải tự lo phần thu hồi.
 *
 * **Bất biến cốt lõi:** không bao giờ có quá MỘT Blob URL sống. Mọi đường thoát
 * (phát đoạn mới, dừng tay, rời màn hình, lỗi giải mã) đều đi qua `stop()`. Một
 * lượt nghe thử là ~15 KB, nhưng bấm thử 20 giọng mà không thu hồi thì rò rỉ
 * kéo dài suốt phiên vì không có gì dọn hộ.
 */

export type PreviewPlayer = {
  /** Phát bytes `.ogg`. Đang phát đoạn khác thì đoạn đó dừng và được thu hồi. */
  play: (bytes: ArrayBuffer) => Promise<void>;
  /** Dừng và thu hồi Blob URL. Gọi nhiều lần vô hại. */
  stop: () => void;
};

export type PreviewPlayerEvents = {
  /** Phát hết đoạn — UI đổi nút "Dừng" về "Nghe thử" */
  onEnded: () => void;
  /** Không giải mã được: file hỏng, hoặc Chromium thiếu codec */
  onError: (message: string) => void;
};

export const createPreviewPlayer = (
  element: HTMLAudioElement,
  events: PreviewPlayerEvents,
): PreviewPlayer => {
  let objectUrl: string | undefined;

  const revoke = (): void => {
    if (objectUrl === undefined) return;
    URL.revokeObjectURL(objectUrl);
    objectUrl = undefined;
  };

  const stop = (): void => {
    element.pause();
    // Bỏ `src` TRƯỚC khi thu hồi: để nguyên rồi thu hồi thì Chromium vẫn giữ
    // tham chiếu tới blob đã chết và ghi một dòng lỗi vào console mỗi lần.
    element.removeAttribute('src');
    element.load();
    revoke();
  };

  element.addEventListener('ended', () => {
    // Thu hồi ngay khi hết chứ không đợi lượt phát sau: user nghe một giọng rồi
    // rời màn hình là đường phổ biến nhất, mà đường đó không đi qua `play()`.
    revoke();
    events.onEnded();
  });

  element.addEventListener('error', () => {
    revoke();
    events.onError('Không phát được đoạn nghe thử.');
  });

  return {
    play: async (bytes) => {
      // Dừng đoạn cũ trước: hai lượt chồng nhau thì nghe thành hai giọng cùng
      // lúc, và Blob URL cũ không còn ai thu hồi.
      stop();

      objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/ogg' }));
      element.src = objectUrl;

      try {
        await element.play();
      } catch (error) {
        // `play()` bị từ chối (chính sách autoplay, hoặc bị `pause()` chen vào)
        // vẫn phải thu hồi — không thì url này không còn đường nào dọn.
        revoke();
        throw error;
      }
    },
    stop,
  };
};
