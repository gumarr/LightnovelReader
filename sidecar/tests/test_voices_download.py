"""Test tải voice: verify SHA256, dọn dẹp khi hỏng, tiến độ.

Dùng **HTTP server thật** trên loopback chứ không mock `httpx`: phần dễ sai
nhất là dòng chảy byte và cách xử lý response đứt giữa chừng — mock thì chính
những thứ đó bị giả định là đúng.
"""

from __future__ import annotations

import hashlib
import http.server
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.voices.catalog import CatalogError, VoiceEntry, VoiceFile, voice_dir
from app.voices.download import (
    PART_SUFFIX,
    DownloadError,
    Progress,
    download_voice,
    file_url,
    remove_voice,
)

MODEL_BYTES = b"model-noi-dung" * 100
CONFIG_BYTES = b'{"sample_rate": 22050}'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class _Handler(http.server.BaseHTTPRequestHandler):
    """Server tí hon phục vụ hai file, có đường dẫn cố tình trả hỏng."""

    files: dict[str, bytes] = {}

    def do_GET(self) -> None:  # noqa: N802 — tên do BaseHTTPRequestHandler quy định
        path = self.path.lstrip("/")
        if path == "loi-500":
            self.send_response(500)
            self.end_headers()
            return
        if path == "ngan-hon":
            # Trả ít byte hơn công bố — mô phỏng kết nối đứt giữa chừng.
            body = MODEL_BYTES[:10]
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return

        body = self.files.get(path)
        if body is None:
            self.send_response(404)
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        """Tắt log ra stderr — pytest không cần thấy từng request."""


@pytest.fixture
def server() -> Iterator[str]:
    _Handler.files = {"model.onnx": MODEL_BYTES, "model.onnx.json": CONFIG_BYTES}
    httpd = http.server.HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}/"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


def make_entry(
    model_sha: str | None = None,
    config_sha: str | None = None,
    model_path: str = "model.onnx",
    model_size: int | None = None,
) -> VoiceEntry:
    return VoiceEntry(
        id="vi_VN-test-medium",
        lang="vi",
        name="Test",
        quality="medium",
        sample_rate=22050,
        license="MIT",
        files=(
            VoiceFile(
                kind="model",
                path=model_path,
                size_bytes=model_size if model_size is not None else len(MODEL_BYTES),
                sha256=model_sha or sha(MODEL_BYTES),
            ),
            VoiceFile(
                kind="config",
                path="model.onnx.json",
                size_bytes=len(CONFIG_BYTES),
                sha256=config_sha or sha(CONFIG_BYTES),
            ),
        ),
    )


def collect(sink_list: list[Progress]) -> object:
    return lambda p: sink_list.append(p)


class TestGhépUrl:
    def test_ghép_bình_thường(self) -> None:
        assert file_url("https://a.co/main", "vi/x.onnx") == "https://a.co/main/vi/x.onnx"

    def test_không_sinh_dấu_gạch_đôi(self) -> None:
        assert file_url("https://a.co/main/", "/vi/x.onnx") == "https://a.co/main/vi/x.onnx"


class TestTảiThànhCông:
    def test_tải_đủ_hai_file(self, server: str, tmp_path: Path) -> None:
        entry = make_entry()
        download_voice(entry, tmp_path, server, lambda p: None)

        directory = voice_dir(tmp_path, entry.id)
        assert (directory / "model.onnx").read_bytes() == MODEL_BYTES
        assert (directory / "model.onnx.json").read_bytes() == CONFIG_BYTES

    def test_không_để_lại_file_part(self, server: str, tmp_path: Path) -> None:
        entry = make_entry()
        download_voice(entry, tmp_path, server, lambda p: None)
        directory = voice_dir(tmp_path, entry.id)
        assert list(directory.glob(f"*{PART_SUFFIX}")) == []

    def test_tiến_độ_kết_thúc_bằng_done(self, server: str, tmp_path: Path) -> None:
        events: list[Progress] = []
        entry = make_entry()
        download_voice(entry, tmp_path, server, collect(events))

        assert events[0].state == "downloading"
        assert events[-1].state == "done"
        assert events[-1].received_bytes == entry.total_bytes

    def test_tiến_độ_tăng_dần_không_giảm(self, server: str, tmp_path: Path) -> None:
        events: list[Progress] = []
        download_voice(make_entry(), tmp_path, server, collect(events))
        received = [e.received_bytes for e in events]
        assert received == sorted(received)

    def test_tổng_lấy_từ_catalog_không_phải_content_length(
        self, server: str, tmp_path: Path
    ) -> None:
        """HF qua CDN có lúc không trả Content-Length; thanh tiến trình không
        có tổng thì vô dụng, nên tổng luôn lấy từ catalog."""
        events: list[Progress] = []
        entry = make_entry()
        download_voice(entry, tmp_path, server, collect(events))
        assert all(e.total_bytes == entry.total_bytes for e in events)


