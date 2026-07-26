import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import type { Book, Chapter, Segment } from '@ln/shared';
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY_NORMAL, JOB_PRIORITY_URGENT } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../migrator.js';
import { createBookRepository } from './books.js';
import { createChapterRepository } from './chapters.js';
import { createSegmentRepository, type SegmentRepository } from './segments.js';
import { createJobRepository, type JobRepository } from './jobs.js';

/**
 * Chạy trên SQLite thật: hàng đợi dựa vào unique index có điều kiện và CASCADE,
 * hai thứ chỉ đúng khi đi qua DB thật chứ không phải bản giả trong bộ nhớ.
 */

let db: Db;
let jobs: JobRepository;
let segments: SegmentRepository;

const book = (id: string, overrides: Partial<Book> = {}): Book => ({
  id,
  title: `Sách ${id}`,
  format: 'pdf',
  filePath: `D:\\lib\\${id}.pdf`,
  fileHash: `hash-${id}`,
  lang: 'vi',
  addedAt: 1000,
  ...overrides,
});

const chapter = (id: string, bookId: string, index = 0): Chapter => ({
  id,
  bookId,
  index,
  title: `Chương ${index + 1}`,
  segmentCount: 0,
  audioBytes: 0,
  errorCount: 0,
  generateStatus: 'none',
});

const segment = (id: string, chapterId: string, index = 0): Segment => ({
  id,
  chapterId,
  index,
  text: `Câu thứ ${index}.`,
  anchor: { kind: 'pdf', page: 1, rects: [] },
  status: 'pending',
  alignStatus: 'none',
});

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);

  const books = createBookRepository(db);
  const chapters = createChapterRepository(db);
  segments = createSegmentRepository(db);
  jobs = createJobRepository(db);

  books.insert(book('book-1'));
  chapters.insertMany([chapter('chap-1', 'book-1')]);
  segments.insertMany([
    segment('seg-1', 'chap-1', 0),
    segment('seg-2', 'chap-1', 1),
    segment('seg-3', 'chap-1', 2),
  ]);
});

afterEach(() => {
  db.close();
});

const enqueue = (id: string, segmentId: string, priority?: number, createdAt = 1000) =>
  jobs.enqueue({
    id,
    type: 'synthesize',
    segmentId,
    ...(priority === undefined ? {} : { priority }),
    createdAt,
  });

describe('JobRepository — thêm job', () => {
  it('lưu rồi đọc lại giữ nguyên giá trị', () => {
    const job = enqueue('job-1', 'seg-1');

    expect(jobs.findById('job-1')).toEqual({
      id: 'job-1',
      type: 'synthesize',
      segmentId: 'seg-1',
      priority: JOB_PRIORITY_NORMAL,
      status: 'queued',
      attempts: 0,
      createdAt: 1000,
    });
    expect(job.status).toBe('queued');
  });

  it('field optional không có thì KHÔNG xuất hiện với giá trị undefined', () => {
    enqueue('job-1', 'seg-1');
    const job = jobs.findById('job-1');

    expect(job).not.toHaveProperty('startedAt');
    expect(job).not.toHaveProperty('finishedAt');
    expect(job).not.toHaveProperty('errorMessage');
  });

  it('bấm generate hai lần cho cùng segment chỉ ra MỘT job', () => {
    // Không chặn thì hai lượt tổng hợp cùng ghi vào một file .ogg.
    enqueue('job-1', 'seg-1');
    enqueue('job-2', 'seg-1');

    expect(jobs.counts().queued).toBe(1);
    expect(jobs.findById('job-2')).toBeUndefined();
  });

  it('enqueue lại trả về job đang có, không phải job rỗng', () => {
    enqueue('job-1', 'seg-1');
    const again = enqueue('job-2', 'seg-1');

    expect(again.id).toBe('job-1');
  });

  it('segment sắp phát nhảy lên đầu hàng đợi', () => {
    enqueue('job-1', 'seg-1');
    const raised = enqueue('job-2', 'seg-1', JOB_PRIORITY_URGENT);

    expect(raised.priority).toBe(JOB_PRIORITY_URGENT);
  });

  it('prefetch đến sau KHÔNG kéo tụt segment đang cần phát', () => {
    enqueue('job-1', 'seg-1', JOB_PRIORITY_URGENT);
    enqueue('job-2', 'seg-1', JOB_PRIORITY_NORMAL);

    expect(jobs.findById('job-1')?.priority).toBe(JOB_PRIORITY_URGENT);
  });

  it('job đã xong không chặn lượt generate lại', () => {
    // Đổi bitrate hay đổi giọng thì phải generate lại được.
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.markDone('job-1', 3000);

    enqueue('job-2', 'seg-1');
    expect(jobs.findById('job-2')?.status).toBe('queued');
  });

  it('enqueueMany đếm số job MỚI, không đếm số input', () => {
    enqueue('job-1', 'seg-1');

    const added = jobs.enqueueMany([
      { id: 'job-2', type: 'synthesize', segmentId: 'seg-1', createdAt: 2000 },
      { id: 'job-3', type: 'synthesize', segmentId: 'seg-2', createdAt: 2000 },
    ]);

    expect(added).toBe(1);
    expect(jobs.counts().queued).toBe(2);
  });

  it('xoá sách thì job của nó biến mất theo (CASCADE)', () => {
    enqueue('job-1', 'seg-1');
    db.prepare('DELETE FROM books WHERE id = ?').run('book-1');

    expect(jobs.findById('job-1')).toBeUndefined();
  });
});

