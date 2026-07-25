import type { Chapter } from '@ln/shared';

/**
 * Chọn chương trong trình đọc.
 *
 * Dùng `<select>` gốc thay vì dropdown tự vẽ: sách thật có tới vài trăm chương,
 * và select của hệ điều hành đã có sẵn cuộn, tìm theo phím, cùng khả năng
 * truy cập — tự dựng lại chỉ tệ hơn.
 */

export type ChapterPickerProps = {
  chapters: readonly Chapter[];
  currentChapterId: string | null;
  onSelect: (chapterId: string) => void;
};

export const ChapterPicker = ({
  chapters,
  currentChapterId,
  onSelect,
}: ChapterPickerProps): JSX.Element | null => {
  if (chapters.length === 0) return null;

  return (
    <select
      aria-label="Chọn chương"
      value={currentChapterId ?? ''}
      onChange={(event) => onSelect(event.target.value)}
      className="max-w-[14rem] rounded border border-border bg-bg px-2 py-1 text-xs text-fg"
    >
      {chapters.map((chapter) => (
        <option key={chapter.id} value={chapter.id}>
          {chapter.index + 1}. {chapter.title}
        </option>
      ))}
    </select>
  );
};
