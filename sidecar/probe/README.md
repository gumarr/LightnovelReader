# probe (sidecar) — đo trên voice Piper thật

**Không phải test sản phẩm.** Script ở đây nạp model 63 MB thật và sinh audio
thật để lấy **con số**, không phải để pass/fail. Đã tách khỏi `pytest` (nằm
ngoài `testpaths` trong [pytest.ini](../pytest.ini)) vì cần voice đã cài và mất
vài giây mỗi lần chạy.

```bash
# chạy từ thư mục sidecar/
.venv/Scripts/python.exe -m probe.timing_probe
.venv/Scripts/python.exe -m probe.timing_probe --json
```

Chưa cài voice thì báo rõ rồi thoát, không ném traceback.

## `timing_probe.py` — P6.1

Đo `estimate_word_timings` lệch bao nhiêu so với alignment **thật** của Piper.

**Vì sao phải đo bây giờ.** Piper trả `phoneme` alignment thật — chuẩn vàng duy
nhất dự án từng có. Cơ hội này **mất hẳn** sau P6.2 (VieNeu: codec 12,5 token/s,
ranh giới token là đơn vị nén chứ không phải ranh giới từ), lúc đó mọi segment
đều `estimate` và không còn gì để so.

### Kết quả P6.1 (10 segment VI, `vi_VN-vais1000-medium`)

| Bản | Lệch TB | Max | Từ lệch > 150 ms |
|---|---|---|---|
| cũ — đếm ký tự | 126.6 ms | 335 ms | 27.4% |
| **mới — đếm âm tiết** | **60.4 ms** | **177 ms** | **8.4%** |

Giảm **52%** lệch trung bình (DoD yêu cầu ≥ 30%).

Chia theo từng từ: **59 từ tốt lên** > 50 ms, **10 từ tệ đi** > 50 ms — tỉ lệ
gần 6:1. Ở nhóm tốt lên, lệch giảm 169 → 47 ms; ở nhóm tệ đi, tăng 54 → 127 ms
và ca tệ nhất (154 ms) vẫn thấp hơn **mức trung bình** của những ca xấu ở bản cũ.

### Ba thứ đo được, đáng nhớ

1. **Số ký tự gần như không liên quan tới thời lượng.** Từ 2 ký tự đọc trung
   bình 194 ms, từ 7 ký tự 218 ms — trong khi độ lệch chuẩn giữa các từ là
   49 ms. Toàn bộ tiền đề của bản cũ sai với tiếng Việt.

2. **Dấu câu không tạo khe hở nào.** 12/12 dấu phẩy đo được khoảng nghỉ đúng
   bằng **0 ms**. Lý do là cấu trúc: `group_phonemes_by_word` gộp khoảng lặng
   vào từ liền kề, nên thời gian nghỉ đã nằm trong thời lượng của chính từ đó.
   Bản đầu của P6.1 có cấp thêm trọng số nghỉ và làm **11/95 từ tệ đi** (tệ nhất
   −242 ms) dù trung bình vẫn đẹp — chính nửa sau của DoD bắt được lỗi này.

3. **Từ cuối segment đọc dài hơn** (phrase-final lengthening): tỉ lệ 1.08–1.49,
   trung bình 1.32, **10/10 segment** cùng chiều.

### Sàn lý thuyết

Quét toàn dải hệ số kéo dài từ cuối, dùng chính thời lượng thật: tốt nhất đạt
được là **~55 ms lệch trung bình**. Bản hiện tại ở 60.4 ms, tức **đã sát giới
hạn** của mọi mô hình chỉ biết "số âm tiết + vị trí". Muốn tốt hơn phải biết nội
dung ngữ âm từng từ — tức forced alignment, đã loại vì license CC BY-NC và
PyTorch (xem [plan.md](../../plan.md) mục 9).

Nói cách khác: **đừng tốn thêm thời gian tinh chỉnh hàm này.** Phần còn lại là
phương sai ngữ âm giữa các từ, không phải lỗi thuật toán.

### Vì sao hệ số là 1.22 chứ không phải 1.32

1.32 là tỉ lệ trung bình **quan sát được**; 1.22 là hệ số **cực tiểu hoá sai số
đo được**. Lấy trung bình quan sát nghe hợp lý hơn nhưng ra kết quả tệ hơn, vì
trung bình bị kéo bởi vài segment có từ cuối rất dài. Tối ưu cho cái đo được.

## Thêm bản ước lượng mới để so

Thêm một dòng vào `ESTIMATORS`, không phải sửa phần đo:

```python
ESTIMATORS["tên bản"] = ham_cua_ban  # (text, duration_ms, lang) -> list[WordTiming]
```

Bản cũ (`_legacy_estimate`) được **chép** vào probe chứ không giữ trong `app/`:
code sản phẩm không nên mang hai thuật toán làm cùng một việc, còn probe thì cần
cả hai để so. Xoá nó đi là mất luôn cột đối chứng.
