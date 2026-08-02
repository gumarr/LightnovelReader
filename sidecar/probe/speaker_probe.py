"""Trích `speakerEmb` cho giọng clone, và đối chiếu fbank numpy với torchaudio.

**Không phải test.** Script này tái lập con số 192 chiều đã nhúng trong
`resources/voices/catalog.json`, để người sau kiểm được nó từ đâu ra thay vì
phải tin một mảng số vô danh.

```bash
# chạy từ thư mục sidecar/
.venv/Scripts/python.exe -m probe.speaker_probe --extract
.venv/Scripts/python.exe -m probe.speaker_probe --verify     # cần torch, xem dưới
```

## Vì sao giọng này là "clone" chứ không phải preset

Giọng Ngọc Huyền bản gốc là **LoRA adapter** cho backbone PyTorch 0.3B
(`pnnbao-ump/VieNeu-TTS-0.3B-lora-ngoc-huyen`), chạy được duy nhất qua đường
PyTorch/Gradio. File `voices.json` trong repo đó **không** dùng lại được cho
đường ONNX: `codes` của nó là mảng 1 chiều 227 phần tử, giá trị tới 64214 — token
của LLM 0.3B, khác hẳn `(T, 16)` giá trị 0–1023 của codec MOSS mà preset ONNX
dùng. Nạp thẳng vào là `KeyError: 'speaker_emb'`.

Đường đi được là **clone từ audio mẫu**: dataset `pnnbao-ump/ngochuyen_voice`
(CC BY-NC-4.0, công khai) có audio thật của chính giọng đó. Từ một clip rút ra
`speaker_emb` 192 chiều rồi nhúng vào catalog — máy user không phải tính lại.

## Con số đo được (đừng kỳ vọng hơn)

| So sánh | cos |
|---|---|
| Audio sinh ra vs Ngọc Huyền thật | **0.71 – 0.79** |
| Hai clip THẬT của chính cô ấy | 0.93 |
| Giọng preset nữ có sẵn vs Ngọc Huyền | 0.33 – 0.48 |

Nghĩa là clone đi được **khoảng hai phần ba** quãng đường từ giọng preset tới
giọng thật. Giống rõ rệt, **không** phải bản sao. Muốn khớp hẳn thì phải chạy
LoRA gốc, tức kéo torch về — đo thật: **527 MB** site-packages.

## `--verify` cần torch, và đó là chuyện một lần

Nhánh `--verify` đối chiếu `app.audio.fbank.speaker_fbank` với
`torchaudio.compliance.kaldi`. Torch **không** nằm trong `requirements.txt` và
không được thêm vào — dựng venv riêng khi cần:

    python -m venv /tmp/torchprobe
    /tmp/torchprobe/Scripts/python.exe -m pip install \
        --index-url https://download.pytorch.org/whl/cpu torch torchaudio

Kết quả đã đo: tương quan hệ số **0.987**, cos(embedding) **0.954 – 0.982** —
cao hơn cả 0.930 giữa hai clip thật của cùng người nói.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
import wave
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.audio.fbank import speaker_fbank  # noqa: E402

DATASET = "pnnbao-ump/ngochuyen_voice"
ROWS_URL = (
    "https://datasets-server.huggingface.co/first-rows"
    f"?dataset={DATASET.replace('/', '%2F')}&config=default&split=train"
)
ENCODER_NAME = "speaker_encoder.onnx"

# Hàng số 0 của split train. Chốt cứng để lần chạy sau ra đúng con số cũ —
# lấy "một clip bất kỳ" thì mỗi lần một embedding khác, không đối chiếu được.
ROW_INDEX = 0


def _model_dir() -> Path:
    """Thư mục model VieNeu đã tải trong userData của app."""
    import os

    return (
        Path(os.environ["USERPROFILE"])
        / "AppData"
        / "Roaming"
        / "LN Reader"
        / "models"
        / "voices"
        / "vi_VN-vieneu-v3turbo"
    )


def _load_wav(path: Path) -> tuple[np.ndarray, int]:
    """Đọc wav → (mảng 1 chiều thang int16, sample rate)."""
    with wave.open(str(path), "rb") as handle:
        rate = handle.getframerate()
        channels = handle.getnchannels()
        raw = handle.readframes(handle.getnframes())
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)
    return samples, rate


def _fetch_reference(dest: Path) -> tuple[Path, str]:
    """Tải clip mẫu qua datasets-server (không kéo cả shard 412 MB)."""
    with urllib.request.urlopen(ROWS_URL, timeout=60) as response:
        payload: dict[str, Any] = json.load(response)
    row = payload["rows"][ROW_INDEX]["row"]
    url = row["audio"][0]["src"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    urllib.request.urlretrieve(url, dest)
    transcript: str = row["transcription"]
    return dest, transcript


def _embed(samples: np.ndarray, rate: int, encoder: Path) -> np.ndarray:
    import onnxruntime as ort
    import soxr

    from app.audio.fbank import SPEAKER_SAMPLE_RATE

    resampled = soxr.resample(samples, rate, SPEAKER_SAMPLE_RATE).astype(np.float32)
    features = speaker_fbank(resampled)
    session = ort.InferenceSession(str(encoder), providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name
    return np.asarray(session.run(None, {name: features[None]})[0][0], dtype=np.float32)


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(a @ b / (np.linalg.norm(a) * np.linalg.norm(b)))


def extract(work: Path) -> int:
    encoder = _model_dir() / "onnx_int8" / ENCODER_NAME
    if not encoder.exists():
        print(f"Chưa có {encoder}.")
        print("Mở app → Giọng đọc → tải giọng VieNeu trước đã.")
        return 1

    wav_path, transcript = _fetch_reference(work / "ngochuyen_ref.wav")
    samples, rate = _load_wav(wav_path)
    print(f"Clip mẫu: {samples.size / rate:.2f}s @ {rate} Hz")
    print(f"Lời thoại: {transcript}")

    embedding = _embed(samples, rate, encoder)
    print(f"speaker_emb: {embedding.shape}, chuẩn {np.linalg.norm(embedding):.3f}")

    rounded = [round(float(x), 6) for x in embedding]
    out = work / "speaker_emb.json"
    out.write_text(json.dumps(rounded), encoding="utf-8")
    print(f"\nĐã ghi {out}")
    print("Chép mảng này vào `speakerEmb` của giọng trong catalog.json.")
    return 0


def verify(work: Path) -> int:
    """Đối chiếu fbank numpy với torchaudio. Chỉ chạy trong venv có torch."""
    try:
        import torch
        import torchaudio.compliance.kaldi as kaldi
        import torchaudio.functional as functional
    except ImportError:
        print("Nhánh này cần torch + torchaudio — xem hướng dẫn ở đầu file.")
        return 1

    encoder = _model_dir() / "onnx_int8" / ENCODER_NAME
    wav_path = work / "ngochuyen_ref.wav"
    if not wav_path.exists():
        _fetch_reference(wav_path)

    samples, rate = _load_wav(wav_path)
    tensor = functional.resample(torch.as_tensor(samples, dtype=torch.float32), rate, 16_000)

    reference = kaldi.fbank(
        tensor.unsqueeze(0), num_mel_bins=80, sample_frequency=16_000, dither=0.0
    )
    reference = (reference - reference.mean(dim=0, keepdim=True)).numpy()
    mine = speaker_fbank(tensor.numpy())

    rows = min(reference.shape[0], mine.shape[0])
    correlation = float(np.corrcoef(reference[:rows].ravel(), mine[:rows].ravel())[0, 1])
    print(f"Tương quan hệ số fbank : {correlation:.4f}")

    import onnxruntime as ort

    session = ort.InferenceSession(str(encoder), providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name

    def run(features: np.ndarray) -> np.ndarray:
        return np.asarray(session.run(None, {name: features[None].astype(np.float32)})[0][0])

    print(f"cos(embedding numpy, torch): {_cosine(run(reference), run(mine)):.4f}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extract", action="store_true", help="Trích speakerEmb cho catalog")
    parser.add_argument("--verify", action="store_true", help="Đối chiếu fbank với torchaudio")
    parser.add_argument(
        "--work",
        type=Path,
        default=Path(__file__).resolve().parent / "_work",
        help="Thư mục chứa file tạm (mặc định probe/_work, đã trong .gitignore)",
    )
    args = parser.parse_args()

    if args.verify:
        return verify(args.work)
    if args.extract:
        return extract(args.work)
    parser.print_help()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
