import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DriveSession, FatigueLog
from app.schemas import VoiceAnalysisResponse
from app.services.fatigue_engine import build_fatigue_result
from app.services.whisper_client import detect_slur, score_coherence, transcribe_audio
from app.services.redis_geo import upsert_driver_location

router = APIRouter(prefix="/analyze-voice", tags=["voice"])


@router.post("", response_model=VoiceAnalysisResponse)
async def analyze_voice(
    audio:         UploadFile = File(...),
    session_id:    str        = Form(...),
    vehicle_id:    str        = Form(...),
    latency_ms:    int        = Form(default=0),
    question_text: str        = Form(...),
    lang:          str        = Form(default="hi"),
    db: AsyncSession          = Depends(get_db),
):
    # ── 1. Verify session exists ─────────────────────────────────────────────
    result = await db.execute(select(DriveSession).where(DriveSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # ── 2. Process audio ─────────────────────────────────────────────────────
    audio_bytes  = await audio.read()
    transcript   = await transcribe_audio(audio_bytes, filename=audio.filename or "audio.m4a")
    coherence    = await score_coherence(question_text, transcript)
    slur         = detect_slur(transcript)

    # ── 3. Score ─────────────────────────────────────────────────────────────
    fatigue = build_fatigue_result(
        latency_ms      = latency_ms if latency_ms > 0 else None,
        coherence_score = coherence,
        slur_detected   = slur,
    )

    # ── 4. Compute drive_hour ─────────────────────────────────────────────────
    elapsed = (datetime.utcnow() - session.started_at).total_seconds()
    drive_hour = int(elapsed // 3600)

    # ── 5. Persist FatigueLog ─────────────────────────────────────────────────
    log = FatigueLog(
        id                   = str(uuid.uuid4()),
        session_id           = session_id,
        vehicle_id           = vehicle_id,
        drive_hour           = drive_hour,
        question_text        = question_text,
        question_lang        = lang,
        response_latency_ms  = latency_ms if latency_ms > 0 else None,
        raw_transcript       = transcript,
        fatigue_score        = fatigue.fatigue_score,
        latency_flag         = fatigue.latency_flag,
        coherence_flag       = fatigue.coherence_flag,
        slur_flag            = fatigue.slur_flag,
        gpt_coherence_score  = round(coherence, 2),
        danger_bubble_active = fatigue.danger_bubble_active,
        suggested_poi_name   = fatigue.suggested_poi["name"] if fatigue.suggested_poi else None,
        suggested_poi_dist_m = fatigue.suggested_poi["distance_m"] if fatigue.suggested_poi else None,
    )
    db.add(log)

    # ── 6. Update session aggregates ──────────────────────────────────────────
    session.total_checks += 1
    if fatigue.fatigue_score >= 6:
        session.failed_checks += 1
    if session.peak_fatigue_score is None or fatigue.fatigue_score > session.peak_fatigue_score:
        session.peak_fatigue_score = fatigue.fatigue_score
    if fatigue.fatigue_score <= 5:
        session.safety_points += 10

    await db.commit()

    return VoiceAnalysisResponse(
        fatigue_score        = fatigue.fatigue_score,
        latency_flag         = fatigue.latency_flag,
        coherence_flag       = fatigue.coherence_flag,
        slur_flag            = fatigue.slur_flag,
        gpt_coherence_score  = round(coherence, 2),
        danger_bubble_active = fatigue.danger_bubble_active,
        suggested_poi        = fatigue.suggested_poi,
        transcript           = transcript if True else None,  # toggle for prod
    )
