/**
 * CHẠY THẬT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Chạy hàng đợi P2.5 với sidecar **thật**, model Piper **thật**, SQLite **thật**
 * và đĩa **thật**. Unit test của `queue.ts` giả `SidecarClient` nên không bao
 * giờ lộ được:
 *
 * - `outPath` main dựng ra có được sidecar chấp nhận không (nó từ chối mọi
 *   đường dẫn ngoài `audioDir` — mà `audioDir` lại đi qua biến môi trường lúc
 *   spawn, một đường nối chỉ tồn tại khi chạy thật)
 * - file `.ogg` sinh ra có phải audio thật không, hay chỉ là file rỗng
 * - `bitrate` từ settings có thật sự đổi dung lượng file không
 *
 * Đúng loại lỗi mà PROGRESS mục 4.19, 4.25 và 4.35 nói tới: mọi unit test xanh
 * mà đường nối hai đầu vẫn hỏng.
 */
import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AudioBitrate, Book, Chapter, Segment } from '@ln/shared';
import { applyConnectionPragmas, migrate } from '../src/db/migrator.js';
import { createBookRepository } from '../src/db/repositories/books.js';
import { createChapterRepository } from '../src/db/repositories/chapters.js';
import { createSegmentRepository } from '../src/db/repositories/segments.js';
import { createJobRepository } from '../src/db/repositories/jobs.js';
import { createGenerateQueue } from '../src/services/queue.js';
import { createTimingsStore } from '../src/services/timings-store.js';
import { createQueueHandlers } from '../src/ipc/handlers/queue.js';
import { createReaderHandlers } from '../src/ipc/handlers/reader.js';
import { createStorageHandlers } from '../src/ipc/handlers/storage.js';
import { createStorageService } from '../src/services/storage.js';
import { createSidecarSupervisor } from '../src/services/sidecar-supervisor.js';
import { nodeSpawnSidecar } from '../src/services/sidecar-spawn.js';
import { VENV_PYTHON_RELATIVE } from '../src/services/sidecar-paths.js';

const REPO_ROOT = resolve(__dirname, '../../..');
const VENV = resolve(REPO_ROOT, 'sidecar', VENV_PYTHON_RELATIVE);

/**
 * Voice thật nằm ở userData của app — cùng chỗ bản dev tải về. Không có voice
 * thì bỏ qua cả nhóm thay vì hỏng: máy CI chưa tải 63 MB model bao giờ.
 */
const APPDATA = process.env['APPDATA'] ?? '';
const MODELS_DIR = join(APPDATA, 'LN Reader', 'models');
const VOICE_ID = 'vi_VN-vais1000-medium';
const hasVoice = existsSync(join(MODELS_DIR, 'voices', VOICE_ID));
const canRun = existsSync(VENV) && hasVoice;

const logger = {
  info: (m: string, d?: string) => console.log(`  [info] ${m}${d === undefined ? '' : ` — ${d}`}`),
  warn: (m: string, d?: string) => console.log(`  [warn] ${m}${d === undefined ? '' : ` — ${d}`}`),
  error: (m: string, d?: string) => console.log(`  [ERR ] ${m}${d === undefined ? '' : ` — ${d}`}`),
};

const TEXTS = [
  'Sau giờ học hôm ấy, cô ấy đứng chờ tôi ở cổng trường.',
  'Trời bắt đầu đổ mưa, nhưng không ai trong hai đứa chịu bước đi.',
  'Tôi nhớ mãi câu nói đó, dù đã mười hai năm trôi qua.',
];

