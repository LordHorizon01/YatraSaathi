"""
Redis geo-index operations for the DangerBubble protocol.
Falls back to an in-memory dict when Redis is unavailable (local dev).
"""
import time
from typing import Optional
import redis.asyncio as aioredis

from app.config import settings

# ─── Connection Pool (lazy init) ──────────────────────────────────────────────
_redis: Optional[aioredis.Redis] = None


async def get_redis() -> Optional[aioredis.Redis]:
    global _redis
    if _redis is None and settings.redis_url:
        try:
            _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
            await _redis.ping()
        except Exception:
            _redis = None   # Redis unavailable — graceful degrade
    return _redis

# ─── In-Memory Fallback ───────────────────────────────────────────────────────
# Structure: { vehicle_id: { lat, lng, score, ts } }
_mem_store: dict[str, dict] = {}
GEO_KEY = "active_drivers"


async def upsert_driver_location(vehicle_id: str, lat: float, lng: float, fatigue_score: int) -> None:
    """Push driver position to Redis geo-index (or in-memory fallback)."""
    r = await get_redis()
    if r:
        await r.geoadd(GEO_KEY, [lng, lat, vehicle_id])
        # Track score separately for retrieval
        await r.hset(f"driver_score:{vehicle_id}", mapping={"score": fatigue_score, "ts": int(time.time())})  # type: ignore[misc]
        if fatigue_score >= 8:
            await r.set(f"danger:{vehicle_id}", "1", ex=settings.danger_bubble_ttl_sec)
        else:
            await r.delete(f"danger:{vehicle_id}")
    else:
        _mem_store[vehicle_id] = {"lat": lat, "lng": lng, "score": fatigue_score, "ts": time.time()}


async def get_nearby_dangers(lat: float, lng: float, radius_km: float) -> list[dict]:
    """
    Return list of { vehicle_id, distance_m, fatigue_score } for fatigued
    drivers within radius_km. Only includes vehicles with score >= 8.
    """
    r = await get_redis()
    if r:
        # geosearch() replaces the deprecated georadius() in redis-py v4+.
        # With withdist=True, each result item is [name, dist_km] (decode_responses=True).
        results = await r.geosearch(
            GEO_KEY,
            longitude=lng,
            latitude=lat,
            radius=radius_km,
            unit="km",
            sort="ASC",
            withdist=True,
        )
        dangers = []
        for item in results:
            vid      = item[0]
            dist_km  = float(item[1])
            score_raw = await r.hget(f"driver_score:{vid}", "score")  # type: ignore[misc]
            score     = int(score_raw) if score_raw else 0
            # danger key auto-expires via TTL — existence check is the authoritative gate
            is_danger = bool(await r.exists(f"danger:{vid}"))
            if is_danger:
                dangers.append({"vehicle_id": vid, "distance_m": round(dist_km * 1000), "fatigue_score": score})
        return dangers
    else:
        # In-memory: simple distance approx (equirectangular — sufficient for 1km)
        from math import radians, cos, sqrt
        dangers = []
        R = 6_371_000   # Earth radius in metres
        for vid, data in _mem_store.items():
            if data["score"] < 8:
                continue
            if time.time() - data["ts"] > settings.danger_bubble_ttl_sec:
                continue
            dlat = radians(lat - data["lat"])
            dlng = radians(lng - data["lng"]) * cos(radians(lat))
            dist_m = sqrt(dlat**2 + dlng**2) * R
            if dist_m <= radius_km * 1000:
                dangers.append({"vehicle_id": vid, "distance_m": round(dist_m), "fatigue_score": data["score"]})
        return sorted(dangers, key=lambda x: x["distance_m"])
