import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import DriveSession, VehicleProfile
from app.schemas import EndSessionRequest, SessionResponse, StartSessionRequest

router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.post("", response_model=SessionResponse, status_code=201)
async def start_session(body: StartSessionRequest, db: AsyncSession = Depends(get_db)):
    # Auto-register vehicle if not seen before
    result = await db.execute(select(VehicleProfile).where(VehicleProfile.vehicle_id == body.vehicle_id))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        vehicle = VehicleProfile(
            id=str(uuid.uuid4()),
            vehicle_id=body.vehicle_id,
            language_pref=body.language_pref,
        )
        db.add(vehicle)

    session = DriveSession(
        id=str(uuid.uuid4()),
        vehicle_id=body.vehicle_id,
        started_at=datetime.utcnow(),
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return SessionResponse(
        session_id=session.id,
        vehicle_id=session.vehicle_id,
        started_at=session.started_at,
        total_checks=session.total_checks,
        safety_points=session.safety_points,
    )


@router.patch("/{session_id}/end", response_model=SessionResponse)
async def end_session(session_id: str, body: EndSessionRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DriveSession).where(DriveSession.id == session_id))
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.ended_at    = datetime.utcnow()
    session.final_state = body.final_state
    await db.commit()
    await db.refresh(session)

    return SessionResponse(
        session_id=session.id,
        vehicle_id=session.vehicle_id,
        started_at=session.started_at,
        total_checks=session.total_checks,
        safety_points=session.safety_points,
    )
