/**
 * KHẢO SÁT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Chạy parser sản phẩm (không phải code trích riêng của probe) trên cả 4
 * file mẫu, rồi nối thẳng vào cleaner + chapter detector để kiểm toàn bộ
 * đường đi từ file → chương.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createNodeParserRegistry } from '../src/parser/node-parsers.js';
import { detectChapters } from '../src/chapter-detector/detector.js';
import { cleanPages } from '../src/cleaner/cleaner.js';
import { segmentText } from '../src/segmenter/segmenter.js';

const ROOT = resolve(__dirname, '../../..');
const registry = createNodeParserRegistry();

const samples = [
  { name: 'PDF VI có outline', file: 'samples/pdf/A1-A3-vietnamese-withbookmark.pdf' },
  { name: 'PDF EN không outline', file: 'samples/pdf/A2-A3-english-withoutbookmark.pdf', maxPages: 140 },
  { name: 'DOCX có heading', file: 'samples/docx/A4-docx-vietnamese.docx' },
  { name: 'DOCX không heading', file: 'samples/docx/B3-docx-noheading.docx' },
];

for (const sample of samples) {
  const path = resolve(ROOT, sample.file);
  const describeIf = existsSync(path) ? describe : describe.skip;

  describeIf(sample.name, () => {
    it('file → parser → cleaner → detector', async () => {
      const parser = registry.require(path);
      const doc = await parser.parse(
        path,
        sample.maxPages === undefined ? {} : { maxPages: sample.maxPages },
      );

      const chapters = detectChapters({
        pages: doc.pages,
        outline: doc.outline,
        totalPages: doc.totalPages,
      });

      const cleaned = cleanPages(doc.pages);
      const allText = cleaned.map((p) => p.text).join('\n');
      const segments = segmentText(allText);

      console.log(`\n${'='.repeat(76)}`);
      console.log(`${sample.name}`);
      console.log('='.repeat(76));
      console.log(`format:        ${doc.format}`);
      console.log(`hasRealPages:  ${doc.hasRealPages}`);
      console.log(`totalPages:    ${doc.totalPages}  (đọc ${doc.pages.length})`);
      console.log(`outline:       ${doc.outline.length} mục`);
      console.log(`text sạch:     ${allText.length} ký tự`);
      console.log(`segment:       ${segments.length}`);

      const unit = doc.hasRealPages ? 'tr.' : 'đoạn';
      console.log(`\nChương (${chapters.length}):`);
      for (const c of chapters.slice(0, 15)) {
        console.log(
          `  ${String(c.index).padStart(3)} │ ${unit}${String(c.pageStart).padStart(4)}–${String(c.pageEnd).padStart(4)} │ ${c.confidence.toFixed(2).padStart(5)} │ ${c.title.slice(0, 50)}`,
        );
      }
      if (chapters.length > 15) console.log(`  … còn ${chapters.length - 15} chương`);

      console.log(`\n3 segment đầu:`);
      for (const s of segments.slice(0, 3)) console.log(`  ▸ ${s.text.slice(0, 88)}`);

      // Bất biến: segment không được vượt ngưỡng
      for (const s of segments) expect(s.text.length).toBeLessThanOrEqual(300);
      expect(chapters.length).toBeGreaterThan(0);
    }, 300_000);
  });
}
