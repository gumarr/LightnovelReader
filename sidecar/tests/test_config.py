"""Test đọc cấu hình từ môi trường."""

from __future__ import annotations

import pytest

from app.config import (
    DEFAULT_HOST,
    DEFAULT_PORT,
    ENV_HOST,
    ENV_MODELS_DIR,
    ENV_PORT,
    ENV_TOKEN,
    ConfigError,
    load_config,
)

BASE_ENV = {ENV_MODELS_DIR: r"C:\models"}


class TestToken:
    def test_lấy_token_từ_môi_trường(self) -> None:
        config = load_config({**BASE_ENV, ENV_TOKEN: "abc123"})
        assert config.token == "abc123"

    def test_thiếu_token_thì_tự_sinh(self) -> None:
        """Chạy tay lúc dev vẫn được, nhưng không bao giờ chạy không xác thực."""
        config = load_config(BASE_ENV)
        assert len(config.token) >= 32

    def test_token_tự_sinh_khác_nhau_mỗi_lần(self) -> None:
        assert load_config(BASE_ENV).token != load_config(BASE_ENV).token

    def test_token_toàn_khoảng_trắng_coi_như_thiếu(self) -> None:
        config = load_config({**BASE_ENV, ENV_TOKEN: "   "})
        assert config.token.strip() != ""
        assert config.token != "   "


class TestHost:
    def test_mặc_định_là_loopback(self) -> None:
        assert load_config(BASE_ENV).host == DEFAULT_HOST == "127.0.0.1"


class TestPort:
    def test_mặc_định_là_không_để_os_cấp(self) -> None:
        assert load_config(BASE_ENV).port == DEFAULT_PORT == 0

    def test_đọc_port_từ_môi_trường(self) -> None:
        assert load_config({**BASE_ENV, ENV_PORT: "8123"}).port == 8123

    def test_port_không_phải_số_thì_ném_lỗi(self) -> None:
        with pytest.raises(ConfigError, match="không phải số"):
            load_config({**BASE_ENV, ENV_PORT: "tám nghìn"})

    def test_port_ngoài_khoảng_thì_ném_lỗi(self) -> None:
        with pytest.raises(ConfigError, match="ngoài khoảng"):
            load_config({**BASE_ENV, ENV_PORT: "70000"})


class TestThưMụcModel:
    def test_thiếu_thì_ném_lỗi(self) -> None:
        """Sidecar không tự đoán userData — main phải truyền vào."""
        with pytest.raises(ConfigError, match=ENV_MODELS_DIR):
            load_config({ENV_TOKEN: "abc"})

    def test_đọc_được(self) -> None:
        assert load_config({ENV_MODELS_DIR: r"D:\ln\models"}).models_dir == r"D:\ln\models"


class TestKhôngĐọcMôiTrườngThật:
    def test_env_truyền_vào_được_ưu_tiên(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """Truyền env tường minh thì không được lẫn với os.environ thật."""
        monkeypatch.setenv(ENV_HOST, "0.0.0.0")
        assert load_config(BASE_ENV).host == DEFAULT_HOST
