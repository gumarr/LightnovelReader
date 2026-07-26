# probe (main) — chạy thật với sidecar Python

**Không phải test sản phẩm.** Đây là script spawn sidecar Python **thật** qua
supervisor **thật**, để kiểm phần nối hai đầu mà unit test dùng tiến trình giả
không bao giờ lộ ra.

Đã loại khỏi `pnpm test` (config gốc loại `**/probe/**`) vì cần venv Python và
mất vài giây mỗi lần chạy. Chạy bằng **config riêng**:

```bash
npx vitest run -c apps/main/probe/vitest.config.ts

# Một kịch bản
npx vitest run -c apps/main/probe/vitest.config.ts -t "giết tiến trình thật"
```

Chưa dựng `sidecar/.venv` thì tự bỏ qua (`describe.skipIf`), không báo lỗi.
`queue-real.test.ts` còn cần **voice thật đã tải** trong userData
(`%APPDATA%/LN Reader/models/voices/vi_VN-vais1000-medium`) — chưa có thì cũng
tự bỏ qua chứ không hỏng.

## Kiểm những gì

### `sidecar-real.test.ts` — supervisor + tiến trình

| Kịch bản | Chứng minh điều gì |
|---|---|
| Khởi động + `/health` + `/normalize` | Bắt tay stdout khớp giữa Python và TS; token main sinh ra được sidecar chấp nhận |
| Giết tiến trình thật | Supervisor phát hiện và dựng lại; cổng **khác** lần trước → đúng là tiến trình mới |
| `stop()` | Không để lại tiến trình Python mồ côi; cổng được nhả |
| Token sai / thiếu | Sidecar thật trả 401 — token không phải hình thức |
| Hỏng cố định (thiếu env) | Hết lượt thì `failed`, không quay vòng vô tận |

### `queue-real.test.ts` — hàng đợi + model 63 MB + SQLite + đĩa

| Kịch bản | Chứng minh điều gì |
|---|---|
| Generate cả chương | `outPath` main dựng được sidecar chấp nhận (nó **từ chối** mọi path ngoài `audioDir`, mà `audioDir` đi qua biến môi trường lúc spawn — đường nối chỉ tồn tại khi chạy thật) |
| Đọc magic `OggS` + kích thước | File sinh ra là audio thật, không phải file rỗng. `audioBytes` trong DB khớp đĩa từng byte |
| Timing ra đĩa | `{segmentId}.json` tồn tại và `durationMs` khớp DB — thứ mà unit test giả `SidecarClient` không chạm tới |
| Bitrate 16 vs 32 | Tham số từ `AppSettings` đi tới tận libsndfile, không bị bỏ quên giữa đường |
| Khôi phục job mồ côi | Job kẹt `running` sau khi app bị kill chạy lại và xong thật |
| Huỷ giữa chừng | Cắt được request đang bay; **không** segment nào kẹt ở `generating`/`queued` |
| Estimate vs reality (P2.6) | The estimate shown to the user before "generate whole book" is checked against bytes actually written. Unit tests stub both the char count and the bitrate, so they only prove the multiplication — they cannot tell whether `CHARS_PER_SECOND_ESTIMATE` and `SYNTHESIS_RTF_ESTIMATE` describe real Piper output at all |
| `enqueueBook` skips finished work (P2.6) | Generates one segment, then queues the whole book: only the remaining segments get jobs, and `chapters.audio_bytes` still matches the sum on disk |
| Deleting audio hits the right files (P2.7) | The unit tests for `storage.ts` create their own `.ogg` files with `writeFileSync`, so they only prove the delete works on files the test itself wrote. Here the files were written by the **sidecar** through the `outPath` main built, with names from `paths.ts` — if those two disagree by one character the delete matches nothing while the DB still reports success. Also checks regenerating right after a delete, which is what a user does after deleting by mistake |
| Deleting audio mid-generate (P2.7) | The handler must cancel the book's jobs **before** removing files. Without that the worker rewrites the very files just deleted, and the DB says `pending` for a file that exists. Cannot be staged in a unit test: it needs a job genuinely in flight. Asserts every `ready` segment still has its file and every file belongs to a `ready` segment — a mismatch either way is orphaned bytes or a play button for a missing file |

Measured on 3 real Vietnamese segments at 24 kbps (2026-07-26):

| | Estimated | Real | Off by |
|---|---|---|---|
| Audio bytes | 33 600 B | 28 498 B | −15% |
| Audio duration | 11 200 ms | 8 533 ms | −24% |
| Processing time | 1 680 ms | 2 045 ms | +22% |

Real RTF was **0.24** including model load, against the `SYNTHESIS_RTF_ESTIMATE = 0.15`
constant. All three are close enough that the constants stay as they are — the
estimate is a forecast, not a measurement, and the dialog says so.

## Vì sao phải có

Chạy thật ở đây đã tìm ra **hai lỗi thật** mà unit test không thấy:

1. **P2.2** — khử trùng lặp báo hỏng theo *trạng thái* khiến lần chết thứ hai
   trở đi bị nuốt, supervisor đứng im ở `restarting` mãi mãi và không bao giờ
   tới `failed`. Tiến trình giả trong unit test luôn bắt tay thành công nên
   không dựng được kịch bản "chết liên tiếp ngay lúc khởi động".
2. **P2.5** — `cancelAll`/`cancelByBook` huỷ job trong SQLite nhưng quên đưa
   segment về `pending`, nên chúng kẹt `queued` vĩnh viễn. 1319 unit test xanh
   vì test của `cancelAll` kiểm đúng thứ nó nghĩ là kết quả (`jobs.counts()`),
   không kiểm thứ user nhìn thấy. Xem PROGRESS mục 4.35.

Cả hai nay đều có unit test khoá lại ở tầng nhanh.
