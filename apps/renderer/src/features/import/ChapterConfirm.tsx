import { useCallback, useMemo, useState } from 'react';
import type {
  BookLang,
  ChapterDraft,
  DraftIssue,
  ImportPreview,
  SaveBookResponse,
} from '@ln/shared';
import { useImportStore } from '@/stores/import-store';
import { ChapterRow } from './ChapterRow';
import { rangeSize } from './confidence';

/**
 * Màn "Xác nhận cấu trúc chương".
 *
 * Bắt buộc đi qua đây trước khi generate — detector giữ nguyên cả mục
 * "Bản quyền", "Lời bạt" trong outline và cố ý không tự đoán mục nào là
 * chương thật (PROGRESS.md mục 4.11a). Việc loại là của user.
 */

export type ChapterConfirmProps = {
  preview: ImportPreview;
  /** Gọi sau khi sách đã lưu vào thư viện */
  onSaved: (result: SaveBookResponse) => void;
  onCancel: () => void;
};

export const ChapterConfirm = ({
  preview,
  onSaved,
  onCancel,
}: ChapterConfirmProps): JSX.Element => {
  const chapters = useImportStore((s) => s.chapters);
  const issues = useImportStore((s) => s.issues);
  const previews = useImportStore((s) => s.previews);
  const loadingPreviews = useImportStore((s) => s.loadingPreviews);
  const historyLength = useImportStore((s) => s.history.length);
  const canConfirm = useImportStore((s) => s.canConfirm());
  const saving = useImportStore((s) => s.saving);
  const error = useImportStore((s) => s.error);
  const save = useImportStore((s) => s.save);

  const [title, setTitle] = useState(preview.suggestedTitle);
  // Mặc định tiếng Việt: app là trình đọc LN dịch, sách EN là ca thiểu số.
  // Không tự đoán từ nội dung — `ImportPreview` không mang theo text mẫu, và
  // đoán sai một cách im lặng còn tệ hơn để user chọn.
  const [lang, setLang] = useState<BookLang>('vi');

  const handleSave = async (): Promise<void> => {
    const result = await save(title, lang);
    if (result !== null) onSaved(result);
  };

  const merge = useImportStore((s) => s.merge);
  const split = useImportStore((s) => s.split);
  const rename = useImportStore((s) => s.rename);
  const remove = useImportStore((s) => s.remove);
  const toggleExclude = useImportStore((s) => s.toggleExclude);
  const undo = useImportStore((s) => s.undo);
  const loadPreview = useImportStore((s) => s.loadPreview);

  const issuesByChapter = useMemo(() => groupIssues(issues), [issues]);
  const globalIssues = useMemo(() => issues.filter((i) => i.chapterId === undefined), [issues]);

  const kept = chapters.filter((c) => !c.excluded);
  const keptPages = kept.reduce((sum, c) => sum + rangeSize(c.pageStart, c.pageEnd), 0);

  // Số thứ tự chỉ đếm chương được giữ — user thấy đúng thứ tự sách sẽ có
  const displayIndexes = new Map<string, number>();
  kept.forEach((chapter, i) => displayIndexes.set(chapter.id, i + 1));

  return (
    <div className="flex h-full flex-col">
      <Header
        preview={preview}
        keptCount={kept.length}
        keptPages={keptPages}
        title={title}
        onTitleChange={setTitle}
        lang={lang}
        onLangChange={setLang}
      />

      {globalIssues.map((issue) => (
        <p key={issue.kind} role="alert" className="mx-4 mb-2 text-sm text-danger">
          {issue.message}
        </p>
      ))}

      {error !== null ? (
        <p role="alert" className="mx-4 mb-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <ol className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
        {chapters.map((chapter, index) => (
          <ChapterRowConnected
            key={chapter.id}
            chapter={chapter}
            displayIndex={displayIndexes.get(chapter.id) ?? null}
            hasRealPages={preview.hasRealPages}
            hasOutline={preview.hasOutline}
            canMerge={index > 0}
            issues={issuesByChapter.get(chapter.id) ?? EMPTY_ISSUES}
            preview={previews[chapter.id]}
            loadingPreview={loadingPreviews.includes(chapter.id)}
            onRename={rename}
            onMerge={merge}
            onSplit={split}
            onRemove={remove}
            onToggleExclude={toggleExclude}
            onRequestPreview={loadPreview}
          />
        ))}
      </ol>

      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-bg-elevated px-4 py-3">
        <button
          type="button"
          onClick={undo}
          disabled={historyLength === 0}
          className="rounded px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
        >
          Hoàn tác
        </button>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
          >
            Huỷ
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={!canConfirm || title.trim().length === 0}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? 'Đang lưu…' : `Xác nhận ${kept.length} chương`}
          </button>
        </div>
      </footer>
    </div>
  );
};

const EMPTY_ISSUES: readonly DraftIssue[] = [];

const groupIssues = (issues: readonly DraftIssue[]): Map<string, DraftIssue[]> => {
  const grouped = new Map<string, DraftIssue[]>();
  for (const issue of issues) {
    if (issue.chapterId === undefined) continue;
    const list = grouped.get(issue.chapterId);
    if (list === undefined) grouped.set(issue.chapterId, [issue]);
    else list.push(issue);
  }
  return grouped;
};

type HeaderProps = {
  preview: ImportPreview;
  keptCount: number;
  keptPages: number;
  title: string;
  onTitleChange: (title: string) => void;
  lang: BookLang;
  onLangChange: (lang: BookLang) => void;
};

const Header = ({
  preview,
  keptCount,
  keptPages,
  title,
  onTitleChange,
  lang,
  onLangChange,
}: HeaderProps): JSX.Element => {
  const unit = preview.hasRealPages ? 'trang' : 'đoạn';

  return (
    <header className="shrink-0 px-4 py-3">
      <h1 className="text-lg font-semibold text-fg">Xác nhận cấu trúc chương</h1>

      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="block min-w-0 flex-1">
          <span className="text-xs text-fg-muted">Tên sách</span>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            aria-label="Tên sách"
            placeholder="Đặt tên cho sách"
            className="mt-0.5 w-full max-w-md rounded border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent"
          />
        </label>

        {/*
          Ngôn ngữ quyết định giọng đọc của **cả sách** và bộ chuẩn hoá text ở
          sidecar. Trước P5.3 giá trị này bị hardcode `'vi'`, nên sách tiếng Anh
          sinh audio bằng giọng Việt — nghe ra âm vô nghĩa. Đặt cạnh tên sách vì
          đây là hai thứ duy nhất user khai ở màn này, và đổi sau khi đã lưu thì
          phải xoá sách nhập lại.
        */}
        <label className="block">
          <span className="text-xs text-fg-muted">Ngôn ngữ</span>
          <select
            value={lang}
            onChange={(e) => onLangChange(e.target.value as BookLang)}
            aria-label="Ngôn ngữ sách"
            data-testid="import-lang"
            className="mt-0.5 block rounded border border-border bg-bg px-2 py-1 text-sm text-fg outline-none focus:border-accent"
          >
            <option value="vi">Tiếng Việt</option>
            <option value="en">Tiếng Anh</option>
          </select>
        </label>
      </div>

      <p className="mt-1.5 text-sm text-fg-muted">
        {preview.totalPages} {unit} · {preview.hasOutline ? 'có mục lục' : 'không có mục lục'} ·
        giữ lại <span className="font-medium text-fg">{keptCount}</span> chương,{' '}
        {keptPages}/{preview.totalPages} {unit}. Bỏ chọn phần không phải nội dung truyện
        (bìa, bản quyền, lời bạt) trước khi xác nhận.
      </p>
    </header>
  );
};

type ChapterRowConnectedProps = {
  chapter: ChapterDraft;
  displayIndex: number | null;
  hasRealPages: boolean;
  hasOutline: boolean;
  canMerge: boolean;
  issues: readonly DraftIssue[];
  preview: string | undefined;
  loadingPreview: boolean;
  onRename: (id: string, title: string) => void;
  onMerge: (id: string) => void;
  onSplit: (id: string, atPage: number) => void;
  onRemove: (id: string) => void;
  onToggleExclude: (id: string) => void;
  onRequestPreview: (id: string) => void;
};

/**
 * Nối `ChapterRow` với store.
 *
 * Tồn tại để gắn `chapter.id` vào từng callback mà **không** tạo closure mới
 * mỗi lần render danh sách — sách 270 trang có hàng chục chương, tạo lại 6 hàm
 * cho mỗi hàng ở mỗi lần gõ phím là lãng phí thật sự.
 */
const ChapterRowConnected = ({
  chapter,
  onRename,
  onMerge,
  onSplit,
  onRemove,
  onToggleExclude,
  onRequestPreview,
  ...rest
}: ChapterRowConnectedProps): JSX.Element => {
  const id = chapter.id;

  return (
    <ChapterRow
      chapter={chapter}
      {...rest}
      onRename={useCallback((title: string) => onRename(id, title), [id, onRename])}
      onMerge={useCallback(() => onMerge(id), [id, onMerge])}
      onSplit={useCallback((atPage: number) => onSplit(id, atPage), [id, onSplit])}
      onRemove={useCallback(() => onRemove(id), [id, onRemove])}
      onToggleExclude={useCallback(() => onToggleExclude(id), [id, onToggleExclude])}
      onRequestPreview={useCallback(() => onRequestPreview(id), [id, onRequestPreview])}
    />
  );
};
