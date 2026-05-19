"""
GET /pois/nearby  — fetch rest-stops near a lat/lng.

Query params:
  lat, lng         : driver position (float, required)
  radius_m         : search radius in metres  (default 8000)
  driver_lat, driver_lng : current position to compute live distance (optional,
                           falls back to lat/lng when absent)
"""
import sys

def safe_print(*a, **kw):
    enc = getattr(sys.stdout, "encoding", "utf-8") or "utf-8"
    safe = []
    for x in a:
        try:
            s = str(x); s.encode(enc); safe.append(s)
        except (UnicodeEncodeError, LookupError):
            safe.append(str(x).encode(enc, errors="replace").decode(enc))
    print(*safe, **kw)


from fastapi import APIRouter, HTTPException, Query
from app.services.places_client import fetch_nearby_pois, _haversine

router = APIRouter(prefix="/pois", tags=["pois"])


@router.get("/nearby")
async def nearby_pois(
    lat:        float = Query(..., description="Search-anchor latitude"),
    lng:        float = Query(..., description="Search-anchor longitude"),
    radius_m:   int   = Query(8000, description="Search radius in metres"),
    driver_lat: float = Query(None, description="Current driver latitude for live distance"),
    driver_lng: float = Query(None, description="Current driver longitude for live distance"),
):
    """
    Returns sorted list of dhabas / restaurants / hotels within radius_m.
    Each item includes:
      id, name, lat, lng, type, address, rating, maps_url, distance_m
    If driver_lat/driver_lng are supplied, distance_m reflects the driver's
    CURRENT position (useful for live distance polling).
    """
    try:
        pois = await fetch_nearby_pois(lat, lng, radius_m)
    except Exception as e:
        safe_print(f"[POI] fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    # Re-compute distance from current driver position if supplied
    dlat = driver_lat if driver_lat is not None else lat
    dlng = driver_lng if driver_lng is not None else lng
    for p in pois:
        p["distance_m"] = round(_haversine(dlat, dlng, p["lat"], p["lng"]))

    # Re-sort by updated distance
    pois.sort(key=lambda p: p["distance_m"])
    return pois
