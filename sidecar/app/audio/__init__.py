"""Xử lý audio: resample, mã hoá Opus, dựng timing từ alignment của Piper.

Mọi thứ ở đây là **hàm thuần trên mảng numpy** — không đụng model, không đụng
mạng. Nhờ vậy test chạy được mà không cần voice 63 MB trên đĩa.
"""

from .encode import (
    DEFAULT_BITRATE,
    SUPPORTED_BITRATES,
    EncodedAudio,
    EncodeError,
    encode_opus,
    quality_for_bitrate,
    write_opus,
)
from .paths import AUDIO_SUFFIX, AudioPathError, resolve_audio_path
from .resample import (
    OPUS_SAMPLE_RATES,
    OPUS_TARGET_RATE,
    PIPER_SAMPLE_RATE,
    ResampleError,
    design_lowpass,
    resample,
    target_rate_for_opus,
)
from .timings import (
    PhonemeChunk,
    WordTiming,
    estimate_word_timings,
    group_phonemes_by_word,
    split_words,
    word_timings_from_phonemes,
)

__all__ = [
    "AUDIO_SUFFIX",
    "AudioPathError",
    "resolve_audio_path",
    "DEFAULT_BITRATE",
    "OPUS_SAMPLE_RATES",
    "OPUS_TARGET_RATE",
    "PIPER_SAMPLE_RATE",
    "SUPPORTED_BITRATES",
    "write_opus",
    "EncodeError",
    "EncodedAudio",
    "PhonemeChunk",
    "ResampleError",
    "WordTiming",
    "design_lowpass",
    "encode_opus",
    "estimate_word_timings",
    "group_phonemes_by_word",
    "quality_for_bitrate",
    "resample",
    "split_words",
    "target_rate_for_opus",
    "word_timings_from_phonemes",
]
