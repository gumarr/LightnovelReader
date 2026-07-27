import { useEffect, useState } from 'react';
import { formatBytes, type AudioBitrate, type ChapterUsageInfo } from '@ln/shared';
import { useStorageStore } from '@/stores/storage-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useLibraryStore } from '@/stores/library-store';
import { DeleteAudioDialog } from './DeleteAudioDialog';
import { StorageBookRow } from './StorageBookRow';
import { StorageSettings } from './StorageSettings';
import { orphanSummary, usageLevel, warnPercent } from './format';

/**
 * Storage Manager — CLAUDE.md yêu cầu có từ Phase 2, không để sau.
 *
 * Dung lượng là mối quan tâm hạng nhất của app này: 1 vol ≈ 97 MB ở 24 kbps,
 * và user sẽ generate nhiều vol. Màn này phải trả lời được ba câu: đang chiếm
 * bao nhiêu, chiếm ở đâu, xoá cái nào.
 */

/** Việc xoá đang chờ user xác nhận. `null` = không có hộp thoại nào mở */
type PendingDelete = {
  kind: 'chapter' | 'book';
  id: string;
  title: string;
  bytes: number;
  segments: number;
};

export type StorageManagerProps = {
  onBack: () => void;
};

export const StorageManager = ({ onBack }: StorageManagerProps): JSX.Element => {
  const usage = useStorageStore((s) => s.usage);
  const chapters = useStorageStore((s) => s.chapters);
  const expandedBookId = useStorageStore((s) => s.expandedBookId);
  const loading = useStorageStore((s) => s.loading);
  const deleting = useStorageStore((s) => s.deleting);
  const error = useStorageStore((s) => s.error);
  const lastDeleted = useStorageStore((s) => s.lastDeleted);
  const load = useStorageStore((s) => s.load);
  const expandBook = useStorageStore((s) => s.expandBook);
  const deleteChapterAudio = useStorageStore((s) => s.deleteChapterAudio);
  const deleteBookAudio = useStorageStore((s) => s.deleteBookAudio);
  const deleteOrphans = useStorageStore((s) => s.deleteOrphans);
  const clearError = useStorageStore((s) => s.clearError);

  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  // Xoá audio làm `generateStatus` của chương đổi — thư viện đang mở phải nạp
  // lại, nếu không màn chi tiết sách vẫn hiện "Đủ audio" cho chương vừa xoá.
  const loadLibrary = useLibraryStore((s) => s.load);

  const [pending, setPending] = useState<PendingDelete | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  const level = usageLevel(usage);
  const orphans = orphanSummary(usage);

  const confirmDelete = async (): Promise<void> => {
    if (pending === null) return;
    // Đóng hộp trước khi xoá: xoá cả sách có thể mất vài giây với ~4800 file, để
    // hộp mở với nút "Đang xoá…" thì trông như treo.
    const target = pending;
    setPending(null);

    if (target.kind === 'chapter') await deleteChapterAudio(target.id);
    else await deleteBookAudio(target.id);

    await loadLibrary();
  };

  const askDeleteChapter = (chapter: ChapterUsageInfo): void => {
    setPending({
      kind: 'chapter',
      id: chapter.chapterId,
      title: chapter.title,
      bytes: chapter.audioBytes,
      segments: chapter.readySegments,
    });
  };

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-4 overflow-y-auto p-6">
      <header>
        <button
          type="button"
          data-testid="storage-back"
          onClick={onBack}
          className="text-xs text-fg-muted transition-colors hover:text-fg"
        >
          ← Quay lại
        </button>
        <h1 className="mt-1 text-lg font-semibold text-fg">Dung lượng</h1>
        <p className="mt-0.5 text-xs text-fg-muted">
          Xoá audio giữ nguyên tiến độ đọc và cấu trúc chương.
        </p>
      </header>

      {error !== null && (
        <div
          role="alert"
          data-testid="storage-error"
          className="flex items-start justify-between gap-3 rounded-lg border border-danger p-3 text-sm text-danger"
          style={{ backgroundColor: 'rgb(var(--danger) / 0.08)' }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Đóng thông báo lỗi"
            className="shrink-0 text-xs underline"
          >
            Đóng
          </button>
        </div>
      )}

      {lastDeleted !== null && lastDeleted.freedBytes > 0 && (
        <p data-testid="storage-freed" className="text-xs text-fg-muted">
          Đã giải phóng {formatBytes(lastDeleted.freedBytes)} ({lastDeleted.filesDeleted} file).
        </p>
      )}

      {usage === null ? (
        <p className="text-sm text-fg-muted">
          {loading ? 'Đang đo dung lượng…' : 'Chưa đọc được dung lượng.'}
        </p>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-bg-elevated p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-xs text-fg-muted">Tổng audio</span>
              <span data-testid="storage-total" className="tabular-nums text-lg font-semibold text-fg">
                {formatBytes(usage.audioBytes)}
              </span>
            </div>

            {usage.warnBytes > 0 && (
              <>
                {/* Thanh mức dùng: màu lấy từ biến CSS chứ không hardcode hex —
                    `rgb(var(--danger))` để dùng được trong style thường. */}
                <div
                  role="progressbar"
                  aria-valuenow={warnPercent(usage)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Mức dùng so với ngưỡng cảnh báo"
                  data-testid="storage-bar"
                  className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-subtle"
                >
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${String(warnPercent(usage))}%`,
                      backgroundColor:
                        level === 'ok' ? 'rgb(var(--accent))' : 'rgb(var(--danger))',
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-fg-muted">
                  {warnPercent(usage)}% của ngưỡng {formatBytes(usage.warnBytes)}
                </p>
              </>
            )}

            {level === 'over' && (
              <p role="alert" data-testid="storage-over-warning" className="mt-2 text-xs text-danger">
                Đã vượt ngưỡng cảnh báo. Xoá audio chương đã đọc hoặc nâng ngưỡng.
              </p>
            )}
            {level === 'near' && (
              <p data-testid="storage-near-warning" className="mt-2 text-xs text-fg-muted">
                Gần tới ngưỡng cảnh báo.
              </p>
            )}
          </div>

          {orphans !== undefined && (
            <div
              data-testid="storage-orphans"
              className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
            >
              <span className="text-xs text-fg-muted">Rác còn sót: {orphans}</span>
              <button
                type="button"
                onClick={() => void deleteOrphans()}
                disabled={deleting}
                data-testid="storage-delete-orphans"
                className="shrink-0 rounded border border-border px-2 py-1 text-xs text-fg transition-colors hover:bg-bg-subtle disabled:opacity-40"
              >
                Dọn
              </button>
            </div>
          )}

          {settings !== null && (
            <StorageSettings
              audioDir={settings.audioDir}
              bitrate={settings.bitrate}
              warnBytes={settings.storageWarnBytes}
              onPickAudioDir={() => void window.api.settings.pickAudioDir()}
              onChangeBitrate={(bitrate: AudioBitrate) => void updateSettings({ bitrate })}
              onChangeWarnBytes={(bytes) => {
                void updateSettings({ storageWarnBytes: bytes });
                // Ngưỡng nằm trong `usage` (main trả về) nên phải nạp lại, nếu
                // không thanh mức dùng vẫn tính theo ngưỡng cũ.
                void load();
              }}
            />
          )}

          {usage.books.length === 0 ? (
            <p className="text-sm text-fg-muted">Thư viện chưa có sách nào.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {usage.books.map((book) => (
                <StorageBookRow
                  key={book.bookId}
                  book={book}
                  expanded={expandedBookId === book.bookId}
                  chapters={expandedBookId === book.bookId ? chapters : []}
                  busy={deleting}
                  onToggle={() =>
                    void expandBook(expandedBookId === book.bookId ? null : book.bookId)
                  }
                  onDeleteBook={() =>
                    setPending({
                      kind: 'book',
                      id: book.bookId,
                      title: book.title,
                      bytes: book.audioBytes,
                      // Không biết số segment chính xác mà chưa mở chương ra;
                      // hộp thoại chỉ cần con số để user hình dung quy mô.
                      segments: chapters
                        .filter(() => expandedBookId === book.bookId)
                        .reduce((sum, c) => sum + c.readySegments, 0),
                    })
                  }
                  onDeleteChapter={askDeleteChapter}
                />
              ))}
            </ul>
          )}
        </>
      )}

      {pending !== null && (
        <DeleteAudioDialog
          title={pending.title}
          bytes={pending.bytes}
          segments={pending.segments}
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
};