describe('JobRepository — lấy job ra chạy', () => {
  it('lấy priority cao nhất trước', () => {
    enqueue('job-1', 'seg-1', JOB_PRIORITY_NORMAL, 1000);
    enqueue('job-2', 'seg-2', JOB_PRIORITY_URGENT, 2000);

    expect(jobs.claimNext(3000)?.id).toBe('job-2');
  });

  it('cùng priority thì ai vào trước chạy trước', () => {
    enqueue('job-2', 'seg-2', JOB_PRIORITY_NORMAL, 2000);
    enqueue('job-1', 'seg-1', JOB_PRIORITY_NORMAL, 1000);

    expect(jobs.claimNext(3000)?.id).toBe('job-1');
  });

  it('job đã lấy không bị lấy lần thứ hai', () => {
    // Đây là lý do claim phải là MỘT transaction: đọc rồi ghi tách rời thì hai
    // lượt gọi cùng nhận một job và tổng hợp trùng.
    enqueue('job-1', 'seg-1');

    expect(jobs.claimNext(2000)?.id).toBe('job-1');
    expect(jobs.claimNext(2000)).toBeUndefined();
  });

  it('hàng đợi rỗng thì trả undefined chứ không ném', () => {
    expect(jobs.claimNext(1000)).toBeUndefined();
  });

  it('lấy ra thì ghi mốc bắt đầu và tăng số lượt', () => {
    enqueue('job-1', 'seg-1');
    const claimed = jobs.claimNext(2000);

    expect(claimed?.status).toBe('running');
    expect(claimed?.startedAt).toBe(2000);
    expect(claimed?.attempts).toBe(1);
  });
});

describe('JobRepository — kết thúc job', () => {
  const claimOne = (): void => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
  };

  it('xong thì ghi mốc kết thúc', () => {
    claimOne();
    jobs.markDone('job-1', 5000);

    const job = jobs.findById('job-1');
    expect(job?.status).toBe('done');
    expect(job?.finishedAt).toBe(5000);
  });

  it('hỏng lần đầu thì quay lại hàng đợi để thử lại', () => {
    claimOne();
    const retryable = jobs.markError('job-1', 'sidecar chết', 5000);

    expect(retryable).toBe(true);
    expect(jobs.findById('job-1')?.status).toBe('queued');
  });

  it('giữ lại lý do hỏng của lượt trước để chẩn đoán', () => {
    claimOne();
    jobs.markError('job-1', 'ECONNREFUSED', 5000);

    expect(jobs.findById('job-1')?.errorMessage).toBe('ECONNREFUSED');
  });

  it('hết lượt thử thì thành lỗi hẳn', () => {
    enqueue('job-1', 'seg-1');
    let retryable = true;
    for (let i = 0; i < JOB_MAX_ATTEMPTS; i += 1) {
      jobs.claimNext(2000);
      retryable = jobs.markError('job-1', 'hỏng', 5000);
    }

    expect(retryable).toBe(false);
    expect(jobs.findById('job-1')?.status).toBe('error');
    expect(jobs.findById('job-1')?.attempts).toBe(JOB_MAX_ATTEMPTS);
  });

  it('làm lại thành công thì xoá lý do hỏng cũ', () => {
    claimOne();
    jobs.markError('job-1', 'lỗi tạm', 5000);
    jobs.claimNext(6000);
    jobs.markDone('job-1', 7000);

    expect(jobs.findById('job-1')).not.toHaveProperty('errorMessage');
  });
});

