"""Test API sidecar: xác thực token, hai route của P2.1 và nhóm /voices (P2.3)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth import token_matches
from app.config import TOKEN_HEADER, SidecarConfig
from app.main import create_app

TOKEN = "token-phien-test"


def make_client(
    models_dir: Path,
    catalog_path: Path | None = None,
    audio_dir: Path | None = None,
) -> TestClient:
    config = SidecarConfig(
        token=TOKEN,
        host="127.0.0.1",
        port=0,
        models_dir=str(models_dir),
        catalog_path="" if catalog_path is None else str(catalog_path),
        audio_dir="" if audio_dir is None else str(audio_dir),
    )
    return TestClient(create_app(config))


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
    return make_client(tmp_path)


def write_catalog(tmp_path: Path, *, voice_id: str = "vi_VN-test-medium") -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(
        json.dumps(
            {
                "version": 1,
                "baseUrl": "https://huggingface.co/rhasspy/piper-voices/resolve/main/",
                "voices": [
                    {
                        "id": voice_id,
                        "lang": "vi",
                        "name": "Test",
                        "quality": "medium",
                        "sampleRate": 22050,
                        "license": "MIT",
                        "files": [
                            {
                                "kind": "model",
                                "path": "vi/model.onnx",
                                "sizeBytes": 10,
                                "sha256": "a" * 64,
                            },
                            {
                                "kind": "config",
                                "path": "vi/model.onnx.json",
                                "sizeBytes": 4,
                                "sha256": "b" * 64,
                            },
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return path


def auth() -> dict[str, str]:
    return {TOKEN_HEADER: TOKEN}


class TestSoToken:
    def test_khớp(self) -> None:
        assert token_matches("abc", "abc")

    def test_không_khớp(self) -> None:
        assert not token_matches("abc", "abd")

    def test_thiếu_token(self) -> None:
        assert not token_matches("abc", None)

    def test_chuỗi_rỗng_không_qua_được(self) -> None:
        assert not token_matches("abc", "")


class TestHealth:
    def test_không_cần_token(self, client: TestClient) -> None:
        """Main phải chẩn đoán được sidecar sống ngay cả khi token lệch."""
        assert client.get("/health").status_code == 200

    def test_trả_về_pid_và_phiên_bản(self, client: TestClient) -> None:
        body = client.get("/health").json()
        assert body["status"] == "ok"
        assert body["pid"] > 0
        assert body["version"]

    def test_engine_chưa_nạp_thì_báo_chưa_sẵn_sàng(self, client: TestClient) -> None:
        """Engine nạp LƯỜI ở lần synthesize đầu tiên.

        Nên `False` lúc mới khởi động là bình thường, không phải hỏng —
        supervisor bên main không được coi đó là lý do restart. Từ P2.4 đây là
        trạng thái thật chứ không còn `False` cứng.
        """
        body = client.get("/health").json()
        assert body["engine_ready"] is False
        assert body["loaded_voice_id"] is None


class TestXácThực:
    def test_thiếu_token_bị_từ_chối(self, client: TestClient) -> None:
        response = client.post("/normalize", json={"text": "xin chào", "lang": "vi"})
        assert response.status_code == 401
        assert response.json()["code"] == "UNAUTHORIZED"

    def test_sai_token_bị_từ_chối(self, client: TestClient) -> None:
        response = client.post(
            "/normalize",
            json={"text": "xin chào", "lang": "vi"},
            headers={TOKEN_HEADER: "token-sai"},
        )
        assert response.status_code == 401

    def test_đúng_token_thì_qua(self, client: TestClient) -> None:
        response = client.post(
            "/normalize", json={"text": "xin chào", "lang": "vi"}, headers=auth()
        )
        assert response.status_code == 200

    def test_thông_báo_lỗi_không_tiết_lộ_thiếu_hay_sai(self, client: TestClient) -> None:
        """Phân biệt hai trường hợp chỉ có ích cho bên đang dò token."""
        thiếu = client.post("/normalize", json={"text": "a"}).json()
        sai = client.post(
            "/normalize", json={"text": "a"}, headers={TOKEN_HEADER: "x"}
        ).json()
        assert thiếu == sai

    def test_không_mở_trang_docs(self, client: TestClient) -> None:
        """Trang docs là đường duy nhất phục vụ request không kèm token.

        Hai lớp chặn: `docs_url=None` bỏ hẳn route, và middleware chặn trước
        khi tới router. Không kèm token thì thấy 401 (middleware bắn trước);
        kèm token đúng mới xuống tới router và nhận 404 — tức route không tồn tại.
        """
        assert client.get("/docs").status_code == 401
        assert client.get("/docs", headers=auth()).status_code == 404
        assert client.get("/openapi.json", headers=auth()).status_code == 404


class TestNormalize:
    def test_tiếng_việt(self, client: TestClient) -> None:
        response = client.post(
            "/normalize", json={"text": "có 15 người", "lang": "vi"}, headers=auth()
        )
        assert response.json()["text"] == "có mười lăm người"

    def test_tiếng_anh(self, client: TestClient) -> None:
        response = client.post(
            "/normalize", json={"text": "Mr. Smith", "lang": "en"}, headers=auth()
        )
        assert response.json()["text"] == "Mister Smith"

    def test_ngôn_ngữ_lạ_rơi_về_vi(self, client: TestClient) -> None:
        """Ném lỗi thì cả chương không generate được — rơi về VI vẫn đọc được."""
        response = client.post(
            "/normalize", json={"text": "có 15 người", "lang": "ja"}, headers=auth()
        )
        assert response.status_code == 200
        assert response.json()["text"] == "có mười lăm người"

    def test_text_rỗng_bị_từ_chối(self, client: TestClient) -> None:
        response = client.post("/normalize", json={"text": ""}, headers=auth())
        assert response.status_code == 422

    def test_text_quá_dài_bị_từ_chối(self, client: TestClient) -> None:
        """Segment tối đa 300 ký tự; 10 000 đã rộng gấp nhiều lần."""
        response = client.post("/normalize", json={"text": "a" * 10_001}, headers=auth())
        assert response.status_code == 422


class TestVoicesCầnToken:
    """Nhóm /voices không được nằm ngoài xác thực như /health."""

    def test_catalog_cần_token(self, client: TestClient) -> None:
        assert client.get("/voices/catalog").status_code == 401

    def test_danh_sách_cần_token(self, client: TestClient) -> None:
        assert client.get("/voices").status_code == 401

    def test_xoá_cần_token(self, client: TestClient) -> None:
        assert client.delete("/voices/abc").status_code == 401


class TestVoicesCatalog:
    def test_không_có_catalog_thì_danh_sách_rỗng(self, client: TestClient) -> None:
        """Thiếu catalog là 'chưa tải được voice nào', không phải lỗi làm sập
        màn hình — app vẫn phải mở được."""
        body = client.get("/voices/catalog", headers=auth()).json()
        assert body["voices"] == []

    def test_đọc_được_catalog(self, tmp_path: Path) -> None:
        catalog = write_catalog(tmp_path)
        client = make_client(tmp_path / "models", catalog)
        body = client.get("/voices/catalog", headers=auth()).json()

        assert len(body["voices"]) == 1
        voice = body["voices"][0]
        assert voice["id"] == "vi_VN-test-medium"
        assert voice["totalBytes"] == 14
        assert voice["installed"] is False

    def test_route_catalog_không_bị_nuốt_thành_voice_id(self, tmp_path: Path) -> None:
        """`/voices/catalog` khai TRƯỚC `/voices/{voice_id}` — đổi thứ tự thì
        FastAPI khớp `catalog` thành một voiceId và route này trả 404."""
        client = make_client(tmp_path / "models", write_catalog(tmp_path))
        assert client.get("/voices/catalog", headers=auth()).status_code == 200

    def test_catalog_hỏng_báo_500_kèm_lý_do(self, tmp_path: Path) -> None:
        path = tmp_path / "catalog.json"
        path.write_text("{ hỏng", encoding="utf-8")
        client = make_client(tmp_path / "models", path)
        response = client.get("/voices/catalog", headers=auth())
        assert response.status_code == 500

    def test_cờ_installed_bật_khi_đủ_file(self, tmp_path: Path) -> None:
        models = tmp_path / "models"
        directory = models / "voices" / "vi_VN-test-medium"
        directory.mkdir(parents=True)
        (directory / "model.onnx").write_bytes(b"x" * 10)
        (directory / "model.onnx.json").write_bytes(b"y" * 4)

        client = make_client(models, write_catalog(tmp_path))
        body = client.get("/voices/catalog", headers=auth()).json()
        assert body["voices"][0]["installed"] is True


class TestVoicesĐãCài:
    def test_chưa_cài_gì_thì_rỗng(self, tmp_path: Path) -> None:
        client = make_client(tmp_path / "models", write_catalog(tmp_path))
        assert client.get("/voices", headers=auth()).json()["voices"] == []

    def test_hiện_voice_đã_cài_kèm_dung_lượng(self, tmp_path: Path) -> None:
        models = tmp_path / "models"
        directory = models / "voices" / "vi_VN-test-medium"
        directory.mkdir(parents=True)
        (directory / "model.onnx").write_bytes(b"x" * 10)
        (directory / "model.onnx.json").write_bytes(b"y" * 4)

        client = make_client(models, write_catalog(tmp_path))
        voices = client.get("/voices", headers=auth()).json()["voices"]
        assert len(voices) == 1
        assert voices[0]["sizeBytes"] == 14
        assert voices[0]["sampleRate"] == 22050

    def test_file_dở_dang_không_được_tính_là_đã_cài(self, tmp_path: Path) -> None:
        models = tmp_path / "models"
        directory = models / "voices" / "vi_VN-test-medium"
        directory.mkdir(parents=True)
        (directory / "model.onnx").write_bytes(b"x" * 3)  # thiếu byte
        (directory / "model.onnx.json").write_bytes(b"y" * 4)

        client = make_client(models, write_catalog(tmp_path))
        assert client.get("/voices", headers=auth()).json()["voices"] == []


class TestTảiVoice:
    def test_voice_không_có_trong_catalog_báo_404(self, tmp_path: Path) -> None:
        client = make_client(tmp_path / "models", write_catalog(tmp_path))
        response = client.post("/voices/khong-co/download", headers=auth())
        assert response.status_code == 404


class TestXoáVoice:
    def test_xoá_voice_đã_cài(self, tmp_path: Path) -> None:
        models = tmp_path / "models"
        directory = models / "voices" / "vi_VN-test-medium"
        directory.mkdir(parents=True)
        (directory / "model.onnx").write_bytes(b"x" * 10)

        client = make_client(models, write_catalog(tmp_path))
        body = client.delete("/voices/vi_VN-test-medium", headers=auth()).json()
        assert body["removed"] is True
        assert not directory.exists()

    def test_xoá_thứ_chưa_có_trả_removed_false(self, tmp_path: Path) -> None:
        client = make_client(tmp_path / "models", write_catalog(tmp_path))
        body = client.delete("/voices/vi_VN-test-medium", headers=auth()).json()
        assert body["removed"] is False

    def test_id_thoát_thư_mục_bị_từ_chối(self, tmp_path: Path) -> None:
        """Sidecar là tiến trình HTTP riêng — ai đoán được cổng + token đều gọi
        thẳng được, nên không tin biên trên đã kiểm hộ."""
        client = make_client(tmp_path / "models", write_catalog(tmp_path))
        response = client.delete("/voices/..%2F..%2Fwindows", headers=auth())
        assert response.status_code in (400, 404)


class TestSynthesize:
    """Route `/synthesize` (P2.4).

    Không nạp model thật ở đây — voice 63 MB không có trong repo và test phải
    chạy được trên máy sạch. Phần tổng hợp thật đã khoá ở `test_engine.py`, còn
    ở đây kiểm **biên HTTP**: xác thực, kiểm đường dẫn, và mã lỗi.
    """

    def _body(self, out_path: Path, voice_id: str = "vi_VN-test-medium") -> dict[str, object]:
        return {
            "text": "Xin chào các bạn.",
            "voiceId": voice_id,
            "outPath": str(out_path),
            "bitrate": 24,
            "lang": "vi",
        }

    def test_thiếu_token_bị_từ_chối(self, tmp_path: Path) -> None:
        audio = tmp_path / "audio"
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)
        response = client.post("/synthesize", json=self._body(audio / "s.ogg"))
        assert response.status_code == 401

    def test_voice_không_có_trong_catalog(self, tmp_path: Path) -> None:
        audio = tmp_path / "audio"
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)
        response = client.post(
            "/synthesize", headers=auth(), json=self._body(audio / "s.ogg", "khong-ton-tai")
        )
        assert response.status_code == 404

    def test_đường_dẫn_ngoài_thư_mục_audio_bị_từ_chối(self, tmp_path: Path) -> None:
        """`outPath` đến từ thân request — không chặn thì ghi đè được file bất kỳ."""
        audio = tmp_path / "audio"
        audio.mkdir()
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)

        response = client.post(
            "/synthesize", headers=auth(), json=self._body(tmp_path / "ngoai.ogg")
        )
        assert response.status_code == 400

    def test_thoát_thư_mục_bằng_dấu_chấm_chấm(self, tmp_path: Path) -> None:
        audio = tmp_path / "audio"
        audio.mkdir()
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)

        body = self._body(audio / "s.ogg")
        body["outPath"] = "../../ln-reader.db.ogg"
        assert client.post("/synthesize", headers=auth(), json=body).status_code == 400

    def test_đuôi_file_khác_ogg_bị_từ_chối(self, tmp_path: Path) -> None:
        audio = tmp_path / "audio"
        audio.mkdir()
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)

        response = client.post(
            "/synthesize", headers=auth(), json=self._body(audio / "seg.json")
        )
        assert response.status_code == 400

    def test_chưa_cấu_hình_thư_mục_audio(self, tmp_path: Path) -> None:
        """Rỗng = main chưa truyền env → từ chối, không ghi bừa ra thư mục làm việc."""
        client = make_client(tmp_path / "models", write_catalog(tmp_path))
        response = client.post(
            "/synthesize", headers=auth(), json=self._body(tmp_path / "s.ogg")
        )
        assert response.status_code == 400

    def test_bitrate_ngoài_danh_sách_bị_từ_chối(self, tmp_path: Path) -> None:
        """Chỉ 16/24/32 — khớp `AudioBitrate` bên TypeScript."""
        audio = tmp_path / "audio"
        audio.mkdir()
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)

        body = self._body(audio / "s.ogg")
        body["bitrate"] = 48
        assert client.post("/synthesize", headers=auth(), json=body).status_code == 422

    def test_text_rỗng_bị_từ_chối(self, tmp_path: Path) -> None:
        audio = tmp_path / "audio"
        audio.mkdir()
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)

        body = self._body(audio / "s.ogg")
        body["text"] = ""
        assert client.post("/synthesize", headers=auth(), json=body).status_code == 422

    def test_voice_chưa_cài_trả_422_kèm_cách_sửa(self, tmp_path: Path) -> None:
        """Phân biệt với 500: user sửa được bằng cách vào màn Giọng đọc tải lại."""
        audio = tmp_path / "audio"
        audio.mkdir()
        client = make_client(tmp_path / "models", write_catalog(tmp_path), audio)

        response = client.post("/synthesize", headers=auth(), json=self._body(audio / "s.ogg"))
        assert response.status_code == 422
        assert "Giọng đọc" in response.json()["detail"]
