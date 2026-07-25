# Sách mẫu để kiểm chứng parser & chapter detection

> **File sách không được commit** — `.gitignore` trong thư mục này đã chặn
> `*.pdf`, `*.docx`, `*.epub`. Chỉ file `*.expected.json` được commit.

```
samples/
  pdf/        ← thả file .pdf vào đây
  docx/       ← thả file .docx vào đây
  expected/   ← kỳ vọng (tôi tự sinh, bạn sửa lại nếu sai)
```

Sau khi thả file vào, chạy:

```
/detect samples/pdf/<tên-file>.pdf
```

---

## Cần những dạng nào

Xếp theo mức độ hữu ích. **Không cần đủ hết** — mỗi file thêm vào đều có giá
trị, nhưng nhóm A là thứ đang thiếu nhất.

### Nhóm A — cần nhất (ngưỡng hiện tại đang đoán mò)

| # | Dạng file | Kiểm được gì |
|---|---|---|
| **A1** | **PDF có mục lục/outline thật** (mở bằng trình đọc thấy sidebar chương bấm được) | Tín hiệu detect mạnh nhất. Đây là đường đi lý tưởng, phải đúng 100% |
| **A2** | **PDF KHÔNG có outline**, chương nhận biết bằng tiêu đề chữ to | Font-size heuristic — đường đi phổ biến nhất với LN convert |
| **A3** | **PDF có header/footer chạy** (tên sách ở đầu trang, số trang ở chân trang) | `stripHeadersFooters`. Ngưỡng `minRatio` 0.6 và `maxLength` 80 chưa từng chạy trên dữ liệu thật |
| **A4** | **DOCX dùng Heading style thật** (Heading 1/2 trong Word) | Nhánh DOCX của detector |

### Nhóm B — nên có (bắt lỗi mà nhóm A không lộ)

| # | Dạng file | Kiểm được gì |
|---|---|---|
| **B1** | PDF **hai cột** | `detectColumnLayout`. Nếu sai thì câu đọc lên vô nghĩa hoàn toàn |
| **B2** | PDF tiếng Anh (hoặc LN dịch còn lẫn tiếng Anh) | De-hyphenate — tiếng Anh ngắt từ cuối dòng nhiều hơn hẳn tiếng Việt |
| **B3** | DOCX **không** dùng Heading style (chương là dòng thường hoặc in đậm) | Nhánh fallback regex của DOCX ✅ đã có |
| **B4** | Sách có **nhiều hội thoại** `「」` `『』`, thán từ `"Ừ."` `"À."` | Sentence splitter + `startsNewBlock`. Sai ở đây là hỏng cả quyển |

### Nhóm C — trường hợp biên (để chắc app không vỡ)

| # | Dạng file | Kiểm được gì |
|---|---|---|
| **C1** | **PDF scan, không có text layer** | Phải báo lỗi rõ ràng cho user, **không** được crash hay ra chương rỗng |
| **C2** | PDF có trang bìa, mục lục, lời bạt, trang quảng cáo | Phần cần loại trừ ở màn xác nhận chương (P1.5) |
| **C3** | Sách chỉ có 1 chương, hoặc chương rất dài (> 50 trang) | Fallback chia theo trang |
| **C4** | PDF có ảnh minh hoạ chèn giữa text | Ảnh không được làm đứt đoạn văn |

---

## Ưu tiên nếu chỉ thêm được vài file

Ít file thì chọn theo thứ tự này:

1. **A2** — PDF không outline, tiêu đề chữ to *(dạng phổ biến nhất)*
2. **A3** — PDF có header/footer chạy *(phần đang đoán mò nhiều nhất)*
3. **A1** — PDF có outline *(để biết đường đi lý tưởng có thật sự đúng)*
4. **A4** — DOCX Heading style

Ba file đầu là đủ để chỉnh ngưỡng có căn cứ.

---

## Đặt tên file

Đặt theo mã ở bảng trên để tôi biết file đó dùng kiểm cái gì:

```
samples/pdf/A2-kiem-vuc-than-de-vol1.pdf
samples/pdf/A3-co-header-footer.pdf
samples/pdf/B1-hai-cot.pdf
samples/docx/A4-heading-style.docx
```

Không đặt đúng cũng không sao — tôi mở ra xem là biết.

---

## Vài chục trang là đủ

**Không cần cả quyển.** Cắt lấy 20–50 trang có 2–3 chương là đủ để chỉnh
ngưỡng, mà file lại nhẹ. Nếu cắt thì nhớ giữ:

- Trang có **tiêu đề chương** (thứ cần detect)
- Vài trang **thân bài liền nhau** (để thống kê header/footer đủ mẫu — dưới
  4 trang thì `stripHeadersFooters` tự bỏ qua, không suy luận)

---

## Sau khi có file

Tôi sẽ:

1. Chạy `/detect` trên từng file, in bảng điểm số từng tín hiệu
2. So kết quả với mắt thường, ghi lại chỗ sai
3. Chỉnh **ngưỡng hoặc thêm tín hiệu**, không hardcode theo riêng một file
4. Mỗi lần chỉnh → thêm test case tương ứng, và ghi vào `expected/<tên>.expected.json`
   để lần sau đổi code mà kết quả lệch đi thì biết ngay

Ngưỡng đang chờ dữ liệu thật để kiểm chứng *(xem PROGRESS.md mục 8)*:

| Ngưỡng | Giá trị hiện tại | Ở đâu |
|---|---|---|
| `minRatio` | 0.6 | `cleaner/header-footer.ts` |
| `maxLength` | 80 | `cleaner/header-footer.ts` |
| `shortLineRatio` | 0.6 | `cleaner/merge-lines.ts` |
| `minGutterRatio` | 0.04 | `cleaner/columns.ts` |
