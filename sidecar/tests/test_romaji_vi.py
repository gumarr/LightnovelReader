"""Test luật chuyển romaji → âm tiết Việt (tầng 2, plan.md mục 8.1).

Hai nhóm quan trọng ngang nhau:
- **Nhận đúng** tên Nhật → phiên âm nghe hiểu được.
- **Từ chối** từ tiếng Anh → giữ nguyên, vì đọc bừa còn tệ hơn.

Nhóm thứ hai mới là nhóm dễ hỏng: nới luật để bắt thêm tên Nhật thì lập tức
nuốt nhầm từ tiếng Anh. Danh sách dưới đây là lưới chặn cho việc đó.
"""

from __future__ import annotations

import pytest

from app.text.romaji_vi import (
    MORA_TABLE,
    looks_like_romaji,
    romaji_to_vi,
)

# Tên Nhật hay gặp trong LN. Kỳ vọng ghi cụ thể để đổi bảng mora là test đỏ,
# không im lặng đổi cách đọc của cả app.
JAPANESE_CASES = [
    ("Tokyo", "Tô-kiô"),
    ("Kyoto", "Kiô-tô"),
    ("Shinkansen", "Sin-can-xên"),
    ("Osaka", "Ô-xa-ca"),
    ("Hokkaido", "Hôc-cai-đô"),
    ("Asuka", "A-xư-ca"),
    ("Sakura", "Xa-cư-ra"),
    ("Konnichiwa", "Côn-ni-chi-goa"),
    ("senpai", "xên-pai"),
    ("Samurai", "Xa-mư-rai"),
    ("Ginza", "Ghin-da"),
    ("Saitama", "Xai-ta-ma"),
]

# Từ tiếng Anh hay lẫn trong LN dịch — phải để nguyên.
ENGLISH_WORDS = [
    "computer", "strong", "world", "hello", "beautiful", "running",
    "system", "player", "light", "novel", "reader", "window",
    "English", "School", "Class", "Master", "Level", "America",
    "London", "Internet", "Online", "Game", "Team", "Manager",
    "Center", "Service", "Access", "Project", "Random", "Simple",
    "Modern", "Silent", "Moment", "Second", "Minute", "Together",
    "Another", "Number", "Person", "Reason", "Season", "Winter",
    "Name", "Time", "Home", "Future", "Nature", "Before", "Machine",
]

# Tên Nhật phải nhận được, nhưng không chốt cách đọc cụ thể.
JAPANESE_NAMES = [
    "Nagoya", "Yokohama", "Fujiwara", "Tanaka", "Yamada", "Chitose",
    "Mizuki", "Ryuunosuke", "Katsuki", "Natsuki", "Himeko", "Tsukasa",
    "Shizuku", "Honda", "Sendai", "Nintendo", "Akihabara", "Harajuku",
    "Onigiri", "Ramen", "Kimono", "Ninja", "Sensei", "Nakamura",
    "Takahashi", "Watanabe", "Kobayashi", "Akira", "Yuki", "Haruka",
    "Kaito", "Shinji", "Rikka", "Sasuke", "Naruto", "Hinata",
    "Suzuki", "Kaneki", "Todoroki", "Midoriya",
    # Nguyên âm rời `ao`/`eo` — từng bị chặn nhầm, xem chú thích ở
    # `_NON_ROMAJI_VOWEL_PAIRS`. Đo trên 291 tên LN thì chặn mất 6 tên thật.
    "Aoi", "Naoki", "Kaori", "Naofumi", "Reo", "Kaoru", "Aoba", "Naomi",
    "Aoyama",
]

# Âm tiết tiếng Việt không dấu, viết hoa như đứng đầu câu. Đây là lớp chặn
# quan trọng nhất: text LN **là** tiếng Việt nên nuốt nhầm ở đây gặp thường
# xuyên hơn nuốt nhầm tiếng Anh, và hỏng nặng hơn.
VIETNAMESE_SENTENCE_STARTS = [
    "Mua", "Ban", "Tai", "Cho", "Nhin", "Nguoi", "Truoc", "Trong",
    # Nhóm `-ao`: cần từ khi bỏ chặn nguyên âm đôi `ao`.
    "Nao", "Bao", "Gao", "Dao", "Cao", "Sao", "Vao", "Giao", "Chao",
]


