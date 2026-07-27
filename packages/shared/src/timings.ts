import type { WordTiming } from './types.js';

/**
 * Mốc thời gian từng từ: **ước lượng** khi thiếu, và **tra cứu** lúc phát.
 *
 * Hai việc này ở chung một file vì chúng là hai nửa của một hợp đồng: hàm ước
 * lượng sinh ra mảng mà hàm tra cứu tiêu thụ, và bất biến chung — mảng sắp xếp
 * tăng dần theo `startMs`, các khoảng không chồng nhau — chỉ giữ được khi cả hai
 * nằm cạnh nhau.
 *
 * Ở `packages/shared` chứ không phải renderer vì main cũng cần: khi segment có
 * audio mà **không** có file timing (sidecar ghi hỏng, user xoá tay file
 * `.json`), main phải ước lượng trước khi trả về, để renderer không bao giờ nhận
 * một segment `ready` mà mảng timing rỗng — highlight sẽ đứng im mà không ai
 * biết vì sao.
 *
 * CLAUDE.md: `alignStatus` đi `none → estimated → aligned`, và **UI phải chạy ở
 * cả ba**. Đây là tầng làm cho `estimated` dùng được ngay.
 */

/**
 * Tách `text` thành các từ kèm vị trí ký tự trong chính chuỗi đó.
 *
 * Ranh giới từ định nghĩa theo **khoảng trắng**, không phải `\w+`: tiếng Việt có
 * dấu nằm ngoài `\w` của regex JS không cờ `u`, và `\p{L}+` lại cắt mất dấu nối
 * trong `Wi-Fi` hay dấu nháy trong `John's` — cắt vụn thì highlight nhảy giữa
 * thân một từ user đang nhìn.
 *
 * `charStart`/`charEnd` trỏ vào `text` gốc (nửa mở: `[charStart, charEnd)`) để
 * subtitle pane tô đúng khoảng ký tự mà không phải dò lại chuỗi.
 */
export type TextWord = {
  w: string;
  charStart: number;
  charEnd: number;
};

export const splitWords = (text: string): TextWord[] => {
  const words: TextWord[] = [];
  // Duyệt tay thay vì `matchAll`: cần vị trí ký tự thật, mà `split` thì mất chỉ số.
  let start = -1;

  for (let i = 0; i <= text.length; i += 1) {
    // Vòng chạy thêm một bước quá cuối chuỗi để chốt từ cuối cùng — nếu không
    // thì từ nào không kết thúc bằng khoảng trắng sẽ bị bỏ.
    const isSpace = i === text.length || /\s/.test(text[i] as string);

    if (isSpace) {
      if (start !== -1) {
        words.push({ w: text.slice(start, i), charStart: start, charEnd: i });
        start = -1;
      }
    } else if (start === -1) {
      start = i;
    }
  }

  return words;
};

/**
 * "Trọng lượng" thời gian của một từ.
 *
 * Chia đều theo **số từ** thì `"Ừ"` và `"nghiêng"` được thời lượng bằng nhau,
 * highlight lệch thấy rõ ngay câu đầu. Chia theo số ký tự sát thực tế hơn nhiều
 * vì thời gian đọc gần tỉ lệ với số âm tiết, mà số âm tiết lại gần tỉ lệ với số
 * ký tự trong cả hai ngôn ngữ app hỗ trợ.
 *
 * Cộng thêm một hằng số cho mỗi từ: giữa hai từ luôn có quãng chuyển, nên từ một
 * ký tự không bao giờ ngắn bằng 1/8 từ tám ký tự.
 */
const WORD_BASE_WEIGHT = 1.5;

const weightOf = (word: string): number => word.length + WORD_BASE_WEIGHT;

