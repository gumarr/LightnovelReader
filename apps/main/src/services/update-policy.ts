/**
 * Phần **thuần** của auto-update: quyết định có được phép cập nhật không, và
 * dịch dữ liệu thô của `electron-updater` sang `UpdateStatus` cho UI.
 *
 * **Vì sao tách khỏi `update-service.ts`.** `electron-updater` chỉ chạy được
 * trong tiến trình Electron thật: nó đọc `app.isPackaged`, `app.getVersion()`
 * và tự tìm `app-update.yml` cạnh file thực thi. Nhét quyết định "có nên chạy
 * không" vào trong đó thì mọi ca quan trọng — bản portable, bản dev, phiên bản
 * lùi — chỉ kiểm được bằng cách đóng gói app rồi chạy tay.
 *
 * Ở đây không import `electron` lẫn `electron-updater`, nên vitest chạy thẳng.
 */

/** Vì sao một bản build không tự cập nhật được. `undefined` = cập nhật được. */
export type UpdateBlockReason = 'dev' | 'portable';

export type UpdateSupportInput = {
  /** `app.isPackaged` — `false` khi chạy `pnpm dev` */
  isPackaged: boolean;
  /**
   * Có `app-update.yml` cạnh file thực thi không.
   *
   * Đây là cách phân biệt **bản NSIS đã cài** với **bản portable** — thứ
   * `app.isPackaged` không nói được vì cả hai đều `true`. electron-builder chỉ
   * đặt file này vào bản cài; bản portable chạy từ thư mục tạm giải nén ra và
   * không có nó. Cài đè một bản portable là vô nghĩa: file gốc user tải về nằm
   * ở chỗ khác hẳn, ghi đè thư mục tạm không đổi được gì.
   */
  hasUpdateConfig: boolean;
};

/**
 * `undefined` nghĩa là cập nhật được. Trả lý do thay vì boolean vì UI nói hai
 * câu khác nhau cho hai ca này, và người đọc log cũng cần biết ca nào.
 */
export const updateBlockReason = (input: UpdateSupportInput): UpdateBlockReason | undefined => {
  if (!input.isPackaged) return 'dev';
  if (!input.hasUpdateConfig) return 'portable';
  return undefined;
};

export const updateBlockMessage = (reason: UpdateBlockReason): string =>
  reason === 'dev'
    ? 'Bản chạy từ mã nguồn không tự cập nhật được.'
    : 'Bản portable không tự cập nhật được. Tải bản mới từ trang Releases và thay file cũ.';

/**
 * So hai phiên bản dạng `major.minor.patch[-prerelease]`.
 *
 * Trả `<0` nếu `a` cũ hơn `b`, `0` nếu bằng, `>0` nếu mới hơn.
 *
 * **Vì sao tự viết mà không dùng `semver`.** Chỉ cần đúng một phép so, và
 * `electron-updater` vốn đã tự quyết định có bản mới hay không — hàm này chỉ
 * dùng để **kiểm tra lại** kết luận đó trước khi hiện nút "Cập nhật" (xem
 * `shouldOfferUpdate`). Thêm một dependency cho một hàm 15 dòng là không đáng.
 *
 * Prerelease xếp **trước** bản chính thức cùng số (`1.0.0-beta` < `1.0.0`) —
 * đúng quy ước semver. Không so nội dung chuỗi prerelease với nhau: dự án này
 * chưa phát hành prerelease bao giờ, đoán thêm là code không có đường chạy.
 */
export const compareVersions = (a: string, b: string): number => {
  const parse = (value: string): { nums: number[]; pre: string } => {
    const [core = '', ...rest] = value.trim().replace(/^v/, '').split('-');
    const nums = core.split('.').map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isNaN(n) ? 0 : n;
    });
    return { nums, pre: rest.join('-') };
  };

  const left = parse(a);
  const right = parse(b);

  for (let i = 0; i < 3; i += 1) {
    const diff = (left.nums[i] ?? 0) - (right.nums[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // Cùng số: có prerelease là cũ hơn bản chính thức
  if (left.pre === right.pre) return 0;
  if (left.pre === '') return 1;
  if (right.pre === '') return -1;
  return 0;
};

/**
 * Có nên mời user cập nhật không.
 *
 * **Vì sao không tin thẳng `electron-updater`.** Sự kiện `update-available` của
 * nó bắn ra theo `latest.yml` trên GitHub, mà file đó là thứ **người** upload.
 * Publish nhầm một release cũ đè lên (`latest.yml` của 0.1.0 ghi lên chỗ của
 * 0.2.0) sẽ đẩy toàn bộ user đang ở bản mới **lùi về bản cũ**, và họ không có
 * cách nào quay lại ngoài tải tay. Một phép so ở đây chặn hẳn ca đó.
 */
export const shouldOfferUpdate = (currentVersion: string, remoteVersion: string): boolean =>
  compareVersions(remoteVersion, currentVersion) > 0;

/**
 * Phần trăm đã tải, kẹp về 0–100 và làm tròn.
 *
 * `electron-updater` trả `percent` dạng số thực dài (`43.71829...`), và khi
 * `total` là 0 — server không trả `Content-Length` — nó cho ra `NaN`. `NaN` đi
 * thẳng vào `style.width` của thanh tiến trình sẽ làm thanh biến mất mà không
 * có lỗi nào, đúng kiểu hỏng lặng lẽ.
 */
export const normalizePercent = (transferred: number, total: number): number => {
  if (!Number.isFinite(total) || total <= 0) return 0;
  if (!Number.isFinite(transferred) || transferred <= 0) return 0;
  return Math.min(100, Math.round((transferred / total) * 100));
};
