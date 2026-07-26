"""Engine TTS. Chỗ duy nhất trong sidecar import thư viện `piper`."""

from .piper import EngineError, PiperEngine, SynthesisResult

__all__ = ["EngineError", "PiperEngine", "SynthesisResult"]
