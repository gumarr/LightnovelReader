/**
 * KHẢO SÁT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Tìm tiêu đề chương trong file KHÔNG có outline và KHÔNG có font lớn hơn
 * thân bài. Tín hiệu còn lại: trang ít dòng, dòng thụt vào giữa, khoảng
 * trắng dọc lớn phía trên, regex tiêu đề.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const ROOT = resolve(__dirname, '../../..');

type Line = { text: string; x: number; y: number; width: number; size: number };

const linesOfPage = async (
  doc: Awaited<ReturnType<typeof getDocument>['promise']>,
  p: number,
): Promise<{ lines: Line[]; width: number; height: number }> => {
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
        size: Math.max(...sorted.map((i) => i.h)),
      };
    })
    .filter((l) => l.text.length > 0);

  return { lines, width: viewport.width, height: viewport.height };
};

const file = 'samples/pdf/A2-A3-english-withoutbookmark.pdf';
const path = resolve(ROOT, file);
const describeIf = existsSync(path) ? describe : describe.skip;

describeIf('EN không outline — tìm tiêu đề chương', () => {
  it('liệt kê trang ít dòng + dòng thụt giữa', async () => {
    const doc = await getDocument({ url: path, useSystemFonts: true }).promise;
    const limit = Math.min(doc.numPages, 140);

    const pages: { p: number; lines: Line[]; width: number; height: number }[] = [];
    for (let p = 1; p <= limit; p += 1) {
      const { lines, width, height } = await linesOfPage(doc, p);
      pages.push({ p, lines, width, height });
    }

    const counts = pages.map((x) => x.lines.length).sort((a, b) => a - b);
    const median = counts[Math.floor(counts.length / 2)] ?? 0;

    console.log(`\n${'='.repeat(72)}`);
    console.log(`Trang ít dòng bất thường (trung vị ${median} dòng/trang)`);
    console.log('='.repeat(72));

    for (const page of pages) {
      if (page.lines.length > median * 0.4) continue;
      console.log(`\n--- Trang ${page.p}: ${page.lines.length} dòng`);
      for (const l of page.lines.slice(0, 8)) {
        const centered = Math.abs(l.x + l.width / 2 - page.width / 2) < 20;
        console.log(
          `   y=${String(Math.round(l.y)).padStart(4)} x=${String(Math.round(l.x)).padStart(4)} sz=${String(Math.round(l.size)).padStart(3)}${centered ? ' [GIỮA]' : '       '} │ ${l.text.slice(0, 60)}`,
        );
      }
    }

    // Dòng khớp regex tiêu đề kiểu EN/VI
    const titleRe = /^(chapter|chương|phần|part|prologue|epilogue|interlude|mở đầu|kết)\b/i;
    console.log(`\n${'='.repeat(72)}`);
    console.log('Dòng khớp regex tiêu đề');
    console.log('='.repeat(72));
    for (const page of pages) {
      for (const l of page.lines) {
        if (titleRe.test(l.text)) {
          console.log(`  tr.${String(page.p).padStart(4)} y=${String(Math.round(l.y)).padStart(4)} sz=${String(Math.round(l.size)).padStart(3)} │ ${l.text.slice(0, 60)}`);
        }
      }
    }

    expect(pages.length).toBeGreaterThan(0);
  }, 300_000);
});
