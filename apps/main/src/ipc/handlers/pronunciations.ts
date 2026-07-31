import {
  err,
  ok,
  pronunciationIdSchema,
  savePronunciationSchema,
  type PronunciationOverride,
  type Result,
} from '@ln/shared';
import type { PronunciationRepository } from '../../db/repositories/pronunciations.js';
import { InvalidInputError } from '../wrap.js';

/**
 * Handler nhóm `pronunciations:*` — tầng 3 của phiên âm (plan.md mục 8.1).
 *
 * Hai tầng dưới (từ điển ship sẵn 193 mục + luật romaji tự suy) đã lo phần lớn;
 * đây là van an toàn cho những cái tên máy đoán sai. Backend có từ P3.5 nhưng
 * **chưa có đường nào gọi tới** cho tới P5.2 — nghĩa là suốt hai phase, user
 * không sửa được cách đọc dù DB đã sẵn sàng.
 *
 * **Không tự generate lại sau khi lưu.** Audio đã sinh vẫn nằm trên đĩa với cách
 * đọc cũ, và một cuốn sách có thể là hàng nghìn segment — tự động tạo lại là
 * đúng thứ CLAUDE.md cấm (phải hiện ước lượng trước khi generate hàng loạt).
 * Renderer nói rõ điều đó rồi để user tự chọn.
 */

export type PronunciationHandlers = {
  list: (input: unknown) => Result<PronunciationOverride[]>;
  save: (input: unknown) => Result<PronunciationOverride>;
  remove: (input: unknown) => Result<void>;
};

export type PronunciationHandlerDeps = {
  pronunciations: PronunciationRepository;
  /** Kiểm sách có thật không — mục trỏ vào sách đã xoá là rác không ai dọn */
  bookExists: (bookId: string) => boolean;
  /** Sinh id mục mới. Tách ra để test khoá được giá trị. */
  newId: () => string;
  now: () => number;
};

export const createPronunciationHandlers = (
  deps: PronunciationHandlerDeps,
): PronunciationHandlers => {
  return {
    list: (input) => {
      if (typeof input !== 'string' || input === '') {
        throw new InvalidInputError('bookId không hợp lệ');
      }

      // Trả cả mục toàn cục lẫn mục của sách: user cần thấy vì sao một từ đang
      // được đọc như vậy, mà nguyên nhân có thể nằm ở mục toàn cục đặt từ lâu.
      // Mục của sách xếp trước vì đó là thứ user vừa sửa.
      return ok([
        ...deps.pronunciations.listByBook(input),
        ...deps.pronunciations.listGlobal(),
      ]);
    },

    save: (input) => {
      const parsed = savePronunciationSchema.safeParse(input);
      if (!parsed.success) {
        // Trả câu của zod: các luật ở đây (cấm khoảng trắng, cấm rỗng) đều có
        // thông báo viết cho user đọc, không phải mã lỗi nội bộ.
        throw new InvalidInputError(
          parsed.error.issues[0]?.message ?? 'Dữ liệu phiên âm không hợp lệ',
        );
      }

      const { bookId, term, replacement } = parsed.data;
      if (bookId !== undefined && !deps.bookExists(bookId)) {
        return err('NOT_FOUND', 'Không tìm thấy sách để lưu phiên âm.');
      }

      const entry: PronunciationOverride = {
        id: deps.newId(),
        ...(bookId === undefined ? {} : { bookId }),
        term,
        replacement,
        createdAt: deps.now(),
      };

      // `upsert` ghi đè khi trùng `term`, nên `entry.id` có thể KHÔNG phải id
      // thật sự nằm trong DB nếu mục đã tồn tại. Đọc lại để trả về đúng bản
      // trong DB — renderer dùng id đó cho nút xoá.
      deps.pronunciations.upsert(entry);
      const saved = (
        bookId === undefined
          ? deps.pronunciations.listGlobal()
          : deps.pronunciations.listByBook(bookId)
      ).find((item) => item.term === term);

      return ok(saved ?? entry);
    },

    remove: (input) => {
      const parsed = pronunciationIdSchema.safeParse(input);
      if (!parsed.success) throw new InvalidInputError('id không hợp lệ');

      // Xoá mục không tồn tại vẫn trả `ok`: user muốn "đừng đọc theo cách đó
      // nữa", mà điều đó đã đúng sẵn rồi.
      deps.pronunciations.remove(parsed.data);
      return ok(undefined);
    },
  };
};
