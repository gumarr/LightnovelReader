import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Book, Chapter, Segment, SynthesisResult } from '@ln/shared';
import { JOB_MAX_ATTEMPTS, JOB_PRIORITY_URGENT } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../db/migrator.js';
import { createBookRepository } from '../db/repositories/books.js';
import { createChapterRepository } from '../db/repositories/chapters.js';
import { createSegmentRepository, type SegmentRepository } from '../db/repositories/segments.js';
import { createJobRepository, type JobRepository } from '../db/repositories/jobs.js';
import { createTimingsStore } from './timings-store.js';
import { createGenerateQueue, type GenerateQueue } from './queue.js';
import type { SidecarClient } from './sidecar-client.js';

/**
 * Chạy trên SQLite thật + đĩa thật, chỉ giả `SidecarClient`.
 *
 * Giả cả DB thì mất đúng thứ đáng test nhất của hàng đợi: ràng buộc "một
 * segment một job" và việc job sống sót qua lần khởi động lại.
 */

let db: Db;
let jobs: JobRepository;
let segments: SegmentRepository;
let queue: GenerateQueue;
let audioDir: string;

/** Lời gọi `synthesize` đã nhận, để kiểm tham số truyền xuống */
let calls: { text: string; voiceId: string; outPath: string; bitrate: number }[];
/** Bản giả trả về gì — mỗi test chỉnh riêng */
let synthesize: (input: {
  text: string;
  outPath: string;
  signal?: AbortSignal;
}) => Promise<SynthesisResult>;

let voiceId: string | undefined;
let bitrate: 16 | 24 | 32;
let clientAvailable: boolean;

const result = (overrides: Partial<SynthesisResult> = {}): SynthesisResult => ({
  audioPath: 'D:/audio/book-1/seg-1.ogg',
  durationMs: 2810,
  audioBytes: 9401,
  sampleRate: 24000,
  voiceId: 'vi_VN-vais1000-medium',
  timingSource: 'phoneme',
  timings: [{ w: 'Sau', startMs: 0, endMs: 232, charStart: 0, charEnd: 3 }],
  ...overrides,
});

type SynthesizeInput = Parameters<SidecarClient['synthesize']>[0];

const fakeClient = (): SidecarClient =>
  ({
    baseUrl: 'http://127.0.0.1:1',
    synthesize: async (input: SynthesizeInput) => {
      calls.push({
        text: input.text,
        voiceId: input.voiceId,
        outPath: input.outPath,
        bitrate: input.bitrate,
      });
      return synthesize(input);
    },
  }) as unknown as SidecarClient;

const book = (id: string): Book => ({
  id,
  title: `Sách ${id}`,
  format: 'pdf',
  filePath: `D:\\lib\\${id}.pdf`,
  fileHash: `hash-${id}`,
  lang: 'vi',
  addedAt: 1000,
});

const chapter = (id: string, bookId: string): Chapter => ({
  id,
  bookId,
  index: 0,
  title: 'Chương 1',
  segmentCount: 0,
  audioBytes: 0,
  errorCount: 0,
  generateStatus: 'none',
});

const segment = (id: string, chapterId: string, index: number): Segment => ({
  id,
  chapterId,
  index,
  text: `Câu thứ ${String(index)}.`,
  anchor: { kind: 'pdf', page: 1, rects: [] },
  status: 'pending',
  alignStatus: 'none',
});

let statusEvents: number;

beforeEach(() => {
  db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);

  audioDir = mkdtempSync(join(tmpdir(), 'ln-queue-'));
  calls = [];
  statusEvents = 0;
  voiceId = 'vi_VN-vais1000-medium';
  bitrate = 24;
  clientAvailable = true;
  synthesize = async () => result();

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

  let counter = 0;
  queue = createGenerateQueue({
    jobs,
    segments,
    timings: createTimingsStore(),
    getClient: () => (clientAvailable ? fakeClient() : undefined),
    getAudioDir: () => audioDir,
    getBitrate: () => bitrate,
    getVoiceStyle: () => 'doc_truyen' as const,
    getVoiceId: () => voiceId,
    getBookLang: () => 'vi',
    onStatusChanged: () => {
      statusEvents += 1;
    },
    now: () => 1000,
    newId: () => {
      counter += 1;
      return `job-${String(counter)}`;
    },
  });
});

afterEach(() => {
  db.close();
  rmSync(audioDir, { recursive: true, force: true });
});

