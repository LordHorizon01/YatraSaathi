"""
Core fatigue scoring engine — the Digital Johns Test implementation.
Keeps all scoring logic in one place so it can be unit-tested independently.
"""
from dataclasses import dataclass
from typing import Optional

# ─── Constants ────────────────────────────────────────────────────────────────
# Thresholds are based on Whisper's first_word_start_time (seconds from recording start).
# Healthy alert driver: responds in 0.5–2s after TTS ends.
# Warning zone: 3–5s (mild drowsiness)
# Critical: 5s+ or no speech detected (severe drowsiness / asleep)
LATENCY_WARNING_MS  = 3_000   # 3 seconds to first word
LATENCY_CRITICAL_MS = 5_000   # 5 seconds to first word

COHERENCE_WARNING  = 0.60
COHERENCE_CRITICAL = 0.30

# Score weights (must sum to 10)
WEIGHT_LATENCY   = 4
WEIGHT_COHERENCE = 3
WEIGHT_SLUR      = 3


@dataclass
class FatigueResult:
    fatigue_score:       int           # 1–10
    latency_flag:        str           # ok | warning | critical
    coherence_flag:      str           # ok | warning | critical
    slur_flag:           str           # ok | warning | critical
    danger_bubble_active: bool
    suggested_poi:       Optional[dict]  # { name, distance_m }


def compute_fatigue_score(
    latency_ms:       Optional[int],
    coherence_score:  float,           # 0.0–1.0 from GPT-4o
    slur_detected:    bool,
) -> tuple[int, str, str, str]:
    """
    Returns (score 1-10, latency_flag, coherence_flag, slur_flag).
    Score of 1 = perfectly alert. Score of 10 = critically impaired.
    """
    score = 1

    # ── Latency component (max +4) ──────────────────────────────────────────
    if latency_ms is None:
        # Complete silence — driver is asleep or incapacitated. Instant 10.
        return 10, "critical", "critical", "critical"
    elif latency_ms > LATENCY_CRITICAL_MS:
        latency_flag = "critical"
        score += WEIGHT_LATENCY
    elif latency_ms > LATENCY_WARNING_MS:
        latency_flag = "warning"
        score += WEIGHT_LATENCY // 2
    else:
        latency_flag = "ok"

    # ── Coherence component (max +3) ────────────────────────────────────────
    if coherence_score < COHERENCE_CRITICAL:
        coherence_flag = "critical"
        score += WEIGHT_COHERENCE
    elif coherence_score < COHERENCE_WARNING:
        coherence_flag = "warning"
        score += 1
    else:
        coherence_flag = "ok"

    # ── Slur component (max +3) ─────────────────────────────────────────────
    if slur_detected:
        slur_flag = "critical"
        score += WEIGHT_SLUR
    else:
        slur_flag = "ok"

    return min(score, 10), latency_flag, coherence_flag, slur_flag


def build_fatigue_result(
    latency_ms:      Optional[int],
    coherence_score: float,
    slur_detected:   bool,
    poi:             Optional[dict] = None,
) -> FatigueResult:
    score, l_flag, c_flag, s_flag = compute_fatigue_score(latency_ms, coherence_score, slur_detected)
    return FatigueResult(
        fatigue_score        = score,
        latency_flag         = l_flag,
        coherence_flag       = c_flag,
        slur_flag            = s_flag,
        danger_bubble_active = score >= 8,
        suggested_poi        = poi if 6 <= score <= 7 else None,
    )
