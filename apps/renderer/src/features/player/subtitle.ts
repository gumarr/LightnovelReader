import type { WordTiming } from '@ln/shared';
import { splitWords } from '@ln/shared';

/**
 * Logic thuần cho subtitle pane: cắt text gốc thành từ, và tìm từ đang đọc.
 *
 * Tách khỏi component vì đây là phần **dễ sai và đáng test**, còn phần vẽ chỉ là
 * gán `className`. Component sẽ gọi mấy hàm này trong `requestAnimationFrame`
 * nên chúng phải rẻ và không cấp phát — xem `SubtitlePane.tsx`.
 *
 * Điểm khó nhất là hợp đồng của `WordTiming` sau P3.5: `charStart`/`charEnd` trỏ
 * vào text **gốc**, nhưng **nhiều timing liên tiếp có thể trỏ về cùng một khoảng**
 * (`Tokyo` đọc thành `Tô-ki-ô` là ba timing, một khoảng gốc). Nên không thể lấy
 * `timings` làm danh sách từ để vẽ — phải cắt từ text gốc rồi map ngược lại.
 */

/** Một từ hiển thị trên subtitle, kèm khoảng ký tự trong `Segment.text` gốc. */
export type SubtitleWord = {
  /** Chuỗi hiện lên màn — luôn là chữ user thấy trong sách, không phải bản đọc */
  text: string;
  charStart: number;
  charEnd: number;
};

/**
 * Cắt text segment thành danh sách từ để vẽ.
 *
 * Dùng `splitWords` của `@ln/shared` chứ không tự tách: đó đúng là hàm mà
 * `estimateWordTimings` dùng, nên khi `alignStatus = 'estimated'` thì ranh giới
 * từ ở subtitle trùng khít ranh giới timing — highlight chạy mượt từng từ một.
 */
export const subtitleWords = (text: string): SubtitleWord[] =>
  splitWords(text).map((word) => ({
    text: word.w,
    charStart: word.charStart,
    charEnd: word.charEnd,
  }));

/**
 * Chỉ số từ trong `words` ứng với timing đang phát, hoặc `-1`.
 *
 * Nhận `timing` chứ không nhận `positionMs` để nơi gọi tự tra `wordIndexAt` một
 * lần rồi dùng lại — vòng `rAF` không nên tìm nhị phân hai lượt.
 *
 * Khớp theo **giao khoảng** chứ không theo `charStart` bằng nhau: timing của
 * `Tô-ki-ô` có ba mảnh cùng trỏ về khoảng của `Tokyo`, và một segment `aligned`
 * còn có thể gộp/tách khác với `splitWords`. Giao khoảng cho câu trả lời đúng ở
 * mọi kiểu lệch đó, còn so bằng thì trượt hết.
 */
export const wordIndexForTiming = (
  words: readonly SubtitleWord[],
  timing: WordTiming | undefined,
): number => {
  if (timing === undefined) return -1;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] as SubtitleWord;
    // Nửa mở hai đầu: `[charStart, charEnd)` giao nhau khi start < end kia.
    if (word.charStart < timing.charEnd && timing.charStart < word.charEnd) {
      return i;
    }
  }

  return -1;
};