/**
 * Ước lượng mốc từng từ khi chưa có timing thật từ phoneme.
 *
 * Trả mảng **liền mạch**: `words[i].endMs === words[i + 1].startMs`. Để hở giữa
 * các từ thì `wordIndexAt` rơi vào khe sẽ trả `-1` và highlight nhấp nháy tắt
 * bật mỗi lần audio đi qua ranh giới từ.
 *
 * `durationMs` ≤ 0 (segment rỗng, hoặc metadata audio chưa nạp) trả mảng rỗng
 * chứ không phải mảng mốc 0 — mảng rỗng làm player rơi về "không highlight", còn
 * mảng toàn số 0 làm nó highlight từ cuối cùng suốt cả segment.
 */
export const estimateWordTimings = (text: string, durationMs: number): WordTiming[] => {
  if (durationMs <= 0) return [];

  const words = splitWords(text);
  if (words.length === 0) return [];

  const total = words.reduce((sum, word) => sum + weightOf(word.w), 0);

  const timings: WordTiming[] = [];
  let elapsed = 0;

  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] as TextWord;
    const startMs = Math.round(elapsed);
    elapsed += (weightOf(word.w) / total) * durationMs;

    timings.push({
      w: word.w,
      startMs,
      // Từ cuối chốt đúng `durationMs`: cộng dồn số thực rồi làm tròn có thể
      // lệch vài ms, mà lệch ở cuối segment nghĩa là highlight tắt sớm trước
      // khi audio dứt.
      endMs: i === words.length - 1 ? durationMs : Math.round(elapsed),
      charStart: word.charStart,
      charEnd: word.charEnd,
    });
  }

  return timings;
};

/**
 * Chỉ số từ đang phát tại mốc `positionMs`, hoặc `-1` khi chưa tới từ nào.
 *
 * Tìm nhị phân chứ không quét tuyến tính: hàm này được gọi **mỗi khung hình**
 * qua `requestAnimationFrame`, và một segment 300 ký tự có tới ~60 từ. Quét
 * tuyến tính vẫn chạy được nhưng là 60 phép so sánh × 60 lần/giây cho một câu
 * trả lời hầu như không đổi giữa hai khung.
 *
 * Khớp theo `startMs` chứ không kiểm cả `endMs`: mảng ước lượng liền mạch nên
 * hai cách cho cùng kết quả, còn mảng từ phoneme **có** khe giữa các từ (chỗ im
 * lặng thật giữa hai tiếng), và ở đó ta muốn giữ nguyên từ vừa đọc chứ không tắt
 * highlight — mắt user không theo kịp nhấp nháy 100ms.
 */
export const wordIndexAt = (timings: readonly WordTiming[], positionMs: number): number => {
  if (timings.length === 0) return -1;
  if (positionMs < (timings[0] as WordTiming).startMs) return -1;

  let lo = 0;
  let hi = timings.length - 1;
  let found = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((timings[mid] as WordTiming).startMs <= positionMs) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Đã qua `endMs` của từ cuối thì segment coi như đọc xong — không giữ highlight
  // ở từ cuối trong khoảng lặng đuôi file.
  const last = timings[timings.length - 1] as WordTiming;
  if (found === timings.length - 1 && positionMs > last.endMs) return -1;

  return found;
};

/**
 * Mốc bắt đầu của từ tại `charOffset` — dùng cho click-to-seek trên subtitle.
 *
 * Bấm vào khoảng trắng giữa hai từ trả về từ **đứng trước**: user bấm vào khe
 * hầu như luôn có ý nhắm từ vừa đọc xong chứ không phải từ kế, và nhảy tới
 * trước sẽ nghe hụt mất một từ.
 *
 * `undefined` khi mảng rỗng hoặc `charOffset` nằm trước từ đầu tiên.
 */
export const seekMsForChar = (
  timings: readonly WordTiming[],
  charOffset: number,
): number | undefined => {
  let candidate: WordTiming | undefined;

  for (const timing of timings) {
    if (timing.charStart > charOffset) break;
    candidate = timing;
  }

  return candidate?.startMs;
};
