"""Test kiểm đường dẫn ghi audio.

`outPath` đến từ **thân request HTTP**. Sidecar nghe loopback nhưng bất kỳ tiến
trình nào trên máy đoán được cổng + token đều gọi được, nên đây là biên bảo mật
thật chứ không phải kiểm tra hình thức.
"""

from __future__ import annotations

import pytest

from app.audio.paths import AudioPathError, resolve_audio_path


class TestResolveAudioPath:
    def test_duong_dan_hop_le_trong_thu_muc(self, tmp_path) -> None:
        target = tmp_path / "book1" / "seg1.ogg"
        assert resolve_audio_path(str(tmp_path), str(target)) == target.resolve()

    def test_duong_dan_tuong_doi_tinh_theo_audio_dir(self, tmp_path) -> None:
        """KHÔNG tính theo thư mục làm việc — thứ không ai kiểm soát ở bản đóng gói."""
        result = resolve_audio_path(str(tmp_path), "book1/seg1.ogg")
        assert result == (tmp_path / "book1" / "seg1.ogg").resolve()

    def test_chan_thoat_ra_bang_dau_cham_cham(self, tmp_path) -> None:
        """`audioDir/../../ln-reader.db` sẽ ghi đè cả thư viện sách."""
        with pytest.raises(AudioPathError):
            resolve_audio_path(str(tmp_path), "../../thoat-ra.ogg")

    def test_chan_duong_dan_tuyet_doi_ngoai_thu_muc(self, tmp_path) -> None:
        outside = tmp_path.parent / "ngoai.ogg"
        with pytest.raises(AudioPathError):
            resolve_audio_path(str(tmp_path), str(outside))

    def test_chan_thu_muc_trung_tien_to(self, tmp_path) -> None:
        """So chuỗi tiền tố thì `/audio-khac` khớp `/audio` và lọt qua.

        Đây là lý do dùng `is_relative_to` trên path đã chuẩn hoá.
        """
        root = tmp_path / "audio"
        root.mkdir()
        sibling = tmp_path / "audio-khac" / "x.ogg"
        with pytest.raises(AudioPathError):
            resolve_audio_path(str(root), str(sibling))

    def test_chan_duoi_file_khac(self, tmp_path) -> None:
        """Bắt sớm lỗi lập trình: gửi nhầm path `.json` của timing sang đây."""
        with pytest.raises(AudioPathError, match=".ogg"):
            resolve_audio_path(str(tmp_path), str(tmp_path / "seg1.json"))

    def test_chua_cau_hinh_thu_muc_audio(self) -> None:
        """Rỗng = chưa cấu hình → từ chối, thay vì ghi bừa ra thư mục làm việc."""
        with pytest.raises(AudioPathError, match="LN_SIDECAR_AUDIO_DIR"):
            resolve_audio_path("", "seg1.ogg")
