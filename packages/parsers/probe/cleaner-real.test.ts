/**
 * KHẢO SÁT — không phải test sản phẩm.
 *
 * Chạy cleaner trên file PDF thật trong `samples/` để xem ngưỡng hiện tại có
 * đúng không. Tự bỏ qua nếu chưa có file mẫu (file mẫu không commit).
 *
 * Chạy: npx vitest run --project node packages/parsers/probe
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { cleanPages } from '../src/cleaner/cleaner.js';
import { findRepeatedKeys, stripHeadersFooters } from '../src/cleaner/header-footer.js';
import { detectColumnLayout } from '../src/cleaner/columns.js';
import type { Page } from '../src/cleaner/types.js';

const ROOT = resolve(__dirname, '../../..');

const loadPages = async (file: string, from: number, count: number): Promise<Page[]> => {
  const doc = await getDocument({ url: file, useSystemFonts: true }).promise;
  const end = Math.min(from + count - 1, doc.numPages);
  const pages: Page[] = [];

  for (let p = from; p <= end; p += 1) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();

    // Gom item thành dòng theo y (pdfjs lấy gốc toạ độ góc DƯỚI-trái)
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
        };
      })
      .filter((l) => l.text.length > 0);

    pages.push({ pageNumber: p, width: viewport.width, height: viewport.height, lines });
  }

  return pages;
};

const samples = [
  { name: 'VI có outline', file: 'samples/pdf/A1-A3-vietnamese-withbookmark.pdf', from: 18, count: 30 },
  { name: 'EN không outline', file: 'samples/pdf/A2-A3-english-withoutbookmark.pdf', from: 12, count: 30 },
];

for (const sample of samples) {
  const path = resolve(ROOT, sample.file);
  const describeIf = existsSync(path) ? describe : describe.skip;

  describeIf(`${sample.name} — ${sample.file}`, () => {
    it('báo cáo kết quả cleaner', async () => {
      const pages = await loadPages(path, sample.from, sample.count);
      const rawLineCount = pages.reduce((s, p) => s + p.lines.length, 0);

      // --- Header/footer ---
      const keys = findRepeatedKeys(pages);
      const stripped = stripHeadersFooters(pages);
      const strippedCount = stripped.reduce((s, p) => s + p.lines.length, 0);
      const removed = new Set<string>();
      for (let i = 0; i < pages.length; i += 1) {
        const before = new Set(stripped[i]!.lines.map((l) => l.text));
        for (const line of pages[i]!.lines) {
          if (!before.has(line.text)) removed.add(line.text);
        }
      }

      // --- Cột ---
      const layouts = pages.map((p) => detectColumnLayout(p).kind);
      const twoColumn = layouts.filter((k) => k === 'two-column').length;

      // --- Pipeline đầy đủ ---
      const cleaned = cleanPages(pages);
      const totalBlocks = cleaned.reduce((s, p) => s + p.text.split('\n').filter(Boolean).length, 0);

      console.log(`\n${'='.repeat(70)}`);
      console.log(`${sample.name} — trang ${sample.from}–${sample.from + sample.count - 1}`);
      console.log('='.repeat(70));
      console.log(`Dòng thô:                 ${rawLineCount}`);
      console.log(`Sau strip header/footer:  ${strippedCount}  (bỏ ${rawLineCount - strippedCount})`);
      console.log(`Khối text sau merge:      ${totalBlocks}`);
      console.log(`Trang nhận là 2 cột:      ${twoColumn}/${pages.length}`);
      console.log(`\nMẫu header/footer bắt được (${keys.size}):`);
      for (const k of keys) console.log(`   • ${JSON.stringify(k)}`);
      console.log(`\nDòng bị loại (${removed.size} mẫu khác nhau):`);
      for (const t of [...removed].slice(0, 25)) console.log(`   • ${JSON.stringify(t)}`);

      console.log(`\n--- Text sau khi làm sạch, 2 trang đầu ---`);
      for (const page of cleaned.slice(0, 2)) {
        console.log(`\n[trang ${page.pageNumber}]`);
        for (const block of page.text.split('\n').filter(Boolean)) {
          console.log(`  ▸ ${block}`);
        }
      }

      expect(cleaned.length).toBe(pages.length);
    }, 120_000);
  });
}