/**
 * Chờ worker lặng hẳn — nó chạy nền nên không await trực tiếp được.
 *
 * Điều kiện dừng là **không còn job hiện hành**, không phải `state !== 'running'`:
 * `pause()` gọi từ trong lúc tổng hợp đổi state ngay lập tức, trong khi job đó
 * vẫn đang chạy dở. Dừng theo state thì test đọc DB đúng lúc segment còn ở
 * `generating` và tưởng là lỗi.
 */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    await new Promise((r) => setTimeout(r, 0));
    const status = queue.getStatus();
    if (status.currentJobId === undefined && status.state !== 'running') return;
  }
};

describe('GenerateQueue — thêm việc', () => {
  it('tạo job cho từng segment', () => {
    expect(queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] })).toBe(2);
    expect(jobs.counts().queued).toBe(2);
  });

  it('đánh dấu segment là queued để UI hiện ngay', () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    expect(segments.findById('seg-1')?.status).toBe('queued');
  });

  it('bấm hai lần chỉ ra một job', () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    expect(queue.enqueueSegments({ segmentIds: ['seg-1'] })).toBe(0);
  });

  it('segment sắp phát nhảy lên đầu hàng đợi', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.enqueueSegments({ segmentIds: ['seg-3'], priority: JOB_PRIORITY_URGENT });

    queue.start();
    await settle();

    expect(calls[0]?.text).toBe('Câu thứ 2.');
  });

  it('segment đã có audio vẫn giữ trạng thái ready khi xếp hàng lại', () => {
    segments.markReady('seg-1', {
      audioPath: 'x.ogg',
      durationMs: 1,
      audioBytes: 1,
      alignStatus: 'estimated',
    });
    queue.enqueueSegments({ segmentIds: ['seg-1'] });

    // Hạ xuống 'queued' là nói dối: file .ogg vẫn phát được trong lúc chờ.
    expect(segments.findById('seg-1')?.status).toBe('ready');
  });
});

describe('GenerateQueue — chạy job', () => {
  it('tổng hợp tuần tự cho tới khi hết việc', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2', 'seg-3'] });
    queue.start();
    await settle();

    expect(calls).toHaveLength(3);
    expect(jobs.counts().done).toBe(3);
  });

  it('KHÔNG chạy hai job cùng lúc — sidecar vốn đã xếp hàng bằng Lock', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    synthesize = async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 1));
      concurrent -= 1;
      return result();
    };

    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2', 'seg-3'] });
    queue.start();
    await settle();

    expect(maxConcurrent).toBe(1);
  });

  it('start() gọi nhiều lần không sinh vòng lặp chồng nhau', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.start();
    queue.start();
    queue.start();
    await settle();

    expect(calls).toHaveLength(2);
  });

  it('ghi audioPath và durationMs thật vào segment', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    const found = segments.findById('seg-1');
    expect(found?.status).toBe('ready');
    expect(found?.durationMs).toBe(2810);
    expect(found?.audioBytes).toBe(9401);
  });

  it('timing phoneme vẫn chỉ là estimated — aligned dành cho CTC ở Phase 4', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(segments.findById('seg-1')?.alignStatus).toBe('estimated');
  });

  it('GHI TIMING RA ĐĨA — nợ từ P2.4', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(existsSync(join(audioDir, 'book-1', 'seg-1.json'))).toBe(true);
  });

  it('tự tạo thư mục sách trước khi sidecar ghi file', async () => {
    // Sidecar chỉ được ghi trong `audioDir` chứ không tạo thư mục cha.
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(existsSync(join(audioDir, 'book-1'))).toBe(true);
  });

  it('outPath lấy qua paths.ts, không tự ghép chuỗi', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(calls[0]?.outPath).toBe(join(audioDir, 'book-1', 'seg-1.ogg'));
  });

  it('truyền bitrate THẬT từ settings xuống — nợ từ P2.4', async () => {
    bitrate = 32;
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(calls[0]?.bitrate).toBe(32);
  });

  it('đọc lại audioDir mỗi job — user đổi thư mục giữa chừng', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    const moved = mkdtempSync(join(tmpdir(), 'ln-queue-moved-'));
    audioDir = moved;
    queue.enqueueSegments({ segmentIds: ['seg-2'] });
    queue.start();
    await settle();

    expect(calls[1]?.outPath).toBe(join(moved, 'book-1', 'seg-2.ogg'));
    rmSync(moved, { recursive: true, force: true });
  });

  it('rỗng việc thì về idle chứ không paused', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(queue.getStatus().state).toBe('idle');
  });

  it('enqueue sau khi idle thì start() lại chạy được', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    queue.enqueueSegments({ segmentIds: ['seg-2'] });
    queue.start();
    await settle();

    expect(calls).toHaveLength(2);
  });
});

