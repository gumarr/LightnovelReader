"""Probe P6.1 — đo `estimate_word_timings` lệch bao nhiêu so với alignment thật.

**Không phải test sản phẩm.** Đây là script chạy voice Piper **thật** (63 MB
trên đĩa) để lấy con số, không phải để pass/fail trong CI.

## Vì sao phải có, và vì sao phải có NGAY

Piper trả alignment `phoneme` **thật** (số mẫu audio cho từng phoneme). Đó là
**chuẩn vàng** duy nhất dự án từng có: với cùng một đoạn text, ta biết chính xác
từng từ bắt đầu và kết thúc ở mili-giây nào.

Cơ hội này **mất hẳn** khi chuyển sang engine thứ hai (P6.2 — VieNeu). Codec của
nó chạy 12,5 token/giây và ranh giới token là đơn vị **nén**, không phải ranh
giới từ — nghĩa là mọi segment sẽ rơi về `estimate` và không còn gì để so. Lúc
đó chỉ còn cảm giác "hình như highlight lệch".

Nên: đo trước, sửa sau. Sửa `estimate` mà không có thước đo thì không biết bản
mới tốt lên thật hay chỉ khác đi.

## Đo cái gì

Với mỗi segment, chạy Piper một lần rồi lấy **hai** đường timing từ **cùng một**
lần tổng hợp đó:

- `word_timings_from_phonemes` → chuẩn vàng.
- các hàm ước lượng đăng ký trong `ESTIMATORS` → bản đang đo.

So từng từ một, ở **cả hai mốc** `start_ms` và `end_ms`. Chỉ so `start_ms` sẽ
bỏ sót lỗi "từ sáng đúng lúc nhưng tắt sai lúc" — mắt vẫn thấy sai.

Báo cáo ba con số cho mỗi bản:

- **lệch trung bình (ms)** — chỉ tiêu chính của DoD.
- **lệch lớn nhất (ms)** — bắt ca tệ nhất, thứ trung bình giấu đi.
- **tỉ lệ từ lệch > 150 ms** — mốc mắt bắt đầu thấy chữ sáng sai chỗ.

## Chạy

```bash
sidecar/.venv/Scripts/python.exe -m probe.timing_probe          # tập mẫu sẵn
sidecar/.venv/Scripts/python.exe -m probe.timing_probe --json   # ra JSON
```

Chạy từ thư mục `sidecar/`. Chưa cài voice thì báo rõ rồi thoát 1, không ném
traceback.

**Chỉ so được trên segment mà Piper cho alignment thật.** Segment nào rơi về
`estimate` (chữ số, tên riêng espeak tách khác regex) sẽ bị **bỏ qua và đếm
riêng** — không có chuẩn vàng thì không có gì để so, và im lặng bỏ qua sẽ làm
mẫu bị thiên lệch mà không ai biết.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

# Cho phép chạy bằng `python probe/timing_probe.py` lẫn `python -m probe.timing_probe`:
# thư mục `sidecar/` phải nằm trên sys.path để `from app...` import được.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.audio.timings import (  # noqa: E402
    WordTiming,
    estimate_word_timings,
    split_words,
)
from app.text import normalize_mapped  # noqa: E402
from app.voices.catalog import VoiceEntry, is_installed, load_catalog  # noqa: E402

# Mốc mắt bắt đầu thấy chữ sáng sai chỗ. Không phải con số tuỳ tiện: dưới ~100 ms
# người xem phụ đề gần như không phân biệt được, trên ~200 ms thì thấy rõ.
VISIBLE_DRIFT_MS = 150

# Voice đo bằng. Cố định một voice vì đây là phép đo so sánh giữa hai thuật toán
# ước lượng, không phải khảo sát chất lượng giọng — đổi voice giữa chừng thì hai
# cột số không còn so được với nhau.
PROBE_VOICE_ID = "vi_VN-vais1000-medium"

# Tập segment mẫu. Chọn tay để phủ đúng các ca P6.1 nhắm tới, không lấy ngẫu
# nhiên: cần chắc chắn có mặt từ một âm tiết ngắn (`à`, `ừ`) đứng cạnh từ nhiều
# chữ cái (`nghiêng`, `chuyện`) — đó là chỗ đếm-ký-tự sai nhất.
#
# Tránh chữ số: Piper đọc `30` thành "ba mươi" (2 từ) nên số nhóm phoneme lệch
# số từ regex, `word_timings_from_phonemes` trả `[]` và mất chuẩn vàng.
SAMPLE_SEGMENTS_VI: tuple[str, ...] = (
    "Ừ, tôi biết chuyện đó rồi.",
    "Nghiêng người sang một bên, à, không phải thế.",
    "Cô ấy nói nhỏ, nhưng tôi vẫn nghe rõ từng chữ.",
    "Ồ, thì ra là vậy sao?",
    "Nghiêm túc mà nói, chuyện này nghiêng về phía cậu nhiều hơn.",
    "Anh à, em nghĩ chúng ta nên nghỉ một chút.",
    "Trời chuyển lạnh, gió thổi nghiêng cả hàng cây bên đường.",
    "Ừ thì, nếu cậu đã nói vậy, tôi nghe theo.",
    "Không, tôi không nghĩ chuyện nghiêm trọng đến thế đâu.",
    "Nhìn kìa, ánh nắng nghiêng qua khung cửa sổ nhỏ.",
)


@dataclass(frozen=True)
class WordDeviation:
    """Lệch của một từ so với chuẩn vàng, ở cả hai mốc."""

    word: str
    start_delta_ms: int
    end_delta_ms: int

    @property
    def worst_ms(self) -> int:
        """Mốc lệch nhiều hơn trong hai mốc — cái quyết định mắt có thấy sai không."""
        return max(abs(self.start_delta_ms), abs(self.end_delta_ms))


@dataclass(frozen=True)
class EstimatorReport:
    """Kết quả một bản ước lượng trên toàn tập mẫu."""

    name: str
    deviations: list[WordDeviation]

    @property
    def word_count(self) -> int:
        return len(self.deviations)

    @property
    def mean_ms(self) -> float:
        if not self.deviations:
            return 0.0
        return sum(d.worst_ms for d in self.deviations) / len(self.deviations)

    @property
    def max_ms(self) -> int:
        return max((d.worst_ms for d in self.deviations), default=0)

    @property
    def visible_ratio(self) -> float:
        """Tỉ lệ từ lệch quá ngưỡng mắt thấy."""
        if not self.deviations:
            return 0.0
        bad = sum(1 for d in self.deviations if d.worst_ms > VISIBLE_DRIFT_MS)
        return bad / len(self.deviations)

    def worst_words(self, limit: int) -> list[WordDeviation]:
        return sorted(self.deviations, key=lambda d: d.worst_ms, reverse=True)[:limit]


# Các bản ước lượng đem đo. Thêm bản mới = thêm một dòng, không sửa phần đo.
#
# Chữ ký `(text, duration_ms, lang) -> list[WordTiming]`: bản hiện tại không
# nhận `lang` nên được bọc lại, chứ không đổi chữ ký hàm sản phẩm chỉ để probe
# gọi cho tiện.
Estimator = Callable[[str, int, str], list[WordTiming]]

# Bản làm mốc so sánh. Mọi bản khác được đối chiếu từng từ với nó.
BASELINE_NAME = "cũ (ký tự)"

ESTIMATORS: dict[str, Estimator] = {
    # Bản cũ giữ lại nguyên vẹn trong probe (không còn trong code sản phẩm) để
    # hai cột số nằm cạnh nhau — DoD của P6.1 là so sánh, không phải giá trị
    # tuyệt đối. Xoá dòng này đi là mất luôn căn cứ đã đo được.
    "cũ (ký tự)": lambda text, duration_ms, _lang: _legacy_estimate(text, duration_ms),
    "mới (âm tiết)": estimate_word_timings,
}


def _legacy_estimate(text: str, duration_ms: int) -> list[WordTiming]:
    """Bản ước lượng theo **độ dài ký tự** — nguyên trạng trước P6.1.

    Chép lại ở đây thay vì giữ trong `app/` vì code sản phẩm không nên mang hai
    thuật toán làm cùng một việc, mà probe thì cần cả hai để so.
    """
    words = split_words(text)
    if not words or duration_ms <= 0:
        return []

    total_chars = sum(len(w.word) for w in words)
    if total_chars == 0:
        return []

    timings: list[WordTiming] = []
    elapsed = 0.0
    per_char = duration_ms / total_chars

    for index, span in enumerate(words):
        start_ms = int(round(elapsed))
        elapsed += len(span.word) * per_char
        end_ms = duration_ms if index == len(words) - 1 else int(round(elapsed))
        timings.append(
            WordTiming(
                w=span.word,
                start_ms=start_ms,
                end_ms=max(end_ms, start_ms),
                char_start=span.char_start,
                char_end=span.char_end,
            )
        )
    return timings


def compare(gold: list[WordTiming], candidate: list[WordTiming]) -> list[WordDeviation]:
    """So từng từ giữa chuẩn vàng và bản ước lượng.

    Trả `[]` khi số từ lệch nhau: hai danh sách không cùng tách từ thì so theo
    chỉ số là so nhầm từ, ra con số vô nghĩa mà trông vẫn hợp lý.
    """
    if len(gold) != len(candidate) or not gold:
        return []
    return [
        WordDeviation(
            word=g.w,
            start_delta_ms=c.start_ms - g.start_ms,
            end_delta_ms=c.end_ms - g.end_ms,
        )
        for g, c in zip(gold, candidate, strict=True)
    ]


def _resolve_voice() -> tuple[Path, VoiceEntry]:
    """Tìm thư mục model + entry catalog của voice đo.

    Đọc `LN_SIDECAR_MODELS_DIR` nếu có (khớp cách main spawn sidecar), còn không
    thì suy ra chỗ mặc định trên Windows. Không tự dò lung tung: sai thư mục thì
    báo rõ để người chạy tự chỉ, hơn là im lặng lấy nhầm model khác.
    """
    env_dir = os.environ.get("LN_SIDECAR_MODELS_DIR")
    if env_dir:
        models_dir = Path(env_dir)
    else:
        appdata = os.environ.get("APPDATA")
        if not appdata:
            raise SystemExit(
                "Không xác định được thư mục model. Đặt LN_SIDECAR_MODELS_DIR "
                "trỏ tới <userData>/models rồi chạy lại."
            )
        models_dir = Path(appdata) / "LN Reader" / "models"

    catalog_path = Path(__file__).resolve().parent.parent.parent / "resources" / "voices" / "catalog.json"
    if not catalog_path.is_file():
        raise SystemExit(f"Không thấy catalog: {catalog_path}")

    catalog = load_catalog(catalog_path)
    entry = catalog.find(PROBE_VOICE_ID)
    if entry is None:
        raise SystemExit(f"Catalog không có voice {PROBE_VOICE_ID}")

    if not is_installed(models_dir, entry):
        raise SystemExit(
            f"Voice {PROBE_VOICE_ID} chưa cài trong {models_dir}.\n"
            "Mở app → Giọng đọc → tải voice rồi chạy lại probe."
        )
    return models_dir, entry


@dataclass(frozen=True)
class SegmentResult:
    """Một segment đã đo xong, hoặc lý do bỏ qua nó."""

    text: str
    duration_ms: int
    gold_words: int
    skipped_reason: str | None


def run_probe(segments: tuple[str, ...], lang: str) -> tuple[
    dict[str, EstimatorReport], list[SegmentResult]
]:
    """Chạy Piper trên từng segment và gom lệch của mọi bản ước lượng."""
    from app.engines.piper import PiperEngine

    models_dir, entry = _resolve_voice()
    engine = PiperEngine(models_dir)

    collected: dict[str, list[WordDeviation]] = {name: [] for name in ESTIMATORS}
    results: list[SegmentResult] = []

    for text in segments:
        # Chuẩn hoá y như đường sản phẩm: `estimate` chạy trên bản ĐỌC
        # (`normalized.spoken`), không phải text gốc. Đo trên text gốc sẽ ra số
        # đẹp hơn thực tế ở mọi câu có tên riêng hoặc chữ số.
        normalized = normalize_mapped(text, lang, {})
        spoken = normalized.spoken

        result = engine.synthesize(spoken, entry)
        duration_ms = result.audio.duration_ms

        if result.timing_source != "phoneme":
            results.append(
                SegmentResult(
                    text=text,
                    duration_ms=duration_ms,
                    gold_words=0,
                    skipped_reason="Piper không cho alignment (không có chuẩn vàng)",
                )
            )
            continue

        gold = result.timings
        results.append(
            SegmentResult(
                text=text,
                duration_ms=duration_ms,
                gold_words=len(gold),
                skipped_reason=None,
            )
        )

        for name, estimator in ESTIMATORS.items():
            deviations = compare(gold, estimator(spoken, duration_ms, lang))
            if not deviations:
                continue
            collected[name].extend(deviations)

    reports = {
        name: EstimatorReport(name=name, deviations=devs)
        for name, devs in collected.items()
    }
    return reports, results


def _print_text_report(
    reports: dict[str, EstimatorReport], results: list[SegmentResult]
) -> None:
    measured = [r for r in results if r.skipped_reason is None]
    skipped = [r for r in results if r.skipped_reason is not None]

    print(f"\nSegment đo được: {len(measured)}/{len(results)}")
    for item in skipped:
        print(f"  bỏ qua: {item.text[:50]!r} — {item.skipped_reason}")

    print(f"\nNgưỡng mắt thấy: {VISIBLE_DRIFT_MS} ms\n")
    header = f"{'Bản ước lượng':<24}{'Từ':>6}{'TB (ms)':>10}{'Max (ms)':>10}{'>ngưỡng':>10}"
    print(header)
    print("-" * len(header))
    for report in reports.values():
        print(
            f"{report.name:<24}{report.word_count:>6}{report.mean_ms:>10.1f}"
            f"{report.max_ms:>10}{report.visible_ratio:>9.1%}"
        )

    for report in reports.values():
        if not report.deviations:
            continue
        print(f"\n5 từ tệ nhất — {report.name}:")
        for dev in report.worst_words(5):
            print(
                f"  {dev.word:<16} start {dev.start_delta_ms:+6} ms   "
                f"end {dev.end_delta_ms:+6} ms"
            )

    _print_regressions(reports)


# Nửa sau của DoD P6.1: "không có từ nào tệ hơn bản cũ quá 50 ms". Con số trung
# bình **không** chứng minh được điều này — một bản có thể kéo trung bình xuống
# rất đẹp mà vẫn làm vài từ tệ đi hẳn, và đúng những từ đó là thứ user nhìn thấy.
REGRESSION_TOLERANCE_MS = 50


def _print_regressions(reports: dict[str, EstimatorReport]) -> None:
    """So từng từ giữa bản mới và bản cũ, liệt kê những từ **tệ đi**."""
    baseline = reports.get(BASELINE_NAME)
    if baseline is None:
        return

    for name, report in reports.items():
        if name == BASELINE_NAME:
            continue
        if len(report.deviations) != len(baseline.deviations):
            print(f"\n{name}: không so được với bản cũ (số từ lệch nhau)")
            continue

        worse = [
            (new, old)
            for new, old in zip(report.deviations, baseline.deviations, strict=True)
            if new.worst_ms - old.worst_ms > REGRESSION_TOLERANCE_MS
        ]
        print(
            f"\nTệ hơn bản cũ quá {REGRESSION_TOLERANCE_MS} ms — {name}: "
            f"{len(worse)}/{len(report.deviations)} từ"
        )
        for new, old in sorted(
            worse, key=lambda p: p[0].worst_ms - p[1].worst_ms, reverse=True
        )[:10]:
            print(
                f"  {new.word:<16} {old.worst_ms:>4} ms → {new.worst_ms:>4} ms "
                f"(+{new.worst_ms - old.worst_ms})"
            )


def _json_payload(
    reports: dict[str, EstimatorReport], results: list[SegmentResult]
) -> dict[str, object]:
    return {
        "voiceId": PROBE_VOICE_ID,
        "visibleDriftMs": VISIBLE_DRIFT_MS,
        "segmentsMeasured": sum(1 for r in results if r.skipped_reason is None),
        "segmentsTotal": len(results),
        "estimators": [
            {
                "name": r.name,
                "words": r.word_count,
                "meanMs": round(r.mean_ms, 1),
                "maxMs": r.max_ms,
                "visibleRatio": round(r.visible_ratio, 4),
            }
            for r in reports.values()
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Đo lệch của estimate_word_timings")
    parser.add_argument("--json", action="store_true", help="In JSON thay vì bảng")
    parser.add_argument("--lang", default="vi", help="Ngôn ngữ chuẩn hoá (mặc định vi)")
    args = parser.parse_args()

    reports, results = run_probe(SAMPLE_SEGMENTS_VI, args.lang)

    if args.json:
        print(json.dumps(_json_payload(reports, results), ensure_ascii=False, indent=2))
    else:
        _print_text_report(reports, results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