type Harness = {
  audioDir: string;
  db: Database.Database;
  queue: ReturnType<typeof createGenerateQueue>;
  segments: ReturnType<typeof createSegmentRepository>;
  chapters: ReturnType<typeof createChapterRepository>;
  jobs: ReturnType<typeof createJobRepository>;
  /** Handler thật, dựng như `index.ts` — để kiểm cả đường ước lượng của P2.6 */
  handlers: ReturnType<typeof createQueueHandlers>;
  /** Handler Storage Manager thật (P2.7) — xoá file thật do sidecar vừa ghi */
  storage: ReturnType<typeof createStorageHandlers>;
  /** Handler trình đọc thật (P3.1) — đọc lại đúng file sidecar vừa ghi */
  reader: ReturnType<typeof createReaderHandlers>;
  supervisor: ReturnType<typeof createSidecarSupervisor>;
  cleanup: () => Promise<void>;
};

const setup = async (bitrate: AudioBitrate = 24): Promise<Harness> => {
  const audioDir = mkdtempSync(join(tmpdir(), 'ln-probe-audio-'));

  const supervisor = createSidecarSupervisor({
    repoRoot: REPO_ROOT,
    modelsDir: MODELS_DIR,
    // Đây là đường nối chỉ tồn tại khi chạy thật: `audioDir` đi qua biến môi
    // trường `LN_SIDECAR_AUDIO_DIR` lúc spawn, và sidecar dùng nó để CHẶN mọi
    // outPath nằm ngoài. Sai một chỗ là mọi job đều 400.
    audioDir: () => audioDir,
    spawn: nodeSpawnSidecar,
    exists: existsSync,
    logger,
    baseEnv: process.env as Record<string, string>,
  });

  await supervisor.start();

  const db = new Database(':memory:');
  applyConnectionPragmas(db);
  migrate(db);

  const books = createBookRepository(db);
  const chapters = createChapterRepository(db);
  const segments = createSegmentRepository(db);
  const jobs = createJobRepository(db);

  const book: Book = {
    id: 'probe-book',
    title: 'Sách probe',
    format: 'pdf',
    filePath: 'D:\\probe.pdf',
    fileHash: 'probe-hash',
    lang: 'vi',
    addedAt: Date.now(),
  };
  const chapter: Chapter = {
    id: 'probe-chap',
    bookId: 'probe-book',
    index: 0,
    title: 'Chương 1',
    segmentCount: TEXTS.length,
    audioBytes: 0,
    // Cột của schema v2 (P2.7b). Thiếu là `NOT NULL constraint failed` ngay ở
    // `insertMany` — cả file probe đã hỏng từ lúc thêm migration.
    errorCount: 0,
    generateStatus: 'none',
  };
  const segmentRows: Segment[] = TEXTS.map((text, index) => ({
    id: `probe-seg-${String(index)}`,
    chapterId: 'probe-chap',
    index,
    text,
    anchor: { kind: 'pdf', page: 1, rects: [] },
    status: 'pending',
    alignStatus: 'none',
  }));

  books.insert(book);
  chapters.insertMany([chapter]);
  segments.insertMany(segmentRows);

  const queue = createGenerateQueue({
    jobs,
    segments,
    timings: createTimingsStore(),
    getClient: () => supervisor.getClient(),
    getAudioDir: () => audioDir,
    getBitrate: () => bitrate,
    getVoiceId: () => VOICE_ID,
    getBookLang: () => 'vi',
    logger,
  });

  const handlers = createQueueHandlers({
    queue,
    jobs,
    segments,
    chapters,
    getBitrate: () => bitrate,
  });

  const storage = createStorageHandlers({
    storage: createStorageService({ books, chapters, segments, logger }),
    books,
    chapters,
    queue,
    getAudioDir: () => audioDir,
    getWarnBytes: () => 5 * 1024 ** 3,
  });

  // Dựng như `index.ts`: cùng `timingsStore`, cùng `getAudioDir`. Đây là đường
  // đọc lại thứ hàng đợi vừa ghi — hai nửa mà unit test luôn giả một bên.
  const reader = createReaderHandlers({
    books,
    chapters,
    segments,
    readFile: (filePath) => readFile(filePath),
    convertDocx: () => {
      throw new Error('probe không dùng DOCX');
    },
    timings: createTimingsStore(),
    getAudioDir: () => audioDir,
  });

  return {
    audioDir,
    db,
    queue,
    segments,
    chapters,
    jobs,
    handlers,
    storage,
    reader,
    supervisor,
    cleanup: async () => {
      await supervisor.stop();
      db.close();
      rmSync(audioDir, { recursive: true, force: true });
    },
  };
};

