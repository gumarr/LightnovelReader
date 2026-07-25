/**
 * Bản nháp cấu trúc chương — thứ user sửa ở màn "Xác nhận cấu trúc chương"
 * trước khi lưu vào DB.
 *
 * Tách khỏi `Chapter` trong `types.ts` vì hai thứ khác nhau về bản chất:
 * `Chapter` là bản ghi đã lưu (có `id`, `bookId`, `segmentCount`, trạng thái
 * generate), còn `ChapterDraft` chỉ tồn tại trong lúc user còn đang sửa —
 * chưa có ID thật, chưa có segment nào.
 *
 * Mọi hàm ở đây **thuần**: nhận mảng, trả mảng mới, không sửa đầu vào. Nhờ vậy
 * undo ở renderer chỉ là giữ lại mảng cũ, không cần cơ chế riêng.
 */

/**
 * Một chương trong bản nháp.
 *
 * `pageStart`/`pageEnd` đếm từ 1 và **bao gồm cả hai đầu**. Với DOCX thì đây
 * là chỉ số paragraph chứ không phải trang giấy — xem `hasRealPages`.
 */
export type ChapterDraft = {
  /** ID tạm, chỉ dùng làm React key và để định danh khi sửa. Không vào DB. */
  id: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  /**
   * Điểm tin cậy từ detector. 0 = fallback chia đều theo trang.
   * `undefined` = chương do user tự tạo (tách/gộp), không còn ý nghĩa "tin cậy".
   */
  confidence?: number;
  /** User bỏ chọn để không đưa vào sách (bìa, mục lục, trang quảng cáo) */
  excluded: boolean;
};

/**
 * Vấn đề phát hiện trong bản nháp. `blocking` quyết định có chặn nút "Xác
 * nhận" hay không — cảnh báo mềm (chương quá dài) không nên chặn user.
 */
export type DraftIssueKind =
  | 'empty-title'
  | 'duplicate-title'
  | 'no-chapters'
  | 'gap'
  | 'overlap'
  | 'invalid-range';

export type DraftIssue = {
  kind: DraftIssueKind;
  message: string;
  /** Chương liên quan. `undefined` với vấn đề ở mức toàn bộ danh sách. */
  chapterId?: string;
  blocking: boolean;
};

/** Sinh ID tạm cho chương mới. Chỉ dùng trong bản nháp, không lưu DB. */
export const nextDraftId = (existing: readonly ChapterDraft[]): string => {
  // Không dùng random: ID phải đoán trước được để test khoá kết quả, và bản
  // nháp không bao giờ rời khỏi một tiến trình nên không cần chống trùng toàn cục.
  let max = 0;
  for (const chapter of existing) {
    const match = /^c(\d+)$/.exec(chapter.id);
    if (match !== null) max = Math.max(max, Number(match[1]));
  }
  return `c${max + 1}`;
};

/** Sắp theo trang bắt đầu — thứ tự hiển thị luôn là thứ tự đọc */
const sortByPage = (chapters: readonly ChapterDraft[]): ChapterDraft[] =>
  [...chapters].sort((a, b) => a.pageStart - b.pageStart || a.pageEnd - b.pageEnd);

/**
 * Gộp một chương vào chương ngay trước nó.
 *
 * Giữ tên chương **trước** vì đó là tên user thấy ở đầu vùng gộp; tên chương
 * sau thường là phần tiếp nối ("Chương 2 (tiếp)") nên bỏ đi hợp lý hơn.
 *
 * Gộp chương đầu tiên là không hợp lệ (không có gì phía trước) → trả nguyên mảng.
 */
export const mergeWithPrevious = (
  chapters: readonly ChapterDraft[],
  chapterId: string,
): ChapterDraft[] => {
  const sorted = sortByPage(chapters);
  const index = sorted.findIndex((c) => c.id === chapterId);
  if (index <= 0) return sorted;

  const previous = sorted[index - 1]!;
  const current = sorted[index]!;

  const merged: ChapterDraft = {
    id: previous.id,
    title: previous.title,
    pageStart: Math.min(previous.pageStart, current.pageStart),
    pageEnd: Math.max(previous.pageEnd, current.pageEnd),
    // Vùng trang đã khác vùng detector chấm điểm → điểm cũ không còn nghĩa
    excluded: previous.excluded,
  };

  return [...sorted.slice(0, index - 1), merged, ...sorted.slice(index + 1)];
};

/**
 * Tách một chương làm đôi tại `atPage` — trang này thành trang đầu của nửa sau.
 *
 * Không tách được khi `atPage` nằm ngoài chương hoặc bằng đúng `pageStart`
 * (nửa đầu sẽ rỗng) → trả nguyên mảng thay vì sinh chương 0 trang.
 */