class TestVerifyHỏng:
    def test_sha256_sai_thì_ném(self, server: str, tmp_path: Path) -> None:
        with pytest.raises(DownloadError, match="SHA256"):
            download_voice(make_entry(model_sha="f" * 64), tmp_path, server, lambda p: None)

    def test_sha256_sai_thì_KHÔNG_để_lại_file_nào(self, server: str, tmp_path: Path) -> None:
        """Giữ lại file hỏng để 'thử dùng xem' là sai: engine nạp vào sẽ hỏng ở
        chỗ khác hẳn, không lần ngược về đây được."""
        entry = make_entry(model_sha="f" * 64)
        with pytest.raises(DownloadError):
            download_voice(entry, tmp_path, server, lambda p: None)
        assert not voice_dir(tmp_path, entry.id).exists()

    def test_sha256_config_sai_cũng_dọn_sạch_cả_model(
        self, server: str, tmp_path: Path
    ) -> None:
        """Model tải xong rồi nhưng config hỏng — để lại một nửa còn tệ hơn
        không có, vì `is_installed` sẽ phải đoán."""
        entry = make_entry(config_sha="f" * 64)
        with pytest.raises(DownloadError):
            download_voice(entry, tmp_path, server, lambda p: None)
        assert not voice_dir(tmp_path, entry.id).exists()

    def test_kích_thước_ngắn_hơn_bị_bắt(self, server: str, tmp_path: Path) -> None:
        """Kết nối đứt giữa chừng: sha256 chắc chắn cũng sai, nhưng báo theo
        kích thước cho user biết là 'tải thiếu' chứ không phải 'file bị sửa'."""
        entry = make_entry(model_path="ngan-hon")
        with pytest.raises(DownloadError, match="Kích thước"):
            download_voice(entry, tmp_path, server, lambda p: None)

    def test_máy_chủ_lỗi_500(self, server: str, tmp_path: Path) -> None:
        with pytest.raises(DownloadError, match="500"):
            download_voice(make_entry(model_path="loi-500"), tmp_path, server, lambda p: None)

    def test_file_không_tồn_tại_404(self, server: str, tmp_path: Path) -> None:
        with pytest.raises(DownloadError, match="404"):
            download_voice(
                make_entry(model_path="khong-co.onnx"), tmp_path, server, lambda p: None
            )

    def test_không_nối_được_máy_chủ(self, tmp_path: Path) -> None:
        # Cổng 1 gần như chắc chắn không có gì lắng nghe.
        with pytest.raises(DownloadError):
            download_voice(make_entry(), tmp_path, "http://127.0.0.1:1/", lambda p: None)


class TestXoáVoice:
    def test_xoá_thư_mục_đã_có(self, server: str, tmp_path: Path) -> None:
        entry = make_entry()
        download_voice(entry, tmp_path, server, lambda p: None)
        assert remove_voice(tmp_path, entry.id) is True
        assert not voice_dir(tmp_path, entry.id).exists()

    def test_xoá_thứ_không_tồn_tại_trả_false(self, tmp_path: Path) -> None:
        """Không ném: xoá thứ đã không còn là đúng ý user rồi."""
        assert remove_voice(tmp_path, "chua-tai-bao-gio") is False

    def test_id_xấu_bị_từ_chối(self, tmp_path: Path) -> None:
        with pytest.raises(CatalogError):
            remove_voice(tmp_path, "../../windows")


class TestTảiLại:
    def test_tải_đè_lên_bản_cũ(self, server: str, tmp_path: Path) -> None:
        """Tải lại voice đã có phải cho ra file đúng, không nối thêm vào đuôi."""
        entry = make_entry()
        download_voice(entry, tmp_path, server, lambda p: None)
        download_voice(entry, tmp_path, server, lambda p: None)
        assert (voice_dir(tmp_path, entry.id) / "model.onnx").read_bytes() == MODEL_BYTES

    def test_file_part_sót_lại_không_làm_hỏng_lần_sau(
        self, server: str, tmp_path: Path
    ) -> None:
        """Lần trước bị giết giữa chừng để lại `.part` — lần này phải ghi đè
        hẳn chứ không nối tiếp, nếu không sha256 sẽ sai vĩnh viễn."""
        entry = make_entry()
        directory = voice_dir(tmp_path, entry.id)
        directory.mkdir(parents=True)
        (directory / ("model.onnx" + PART_SUFFIX)).write_bytes(b"rac-tu-lan-truoc")

        download_voice(entry, tmp_path, server, lambda p: None)
        assert (directory / "model.onnx").read_bytes() == MODEL_BYTES