const waitForIdle = async (harness: Harness, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = harness.queue.getStatus();
    if (status.state !== 'running' && status.currentJobId === undefined) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Hàng đợi chạy quá lâu');
};

describe.skipIf(!canRun)('hàng đợi thật + sidecar thật + model thật', () => {
  it('generate cả chương: có .ogg nghe được, có timing, DB khớp đĩa', async () => {
    const harness = await setup();
    try {
      const started = Date.now();
      const added = harness.queue.enqueueSegments({
        segmentIds: TEXTS.map((_, i) => `probe-seg-${String(i)}`),
      });
      expect(added).toBe(TEXTS.length);

      harness.queue.start();
      await waitForIdle(harness, 240_000);

      const elapsed = Date.now() - started;
      console.log(`  Tổng hợp ${String(TEXTS.length)} segment trong ${String(elapsed)} ms`);

      let totalBytes = 0;
      let totalDuration = 0;

      for (let i = 0; i < TEXTS.length; i += 1) {
        const id = `probe-seg-${String(i)}`;
        const segment = harness.segments.findById(id);

        expect(segment?.status).toBe('ready');
        expect(segment?.alignStatus).toBe('estimated');

        // File audio phải tồn tại THẬT ở đúng chỗ domain model quy định
        const oggPath = join(harness.audioDir, 'probe-book', `${id}.ogg`);
        expect(existsSync(oggPath)).toBe(true);

        // Không chỉ tồn tại — phải là Ogg thật. File rỗng cũng "tồn tại".
        const header = readFileSync(oggPath).subarray(0, 4).toString('ascii');
        expect(header).toBe('OggS');

        const sizeOnDisk = statSync(oggPath).size;
        expect(sizeOnDisk).toBeGreaterThan(1000);
        // Con số trong DB phải khớp đĩa, nếu không storage manager nói dối
        expect(segment?.audioBytes).toBe(sizeOnDisk);

        // NỢ P2.4 ĐÃ TRẢ: timing phải nằm trên đĩa, không chỉ đi qua HTTP
        const jsonPath = join(harness.audioDir, 'probe-book', `${id}.json`);
        expect(existsSync(jsonPath)).toBe(true);

        const timings: unknown = JSON.parse(readFileSync(jsonPath, 'utf8'));
        const parsed = timings as { words: unknown[]; durationMs: number; source: string };
        expect(Array.isArray(parsed.words)).toBe(true);
        expect(parsed.words.length).toBeGreaterThan(0);
        expect(parsed.durationMs).toBe(segment?.durationMs);

        console.log(
          `  ${id}: ${String(sizeOnDisk)} B · ${String(segment?.durationMs)} ms · ` +
            `${String(parsed.words.length)} từ · timing=${parsed.source}`,
        );

        totalBytes += sizeOnDisk;
        totalDuration += segment?.durationMs ?? 0;
      }

      // Bitrate thật đo được: kiểm 24 kbps có ra đúng cỡ đó không
      const kbps = (totalBytes * 8) / (totalDuration / 1000) / 1000;
      console.log(`  Bitrate đo được: ${kbps.toFixed(1)} kbps (đặt 24)`);
      expect(kbps).toBeGreaterThan(15);
      expect(kbps).toBeLessThan(40);

      expect(harness.jobs.counts().done).toBe(TEXTS.length);
    } finally {
      await harness.cleanup();
    }
  });

  it('P3.1: đọc lại audio + timing thật qua reader:getSegmentAudio', async () => {
    const harness = await setup();
    try {
      harness.queue.enqueueSegments({ segmentIds: ['probe-seg-0'] });
      harness.queue.start();
      await waitForIdle(harness, 240_000);

      const segment = harness.segments.findById('probe-seg-0');
      expect(segment?.status).toBe('ready');

      const result = await harness.reader.getSegmentAudio('probe-seg-0');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { bytes, durationMs, timings, timingSource } = result.data;

      // Bytes qua IPC phải là chính file trên đĩa — không cụt, không lệch offset
      const oggPath = join(harness.audioDir, 'probe-book', 'probe-seg-0.ogg');
      const onDisk = readFileSync(oggPath);
      expect(bytes.byteLength).toBe(onDisk.byteLength);
      expect(Buffer.from(bytes).equals(onDisk)).toBe(true);
      expect(Buffer.from(bytes).subarray(0, 4).toString('ascii')).toBe('OggS');

      // Timing phải là bản thật từ phoneme, không phải ước lượng: file `.json`
      // do hàng đợi ghi ngay cạnh, nên rơi về `estimate` ở đây nghĩa là đường
      // đọc đang trỏ sai chỗ.
      expect(timingSource).toBe('phoneme');
      expect(durationMs).toBe(segment?.durationMs);
      expect(timings.length).toBeGreaterThan(0);

      // Bất biến mà player dựa vào: mốc tăng dần và nằm trong thời lượng audio
      for (let i = 0; i < timings.length; i += 1) {
        const t = timings[i];
        if (t === undefined) continue;
        expect(t.endMs).toBeGreaterThanOrEqual(t.startMs);
        expect(t.startMs).toBeGreaterThanOrEqual(0);
        expect(t.endMs).toBeLessThanOrEqual(durationMs + 50);
        if (i > 0) expect(t.startMs).toBeGreaterThanOrEqual(timings[i - 1]?.startMs ?? 0);
      }

      // `charStart`/`charEnd` phải cắt lại đúng chữ trong text gốc — đây là thứ
      // subtitle pane dùng để tô, sai một ký tự là tô lệch cả câu.
      const text = segment?.text ?? '';
      let matched = 0;
      for (const t of timings) {
        if (text.slice(t.charStart, t.charEnd) === t.w) matched += 1;
      }
      console.log(
        `  ${String(timings.length)} từ · ${String(matched)} khớp charStart/charEnd · ` +
          `${String(durationMs)} ms · nguồn=${timingSource}`,
      );
      expect(matched).toBe(timings.length);

      // Xoá file `.json` rồi đọc lại: phải rơi về ước lượng chứ không trả mảng
      // rỗng — nếu không thì highlight đứng im mà không ai biết vì sao.
      rmSync(join(harness.audioDir, 'probe-book', 'probe-seg-0.json'));
      const fallback = await harness.reader.getSegmentAudio('probe-seg-0');
      expect(fallback.ok).toBe(true);
      if (!fallback.ok) return;
      expect(fallback.data.timingSource).toBe('estimate');
      expect(fallback.data.timings.length).toBeGreaterThan(0);
      expect(fallback.data.durationMs).toBe(segment?.durationMs);
      console.log(`  Mất file timing → ước lượng ${String(fallback.data.timings.length)} từ`);

      // Xoá luôn `.ogg`: DB vẫn nói `ready` nhưng file không còn — player phải
      // nhận `NOT_FOUND` để xếp lại hàng đợi, không phải lỗi hệ thống.
      rmSync(oggPath);
      const gone = await harness.reader.getSegmentAudio('probe-seg-0');
      expect(gone.ok).toBe(false);
      if (gone.ok) return;
      expect(gone.error.code).toBe('NOT_FOUND');

      // Segment chưa generate cũng cùng mã
      const pending = await harness.reader.getSegmentAudio('probe-seg-1');
      expect(pending.ok).toBe(false);
      if (pending.ok) return;
      expect(pending.error.code).toBe('NOT_FOUND');
    } finally {
      await harness.cleanup();
    }
  }, 300_000);

  it('bitrate 16 cho file NHỎ HƠN 32 — settings thật sự có tác dụng', async () => {
    // Nợ từ P2.4: `AppSettings.bitrate` có sẵn mà chưa ai đọc. Chỉ đo trên file
    // thật mới biết nó có đi tới libsndfile hay bị bỏ quên giữa đường.
    const low = await setup(16);
    let lowBytes = 0;
    try {
      low.queue.enqueueSegments({ segmentIds: ['probe-seg-0'] });
      low.queue.start();
      await waitForIdle(low, 120_000);
      lowBytes = low.segments.findById('probe-seg-0')?.audioBytes ?? 0;
    } finally {
      await low.cleanup();
    }

    const high = await setup(32);
    let highBytes = 0;
    try {
      high.queue.enqueueSegments({ segmentIds: ['probe-seg-0'] });
      high.queue.start();
      await waitForIdle(high, 120_000);
      highBytes = high.segments.findById('probe-seg-0')?.audioBytes ?? 0;
    } finally {
      await high.cleanup();
    }

    console.log(`  16 kbps → ${String(lowBytes)} B · 32 kbps → ${String(highBytes)} B`);
    expect(lowBytes).toBeGreaterThan(0);
    expect(highBytes).toBeGreaterThan(lowBytes);
  });

  it('hàng đợi sống sót qua "khởi động lại": job dở dang chạy tiếp', async () => {
    const harness = await setup();
    try {
      // Mô phỏng app bị kill giữa lúc chạy: job ở `running`, segment ở
      // `generating`, không có ai đang cầm nó nữa.
      harness.queue.enqueueSegments({ segmentIds: ['probe-seg-0'] });
      harness.jobs.claimNext(Date.now());
      harness.segments.markGenerating('probe-seg-0');

      expect(harness.jobs.counts().running).toBe(1);

      // Phiên mới
      const recovered = harness.queue.recover();
      console.log(`  Khôi phục ${String(recovered)} job mồ côi`);
      expect(recovered).toBe(1);

      harness.queue.start();
      await waitForIdle(harness, 120_000);

      expect(harness.segments.findById('probe-seg-0')?.status).toBe('ready');
      expect(existsSync(join(harness.audioDir, 'probe-book', 'probe-seg-0.ogg'))).toBe(true);
    } finally {
      await harness.cleanup();
    }
  });

  it('huỷ giữa chừng thì cắt thật, không để lại segment kẹt ở generating', async () => {
    const harness = await setup();
    try {
      harness.queue.enqueueSegments({
        segmentIds: TEXTS.map((_, i) => `probe-seg-${String(i)}`),
      });
      harness.queue.start();

      // Chờ tới khi có job thật sự đang chạy rồi mới huỷ — huỷ trước khi worker
      // kịp cầm job nào thì không kiểm được đường cắt request đang bay.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline && harness.queue.getStatus().currentJobId === undefined) {
        await new Promise((r) => setTimeout(r, 20));
      }

      const cancelled = harness.queue.cancelAll();
      console.log(`  Huỷ ${String(cancelled)} job`);
      await waitForIdle(harness, 120_000);

      // Không segment nào được phép kẹt ở `generating`/`queued`: UI sẽ quay
      // vòng mãi mãi cho một việc không còn ai làm.
      const statuses = TEXTS.map(
        (_, i) => harness.segments.findById(`probe-seg-${String(i)}`)?.status,
      );
      console.log(`  Trạng thái segment sau huỷ: ${statuses.join(', ')}`);
      for (const status of statuses) {
        expect(status === 'pending' || status === 'ready').toBe(true);
      }
      expect(harness.jobs.counts().queued).toBe(0);
      expect(harness.jobs.counts().running).toBe(0);
    } finally {
      await harness.cleanup();
    }
  });

  /**
   * P2.6: ước lượng phải bám sát số THẬT.
   *
   * Unit test của `estimateChapter` giả cả `pendingStats` lẫn bitrate nên chỉ
   * chứng minh phép nhân đúng — nó không thể biết `CHARS_PER_SECOND_ESTIMATE`
   * và `bytesPerSecondAt` có mô tả đúng Piper thật hay không. Hộp ước lượng lệch
   * mười lần thì user tin sai về dung lượng đĩa mà mọi test vẫn xanh.
   */
  it('ước lượng bám sát dung lượng thật sau khi generate', async () => {
    const harness = await setup();
    try {
      const before = harness.handlers.estimateChapter('probe-chap');
      expect(before.ok).toBe(true);
      if (!before.ok) return;

      // Chưa generate gì: phải đếm đủ mọi segment và chưa có byte nào
      expect(before.data.segmentCount).toBe(TEXTS.length);
      expect(before.data.existingBytes).toBe(0);

      const started = Date.now();
      harness.queue.enqueueSegments({
        segmentIds: TEXTS.map((_, i) => `probe-seg-${String(i)}`),
      });
      harness.queue.start();
      await waitForIdle(harness, 120_000);
      const realProcessingMs = Date.now() - started;

      const after = harness.handlers.estimateChapter('probe-chap');
      expect(after.ok).toBe(true);
      if (!after.ok) return;

      // Generate xong thì không còn gì để ước lượng nữa
      expect(after.data.segmentCount).toBe(0);
      expect(after.data.audioBytes).toBe(0);

      // `existingBytes` phải khớp tổng byte THẬT trên đĩa
      const realBytes = TEXTS.reduce(
        (sum, _, i) =>
          sum + statSync(join(harness.audioDir, 'probe-book', `probe-seg-${String(i)}.ogg`)).size,
        0,
      );
      expect(after.data.existingBytes).toBe(realBytes);

      const ratio = realBytes / before.data.audioBytes;
      console.log(
        `  Ước lượng ${String(before.data.audioBytes)} B vs thật ${String(realBytes)} B ` +
          `(lệch ${(ratio * 100 - 100).toFixed(0)}%)`,
      );
      const realDurationMs = harness.segments
        .listByChapter('probe-chap')
        .reduce((sum, seg) => sum + (seg.durationMs ?? 0), 0);
      console.log(
        `  Thời lượng ước ${String(before.data.audioDurationMs)} ms vs thật ` +
          `${String(realDurationMs)} ms`,
      );
      // `SYNTHESIS_RTF_ESTIMATE` là hằng số đặt từ Phase 0 theo plan.md, chưa ai
      // đo lại. In cả hai số để biết nó còn hợp lý không (mục 8).
      console.log(
        `  Thời gian xử lý ước ${String(before.data.processingMs)} ms vs thật ` +
          `${String(realProcessingMs)} ms (gồm nạp model) · RTF thật ` +
          `${(realProcessingMs / realDurationMs).toFixed(2)}`,
      );

      // Ngưỡng rộng: đây là ước lượng, không phải phép đo. Nhưng lệch quá 4 lần
      // thì hằng số đã sai bản chất, không còn là sai số.
      expect(ratio).toBeGreaterThan(0.25);
      expect(ratio).toBeLessThan(4);
    } finally {
      await harness.cleanup();
    }
  }, 180_000);

  /**
   * P2.6: `enqueueBook` phải xếp đúng mọi segment chưa có audio của cả sách,
   * kể cả khi một phần đã generate rồi — và không tạo job thứ hai cho segment
   * đã nằm trong hàng đợi.
   */
  it('xếp cả sách bỏ qua segment đã có audio', async () => {
    const harness = await setup();
    try {
      // Generate trước một segment
      harness.queue.enqueueSegments({ segmentIds: ['probe-seg-0'] });
      harness.queue.start();
      await waitForIdle(harness, 120_000);
      expect(harness.segments.findById('probe-seg-0')?.status).toBe('ready');

      const result = harness.handlers.enqueueBook('probe-book');
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Chỉ 2 segment còn lại được xếp, không tổng hợp lại cái đã xong
      expect(result.data.added).toBe(TEXTS.length - 1);
      console.log(`  Xếp lại cả sách: thêm ${String(result.data.added)} job`);

      await waitForIdle(harness, 120_000);

      const statuses = harness.segments.listByChapter('probe-chap').map((s) => s.status);
      expect(statuses).toEqual(['ready', 'ready', 'ready']);

      // Chương phải báo `complete` và dung lượng khớp đĩa
      const chapter = harness.chapters.findById('probe-chap');
      expect(chapter?.generateStatus).toBe('complete');
      expect(harness.chapters.audioBytesByBook('probe-book')).toBe(chapter?.audioBytes);
      console.log(`  Dung lượng cả sách: ${String(chapter?.audioBytes ?? 0)} B`);
    } finally {
      await harness.cleanup();
    }
  }, 240_000);

  /**
   * P2.7: Storage Manager xoá **file thật do sidecar vừa ghi**.
   *
   * Unit test của `storage.ts` tự tạo file bằng `writeFileSync` nên chỉ chứng
   * minh phép xoá đúng trên file nó tự dựng. Ở đây file do sidecar ghi qua
   * `outPath` mà main dựng, tên do `paths.ts` sinh — nếu hai bên lệch nhau một
   * ký tự thì xoá không trúng gì mà DB vẫn báo đã xoá xong.
   */
  it('xoá audio dọn đúng file sidecar đã ghi, DB và đĩa cùng về 0', async () => {
    const harness = await setup();
    try {
      harness.queue.enqueueSegments({
        segmentIds: TEXTS.map((_, i) => `probe-seg-${String(i)}`),
      });
      harness.queue.start();
      await waitForIdle(harness, 240_000);

      const dir = join(harness.audioDir, 'probe-book');
      const before = readdirSync(dir).sort();
      // 3 segment × (ogg + json)
      expect(before).toHaveLength(TEXTS.length * 2);

      const usageBefore = await harness.storage.getUsage();
      expect(usageBefore.ok).toBe(true);
      if (!usageBefore.ok) return;
      console.log(
        `  Trước khi xoá: DB ${String(usageBefore.data.audioBytes)} B, ` +
          `đĩa ${String(usageBefore.data.audioBytesOnDisk)} B, ` +
          `${String(before.length)} file`,
      );

      // Số DB không được lớn hơn số đĩa: DB chỉ đếm `.ogg`, đĩa đếm cả `.json`
      expect(usageBefore.data.audioBytesOnDisk).toBeGreaterThan(usageBefore.data.audioBytes);

      const deleted = await harness.storage.deleteBookAudio('probe-book');
      expect(deleted.ok).toBe(true);
      if (!deleted.ok) return;

      console.log(
        `  Đã xoá ${String(deleted.data.filesDeleted)} file, ` +
          `giải phóng ${String(deleted.data.freedBytes)} B`,
      );

      // Đúng số file đã xoá — không sót `.json` nào
      expect(deleted.data.filesDeleted).toBe(TEXTS.length * 2);
      expect(deleted.data.segments).toBe(TEXTS.length);
      expect(existsSync(dir)).toBe(false);

      const usageAfter = await harness.storage.getUsage();
      if (!usageAfter.ok) return;
      expect(usageAfter.data.audioBytes).toBe(0);
      expect(usageAfter.data.audioBytesOnDisk).toBe(0);
      expect(usageAfter.data.orphanFiles).toBe(0);

      // Segment về `pending` và generate lại được — xoá không phá cấu trúc
      const statuses = harness.segments.listByChapter('probe-chap').map((s) => s.status);
      expect(statuses).toEqual(['pending', 'pending', 'pending']);
      expect(harness.chapters.findById('probe-chap')?.generateStatus).toBe('none');

      // Generate lại từ trạng thái đã xoá: đây là thứ user sẽ làm ngay sau khi
      // xoá nhầm, và nó phải chạy chứ không kẹt vì job cũ còn trong DB.
      const again = harness.handlers.enqueueBook('probe-book');
      expect(again.ok).toBe(true);
      if (!again.ok) return;
      expect(again.data.added).toBe(TEXTS.length);

      await waitForIdle(harness, 240_000);
      expect(harness.segments.listByChapter('probe-chap').map((s) => s.status)).toEqual([
        'ready',
        'ready',
        'ready',
      ]);
      console.log('  Generate lại sau khi xoá: xong cả 3 segment');
    } finally {
      await harness.cleanup();
    }
  }, 600_000);

  /**
   * P2.7: xoá audio giữa lúc hàng đợi đang chạy.
   *
   * Đây là ca mà unit test không dựng được: handler phải huỷ job **trước** khi
   * xoá file, nếu không worker ghi lại đúng những file vừa xoá và DB nói
   * `pending` cho file đang tồn tại — user bấm xoá mà dung lượng không giảm.
   */
  it('xoá audio giữa lúc đang generate: không segment nào kẹt, không file mồ côi', async () => {
    const harness = await setup();
    try {
      harness.queue.enqueueSegments({
        segmentIds: TEXTS.map((_, i) => `probe-seg-${String(i)}`),
      });
      harness.queue.start();

      // Chờ segment đầu xong rồi cắt giữa chừng — lúc này còn job đang chạy
      const deadline = Date.now() + 240_000;
      while (Date.now() < deadline) {
        if (harness.segments.findById('probe-seg-0')?.status === 'ready') break;
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(harness.segments.findById('probe-seg-0')?.status).toBe('ready');

      const deleted = await harness.storage.deleteBookAudio('probe-book');
      expect(deleted.ok).toBe(true);

      // Chờ hàng đợi lắng hẳn: request đang bay bị cắt, worker phải thoát vòng
      await waitForIdle(harness, 120_000);

      // KHÔNG segment nào được kẹt ở `queued`/`generating` — cùng loại lỗi 4.35
      const statuses = harness.segments.listByChapter('probe-chap').map((s) => s.status);
      console.log(`  Trạng thái sau khi xoá giữa chừng: ${statuses.join(', ')}`);
      expect(statuses.some((s) => s === 'queued' || s === 'generating')).toBe(false);

      // Job đang bay có thể ghi xong file sau lượt xoá — đó chính là lý do
      // handler phải huỷ job trước. Kiểm bằng số thật: DB và đĩa phải khớp.
      const usage = await harness.storage.getUsage();
      if (!usage.ok) return;

      const dir = join(harness.audioDir, 'probe-book');
      const leftover = existsSync(dir) ? readdirSync(dir) : [];
      console.log(
        `  Còn lại: DB ${String(usage.data.audioBytes)} B, ` +
          `đĩa ${String(usage.data.audioBytesOnDisk)} B, ${String(leftover.length)} file`,
      );

      // Mỗi segment `ready` phải có file thật; mỗi file thật phải thuộc một
      // segment `ready`. Lệch một chiều nào cũng là rác hoặc nút phát hỏng.
      const readyIds = harness.segments
        .listByChapter('probe-chap')
        .filter((s) => s.status === 'ready')
        .map((s) => s.id);

      for (const id of readyIds) {
        expect(existsSync(join(dir, `${id}.ogg`))).toBe(true);
      }
      const oggFiles = leftover.filter((name) => name.endsWith('.ogg'));
      expect(oggFiles).toHaveLength(readyIds.length);
      expect(usage.data.orphanFiles).toBe(0);
    } finally {
      await harness.cleanup();
    }
  }, 600_000);
});
