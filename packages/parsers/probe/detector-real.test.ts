/**
 * KHẢO SÁT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Chạy chapter detector trên PDF thật, in bảng điểm từng tín hiệu để đối
 * chiếu với cấu trúc thật của sách.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { detectChapters, scoreCandidates } from '../src/chapter-detector/detector.js';
import type { DetectSource, OutlineEntry } from '../src/chapter-detector/types.js';
import type { Page } from '../src/cleaner/types.js';

const ROOT = resolve(__dirname, '../../..');

const loadSource = async (path: string, maxPages: number): Promise<DetectSource> => {
  const doc = await getDocument({ url: path, useSystemFonts: true }).promise;
  const limit = Math.min(doc.numPages, maxPages);

  // --- Outline ---
  const raw = await doc.getOutline();
  const outline: OutlineEntry[] = [];
  for (const item of raw ?? []) {
    let pageNumber: number | undefined;
    try {
      const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
      if (Array.isArray(dest) && dest[0]) {
        pageNumber = (await doc.getPageIndex(dest[0] as never)) + 1;
      }
    } catch {
      pageNumber = undefined;
    }
    outline.push(pageNumber === undefined ? { title: item.title } : { title: item.title, pageNumber });
  }

  // --- Trang ---
  const pages: Page[] = [];
  for (let p = 1; p <= limit; p += 1) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    const rows = new Map<number, { yTop: number; items: { x: number; str: string; w: number; h: number }[] }>();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const x = item.transform[4] as number;
      const yTop = viewport.height - (item.transform[5] as number);
      const key = Math.round(yTop / 3);
      const row = rows.get(key) ?? { yTop, items: [] };
      row.items.push({ x, str: item.str, w: item.width, h: item.height });
      rows.set(key, row);
    }

    const lines = [...rows.values()]
      .sort((a, b) => a.yTop - b.yTop)
      .map((row) => {
        const sorted = row.items.sort((a, b) => a.x - b.x);
        const x = Math.min(...sorted.map((i) => i.x));
        const right = Math.max(...sorted.map((i) => i.x + i.w));
        return {
          text: sorted.map((i) => i.str).join('').replace(/\s+/g, ' ').trim(),
          x,
          y: row.yTop,
          width: right - x,
          height: Math.max(...sorted.map((i) => i.h)),
          fontSize: Math.max(...sorted.map((i) => i.h)),
        };
      })
      .filter((l) => l.text.length > 0);

    pages.push({ pageNumber: p, width: viewport.width, height: viewport.height, lines });
  }

  return { pages, outline, totalPages: doc.numPages };
};

const samples = [
  {
    name: 'VI có outline',
    file: 'samples/pdf/A1-A3-vietnamese-withbookmark.pdf',
    maxPages: 270,
    expect: ['Chương Một', 'Chương Hai', 'Chương Ba', 'Chương Bốn'],
  },
  {
    name: 'EN không outline',
    file: 'samples/pdf/A2-A3-english-withoutbookmark.pdf',
    maxPages: 140,
    expect: ['Prologue', 'Chapter 1', 'Chapter 2'],
  },
];

for (const sample of samples) {
  const path = resolve(ROOT, sample.file);
  const describeIf = existsSync(path) ? describe : describe.skip;

  describeIf(sample.name, () => {
    it('phát hiện chương', async () => {
      const src = await loadSource(path, sample.maxPages);
      const chapters = detectChapters(src);

      console.log(`\n${'='.repeat(76)}`);
      console.log(`${sample.name} — ${src.totalPages} trang, đọc ${src.pages.length}`);
      console.log(`Outline: ${src.outline?.length ?? 0} mục`);
      console.log('='.repeat(76));

      console.log(`\nChương phát hiện (${chapters.length}):`);
      for (const c of chapters) {
        console.log(
          `  ${String(c.index).padStart(3)} │ tr.${String(c.pageStart).padStart(4)}–${String(c.pageEnd).padStart(4)} │ điểm ${c.confidence.toFixed(2).padStart(5)} │ ${c.title.slice(0, 52)}`,
        );
      }

      console.log(`\nTop 15 ứng viên (điểm từng tín hiệu):`);
      console.log(`  ${'trang'.padStart(5)} ${'outl'.padStart(5)} ${'font'.padStart(5)} ${'ptrn'.padStart(5)} ${'vtri'.padStart(5)} ${'thưa'.padStart(5)} ${'TỔNG'.padStart(6)} │ text`);
      for (const c of scoreCandidates(src).slice(0, 15)) {
        const s = c.scores;
        console.log(
          `  ${String(c.pageNumber).padStart(5)} ${s.outline.toFixed(2).padStart(5)} ${s.fontSize.toFixed(2).padStart(5)} ${s.pattern.toFixed(2).padStart(5)} ${s.position.toFixed(2).padStart(5)} ${s.sparsePage.toFixed(2).padStart(5)} ${c.total.toFixed(2).padStart(6)} │ ${c.text.slice(0, 45)}`,
        );
      }

      // Kiểm: các chương mong đợi phải xuất hiện
      const titles = chapters.map((c) => c.title).join(' | ');
      console.log(`\nKiểm tra chương mong đợi:`);
      for (const want of sample.expect) {
        const found = titles.includes(want);
        console.log(`  ${found ? '✅' : '❌'} ${want}`);
      }

      expect(chapters.length).toBeGreaterThan(0);
    }, 300_000);
  });
}
