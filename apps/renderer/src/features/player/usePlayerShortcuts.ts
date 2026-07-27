import { useEffect } from 'react';
import { playerPositionMs, usePlayerStore } from '@/stores/player-store';
import { stepRate } from './format';

/**
 * Phím tắt của player (plan.md: Space, ←/→, J/K).
 *
 * Gắn ở `window` chứ không ở thanh player: user đang đọc thì tiêu điểm nằm ở
 * viewer hoặc danh sách đoạn, mà bắt họ bấm vào thanh player trước mỗi lần tạm
 * dừng là hỏng đúng mục đích của phím tắt.
 *
 * Nhưng gắn ở `window` kéo theo hai nghĩa vụ, và bỏ sót cái nào cũng thành lỗi
 * user gặp hàng ngày:
 *
 * 1. **Không cướp phím khi user đang gõ.** Ô "đổi tên chương", ô tìm kiếm —
 *    space trong đó phải ra dấu cách chứ không phải tạm dừng nhạc.
 * 2. **Không cướp phím của nút đang có tiêu điểm.** Space trên một `<button>` là
 *    "bấm nút" theo chuẩn; chặn nó là làm hỏng thao tác bàn phím của cả app.
 */

/** Số ms `←`/`→` tua trong đoạn. 5s trên đoạn ~10s là khoảng nửa câu. */
export const SEEK_STEP_MS = 5000;

/**
 * Chỗ user đang gõ chữ → trả phím lại cho họ.
 *
 * Kiểm cả vùng `contenteditable` chứ không riêng thẻ: vùng soạn thảo có thể là
 * một `<div contenteditable>` và lúc đó `tagName` chỉ là `DIV`.
 *
 * Đọc **cả thuộc tính lẫn property**: `isContentEditable` là thứ đúng đắn trên
 * Chromium (nó tính cả kế thừa từ thẻ cha), nhưng jsdom **không cài** nó — trả
 * `undefined` dù thuộc tính có mặt. Chỉ dựa vào property thì nhánh này không
 * kiểm được bằng test, mà đây đúng là nhánh dễ hỏng âm thầm nhất: hỏng thì user
 * gõ dấu cách trong ô soạn thảo lại thành tạm dừng nhạc.
 */
const isTyping = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  // `closest` để bắt cả khi tiêu điểm nằm ở thẻ con bên trong vùng soạn thảo
  if (target.closest('[contenteditable]:not([contenteditable="false"])') !== null) return true;

  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/** Nút/link đang có tiêu điểm — Space và Enter thuộc về nó theo chuẩn */
const isActivatable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;

  const tag = target.tagName;
  return tag === 'BUTTON' || tag === 'A' || target.getAttribute('role') === 'button';
};

export const usePlayerShortcuts = (): void => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Tổ hợp có phím bổ trợ thuộc về app/OS (Ctrl+F, Alt+Tab…) — không đụng
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (isTyping(event.target)) return;

      const player = usePlayerStore.getState();

      switch (event.key) {
        case ' ': {
          // Space trên một nút là "bấm nút đó" — nhường
          if (isActivatable(event.target)) return;
          event.preventDefault(); // nếu không thì trang cuộn xuống một màn
          void player.toggle();
          return;
        }

        case 'ArrowLeft': {
          event.preventDefault();
          // Tua **trong** đoạn, không nhảy đoạn: đoạn ~10s nên nhảy đoạn là bước
          // quá thô cho thao tác "nghe lại chỗ vừa rồi". Nhảy đoạn là J/K.
          player.seek(Math.max(0, playerPositionMs() - SEEK_STEP_MS));
          return;
        }

        case 'ArrowRight': {
          event.preventDefault();
          player.seek(playerPositionMs() + SEEK_STEP_MS);
          return;
        }

        case 'j':
        case 'J': {
          event.preventDefault();
          void player.previous();
          return;
        }

        case 'k':
        case 'K': {
          event.preventDefault();
          void player.next();
          return;
        }

        // `[` `]` đổi tốc độ — cùng quy ước với trình phát podcast
        case '[': {
          event.preventDefault();
          void player.setRate(stepRate(player.playbackRate, -1));
          return;
        }

        case ']': {
          event.preventDefault();
          void player.setRate(stepRate(player.playbackRate, 1));
          return;
        }

        default:
          return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
};
