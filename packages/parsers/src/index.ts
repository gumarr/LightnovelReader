export { splitSentences, type Sentence } from './segmenter/sentence-splitter.js';
export { segmentText, type RawSegment, type SegmenterOptions } from './segmenter/segmenter.js';
export {
  buildChapterSegments,
  findLineRects,
  type BuildSegmentsInput,
  type ChapterSegment,
} from './segmenter/chapter-segments.js';

export type { Page, TextLine } from './cleaner/types.js';
export { cleanPages, cleanText, type CleanOptions, type CleanedPage } from './cleaner/cleaner.js';
export {
  stripHeadersFooters,
  findRepeatedKeys,
  normalizeForMatch,
  type HeaderFooterOptions,
} from './cleaner/header-footer.js';
export { dehyphenate, type DehyphenateOptions } from './cleaner/dehyphenate.js';
export {
  mergeLines,
  endsSentence,
  startsNewBlock,
  type MergeLinesOptions,
} from './cleaner/merge-lines.js';
export {
  detectColumnLayout,
  reorderColumns,
  type ColumnLayout,
  type ColumnOptions,
} from './cleaner/columns.js';

export type {
  DetectSource,
  DetectedChapter,
  OutlineEntry,
  ScoredCandidate,
  SignalScores,
  TitleCandidate,
} from './chapter-detector/types.js';
export {
  detectChapters,
  fallbackByPage,
  scoreCandidates,
  type DetectOptions,
  type SignalWeights,
} from './chapter-detector/detector.js';
export { bodyFontSize, scoreFontSize } from './chapter-detector/signals/font-size.js';
export {
  normalizeOutline,
  scoreOutline,
  isUsableEntry,
} from './chapter-detector/signals/outline.js';
export { scorePattern } from './chapter-detector/signals/pattern.js';
export { scorePosition, scoreSparsePage } from './chapter-detector/signals/position.js';
export {
  isTableOfContents,
  looksLikeTocEntry,
  type TocOptions,
} from './chapter-detector/signals/toc.js';

export {
  ParseError,
  type DocumentParser,
  type ParsedDocument,
  type ParseErrorKind,
  type ParseOptions,
} from './parser/types.js';
export {
  createPdfParser,
  groupItemsIntoLines,
  hasTextLayer,
  readOutline,
  type PdfLoader,
} from './parser/pdf.js';
export {
  blocksToPages,
  createDocxParser,
  extractBlocks,
  stripHtml,
  type DocxBlock,
  type DocxConverter,
} from './parser/docx.js';
export { createRegistry, extensionOf, type ParserRegistry } from './parser/registry.js';
