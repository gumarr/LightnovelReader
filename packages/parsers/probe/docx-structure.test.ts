/**
 * KHẢO SÁT — không phải test sản phẩm. Xem probe/README.md.
 *
 * Đo cấu trúc thật của file DOCX trước khi viết parser: mammoth trả HTML
 * kiểu gì, heading có giữ được không, chương nhận biết bằng tín hiệu nào.
 */
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import mammoth from 'mammoth';

const ROOT = resolve(__dirname, '../../..');

const samples = [
  { name: 'DOCX có heading style', file: 'samples/docx/A4-docx-vietnamese.docx' },
  { name: 'DOCX không heading', file: 'samples/docx/B3-docx-noheading.docx' },
];

for (const sample of samples) {
  const path = resolve(ROOT, sample.file);
  const describeIf = existsSync(path) ? describe : describe.skip;

  describeIf(sample.name, () => {
    it('đo cấu trúc HTML mammoth trả về', async () => {
      const { value: html, messages } = await mammoth.convertToHtml({ path });

      console.log(`\n${'='.repeat(76)}`);
      console.log(`${sample.name} — ${sample.file}`);
      console.log('='.repeat(76));
      console.log(`HTML dài: ${html.length} ký tự`);

      if (messages.length > 0) {
        console.log(`\nCảnh báo từ mammoth (${messages.length}, in 8 cái đầu):`);
        for (const m of messages.slice(0, 8)) console.log(`  [${m.type}] ${m.message}`);
      }

      // --- Thống kê thẻ ---
      const tagCount = new Map<string, number>();
      for (const match of html.matchAll(/<(\w+)[^>]*>/g)) {
        const tag = match[1]!.toLowerCase();
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
      console.log(`\nThẻ HTML:`);
      for (const [tag, n] of [...tagCount.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  <${tag}>`.padEnd(12) + `${n}`);
      }

      // --- Heading ---
      const headings = [...html.matchAll(/<(h[1-6])[^>]*>(.*?)<\/\1>/gis)].map((m) => ({
        tag: m[1]!,
        text: m[2]!.replace(/<[^>]+>/g, '').trim(),
      }));

      console.log(`\nHeading tìm được (${headings.length}):`);
      for (const h of headings.slice(0, 25)) {
        console.log(`  <${h.tag}> ${h.text.slice(0, 66)}`);
      }
      if (headings.length > 25) console.log(`  … còn ${headings.length - 25}`);

      // --- Paragraph đầu tiên, để xem text trông thế nào ---
      const paras = [...html.matchAll(/<p[^>]*>(.*?)<\/p>/gis)].map((m) =>
        m[1]!.replace(/<[^>]+>/g, '').trim(),
      );
      const nonEmpty = paras.filter((p) => p.length > 0);
      console.log(`\nParagraph: ${paras.length} tổng, ${nonEmpty.length} có nội dung`);
      console.log(`5 paragraph đầu:`);
      for (const p of nonEmpty.slice(0, 5)) console.log(`  ▸ ${p.slice(0, 90)}`);

      // --- Ứng viên tiêu đề trong paragraph (khi không có heading) ---
      const titleRe = /^(chương|phần|quyển|hồi|mở đầu|kết|lời bạt|chapter|part|prologue|epilogue)\b/i;
      const candidates = nonEmpty.filter((p) => titleRe.test(p) && p.length < 120);
      console.log(`\nParagraph khớp regex tiêu đề (${candidates.length}):`);
      for (const c of candidates.slice(0, 20)) console.log(`  ▸ ${c.slice(0, 66)}`);

      // --- Dấu in đậm: mammoth map <strong> ---
      const strongParas = [...html.matchAll(/<p[^>]*>\s*<strong>(.*?)<\/strong>\s*<\/p>/gis)].map(
        (m) => m[1]!.replace(/<[^>]+>/g, '').trim(),
      );
      console.log(`\nParagraph CHỈ gồm chữ in đậm (${strongParas.length}):`);
      for (const s of strongParas.slice(0, 15)) console.log(`  ▸ ${s.slice(0, 66)}`);

      expect(html.length).toBeGreaterThan(0);
    }, 300_000);
  });
}
