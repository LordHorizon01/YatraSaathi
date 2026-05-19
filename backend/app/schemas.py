from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


# ─── Vehicle ──────────────────────────────────────────────────────────────────

class VehicleRegisterRequest(BaseModel):
    vehicle_id:    str = Field(..., min_length=4, max_length=12)
    language_pref: str = Field(default="hi", max_length=10)


# ─── Sessions ─────────────────────────────────────────────────────────────────

class StartSessionRequest(BaseModel):
    vehicle_id:    str
    language_pref: str = "hi"

class EndSessionRequest(BaseModel):
    final_state: str = "completed"

class SessionResponse(BaseModel):
    session_id:    str
    vehicle_id:    str
    started_at:    datetime
    total_checks:  int
    safety_points: int

    model_config = {"from_attributes": True}


# ─── Voice Analysis ───────────────────────────────────────────────────────────

class VoiceAnalysisResponse(BaseModel):
    fatigue_score:        int
    latency_flag:         str
    coherence_flag:       str
    slur_flag:            str
    gpt_coherence_score:  Optional[float]
    danger_bubble_active: bool
    suggested_poi:        Optional[dict]      # closest POI { name, distance_m, … }
    nearby_pois:          Optional[list[dict]] # all fetched POIs for the panel
    transcript:           Optional[str]       # echoed back for debug; omit in prod



# ─── Geo / DangerBubble ───────────────────────────────────────────────────────

class LocationPushRequest(BaseModel):
    vehicle_id:    str
    lat:           float
    lng:           float
    fatigue_score: int

class NearbyDangerItem(BaseModel):
    vehicle_id:  str
    distance_m:  float
    fatigue_score: int

class NearbyDangersResponse(BaseModel):
    dangers: list[NearbyDangerItem]
