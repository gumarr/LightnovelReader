# sidecar — dịch vụ TTS Python

FastAPI chạy như **tiến trình con của Electron main**. Renderer không bao giờ
gọi thẳng vào đây — mọi thứ đi qua main (xem ràng buộc kiến trúc ở `CLAUDE.md`).

## Chạy lúc dev

```bash
cd sidecar
py -3.12 -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt

# Chạy tay: models dir bắt buộc, token tự sinh nếu không đặt
LN_SIDECAR_MODELS_DIR=C:/tmp/models .venv/Scripts/python.exe -m app.server

# Test
.venv/Scripts/python.exe -m pytest tests/
```

> **Python 3.12**, không phải 3.11 như `plan.md` ghi. Máy dev không có 3.11 và
> mọi thứ sidecar dùng đều có wheel cho 3.12. Code không dùng cú pháp riêng
> 3.12 nên vẫn chạy được trên 3.11 nếu bản đóng gói cần.

## Biến môi trường

Main đặt hết lúc spawn. Sidecar **không tự đoán** đường dẫn nào.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `LN_SIDECAR_MODELS_DIR` | ✅ | Thư mục model, lấy từ `services/paths.ts` |
| `LN_SIDECAR_TOKEN` | ⬜ | Token phiên. Thiếu thì tự sinh (chỉ tiện lúc dev) |
| `LN_SIDECAR_HOST` | ⬜ | Mặc định `127.0.0.1` — đừng đổi |
| `LN_SIDECAR_PORT` | ⬜ | Mặc định `0` = OS cấp cổng trống |

Token đi qua **biến môi trường chứ không phải tham số dòng lệnh**: trên Windows
mọi tiến trình đều đọc được command line của tiến trình khác.

## Bắt tay với main

Sidecar bind cổng `0` nên main không biết trước cổng nào. Sau khi socket đã
lắng nghe, sidecar in **đúng một dòng** ra stdout:

```
LN_SIDECAR_READY {"host":"127.0.0.1","port":54757,"pid":16204}
```

Supervisor bên main đọc dòng này rồi mới gọi API. Log của uvicorn đi ra
**stderr** để stdout chỉ còn đúng dòng bắt tay.

Định dạng dòng này là **hợp đồng** — đổi nó mà quên sửa phía main thì app treo
ở "đang khởi động sidecar". `tests/test_server.py` khoá lại.

## API

Mọi request trừ `/health` phải kèm header `X-Session-Token`.

| Route | Có từ | Ghi chú |
|---|---|---|
| `GET /health` | P2.1 | Không cần token — main phải chẩn đoán được cả khi token lệch |
| `POST /normalize` | P2.1 | `{text, lang}` → text đã chuẩn hoá |
| `POST /synthesize` | P2.4 | chưa có |
| `GET /voices` | P2.3 | chưa có |
| `POST /align` | Phase 4 | chưa có |

Trang `/docs` **tắt hẳn** — đó là đường duy nhất phục vụ request không kèm token.

## Chuẩn hoá text

Mỗi luật là một hàm thuần riêng có test riêng, ghép lại ở `normalize_vi()` /
`normalize_en()`. Thứ tự áp dụng là bắt buộc — xem docstring của hai hàm đó.

VI và EN **không dùng chung** hàm ngày tháng dù regex trông giống nhau: VI là
ngày/tháng, EN là tháng/ngày. Dùng nhầm thì ra ngày sai mà không có gì báo lỗi.

### Đã kiểm trên 2429 segment thật

Lấy từ sách mẫu qua `packages/parsers/probe/dump-segments.test.ts` (parser →
cleaner → segmenter thật). Kết quả: 0 lỗi, 0 segment bị xoá nội dung, chỉ 3
segment còn chữ số — cả 3 đều đúng (`A2`, `F1` là mã hạng dính chữ).

Chạy trên dữ liệu thật lộ ra **một lỗi nặng mà unit test không thấy**: LN Nhật
ghi lớp học kiểu `lớp 11-5` / `Class 2-5`, khớp regex ngày y hệt và bị đọc
thành "lớp ngày mười một tháng năm". Cả hai cuốn mẫu đều dính. Nay `-` chỉ
tính là ngày khi có năm 4 chữ số đi kèm.
