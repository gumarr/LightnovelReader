export { splitSentences, type Sentence } from './segmenter/sentence-splitter.js';
export { segmentText, type RawSegment, type SegmenterOptions } from './segmenter/segmenter.js';

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
