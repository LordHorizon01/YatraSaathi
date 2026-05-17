"""
WebSocket DangerBubble broadcaster.

Nearby drivers connect to:
  ws://<host>/ws/danger/<vehicle_id>

When a driver's fatigue score hits >= 8, the geo router calls
`broadcast_danger()` which pushes a JSON alert to all connections
whose registered lat/lng fall within the 1km DangerBubble radius.

Connection lifecycle:
  1. Client connects with their vehicle_id, lat, lng as query params.
  2. Server registers their ConnectionRecord.
  3. When any driver is flagged dangerous, all within 1km receive:
       { "type": "danger", "vehicle_id": <id>, "distance_m": <int>, "fatigue_score": <int> }
  4. Client disconnects → record removed immediately.
"""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass, field
from typing import Dict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

router = APIRouter(tags=["danger-ws"])

# ─── Connection Registry ──────────────────────────────────────────────────────

@dataclass
class ConnectionRecord:
    vehicle_id: str
    lat:        float
    lng:        float
    ws:         WebSocket


class _Registry:
    def __init__(self):
        self._connections: Dict[str, ConnectionRecord] = {}
        self._lock = asyncio.Lock()

    async def add(self, record: ConnectionRecord):
        async with self._lock:
            self._connections[record.vehicle_id] = record

    async def remove(self, vehicle_id: str):
        async with self._lock:
            self._connections.pop(vehicle_id, None)

    async def broadcast_danger(self, source_vehicle_id: str, lat: float, lng: float,
                               fatigue_score: int, radius_km: float = 1.0):
        """Push danger alert to all drivers within radius_km of the danger source."""
        async with self._lock:
            targets = list(self._connections.values())

        payload = {
            "type":          "danger",
            "vehicle_id":    source_vehicle_id,
            "fatigue_score": fatigue_score,
        }

        dead = []
        for record in targets:
            if record.vehicle_id == source_vehicle_id:
                continue
            dist_m = _haversine_m(lat, lng, record.lat, record.lng)
            if dist_m > radius_km * 1000:
                continue
            try:
                await record.ws.send_json({**payload, "distance_m": int(dist_m)})
            except Exception:
                dead.append(record.vehicle_id)

        # Clean up dead connections
        async with self._lock:
            for vid in dead:
                self._connections.pop(vid, None)


registry = _Registry()


# ─── Haversine ────────────────────────────────────────────────────────────────

def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6_371_000
    φ1, φ2 = math.radians(lat1), math.radians(lat2)
    dφ = math.radians(lat2 - lat1)
    dλ = math.radians(lon2 - lon1)
    a = math.sin(dφ / 2) ** 2 + math.cos(φ1) * math.cos(φ2) * math.sin(dλ / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ─── WebSocket Endpoint ───────────────────────────────────────────────────────

@router.websocket("/ws/danger/{vehicle_id}")
async def danger_ws(
    websocket:  WebSocket,
    vehicle_id: str,
    lat:        float = Query(...),
    lng:        float = Query(...),
):
    """
    Persistent connection for real-time DangerBubble alerts.

    Connect with:
      ws://host/ws/danger/<vehicle_id>?lat=<float>&lng=<float>
    """
    await websocket.accept()
    record = ConnectionRecord(vehicle_id=vehicle_id, lat=lat, lng=lng, ws=websocket)
    await registry.add(record)

    try:
        # Keep alive — client sends periodic pings; server echoes pong
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
            # Update position if client sends JSON {"lat": ..., "lng": ...}
            try:
                import json
                coords = json.loads(data)
                async with registry._lock:
                    if vehicle_id in registry._connections:
                        registry._connections[vehicle_id].lat = coords.get("lat", lat)
                        registry._connections[vehicle_id].lng = coords.get("lng", lng)
            except Exception:
                pass
    except WebSocketDisconnect:
        await registry.remove(vehicle_id)