class TestRomajiToVi:
    @pytest.mark.parametrize(("word", "expected"), JAPANESE_CASES)
    def test_phien_am_dung(self, word: str, expected: str) -> None:
        assert romaji_to_vi(word) == expected

    @pytest.mark.parametrize("word", JAPANESE_NAMES)
    def test_nhan_dien_ten_nhat(self, word: str) -> None:
        assert romaji_to_vi(word) is not None

    @pytest.mark.parametrize("word", ENGLISH_WORDS)
    def test_tu_choi_tu_tieng_anh(self, word: str) -> None:
        assert romaji_to_vi(word) is None

    @pytest.mark.parametrize("word", VIETNAMESE_SENTENCE_STARTS)
    def test_tu_choi_am_tiet_viet_dau_cau(self, word: str) -> None:
        # Cổng chữ hoa ở `lexicon_jp.lookup` không cứu được từ Việt đứng đầu
        # câu — chính nó cũng viết hoa. Phải chặn ngay ở luật.
        assert romaji_to_vi(word) is None

    def test_nguyen_am_roi_ao_eo_van_la_romaji(self) -> None:
        # `ao`/`eo` trông rất "Tây" nhưng là hai nguyên âm rời hợp lệ. Chặn
        # chúng thì mất `Aoi`, `Naoki`, `Kaori`, `Naofumi`, `Reo`, `Kaoru`.
        assert romaji_to_vi("Aoi") == "A-ôi"
        assert romaji_to_vi("Naoki") == "Na-ô-ki"
        assert romaji_to_vi("Reo") == "Rê-ô"

    def test_giu_chu_hoa_dau(self) -> None:
        assert romaji_to_vi("Tokyo") == "Tô-kiô"
        assert romaji_to_vi("tokyo") == "tô-kiô"

    def test_dung_gach_noi_khong_dung_dau_cach(self) -> None:
        # Dấu cách khiến Piper chèn khoảng nghỉ giữa các âm tiết.
        result = romaji_to_vi("Sakura")
        assert result is not None
        assert " " not in result
        assert "-" in result

    def test_n_mui_dinh_vao_am_tiet_truoc(self) -> None:
        # `Cô-n-ni` sai: `n` đứng một mình bị đọc thành tên chữ cái.
        assert romaji_to_vi("Konnichiwa") == "Côn-ni-chi-goa"

    def test_sokuon_nhan_doi_phu_am(self) -> None:
        assert romaji_to_vi("Hokkaido") == "Hôc-cai-đô"

    def test_nguyen_am_doi_gop_lai(self) -> None:
        assert romaji_to_vi("senpai") == "xên-pai"

    def test_truong_am_rut_gon(self) -> None:
        # `uu` → `u`, không lặp âm tiết.
        assert romaji_to_vi("Ryuunosuke") == "Riu-nô-xư-kê"

    def test_tu_qua_ngan(self) -> None:
        assert romaji_to_vi("ai") is None
        assert romaji_to_vi("a") is None

    def test_tu_qua_dai(self) -> None:
        assert romaji_to_vi("a" * 21) is None

    def test_chuoi_rong(self) -> None:
        assert romaji_to_vi("") is None

    def test_co_chu_so(self) -> None:
        assert romaji_to_vi("Tokyo2024") is None

    def test_co_dau_tieng_viet(self) -> None:
        assert romaji_to_vi("Chào") is None

    def test_chu_cai_khong_co_trong_romaji(self) -> None:
        # `l`, `v`, `x`, `q` không có trong Hepburn.
        for word in ("Level", "Victor", "Xavier", "Queen"):
            assert romaji_to_vi(word) is None


class TestLooksLikeRomaji:
    def test_dong_bo_voi_romaji_to_vi(self) -> None:
        """Nhận diện và chuyển đổi phải thống nhất — không có ca nhận mà không chuyển được."""
        for word in JAPANESE_NAMES + [w for w, _ in JAPANESE_CASES] + ENGLISH_WORDS:
            if looks_like_romaji(word):
                assert romaji_to_vi(word) is not None

    def test_khong_phan_biet_hoa_thuong(self) -> None:
        assert looks_like_romaji("TOKYO") == looks_like_romaji("tokyo")


class TestMoraTable:
    def test_moi_gia_tri_deu_khong_rong(self) -> None:
        for key, value in MORA_TABLE.items():
            assert value, f"mora {key!r} ánh xạ sang chuỗi rỗng"

    def test_khong_co_khoang_trang_trong_gia_tri(self) -> None:
        # Khoảng trắng trong bảng sẽ lọt ra ngoài và làm Piper ngắt nhịp.
        for key, value in MORA_TABLE.items():
            assert " " not in value, f"mora {key!r} chứa khoảng trắng"
