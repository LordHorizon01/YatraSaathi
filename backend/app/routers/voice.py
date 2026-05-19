import sys
import uuid
from datetime import datetime


def safe_print(*args, **kwargs):
    """Print that survives Windows charmap encoding by replacing unencodable chars."""
    enc = getattr(sys.stdout, "encoding", "utf-8") or "utf-8"
    safe_args = []
    for a in args:
        try:
            s = str(a)
            s.encode(enc)        # probe — will raise if charmap can't handle it
            safe_args.append(s)
        except (UnicodeEncodeError, LookupError):
            safe_args.append(str(a).encode(enc, errors="replace").decode(enc))
    print(*safe_args, **kwargs)


from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DriveSession, FatigueLog
from app.schemas import VoiceAnalysisResponse
from app.services.fatigue_engine import build_fatigue_result
from app.services.whisper_client import detect_slur, score_coherence, transcribe_audio
from app.services.redis_geo import upsert_driver_location
from app.routers.danger_ws import registry

router = APIRouter(prefix="/analyze-voice", tags=["voice"])


@router.post("", response_model=VoiceAnalysisResponse)
async def analyze_voice(
    audio:         UploadFile = File(...),
    session_id:    str        = Form(...),
    vehicle_id:    str        = Form(default="UNKNOWN"),
    latency_ms:    int        = Form(default=0),
    question_text: str        = Form(...),
    lang:          str        = Form(default="hi"),
    lat:           float      = Form(default=0.0),
    lng:           float      = Form(default=0.0),
    db: AsyncSession          = Depends(get_db),
):
    import traceback
    try:
        # ── 1. Find or create session ──────────────────────────────────────────
        result = await db.execute(select(DriveSession).where(DriveSession.id == session_id))
        session = result.scalar_one_or_none()
        if not session:
            session = DriveSession(
                id=session_id,
                vehicle_id=vehicle_id or "UNKNOWN",
                started_at=datetime.utcnow(),
                total_checks=0,
                failed_checks=0,
                safety_points=0,
            )
            db.add(session)
            await db.flush()  # ensure session exists before FK references

        # ── 2. Process audio ─────────────────────────────────────────────────
        audio_bytes  = await audio.read()
        transcript, first_word_sec = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.m4a")
        from app.services.places_client import fetch_nearby_pois

        # ── DIAGNOSTIC ───────────────────────────────────────────────────────
        safe_print(f"\n[SAARTHI DEBUG]")
        safe_print(f"  audio_size     : {len(audio_bytes)} bytes")
        safe_print(f"  transcript     : '{transcript}'")
        safe_print(f"  first_word_sec : {first_word_sec}")
        safe_print(f"  word_count     : {len(transcript.split())}")
        safe_print()

        # Silence detection — Whisper hallucinates on silent audio.
        # Require at least 3 real alphabetic words. Fewer = treated as no-response → 10/10.
        real_words = [w for w in transcript.split() if any(c.isalpha() for c in w)]
        is_silence = len(real_words) < 3

        safe_print(f"  real_words     : {real_words}")
        safe_print(f"  is_silence     : {is_silence}")

        poi_list: list[dict] = []   # populated below only in warning zone

        if is_silence:
            # Driver did not respond — bypass all AI scoring, directly return 10/10
            from app.services.fatigue_engine import FatigueResult
            fatigue = FatigueResult(
                fatigue_score        = 10,
                latency_flag         = "critical",
                coherence_flag       = "critical",
                slur_flag            = "critical",
                danger_bubble_active = True,
                suggested_poi        = None,
            )
            coherence   = 0.0
            true_latency_ms = None
        else:
            true_latency_ms = int(first_word_sec * 1000)
            coherence       = await score_coherence(question_text, transcript)
            slur            = detect_slur(transcript)

            # Pre-compute score to decide if we need POI fetch (5–7 = warning zone)
            from app.services.fatigue_engine import compute_fatigue_score
            pre_score, _, _, _ = compute_fatigue_score(true_latency_ms, coherence, slur)

            # Fetch nearby POIs in warning+danger zone (5–9) AND driver has a GPS fix
            poi_list: list[dict] = []
            if 5 <= pre_score <= 9 and lat != 0.0 and lng != 0.0:
                try:
                    poi_list = await fetch_nearby_pois(lat, lng, radius_m=8000)
                    safe_print(f"[POI] fetched {len(poi_list)} POIs near ({lat},{lng})")
                except Exception as pe:
                    safe_print(f"[POI] fetch skipped: {pe}")

            fatigue = build_fatigue_result(
                latency_ms      = true_latency_ms,
                coherence_score = coherence,
                slur_detected   = slur,
                poi             = poi_list[0] if poi_list else None,
            )

        # ── 4. Compute drive_hour ─────────────────────────────────────────────
        elapsed = (datetime.utcnow() - session.started_at).total_seconds()
        drive_hour = int(elapsed // 3600)

        # ── 5. Persist FatigueLog ─────────────────────────────────────────────
        # Ensure all values are properly typed before any comparison
        fat_score    = int(fatigue.fatigue_score)
        coherence_f  = float(coherence) if coherence is not None else 0.8
        lat_ms_safe  = int(true_latency_ms) if true_latency_ms is not None else None

        log = FatigueLog(
            id                   = str(uuid.uuid4()),
            session_id           = session_id,
            vehicle_id           = vehicle_id or "UNKNOWN",
            drive_hour           = int(drive_hour),
            question_text        = question_text,
            question_lang        = lang,
            response_latency_ms  = lat_ms_safe,
            raw_transcript       = transcript,
            fatigue_score        = fat_score,
            latency_flag         = str(fatigue.latency_flag),
            coherence_flag       = str(fatigue.coherence_flag),
            slur_flag            = str(fatigue.slur_flag),
            gpt_coherence_score  = round(coherence_f, 2),
            danger_bubble_active = bool(fatigue.danger_bubble_active),
            suggested_poi_name   = fatigue.suggested_poi.get("name")   if fatigue.suggested_poi else None,
            suggested_poi_dist_m = fatigue.suggested_poi.get("distance_m") if fatigue.suggested_poi else None,
        )
        db.add(log)

        # ── 6. Update session aggregates ──────────────────────────────────────
        session.total_checks = int(session.total_checks or 0) + 1
        if fat_score >= 6:
            session.failed_checks = int(session.failed_checks or 0) + 1
        current_peak = session.peak_fatigue_score
        if current_peak is None or fat_score > int(current_peak):
            session.peak_fatigue_score = fat_score
        if fat_score <= 5:
            session.safety_points = int(session.safety_points or 0) + 10

        await db.commit()

        # ── 7. DangerBubble broadcast ─────────────────────────────────────────
        # Always broadcast if danger is active — don't gate on GPS availability.
        # During testing, use a large radius so distance never blocks the alert.
        if fatigue.danger_bubble_active:
            broadcast_lat = lat if lat != 0.0 else 0.0
            broadcast_lng = lng if lng != 0.0 else 0.0
            try:
                await registry.broadcast_danger(
                    source_vehicle_id = vehicle_id or "UNKNOWN",
                    lat               = broadcast_lat,
                    lng               = broadcast_lng,
                    fatigue_score     = fat_score,
                    radius_km         = 50.0,
                )
                await upsert_driver_location(vehicle_id, broadcast_lat, broadcast_lng, fat_score)
            except Exception as e:
                safe_print(f"[DANGER WS] Broadcast failed: {e}")

        return VoiceAnalysisResponse(
            fatigue_score        = fatigue.fatigue_score,
            latency_flag         = fatigue.latency_flag,
            coherence_flag       = fatigue.coherence_flag,
            slur_flag            = fatigue.slur_flag,
            gpt_coherence_score  = round(coherence, 2),
            danger_bubble_active = fatigue.danger_bubble_active,
            suggested_poi        = fatigue.suggested_poi,
            nearby_pois          = poi_list if (5 <= fat_score <= 9) else [],
            transcript           = transcript,
        )

    except Exception as e:
        await db.rollback()
        tb = traceback.format_exc()
        safe_print(f"[VOICE ERROR] {tb}")
        # Build a safe ASCII error detail — use repr() so that any Unicode
        # characters inside the exception message are escaped (e.g. \u0935)
        # rather than triggering a secondary charmap crash when FastAPI
        # serialises the HTTPException detail string.
        try:
            err_detail = f"{type(e).__name__}: {str(e)}"
            # Verify it is safe; if not, fall back to repr which escapes all non-ASCII
            err_detail.encode("utf-8")
        except Exception:
            err_detail = repr(e)
        raise HTTPException(status_code=500, detail=err_detail)
