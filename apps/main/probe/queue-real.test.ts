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
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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
  jobs: ReturnType<typeof createJobRepository>;
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

  return {
    audioDir,
    db,
    queue,
    segments,
    jobs,
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
});