export const splitAt = (
  chapters: readonly ChapterDraft[],
  chapterId: string,
  atPage: number,
): ChapterDraft[] => {
  const sorted = sortByPage(chapters);
  const index = sorted.findIndex((c) => c.id === chapterId);
  if (index < 0) return sorted;

  const target = sorted[index]!;
  if (!Number.isInteger(atPage)) return sorted;
  if (atPage <= target.pageStart || atPage > target.pageEnd) return sorted;

  const first: ChapterDraft = {
    id: target.id,
    title: target.title,
    pageStart: target.pageStart,
    pageEnd: atPage - 1,
    excluded: target.excluded,
  };

  const second: ChapterDraft = {
    id: nextDraftId(sorted),
    // Không bịa tên: để rỗng thì `validateDraft` báo lỗi và user buộc phải đặt
    title: '',
    pageStart: atPage,
    pageEnd: target.pageEnd,
    excluded: target.excluded,
  };

  return [...sorted.slice(0, index), first, second, ...sorted.slice(index + 1)];
};

/**
 * Xoá hẳn một chương khỏi bản nháp.
 *
 * Trang của chương bị xoá **không** được nhập vào chương lân cận — user xoá
 * chương thường là muốn bỏ luôn nội dung (trang quảng cáo, lời bạt). Muốn giữ
 * nội dung thì dùng gộp. Khoảng trống sinh ra sẽ được `validateDraft` báo.
 */
export const removeChapter = (
  chapters: readonly ChapterDraft[],
  chapterId: string,
): ChapterDraft[] => sortByPage(chapters).filter((c) => c.id !== chapterId);

export const renameChapter = (
  chapters: readonly ChapterDraft[],
  chapterId: string,
  title: string,
): ChapterDraft[] =>
  sortByPage(chapters).map((c) => (c.id === chapterId ? { ...c, title } : c));

/**
 * Bật/tắt loại trừ. Chương bị loại vẫn nằm trong danh sách (user đổi ý được)
 * nhưng không sinh segment.
 */
export const toggleExcluded = (
  chapters: readonly ChapterDraft[],
  chapterId: string,
): ChapterDraft[] =>
  sortByPage(chapters).map((c) => (c.id === chapterId ? { ...c, excluded: !c.excluded } : c));

/**
 * Kiểm tra bản nháp trước khi cho lưu.
 *
 * Cố ý **không** tự sửa: user phải thấy vấn đề rồi tự quyết. Tự vá khoảng
 * trống sẽ âm thầm nhét trang quảng cáo vào chương thật.
 */
export const validateDraft = (
  chapters: readonly ChapterDraft[],
  totalPages: number,
): DraftIssue[] => {
  const issues: DraftIssue[] = [];
  const active = sortByPage(chapters).filter((c) => !c.excluded);

  if (active.length === 0) {
    issues.push({
      kind: 'no-chapters',
      message: 'Phải giữ lại ít nhất một chương.',
      blocking: true,
    });
    return issues;
  }

  const seenTitles = new Map<string, string>();

  for (const chapter of active) {
    const title = chapter.title.trim();

    if (title.length === 0) {
      issues.push({
        kind: 'empty-title',
        message: 'Chương chưa có tên.',
        chapterId: chapter.id,
        blocking: true,
      });
    } else {
      const previousId = seenTitles.get(title.toLowerCase());
      if (previousId === undefined) {
        seenTitles.set(title.toLowerCase(), chapter.id);
      } else {
        // Trùng tên không chặn: sách thật có "Ngoại truyện" xuất hiện hai lần
        issues.push({
          kind: 'duplicate-title',
          message: `Trùng tên với một chương khác: "${title}".`,
          chapterId: chapter.id,
          blocking: false,
        });
      }
    }

    if (chapter.pageEnd < chapter.pageStart || chapter.pageStart < 1) {
      issues.push({
        kind: 'invalid-range',
        message: `Khoảng trang không hợp lệ (${chapter.pageStart}–${chapter.pageEnd}).`,
        chapterId: chapter.id,
        blocking: true,
      });
    } else if (chapter.pageEnd > totalPages) {
      issues.push({
        kind: 'invalid-range',
        message: `Vượt quá số trang của sách (${chapter.pageEnd} > ${totalPages}).`,
        chapterId: chapter.id,
        blocking: true,
      });
    }
  }

  for (let i = 1; i < active.length; i += 1) {
    const previous = active[i - 1]!;
    const current = active[i]!;

    if (current.pageStart <= previous.pageEnd) {
      issues.push({
        kind: 'overlap',
        message: `Chồng trang với "${previous.title.trim() || 'chương trước'}".`,
        chapterId: current.id,
        blocking: true,
      });
    } else if (current.pageStart > previous.pageEnd + 1) {
      // Khoảng trống là chuyện bình thường sau khi xoá chương — cảnh báo
      // để user biết mình đang bỏ nội dung, nhưng không chặn.
      const from = previous.pageEnd + 1;
      const to = current.pageStart - 1;
      issues.push({
        kind: 'gap',
        message:
          from === to
            ? `Trang ${from} không thuộc chương nào.`
            : `Trang ${from}–${to} không thuộc chương nào.`,
        chapterId: current.id,
        blocking: false,
      });
    }
  }

  return issues;
};

export const hasBlockingIssue = (issues: readonly DraftIssue[]): boolean =>
  issues.some((issue) => issue.blocking);
