"""Đóng gói sidecar thành `.exe` bằng PyInstaller (chế độ onedir).

Chạy:

    cd sidecar
    .venv/Scripts/python.exe build.py

Kết quả: `sidecar/dist/ln-sidecar/ln-sidecar.exe` + DLL đi kèm. Thư mục này
được electron-builder chép vào `resources/sidecar/` (xem `electron-builder.yml`),
đúng chỗ `resolveSidecarCommand()` bên main tìm tới.

**Vì sao onedir chứ không onefile.** onefile giải nén cả bộ vào thư mục tạm mỗi
lần khởi động — chậm thêm vài giây và bị antivirus soi kỹ hơn. Sidecar khởi
động cùng app nên độ trễ đó user thấy ngay. onedir đổi lại là nhiều file, nhưng
electron-builder vốn đã chép cả thư mục.

**Vì sao không dùng file .spec.** Mọi tuỳ chọn nằm ở đây, trong Python thật, nên
đọc được lý do từng dòng. File `.spec` là script Python bị PyInstaller exec với
biến toàn cục ngầm — khó đọc và khó test hơn.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

SIDECAR_DIR = Path(__file__).resolve().parent

# Phải khớp `SIDECAR_EXE_NAME` ở `apps/main/src/services/sidecar-paths.ts`.
# Lệch tên thì bản đóng gói không tìm thấy sidecar, mà unit test bên TS vẫn
# xanh vì nó chỉ khoá thứ tự tìm kiếm chứ không biết PyInstaller sinh ra gì.
EXE_NAME = "ln-sidecar"

DIST_DIR = SIDECAR_DIR / "dist"
BUILD_DIR = SIDECAR_DIR / "build"
OUTPUT_DIR = DIST_DIR / EXE_NAME

# Module uvicorn/fastapi nạp động lúc chạy — PyInstaller dò import tĩnh nên
# không thấy chúng. Thiếu là `.exe` build xong vẫn chết ngay lúc khởi động,
# và lỗi chỉ hiện ở stderr của tiến trình con.
HIDDEN_IMPORTS = [
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # P2.4 — engine TTS.
    #
    # `onnxruntime` nạp provider CPU qua DLL native, `soundfile` nạp libsndfile
    # qua cffi, và cả hai đều KHÔNG lộ ra cho bộ dò import tĩnh của PyInstaller.
    # Thiếu là `.exe` build xong vẫn chạy, rồi chết đúng lúc user bấm generate.
    "onnxruntime",
    "onnxruntime.capi",
    "onnxruntime.capi._pybind_state",
    "soundfile",
    # KHÔNG khai `numpy` ở đây. PyInstaller có hook riêng cho numpy, và khai
    # tường minh sẽ ĐÈ hook đó: nó chỉ mang theo `numpy` mà bỏ các
    # C-extension con (`numpy._core._exceptions`…), khiến `.exe` chết ngay lúc
    # import với "Importing the numpy C-extensions failed". Đã gặp thật khi
    # build P2.4 — để hook tự lo là đúng.
    # `piper` nạp bộ phiên âm theo ngôn ngữ lúc chạy — voice VI/EN dùng espeak.
    "piper",
    "piper.voice",
    "piper.config",
    "piper.phonemize_espeak",
    "piper.phoneme_ids",
    # Cần cho `include_alignments`: piper vá model trong bộ nhớ để lộ số mẫu mỗi
    # phoneme. Thiếu thì piper CHỈ ghi log rồi trả `None` — timing âm thầm rơi
    # hết về ước lượng theo ký tự mà không có gì báo.
    "onnx",
    # P6.2 — engine VieNeu. `vieneu/__init__.py` chỉ export một factory dùng
    # `match` + import trong hàm, nên PyInstaller **không** dò ra `v3turbo` bằng
    # phân tích tĩnh; phải khai tay, nếu không `.exe` build xong vẫn chết lúc
    # user chọn giọng VieNeu.
    "vieneu",
    "vieneu.v3turbo",
    "vieneu._v3_turbo_engine",
    "vieneu._v3_turbo_engine.onnx_runtime_lite",
    "vieneu._v3_turbo_engine.speaker.onnx_extractor",
    "vieneu_utils",
    "vieneu_utils.phonemize_text",
    "sea_g2p",
    "soxr",
    "tokenizers",
    "huggingface_hub",
]

# Dữ liệu không phải mã Python, PyInstaller không tự mang theo.
#
# `espeak-ng-data` là bảng phiên âm của espeak (gồm `vi_dict`) nằm trong wheel
# piper. Thiếu nó thì model nạp được nhưng không phiên âm nổi chữ nào.
#
# `vieneu` mang theo `assets/voices_v3_turbo.json` (1.4 MB) chứa **14 giọng
# preset** — speaker embedding của chúng nằm trong file này, không phải trong
# model 244 MB tải về. Thiếu nó thì model nạp được nhưng không có giọng nào.
#
# `sea_g2p` mang từ điển phiên âm tiếng Việt, thiếu thì không đọc nổi chữ nào.
COLLECT_DATA = ["piper", "soundfile", "onnxruntime", "vieneu", "sea_g2p"]

# `--collect-binaries` cho DLL native đi kèm wheel.
COLLECT_BINARIES = ["onnxruntime", "soundfile", "sea_g2p", "tokenizers", "soxr"]

# Không mang theo thứ chỉ dùng lúc test/build — mỗi cái là vài MB.
EXCLUDES = ["pytest", "PyInstaller", "tkinter", "unittest", "pydoc"]


def clean() -> None:
    """Xoá kết quả build cũ.

    Bắt buộc: PyInstaller **không** dọn `dist/` trước khi ghi, nên file của lần
    build trước còn sót lại sẽ đi thẳng vào bản đóng gói — kiểu lỗi rất khó
    đoán vì nó chỉ xảy ra trên máy đã build nhiều lần.
    """
    for directory in (DIST_DIR, BUILD_DIR):
        if directory.exists():
            shutil.rmtree(directory)


def build() -> int:
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onedir",
        "--name",
        EXE_NAME,
        # Không có cửa sổ console: sidecar là tiến trình nền, hiện console đen
        # mỗi lần mở app là lỗi user nhìn thấy ngay.
        #
        # LƯU Ý: `--windowed` sẽ làm stdout/stderr thành thiết bị rỗng trên
        # Windows, mà bắt tay lại đi qua stdout (PROGRESS mục 4.26a). Dùng
        # `--console` rồi để electron-builder ẩn cửa sổ là sai hướng — thay vào
        # đó giữ console nhưng spawn với `windowsHide` bên main.
        "--console",
        "--distpath",
        str(DIST_DIR),
        "--workpath",
        str(BUILD_DIR),
        "--specpath",
        str(BUILD_DIR),
    ]

    for module in HIDDEN_IMPORTS:
        args += ["--hidden-import", module]
    for package in COLLECT_DATA:
        args += ["--collect-data", package]
    for package in COLLECT_BINARIES:
        args += ["--collect-binaries", package]
    for module in EXCLUDES:
        args += ["--exclude-module", module]

    # Điểm vào là `entry.py` ở ngoài package, KHÔNG phải `app/server.py`.
    #
    # PyInstaller chạy script đích như module cấp cao nhất, không có package
    # cha — mà `app/server.py` dùng import tương đối nên sẽ chết ngay lúc khởi
    # động với `ImportError: attempted relative import with no known parent
    # package`. Lỗi đó KHÔNG lộ ra lúc dev (main chạy `-m app.server`) cũng
    # không lộ ra ở pytest. Xem `entry.py` để biết chi tiết.
    args.append(str(SIDECAR_DIR / "entry.py"))

    print(f"[build] PyInstaller → {OUTPUT_DIR}")
    return subprocess.call(args, cwd=SIDECAR_DIR)


def verify() -> int:
    """Kiểm file thực thi có thật sự sinh ra không.

    PyInstaller trả mã 0 trong vài trường hợp mà file cuối vẫn thiếu. Không
    kiểm ở đây thì lỗi trôi tới tận lúc chạy bản đóng gói — đúng vết xe đổ của
    worker pdfjs (PROGRESS mục 4.19).
    """
    exe = OUTPUT_DIR / f"{EXE_NAME}.exe"
    if not exe.is_file():
        print(f"[build] LỖI: không thấy {exe}", file=sys.stderr)
        return 1

    size_mb = exe.stat().st_size / (1024 * 1024)
    total_mb = sum(f.stat().st_size for f in OUTPUT_DIR.rglob("*") if f.is_file()) / (
        1024 * 1024
    )
    print(f"[build] OK: {exe.name} ({size_mb:.1f} MB), cả thư mục {total_mb:.1f} MB")
    return 0


def main() -> int:
    clean()
    code = build()
    if code != 0:
        print(f"[build] PyInstaller thất bại, mã {code}", file=sys.stderr)
        return code
    return verify()


if __name__ == "__main__":
    raise SystemExit(main())