describe('GenerateQueue — job hỏng', () => {
  it('hỏng lần đầu thì thử lại, không mất việc', async () => {
    let attempt = 0;
    synthesize = async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('sidecar chết');
      return result();
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(segments.findById('seg-1')?.status).toBe('ready');
    expect(attempt).toBe(2);
  });

  it('hết lượt thử thì segment mang lỗi để user thấy', async () => {
    synthesize = async () => {
      throw new Error('ONNX hỏng');
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    const found = segments.findById('seg-1');
    expect(found?.status).toBe('error');
    expect(found?.errorMessage).toContain('ONNX hỏng');
    expect(jobs.findById('job-1')?.attempts).toBe(JOB_MAX_ATTEMPTS);
  });

  it('giữ nguyên thông báo thật của sidecar', async () => {
    synthesize = async () => {
      throw new Error('Voice chưa được cài. Vào màn Giọng đọc để tải lại.');
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(segments.findById('seg-1')?.errorMessage).toContain('Vào màn Giọng đọc');
  });

  it('một job hỏng không chặn các job còn lại', async () => {
    synthesize = async (input) => {
      if (input.text.includes('thứ 0')) throw new Error('hỏng');
      return result();
    };

    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.start();
    await settle();

    expect(segments.findById('seg-2')?.status).toBe('ready');
  });

  it('KHÔNG ghi timing khi tổng hợp hỏng', async () => {
    synthesize = async () => {
      throw new Error('hỏng');
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(existsSync(join(audioDir, 'book-1', 'seg-1.json'))).toBe(false);
  });

  it('segment biến mất giữa chừng thì job lỗi chứ không treo', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    db.prepare('DELETE FROM segments WHERE id = ?').run('seg-1');
    queue.start();
    await settle();

    expect(queue.getStatus().state).not.toBe('running');
  });
});

describe('GenerateQueue — sidecar chưa sẵn sàng', () => {
  it('không có client thì tạm dừng, KHÔNG đốt số lượt thử', async () => {
    clientAvailable = false;
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(queue.getStatus().state).toBe('paused');
    // Job phải quay lại hàng đợi nguyên vẹn để chạy khi sidecar sống lại.
    expect(jobs.findById('job-1')?.status).toBe('queued');
  });

  it('sidecar sống lại thì resume() chạy tiếp đúng job đó', async () => {
    clientAvailable = false;
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    clientAvailable = true;
    queue.resume();
    await settle();

    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('chưa cài voice thì dừng hẳn thay vì hỏng từng job một', async () => {
    // Mọi job đều hỏng vì cùng một lý do — chạy tiếp chỉ đốt sạch số lượt thử
    // của cả hàng đợi rồi mới dừng.
    voiceId = undefined;
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.start();
    await settle();

    expect(queue.getStatus().state).toBe('paused');
    expect(segments.findById('seg-2')?.status).toBe('queued');
  });

  it('báo lỗi chưa cài voice bằng câu user hiểu được', async () => {
    voiceId = undefined;
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(segments.findById('seg-1')?.errorMessage).toContain('Giọng đọc');
  });
});

describe('GenerateQueue — dừng và huỷ', () => {
  it('pause dừng sau job hiện tại, không vứt công đang làm dở', async () => {
    synthesize = async () => {
      queue.pause();
      return result();
    };

    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.start();
    await settle();

    // Job đầu vẫn hoàn tất — vứt đi rồi generate lại từ đầu là lãng phí thật.
    expect(segments.findById('seg-1')?.status).toBe('ready');
    expect(calls).toHaveLength(1);
    expect(queue.getStatus().state).toBe('paused');
  });

  it('resume chạy tiếp phần còn lại', async () => {
    let paused = false;
    synthesize = async () => {
      if (!paused) {
        paused = true;
        queue.pause();
      }
      return result();
    };

    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.start();
    await settle();
    queue.resume();
    await settle();

    expect(calls).toHaveLength(2);
  });

  it('huỷ job đang chờ thì nó không bao giờ chạy', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    const target = jobs.findActiveBySegment('seg-2', 'synthesize');
    expect(queue.cancelJob(target?.id ?? '')).toBe(true);

    queue.start();
    await settle();

    expect(calls).toHaveLength(1);
  });

  it('huỷ job đang chạy thì CẮT request đang bay', async () => {
    let sawAbort = false;
    synthesize = async (input) => {
      const jobId = queue.getStatus().currentJobId;
      queue.cancelJob(jobId ?? '');
      sawAbort = input.signal?.aborted === true;
      throw new Error('aborted');
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    // Không cắt thì job "đã huỷ" vẫn chiếm sidecar cho tới khi tổng hợp xong.
    expect(sawAbort).toBe(true);
  });

  it('job bị huỷ thì segment về pending, không mang lỗi', async () => {
    synthesize = async () => {
      queue.cancelJob(queue.getStatus().currentJobId ?? '');
      throw new Error('aborted');
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    const found = segments.findById('seg-1');
    expect(found?.status).toBe('pending');
    expect(found).not.toHaveProperty('errorMessage');
  });

  it('huỷ theo sách chỉ đụng sách đó', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });

    expect(queue.cancelBook('book-1')).toBe(2);
    expect(jobs.counts().cancelled).toBe(2);
  });

  it('huỷ HÀNG LOẠT cũng đưa segment về pending, không để kẹt ở queued', () => {
    // Lỗi thật gặp ở probe: `cancelAll` huỷ job trong SQLite nhưng quên
    // segment, nên chúng kẹt `queued` vĩnh viễn — UI quay vòng cho việc không
    // còn ai làm. `cancelJob` làm đúng, hai biến thể hàng loạt thì không.
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    expect(segments.findById('seg-1')?.status).toBe('queued');

    queue.cancelAll();

    expect(segments.findById('seg-1')?.status).toBe('pending');
    expect(segments.findById('seg-2')?.status).toBe('pending');
  });

  it('huỷ theo sách cũng dọn segment của sách đó', () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.cancelBook('book-1');

    expect(segments.findById('seg-1')?.status).toBe('pending');
  });

  it('huỷ hàng loạt KHÔNG hạ segment đã có audio', () => {
    segments.markReady('seg-1', {
      audioPath: 'x.ogg',
      durationMs: 1,
      audioBytes: 1,
      alignStatus: 'estimated',
    });
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.cancelAll();

    // File .ogg vẫn nằm trên đĩa và vẫn phát được.
    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('huỷ tất cả thì hàng đợi rỗng việc', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2', 'seg-3'] });

    expect(queue.cancelAll()).toBe(3);
    queue.start();
    await settle();

    expect(calls).toHaveLength(0);
  });

  it('huỷ xong thì segment đó xếp hàng lại được', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.cancelAll();

    expect(queue.enqueueSegments({ segmentIds: ['seg-1'] })).toBe(1);
  });
});

describe('GenerateQueue — khôi phục sau khi app tắt đột ngột', () => {
  it('job đang chạy lúc bị kill được chạy lại ở phiên sau', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    jobs.claimNext(1000);
    segments.markGenerating('seg-1');

    // Phiên mới: recover() trước start().
    expect(queue.recover()).toBe(1);
    queue.start();
    await settle();

    expect(segments.findById('seg-1')?.status).toBe('ready');
  });

  it('hàng đợi sống sót qua lần khởi động lại — đây là lý do persist vào SQLite', () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });

    // Dựng repository mới trên cùng file DB = mở lại app.
    const reopened = createJobRepository(db);
    expect(reopened.counts().queued).toBe(2);
  });
});

describe('GenerateQueue — báo trạng thái lên UI', () => {
  it('đẩy sự kiện khi có việc mới', () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    expect(statusEvents).toBeGreaterThan(0);
  });

  it('cho biết đang tổng hợp segment nào', async () => {
    const seen: (string | undefined)[] = [];
    synthesize = async () => {
      seen.push(queue.getStatus().currentSegmentId);
      return result();
    };

    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(seen).toEqual(['seg-1']);
  });

  it('xong việc thì không còn job hiện hành', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1'] });
    queue.start();
    await settle();

    expect(queue.getStatus().currentJobId).toBeUndefined();
  });

  it('đếm đủ số job theo trạng thái', async () => {
    queue.enqueueSegments({ segmentIds: ['seg-1', 'seg-2'] });
    queue.start();
    await settle();

    expect(queue.getStatus().counts.done).toBe(2);
  });
});
