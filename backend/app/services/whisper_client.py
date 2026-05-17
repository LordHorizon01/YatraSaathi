"""
OpenAI Whisper + GPT-4o wrapper for voice analysis.
Returns (transcript, coherence_score 0-1, slur_detected bool, first_word_latency_sec).
Falls back to mock values when OPENAI_API_KEY is not set.
"""
import re
from typing import Optional
from openai import AsyncOpenAI
from app.config import settings

_client: Optional[AsyncOpenAI] = None


def _get_client() -> Optional[AsyncOpenAI]:
    global _client
    if _client is None and settings.openai_api_key:
        _client = AsyncOpenAI(api_key=settings.openai_api_key)
    return _client


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.m4a") -> tuple[str, float]:
    """
    Transcribe audio via Whisper.
    Returns (transcript_text, first_word_start_time_in_seconds).
    """
    client = _get_client()
    if not client:
        return ("[mock-transcript] Haan bhai, theek hai.", 0.5)   # dev fallback

    from io import BytesIO
    file_tuple = (filename, BytesIO(audio_bytes), "audio/m4a")
    response = await client.audio.transcriptions.create(
        model="whisper-1",
        file=file_tuple,        # type: ignore
        language=None,          # auto-detect language
        response_format="verbose_json",
        timestamp_granularities=["word"]
    )
    
    # Extract transcript and first word latency
    text = response.text.strip()
    first_word_latency = 0.0
    
    if hasattr(response, "words") and response.words:
        word = response.words[0]
        # OpenAI returns Pydantic objects with .start attribute
        if hasattr(word, "start"):
            first_word_latency = float(word.start)
        elif isinstance(word, dict):
            first_word_latency = float(word.get("start", 0))
        
    return text, first_word_latency


async def score_coherence(question: str, answer: str) -> float:
    """
    Use GPT-4o to score how coherent/logical the answer is relative to the question.
    Returns a float 0.0 (incoherent) to 1.0 (fully coherent).
    Falls back to 0.8 (pass) if OpenAI is unavailable.
    """
    client = _get_client()
    if not client or not answer.strip():
        return 0.5 if not answer.strip() else 0.8   # dev fallback

    prompt = (
        "You are a fatigue detection system. Rate the coherence of a driver's answer "
        "to a casual question on a scale of 0.0 to 1.0.\n"
        "0.0 = completely incoherent, gibberish, or no answer.\n"
        "1.0 = clear, relevant, and lucid response.\n"
        f"Question: {question}\n"
        f"Answer: {answer}\n"
        "Respond with ONLY a decimal number between 0.0 and 1.0. Nothing else."
    )
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=10,
        temperature=0,
    )
    raw = response.choices[0].message.content.strip()
    match = re.search(r"[\d.]+", raw)
    return float(match.group()) if match else 0.8


def detect_slur(transcript: str) -> bool:
    """
    Heuristic slur detection: checks for phonetic softness markers.
    Whisper's text output preserves phonetic collisions (e.g., "haain" vs "haan").
    In production, this would use Whisper's word-level confidence scores.
    """
    if not transcript:
        return False
    slur_patterns = [
        r"\b\w*([aeiou])\1{2,}\w*\b",  # Elongated vowels (haaain, okayy)
        r"\b\w{1,2}\b \b\w{1,2}\b \b\w{1,2}\b",  # Short fragmented words
    ]
    for pattern in slur_patterns:
        if re.search(pattern, transcript, re.IGNORECASE):
            return True
    return len(transcript.split()) < 2 and len(transcript) > 0  # Single mumble
