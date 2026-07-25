import { z } from 'zod';
import {
  AUDIO_BITRATES,
  PLAYBACK_RATE_MAX,
  PLAYBACK_RATE_MIN,
  SEGMENT_MAX_CHARS,
  VIEWER_PANE_RATIO_MAX,
  VIEWER_PANE_RATIO_MIN,
} from './constants.js';

/**
 * Schema validate ở biên IPC — main không tin dữ liệu từ renderer.
 * Type suy ra từ schema phải khớp với type trong types.ts (có test kiểm chứng).
 */

export const bookFormatSchema = z.enum(['pdf', 'docx', 'epub']);
export const bookLangSchema = z.enum(['vi', 'en']);

export const rectSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const segmentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('pdf'),
    page: z.number().int().nonnegative(),
    rects: z.array(rectSchema),
  }),
  z.object({
    kind: z.literal('docx'),
    nodePath: z.string(),
    offset: z.number().int().nonnegative(),
  }),
]);

export const segmentStatusSchema = z.enum(['pending', 'queued', 'generating', 'ready', 'error']);
export const alignStatusSchema = z.enum(['none', 'estimated', 'aligned']);
export const chapterGenerateStatusSchema = z.enum(['none', 'partial', 'complete']);

export const wordTimingSchema = z.object({
  w: z.string(),
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
  charStart: z.number().int().nonnegative(),
  charEnd: z.number().int().nonnegative(),
});

export const wordTimingsFileSchema = z.array(wordTimingSchema);

export const bookSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  author: z.string().optional(),
  format: bookFormatSchema,
  filePath: z.string().min(1),
  fileHash: z.string().min(1),
  lang: bookLangSchema,
  coverPath: z.string().optional(),
  addedAt: z.number().int(),
  lastOpenedAt: z.number().int().optional(),
  lastSegmentId: z.string().optional(),
});

export const chapterSchema = z.object({
  id: z.string().min(1),
  bookId: z.string().min(1),
  index: z.number().int().nonnegative(),
  title: z.string(),
  pageStart: z.number().int().nonnegative().optional(),
  pageEnd: z.number().int().nonnegative().optional(),
  segmentCount: z.number().int().nonnegative(),
  audioBytes: z.number().int().nonnegative(),
  generateStatus: chapterGenerateStatusSchema,
});

export const segmentSchema = z.object({
  id: z.string().min(1),
  chapterId: z.string().min(1),
  index: z.number().int().nonnegative(),
  text: z.string().max(SEGMENT_MAX_CHARS),
  anchor: segmentAnchorSchema,
  audioPath: z.string().optional(),
  durationMs: z.number().nonnegative().optional(),
  audioBytes: z.number().int().nonnegative().optional(),
  status: segmentStatusSchema,
  alignStatus: alignStatusSchema,
  errorMessage: z.string().optional(),
});

export const themeModeSchema = z.enum(['light', 'dark', 'system']);

export const audioBitrateSchema = z.union([z.literal(16), z.literal(24), z.literal(32)]);

export const appSettingsSchema = z.object({
  theme: themeModeSchema,
  audioDir: z.string().min(1),
  bitrate: audioBitrateSchema,
  storageWarnBytes: z.number().int().nonnegative(),
  alignmentEnabled: z.boolean(),
  viewerPaneRatio: z.number().min(VIEWER_PANE_RATIO_MIN).max(VIEWER_PANE_RATIO_MAX),
  subtitleFontSize: z.number().int().min(10).max(48),
  playbackRate: z.number().min(PLAYBACK_RATE_MIN).max(PLAYBACK_RATE_MAX),
});

/** Patch settings — mọi field optional, dùng cho IPC settings:update */
export const appSettingsPatchSchema = appSettingsSchema.partial();

/**
 * Input của `import:*`. Main không tin đường dẫn từ renderer — nhưng ở đây
 * chỉ kiểm dạng, việc chặn đường dẫn ngoài thư viện là của handler.
 */
export const importFilePathSchema = z.string().min(1);

export const importIdSchema = z.string().min(1).max(64);

export const chapterPreviewRequestSchema = z.object({
  importId: importIdSchema,
  chapterId: z.string().min(1).max(64),
  pageStart: z.number().int().positive(),
  pageEnd: z.number().int().positive(),
  maxChars: z.number().int().positive().max(2000).optional(),
});

// Kiểm tra AUDIO_BITRATES và schema không lệch nhau khi sửa constants
const _bitrateGuard: ReadonlyArray<z.infer<typeof audioBitrateSchema>> = AUDIO_BITRATES;
void _bitrateGuard;
