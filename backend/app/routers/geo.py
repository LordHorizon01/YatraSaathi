from fastapi import APIRouter
from app.schemas import LocationPushRequest, NearbyDangersResponse, NearbyDangerItem
from app.services.redis_geo import upsert_driver_location, get_nearby_dangers
from app.config import settings

router = APIRouter(prefix="/geo", tags=["geo"])


@router.post("/location", status_code=204)
async def push_location(body: LocationPushRequest):
    """Receive a driver's position and update the geo-index. Fire-and-forget."""
    await upsert_driver_location(body.vehicle_id, body.lat, body.lng, body.fatigue_score)


@router.get("/nearby", response_model=NearbyDangersResponse)
async def nearby_dangers(lat: float, lng: float, radius_km: float = 1.0):
    """Return fatigued drivers within radius_km (score >= 8, DangerBubble active)."""
    raw = await get_nearby_dangers(lat, lng, radius_km)
    items = [NearbyDangerItem(**d) for d in raw]
    return NearbyDangersResponse(dangers=items)
