import type { Segment, SegmentStatus } from '@ln/shared';

/**
 * Quyết định **thuần** của player: gặp một segment thì làm gì với nó.
 *
 * Tách khỏi `player-store` vì đây là phần dễ sai nhất của Phase 3 và cũng là
 * phần không cần `<audio>` để kiểm: "segment hỏng thì bỏ qua, không làm gián
 * đoạn" là một quy tắc về **trạng thái**, không phải về DOM. Nhét chung vào
 * store thì mỗi lần kiểm một nhánh lại phải dựng cả thẻ audio giả.
 *
 * Nguyên tắc bao trùm, do user đặt ra: **audio đang chạy thì không được đứt.**
 * Mọi nhánh ở đây phải trả lời được câu "user có nghe thấy khoảng lặng bất
 * thường không?" — và câu trả lời chỉ được phép là "không" trừ khi thật sự phải
 * chờ audio chưa sinh xong.
 */

/**
 * Việc player phải làm với một segment.
 *
 * - `play`   — có audio, phát ngay.
 * - `skip`   — không phát được và **không đáng chờ**: nhảy sang segment kế
 *              ngay lập tức, không hiện gì chặn đường.
 * - `wait`   — sẽ có audio (đang trong hàng đợi), chờ `queue:segmentUpdated`.
 * - `request`— chưa ai xếp, phải xếp ưu tiên rồi mới chờ.
 */
export type SegmentAction = 'play' | 'skip' | 'wait' | 'request';

export type SegmentDecision = {
  action: SegmentAction;
  /** Lý do, để log và để hiện nhãn nhỏ chứ **không** để chặn phát */
  reason: string;
};

/**
 * Segment không có chữ để đọc.
 *
 * Có thật trong dữ liệu: P2.7 đo trên sách DOCX thật thấy **5/195 đoạn** chỉ
 * gồm dấu câu hoặc khoảng trắng, Piper không sinh nổi audio và hàng đợi ghi lỗi.
 * Xếp lại hàng đợi cho những đoạn này là chờ một thứ không bao giờ tới.
 */
const hasSpeakableText = (text: string): boolean => /\p{L}|\p{N}/u.test(text);

/**
 * Quyết định làm gì với một segment.
 *
 * `wantsGenerate = false` (user tắt tự động tạo audio, hoặc chưa chọn giọng) thì
 * mọi segment chưa có audio đều `skip`: chờ một hàng đợi sẽ không chạy là treo
 * player vĩnh viễn, mà đứng im không nói gì là kiểu hỏng tệ nhất.
 */
export const decideSegment = (
  segment: Pick<Segment, 'status' | 'text' | 'errorMessage'>,
  wantsGenerate: boolean,
): SegmentDecision => {
  if (segment.status === 'ready') {
    return { action: 'play', reason: 'có audio' };
  }

  // Đoạn hỏng: KHÔNG thử lại tự động. Hàng đợi đã thử tới hết số lượt retry rồi
  // mới đặt `error`; xếp lại ở đây là bắt user chờ đúng chuỗi thất bại đó lần
  // nữa, ngay giữa lúc đang nghe. Bỏ qua ngay, ghi lại để hiện ở danh sách đoạn.
  if (segment.status === 'error') {
    return { action: 'skip', reason: segment.errorMessage ?? 'đoạn lỗi' };
  }

  // Không có chữ thì không có gì để đọc — dù trạng thái là `pending`. Đây là
  // nguồn gốc của phần lớn đoạn `error` trong dữ liệu thật, bắt sớm ở đây thì
  // không phải đi một vòng hàng đợi mới biết.
  if (!hasSpeakableText(segment.text)) {
    return { action: 'skip', reason: 'đoạn không có chữ để đọc' };
  }

  if (!wantsGenerate) {
    return { action: 'skip', reason: 'chưa bật tạo audio' };
  }

  // Đã nằm trong hàng đợi rồi thì chỉ chờ. Xếp lại cũng không sai (main chỉ nâng
  // priority chứ không tạo job trùng) nhưng là một lượt IPC vô ích mỗi lần
  // player chạm tới segment đó.
  if (segment.status === 'queued' || segment.status === 'generating') {
    return { action: 'wait', reason: 'đang tạo audio' };
  }

  return { action: 'request', reason: 'chưa có audio' };
};

/**
 * Tìm segment kế tiếp **phát được**, bỏ qua mọi segment `skip` trên đường.
 *
 * Đây là hàm giữ lời hứa "không làm gián đoạn": khi audio của segment i vừa hết,
 * player gọi hàm này để biết ngay phải phát gì tiếp — không dừng lại ở từng
 * segment hỏng để rồi phải chờ một vòng sự kiện nữa mới đi tiếp. Mười đoạn hỏng
 * liên tiếp vẫn chỉ là một lần gọi.
 *
 * Trả `undefined` khi hết chương (không còn segment nào phát được **hay** đáng
 * chờ) — player dừng hẳn ở đó.
 *
 * `from` là chỉ số bắt đầu **đã bao gồm**: gọi với chỉ số của segment vừa phát
 * xong cộng một.
 */
