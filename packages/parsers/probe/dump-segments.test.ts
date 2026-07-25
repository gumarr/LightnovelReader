/**
 * KHẢO SÁT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Xuất segment thật từ sách mẫu ra JSON để sidecar chạy normalize lên chúng.
 * Text tổng hợp trong unit test không có dấu 「」, số trang dính chữ, hay
 * hội thoại gạch đầu dòng — mà đó mới là thứ normalize phải xử lý đúng.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createNodeParserRegistry } from '../src/parser/node-parsers.js';
import { cleanPages } from '../src/cleaner/cleaner.js';
import { segmentText } from '../src/segmenter/segmenter.js';

const ROOT = resolve(__dirname, '../../..');
const OUT = resolve(ROOT, 'packages/parsers/probe/out/segments.json');
const registry = createNodeParserRegistry();

const samples = [
  { name: 'pdf-vi', file: 'samples/pdf/A1-A3-vietnamese-withbookmark.pdf', lang: 'vi', maxPages: 60 },
  { name: 'pdf-en', file: 'samples/pdf/A2-A3-english-withoutbookmark.pdf', lang: 'en', maxPages: 60 },
  { name: 'docx-vi', file: 'samples/docx/A4-docx-vietnamese.docx', lang: 'vi' },
];

describe('xuất segment thật', () => {
  it('ghi ra out/segments.json', async () => {
    const collected: { source: string; lang: string; text: string }[] = [];

    for (const sample of samples) {
      const path = resolve(ROOT, sample.file);
      if (!existsSync(path)) continue;

      const parser = registry.require(path);
      const doc = await parser.parse(
        path,
        sample.maxPages === undefined ? {} : { maxPages: sample.maxPages },
      );
      const cleaned = cleanPages(doc.pages);

      for (const page of cleaned) {
        for (const segment of segmentText(page.text)) {
          collected.push({ source: sample.name, lang: sample.lang, text: segment.text });
        }
      }
    }

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(collected, null, 0), 'utf8');
    console.log(`Đã ghi ${collected.length} segment → ${OUT}`);
    expect(collected.length).toBeGreaterThan(0);
  }, 120_000);
});
