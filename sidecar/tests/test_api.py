"""Test API sidecar: xác thực token và hai route của P2.1."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.auth import token_matches
from app.config import TOKEN_HEADER, SidecarConfig
from app.main import create_app

TOKEN = "token-phien-test"


@pytest.fixture
def client() -> TestClient:
    config = SidecarConfig(token=TOKEN, host="127.0.0.1", port=0, models_dir=r"C:\models")
    return TestClient(create_app(config))


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

    def test_engine_chưa_sẵn_sàng_ở_p21(self, client: TestClient) -> None:
        """Chưa có engine TTS nào — không được báo sẵn sàng khống."""
        assert client.get("/health").json()["engine_ready"] is False


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