export type NextTarget = {
  index: number;
  decision: SegmentDecision;
  /** Segment bị bỏ qua trên đường tới đây — để báo user "đã bỏ N đoạn" */
  skipped: { index: number; reason: string }[];
};

export const findNextPlayable = (
  segments: readonly Pick<Segment, 'status' | 'text' | 'errorMessage'>[],
  from: number,
  wantsGenerate: boolean,
): NextTarget | undefined => {
  const skipped: { index: number; reason: string }[] = [];

  for (let index = Math.max(0, from); index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;

    const decision = decideSegment(segment, wantsGenerate);
    if (decision.action === 'skip') {
      skipped.push({ index, reason: decision.reason });
      continue;
    }

    return { index, decision, skipped };
  }

  return undefined;
};

/**
 * Đoạn bị bỏ qua ở **đuôi chương** — phần mà `findNextPlayable` nuốt mất.
 *
 * Khi không còn segment nào phát được, `findNextPlayable` trả `undefined` và
 * mảng `skipped` nó đang dựng dở mất theo. Nhưng những đoạn đó vẫn cần hiện cho
 * user: "chương này bỏ 4 đoạn cuối vì lỗi" khác hẳn "chương hết ở đây".
 *
 * Chỉ gọi khi `findNextPlayable` đã trả `undefined` — lúc đó mọi segment từ
 * `from` trở đi chắc chắn đều là `skip`.
 */
export const tailSkips = (
  segments: readonly Pick<Segment, 'status' | 'text' | 'errorMessage'>[],
  from: number,
  wantsGenerate: boolean,
): { index: number; reason: string }[] => {
  const rows: { index: number; reason: string }[] = [];

  for (let index = Math.max(0, from); index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;

    const decision = decideSegment(segment, wantsGenerate);
    // Thủ thế: nếu có gì phát được ở đây thì gọi sai chỗ, dừng lại còn hơn báo
    // nhầm cho user là đã bỏ qua một đoạn nghe được.
    if (decision.action !== 'skip') break;

    rows.push({ index, reason: decision.reason });
  }

  return rows;
};

/**
 * Segment nên được nạp trước để phát nối liền không hở.
 *
 * `<audio>` cần vài chục ms để giải mã đoạn đầu file Ogg; nạp đúng lúc segment
 * trước vừa dứt thì nghe rõ một khoảng hụt giữa hai câu. Nạp sẵn segment kế
 * ngay khi segment hiện tại bắt đầu phát thì khoảng hụt đó biến mất.
 *
 * Chỉ trả segment **`ready`**: nạp trước một segment đang generate là vô nghĩa
 * (chưa có file để tải), và bỏ qua đoạn `skip` để nạp đúng thứ sẽ phát thật.
 */
export const findPreloadTarget = (
  segments: readonly Pick<Segment, 'status' | 'text' | 'errorMessage'>[],
  after: number,
  wantsGenerate: boolean,
): number | undefined => {
  const next = findNextPlayable(segments, after + 1, wantsGenerate);
  return next?.decision.action === 'play' ? next.index : undefined;
};

/**
 * Các segment nên xếp ưu tiên khi player sắp chạy tới.
 *
 * Không chỉ xếp đúng segment đang cần: sinh một segment mất ~1.5–2.5s trong khi
 * phát nó chỉ mất ~10s, nên nếu chỉ xếp từng cái một thì player luôn chạy sát
 * nút và hụt ngay khi có một segment dài. Xếp trước vài cái để hàng đợi luôn đi
 * trước đầu phát.
 *
 * Trần `limit` để không biến "bấm phát" thành "generate cả chương" — CLAUDE.md
 * bắt buộc hiện ước lượng trước khi generate hàng loạt, mà đây là đường đi vòng
 * qua hộp đó.
 */
export const segmentsToPrioritise = (
  segments: readonly Pick<Segment, 'id' | 'status' | 'text' | 'errorMessage'>[],
  from: number,
  limit: number,
): string[] => {
  const ids: string[] = [];

  for (let index = Math.max(0, from); index < segments.length && ids.length < limit; index += 1) {
    const segment = segments[index];
    if (segment === undefined) continue;

    // Chỉ xếp thứ thật sự thiếu: `ready` không cần, `error` không đáng thử lại,
    // `queued`/`generating` đã có job rồi.
    const status: SegmentStatus = segment.status;
    if (status !== 'pending') continue;
    if (!hasSpeakableText(segment.text)) continue;

    ids.push(segment.id);
  }

  return ids;
};
