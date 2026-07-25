import { useEffect, useRef, useState } from 'react';
import type { ChapterDraft, DraftIssue } from '@ln/shared';
import {
  CONFIDENCE_CLASSES,
  CONFIDENCE_LABELS,
  confidenceLevel,
  rangeLabel,
  rangeSize,
} from './confidence';

export type ChapterRowProps = {
  chapter: ChapterDraft;
  /** Số thứ tự hiển thị, chỉ đếm chương không bị loại trừ */
  displayIndex: number | null;
  hasRealPages: boolean;
  /** Sách không có outline thì điểm luôn thấp — mốc tin cậy phải khác */
  hasOutline: boolean;
  /** Không cho gộp chương đầu tiên — không có gì phía trước */
  canMerge: boolean;
  issues: readonly DraftIssue[];
  preview: string | undefined;
  loadingPreview: boolean;
  onRename: (title: string) => void;
  onMerge: () => void;
  onSplit: (atPage: number) => void;
  onRemove: () => void;
  onToggleExclude: () => void;
  onRequestPreview: () => void;
};

export const ChapterRow = ({
  chapter,
  displayIndex,
  hasRealPages,
  hasOutline,
  canMerge,
  issues,
  preview,
  loadingPreview,
  onRename,
  onMerge,
  onSplit,
  onRemove,
  onToggleExclude,
  onRequestPreview,
}: ChapterRowProps): JSX.Element => {
  const [expanded, setExpanded] = useState(false);
  const level = confidenceLevel(chapter.confidence, hasOutline);
  const blocking = issues.some((i) => i.blocking);

  // Mở rộng lần đầu mới tải preview — sách 270 trang có hàng chục chương,
  // tải hết ngay là gọi IPC hàng loạt cho nội dung user chưa nhìn tới.
  useEffect(() => {
    if (expanded) onRequestPreview();
  }, [expanded, onRequestPreview]);

  return (
    <li
      data-testid="chapter-row"
      data-chapter-id={chapter.id}
      data-excluded={chapter.excluded}
      className={`group rounded-md border ${
        blocking ? 'border-danger' : 'border-border'
      } bg-bg-elevated ${chapter.excluded ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start gap-3 p-3">
        <input
          type="checkbox"
          checked={!chapter.excluded}
          onChange={onToggleExclude}
          aria-label={`Đưa "${chapter.title || 'chương chưa đặt tên'}" vào sách`}
          className="mt-1 h-4 w-4 shrink-0 accent-accent"
        />

        <span className="mt-0.5 w-6 shrink-0 text-right text-sm tabular-nums text-fg-muted">
          {displayIndex ?? '—'}
        </span>

        <div className="min-w-0 flex-1">
          <TitleInput
            title={chapter.title}
            excluded={chapter.excluded}
            onRename={onRename}
          />

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
            <span>{rangeLabel(chapter.pageStart, chapter.pageEnd, hasRealPages)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {rangeSize(chapter.pageStart, chapter.pageEnd)} {hasRealPages ? 'trang' : 'đoạn'}
            </span>
            <span className={`rounded px-1.5 py-0.5 ${CONFIDENCE_CLASSES[level]}`}>
              {CONFIDENCE_LABELS[level]}
            </span>
          </div>

          {issues.map((issue) => (
            <p
              key={`${issue.kind}-${issue.message}`}
              role={issue.blocking ? 'alert' : undefined}
              className={`mt-1 text-xs ${issue.blocking ? 'text-danger' : 'text-fg-muted'}`}
            >
              {issue.blocking ? '⚠ ' : 'ℹ '}
              {issue.message}
            </p>
          ))}

          {expanded ? (
            <ChapterDetails
              chapter={chapter}
              hasRealPages={hasRealPages}
              preview={preview}
              loadingPreview={loadingPreview}
              onSplit={onSplit}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <RowButton
            label={expanded ? 'Thu gọn' : 'Xem nội dung'}
            onClick={() => setExpanded((v) => !v)}
          />
          {canMerge ? <RowButton label="Gộp lên trên" onClick={onMerge} /> : null}
          <RowButton label="Xoá" onClick={onRemove} danger />
        </div>
      </div>
    </li>
  );
};

type TitleInputProps = {
  title: string;
  excluded: boolean;
  onRename: (title: string) => void;
};

/**
 * Ô tên chương. Giữ state cục bộ trong lúc gõ rồi mới đẩy lên store khi rời ô:
 * mỗi ký tự một lần `apply()` sẽ nhồi history đầy những bước một chữ cái.
 */
const TitleInput = ({ title, excluded, onRename }: TitleInputProps): JSX.Element => {
  const [draft, setDraft] = useState(title);
  const lastCommitted = useRef(title);

  // Tên đổi từ bên ngoài (hoàn tác, gộp chương) phải phản ánh vào ô
  useEffect(() => {
    if (title !== lastCommitted.current) {
      lastCommitted.current = title;
      setDraft(title);
    }
  }, [title]);

  const commit = (): void => {
    if (draft === lastCommitted.current) return;
    lastCommitted.current = draft;
    onRename(draft);
  };

  return (
    <input
      type="text"
      value={draft}
      placeholder="Chương chưa có tên"
      aria-label="Tên chương"
      disabled={excluded}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      // Viền gợi ý "sửa được" chỉ hiện khi rê chuột lên **cả hàng**
      // (`group-hover`), không phải khi chuột nằm trên riêng ô input: chuột
      // đứng yên sau lúc bấm sẽ khiến một chương trông như đang được chọn.
      className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-sm font-medium text-fg outline-none group-hover:border-border focus:border-accent disabled:cursor-not-allowed"
    />
  );
};

type ChapterDetailsProps = {
  chapter: ChapterDraft;
  hasRealPages: boolean;
  preview: string | undefined;
  loadingPreview: boolean;
  onSplit: (atPage: number) => void;
};

const ChapterDetails = ({
  chapter,
  hasRealPages,
  preview,
  loadingPreview,
  onSplit,
}: ChapterDetailsProps): JSX.Element => {
  const unit = hasRealPages ? 'trang' : 'đoạn';
  const canSplit = chapter.pageEnd > chapter.pageStart;
  const [splitPage, setSplitPage] = useState(chapter.pageStart + 1);

  return (
    <div className="mt-2 border-t border-border pt-2">
      <p className="text-xs leading-relaxed text-fg-muted">
        {loadingPreview ? 'Đang tải nội dung…' : (preview ?? '')}
        {!loadingPreview && preview === '' ? (
          <span className="italic">Vùng {unit} này không có chữ nào đọc được.</span>
        ) : null}
      </p>

      {canSplit ? (
        <div className="mt-2 flex items-center gap-2">
          <label className="text-xs text-fg-muted" htmlFor={`split-${chapter.id}`}>
            Tách từ {unit}
          </label>
          <input
            id={`split-${chapter.id}`}
            type="number"
            min={chapter.pageStart + 1}
            max={chapter.pageEnd}
            value={splitPage}
            onChange={(e) => setSplitPage(Number(e.target.value))}
            className="w-20 rounded border border-border bg-bg px-1.5 py-0.5 text-xs text-fg outline-none focus:border-accent"
          />
          <RowButton label="Tách" onClick={() => onSplit(splitPage)} />
        </div>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">Chương chỉ có một {unit}, không tách được.</p>
      )}
    </div>
  );
};

type RowButtonProps = {
  label: string;
  onClick: () => void;
  danger?: boolean;
};

const RowButton = ({ label, onClick, danger = false }: RowButtonProps): JSX.Element => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded px-2 py-1 text-xs transition-colors hover:bg-bg-subtle ${
      danger ? 'text-danger' : 'text-fg-muted hover:text-fg'
    }`}
  >
    {label}
  </button>
);