describe('JobRepository — huỷ', () => {
  it('huỷ được job đang chờ', () => {
    enqueue('job-1', 'seg-1');

    expect(jobs.cancel('job-1', 5000)).toBe(true);
    expect(jobs.findById('job-1')?.status).toBe('cancelled');
  });

  it('huỷ được job đang chạy — user bấm dừng giữa chừng', () => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);

    expect(jobs.cancel('job-1', 5000)).toBe(true);
  });

  it('huỷ job đã xong thì không đổi gì', () => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.markDone('job-1', 3000);

    expect(jobs.cancel('job-1', 5000)).toBe(false);
    expect(jobs.findById('job-1')?.status).toBe('done');
  });

  it('job đã huỷ thì lượt claim kế bỏ qua nó', () => {
    enqueue('job-1', 'seg-1');
    jobs.cancel('job-1', 2000);

    expect(jobs.claimNext(3000)).toBeUndefined();
  });

  it('huỷ theo sách chỉ đụng job của sách đó', () => {
    const books = createBookRepository(db);
    const chapters = createChapterRepository(db);
    books.insert(book('book-2'));
    chapters.insertMany([chapter('chap-2', 'book-2')]);
    segments.insertMany([segment('seg-9', 'chap-2')]);

    enqueue('job-1', 'seg-1');
    enqueue('job-2', 'seg-9');

    expect(jobs.cancelByBook('book-1', 5000)).toEqual(['seg-1']);
    expect(jobs.findById('job-1')?.status).toBe('cancelled');
    expect(jobs.findById('job-2')?.status).toBe('queued');
  });

  it('huỷ tất cả không đụng job đã xong', () => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.markDone('job-1', 3000);
    enqueue('job-2', 'seg-2');

    expect(jobs.cancelAll(5000)).toEqual(['seg-2']);
    expect(jobs.findById('job-1')?.status).toBe('done');
  });

  it('huỷ hàng loạt trả về segment bị ảnh hưởng để nơi gọi còn dọn', () => {
    // Không có danh sách này thì segment kẹt ở `queued` vĩnh viễn — lỗi thật
    // đã gặp khi chạy probe với sidecar thật.
    enqueue('job-1', 'seg-1');
    enqueue('job-2', 'seg-2');

    expect(jobs.cancelAll(5000).sort()).toEqual(['seg-1', 'seg-2']);
  });

  it('huỷ xong thì segment đó enqueue lại được', () => {
    enqueue('job-1', 'seg-1');
    jobs.cancel('job-1', 2000);

    const again = enqueue('job-2', 'seg-1');
    expect(again.id).toBe('job-2');
    expect(again.status).toBe('queued');
  });
});

describe('JobRepository — khởi động lại', () => {
  it('job đang chạy lúc app bị kill được đưa về hàng đợi', () => {
    // Không có bước này thì job mắc kẹt ở `running` mãi mãi: worker mới không
    // nhận nó, mà unique index lại chặn tạo job mới cho segment đó.
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);

    expect(jobs.requeueOrphans()).toBe(1);
    expect(jobs.findById('job-1')?.status).toBe('queued');
  });

  it('KHÔNG reset số lượt đã thử', () => {
    // Reset thì job làm sidecar chết sẽ thử lại vô hạn, mỗi lần kéo sập app.
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.requeueOrphans();

    expect(jobs.findById('job-1')?.attempts).toBe(1);
  });

  it('không đụng job đã xong hay đã huỷ', () => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.markDone('job-1', 3000);
    enqueue('job-2', 'seg-2');
    jobs.cancel('job-2', 3000);

    expect(jobs.requeueOrphans()).toBe(0);
  });

  it('job khôi phục lại chạy tiếp được ngay', () => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.requeueOrphans();

    expect(jobs.claimNext(9000)?.id).toBe('job-1');
  });
});

describe('JobRepository — đếm và liệt kê', () => {
  it('đếm theo từng trạng thái', () => {
    enqueue('job-1', 'seg-1');
    enqueue('job-2', 'seg-2');
    jobs.claimNext(2000);

    expect(jobs.counts()).toEqual({
      queued: 1,
      running: 1,
      done: 0,
      error: 0,
      cancelled: 0,
    });
  });

  it('đếm theo sách để UI hiện tiến độ từng cuốn', () => {
    enqueue('job-1', 'seg-1');
    enqueue('job-2', 'seg-2');

    expect(jobs.countsByBook('book-1').queued).toBe(2);
    expect(jobs.countsByBook('book-khác').queued).toBe(0);
  });

  it('danh sách chờ đặt job đang chạy lên đầu', () => {
    enqueue('job-1', 'seg-1');
    enqueue('job-2', 'seg-2', JOB_PRIORITY_URGENT);
    jobs.claimNext(2000);

    expect(jobs.listPending(10).map((j) => j.id)).toEqual(['job-2', 'job-1']);
  });

  it('danh sách chờ không kèm job đã xong', () => {
    enqueue('job-1', 'seg-1');
    jobs.claimNext(2000);
    jobs.markDone('job-1', 3000);

    expect(jobs.listPending(10)).toEqual([]);
  });

  it('tìm được job đang hoạt động của một segment', () => {
    enqueue('job-1', 'seg-1');

    expect(jobs.findActiveBySegment('seg-1', 'synthesize')?.id).toBe('job-1');
    expect(jobs.findActiveBySegment('seg-2', 'synthesize')).toBeUndefined();
  });
});
