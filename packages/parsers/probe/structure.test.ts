/**
 * KHẢO SÁT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Đo cấu trúc thật phục vụ P1.3: phân bố font size, dòng nào là ứng viên
 * tiêu đề chương, outline trỏ tới trang nào.
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

const samples = [
  { name: 'VI có outline', file: 'samples/pdf/A1-A3-vietnamese-withbookmark.pdf' },
  { name: 'EN không outline', file: 'samples/pdf/A2-A3-english-withoutbookmark.pdf' },
];

for (const sample of samples) {
  const path = resolve(ROOT, sample.file);
  const describeIf = existsSync(path) ? describe : describe.skip;

  describeIf(`${sample.name}`, () => {
    it('đo phân bố font size + ứng viên tiêu đề', async () => {
      const doc = await getDocument({ url: path, useSystemFonts: true }).promise;

      // --- Outline trỏ tới trang nào ---
      const outline = await doc.getOutline();
      console.log(`\n${'='.repeat(72)}`);
      console.log(`${sample.name} — ${doc.numPages} trang`);
      console.log('='.repeat(72));

      if (outline) {
        console.log(`\nOutline → trang:`);
        for (const item of outline) {
          let pageNum: number | string = '?';
          try {
            const dest = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest;
            if (Array.isArray(dest) && dest[0]) {
              pageNum = (await doc.getPageIndex(dest[0] as never)) + 1;
            }
          } catch {
            pageNum = 'lỗi';
          }
          console.log(`  tr.${String(pageNum).padStart(4)} │ ${item.title}`);
        }
      }

      // --- Phân bố font size toàn sách ---
      const sizeCount = new Map<number, number>();
      const bySize = new Map<number, Line[]>();
      const sample1 = Math.min(doc.numPages, 120);

      for (let p = 1; p <= sample1; p += 1) {
        const { lines } = await linesOfPage(doc, p);
        for (const l of lines) {
          const s = Math.round(l.size);
          sizeCount.set(s, (sizeCount.get(s) ?? 0) + 1);
          const bucket = bySize.get(s) ?? [];
          if (bucket.length < 6) bucket.push({ ...l, y: p });
          bySize.set(s, bucket);
        }
      }

      const total = [...sizeCount.values()].reduce((a, b) => a + b, 0);
      const sorted = [...sizeCount.entries()].sort((a, b) => b[1] - a[1]);
      const bodySize = sorted[0]![0];

      console.log(`\nPhân bố font size (${sample1} trang đầu, ${total} dòng):`);
      for (const [size, count] of sorted.slice(0, 10)) {
        const pct = ((count / total) * 100).toFixed(1);
        const mark = size === bodySize ? ' ← THÂN BÀI' : size > bodySize ? ' ← lớn hơn thân bài' : '';
        console.log(`  ${String(size).padStart(3)}pt: ${String(count).padStart(5)} dòng (${pct.padStart(5)}%)${mark}`);
      }

      console.log(`\nMẫu dòng có size > thân bài (${bodySize}pt):`);
      for (const [size, lines] of [...bySize.entries()].filter(([s]) => s > bodySize).sort((a, b) => b[0] - a[0])) {
        for (const l of lines.slice(0, 4)) {
          console.log(`  ${String(size).padStart(3)}pt tr.${String(l.y).padStart(3)} x=${String(Math.round(l.x)).padStart(4)} │ ${l.text.slice(0, 70)}`);
        }
      }

      expect(doc.numPages).toBeGreaterThan(0);
    }, 300_000);
  });
}
