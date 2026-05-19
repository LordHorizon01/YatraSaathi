"""
POI fetching service — finds dhabas, restaurants, hotels near driver.

Strategy (tried in order until one succeeds):
  1. Google Places API    — if GOOGLE_PLACES_API_KEY is set (best Indian results)
  2. Overpass API (GET)   — tries ALL mirrors IN PARALLEL (fastest first wins)
  3. Nominatim search     — OSM geocoding API, free, no key, works well from India

In-memory cache (5 min TTL) prevents repeated slow lookups for the same area.
"""
import asyncio
import math
import os
import time
import urllib.parse
from typing import Optional

import httpx

from app.config import settings

GOOGLE_PLACES_KEY: Optional[str] = (
    getattr(settings, "google_places_api_key", None)
    or os.getenv("GOOGLE_PLACES_API_KEY", "")
)

# Overpass mirrors — all tried IN PARALLEL, first success wins
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/oapi/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# Common HTTP headers that help avoid 406/rate-limit rejections
_HEADERS = {
    "Accept":          "application/json, text/plain, */*",
    "Content-Type":    "application/x-www-form-urlencoded",
    "User-Agent":      "YatraSaathi/1.0 (saarthi-ai-driver-app; contact@yatrasaathi.in)",
}

# ─── Simple in-memory cache ───────────────────────────────────────────────────
# Key: (grid_lat, grid_lng, radius_m) rounded to ~1 km grid
# Value: (timestamp, list[dict])
_POI_CACHE: dict = {}
_CACHE_TTL_SEC = 300   # 5 minutes

def _cache_key(lat: float, lng: float, radius_m: int) -> tuple:
    """Round to ~1 km grid so nearby positions share the same cache entry."""
    return (round(lat, 2), round(lng, 2), radius_m)

def _cache_get(lat: float, lng: float, radius_m: int) -> Optional[list]:
    key = _cache_key(lat, lng, radius_m)
    entry = _POI_CACHE.get(key)
    if entry and (time.time() - entry[0]) < _CACHE_TTL_SEC:
        print(f"[POI] Cache HIT for key={key}")
        return entry[1]
    return None

def _cache_set(lat: float, lng: float, radius_m: int, pois: list) -> None:
    key = _cache_key(lat, lng, radius_m)
    _POI_CACHE[key] = (time.time(), pois)
    print(f"[POI] Cache SET for key={key} ({len(pois)} pois)")


# ─── Haversine distance (metres) ─────────────────────────────────────────────
def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6_371_000
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi  = math.radians(lat2 - lat1)
    dlam  = math.radians(lng2 - lng1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _maps_url(lat: float, lng: float, place_id: Optional[str] = None) -> str:
    if place_id:
        return f"https://www.google.com/maps/place/?q=place_id:{place_id}"
    return f"https://maps.google.com/maps?q={lat},{lng}"


def _bounding_box(lat: float, lng: float, radius_m: int):
    """Return (min_lng, min_lat, max_lng, max_lat) bounding box for Nominatim viewbox."""
    delta_lat = radius_m / 111_000
    delta_lng = radius_m / (111_000 * math.cos(math.radians(lat)))
    return (
        lng - delta_lng, lat - delta_lat,
        lng + delta_lng, lat + delta_lat,
    )


# ─── Google Places ────────────────────────────────────────────────────────────
async def _fetch_google(lat: float, lng: float, radius_m: int) -> list[dict]:
    key     = GOOGLE_PLACES_KEY
    results: list[dict] = []

    async with httpx.AsyncClient(timeout=10) as client:
        for keyword, ptype in [
            ("dhaba",      "restaurant"),
            ("restaurant", "restaurant"),
            ("hotel",      "lodging"),
            ("cafe",       "cafe"),
        ]:
            params = {
                "location": f"{lat},{lng}",
                "radius":   radius_m,
                "type":     ptype,
                "keyword":  keyword,
                "key":      key,
            }
            try:
                r    = await client.get(
                    "https://maps.googleapis.com/maps/api/place/nearbysearch/json",
                    params=params,
                )
                data   = r.json()
                status = data.get("status", "")
                if status not in ("OK", "ZERO_RESULTS"):
                    print(f"[POI] Google Places status={status} for keyword={keyword}")
                for p in data.get("results", [])[:8]:
                    plat = p["geometry"]["location"]["lat"]
                    plng = p["geometry"]["location"]["lng"]
                    results.append({
                        "id":       p.get("place_id", f"{plat},{plng}"),
                        "name":     p.get("name", "Rest Stop"),
                        "lat":      plat,  "lng": plng,
                        "type":     "dhaba" if keyword == "dhaba" else ptype,
                        "address":  p.get("vicinity", ""),
                        "rating":   p.get("rating"),
                        "maps_url": _maps_url(plat, plng, p.get("place_id")),
                    })
            except Exception as e:
                print(f"[POI] Google Places failed ({keyword}): {e}")

    print(f"[POI] Google returned {len(results)} raw results")
    return results


# ─── Overpass query builder ───────────────────────────────────────────────────
def _overpass_query(lat: float, lng: float, radius_m: int) -> str:
    r = radius_m
    return (
        f"[out:json][timeout:28];\n"
        f"(\n"
        f'  node["amenity"~"restaurant|fast_food|cafe|food_court"](around:{r},{lat},{lng});\n'
        f'  way["amenity"~"restaurant|fast_food|cafe|food_court"](around:{r},{lat},{lng});\n'
        f'  node["tourism"~"hotel|motel|hostel|guest_house"](around:{r},{lat},{lng});\n'
        f'  way["tourism"~"hotel|motel|hostel|guest_house"](around:{r},{lat},{lng});\n'
        f'  node["name"~"[Dd]haba|[Hh]otel|[Rr]estaurant|[Cc]afe|[Ll]odge|[Dd]habha|[Kk]hana"](around:{r},{lat},{lng});\n'
        f');\n'
        f"out center tags 80;\n"
    )


def _parse_overpass_elements(elements: list, lat: float, lng: float) -> list[dict]:
    """Convert raw Overpass elements into our POI dict format."""
    results = []
    for el in elements:
        if "lat" in el and "lon" in el:
            plat, plng = el["lat"], el["lon"]
        elif "center" in el:
            plat, plng = el["center"]["lat"], el["center"]["lon"]
        else:
            continue

        tags   = el.get("tags", {})
        name   = (
            tags.get("name") or tags.get("name:en") or tags.get("name:hi")
            or tags.get("brand") or tags.get("operator") or ""
        ).strip()

        if not name:
            amenity = tags.get("amenity", "")
            tourism = tags.get("tourism", "")
            if amenity in ("restaurant", "fast_food", "cafe", "food_court"):
                name = amenity.replace("_", " ").title()
            elif tourism in ("hotel", "motel", "hostel", "guest_house"):
                name = tourism.replace("_", " ").title()
            else:
                continue

        amenity = tags.get("amenity", "")
        tourism = tags.get("tourism", "")
        nl      = name.lower()
        ptype   = (
            "dhaba"      if ("dhaba" in nl or "dhabha" in nl or "bhojanalaya" in nl) else
            "hotel"      if (tourism or "hotel" in nl or "lodge" in nl or "motel" in nl) else
            "restaurant"
        )
        results.append({
            "id":      str(el["id"]),
            "name":    name,
            "lat":     plat,  "lng": plng,
            "type":    ptype,
            "address": (tags.get("addr:full") or tags.get("addr:street", "")
                        or tags.get("addr:city", "") or tags.get("addr:village", "")),
            "rating":  None,
            "maps_url": _maps_url(plat, plng),
        })
    return results


# ─── Overpass API — all mirrors tried IN PARALLEL ────────────────────────────
async def _try_overpass_mirror(client: httpx.AsyncClient, mirror_url: str, encoded_query: str, lat: float, lng: float) -> list[dict]:
    """Try one Overpass mirror with GET then POST. Returns empty list on failure."""
    # GET
    try:
        get_url = f"{mirror_url}?data={encoded_query}"
        print(f"[POI] Overpass GET: {mirror_url}")
        r = await client.get(get_url)
        if r.status_code == 200:
            els = r.json().get("elements", [])
            print(f"[POI] Overpass GET OK — {len(els)} elements from {mirror_url}")
            pois = _parse_overpass_elements(els, lat, lng)
            if pois:
                return pois
        else:
            print(f"[POI] Overpass GET {r.status_code} from {mirror_url}")
    except Exception as e:
        print(f"[POI] Overpass GET failed ({mirror_url}): {e}")

    # POST fallback
    try:
        print(f"[POI] Overpass POST: {mirror_url}")
        r = await client.post(
            mirror_url, content=f"data={encoded_query}",
            headers={**_HEADERS, "Content-Type": "application/x-www-form-urlencoded"},
        )
        if r.status_code == 200:
            els = r.json().get("elements", [])
            print(f"[POI] Overpass POST OK — {len(els)} elements from {mirror_url}")
            pois = _parse_overpass_elements(els, lat, lng)
            if pois:
                return pois
        else:
            print(f"[POI] Overpass POST {r.status_code} from {mirror_url}")
    except Exception as e:
        print(f"[POI] Overpass POST failed ({mirror_url}): {e}")

    return []


async def _fetch_osm_overpass(lat: float, lng: float, radius_m: int) -> list[dict]:
    """Fire all Overpass mirrors concurrently — first non-empty result wins."""
    query = _overpass_query(lat, lng, radius_m)
    encoded_query = urllib.parse.quote(query)

    async with httpx.AsyncClient(timeout=28, headers=_HEADERS) as client:
        tasks = [
            asyncio.create_task(_try_overpass_mirror(client, m, encoded_query, lat, lng))
            for m in OVERPASS_MIRRORS
        ]
        # Collect results as they finish; return first non-empty
        for coro in asyncio.as_completed(tasks):
            try:
                result = await coro
                if result:
                    # Cancel remaining tasks
                    for t in tasks:
                        t.cancel()
                    return result
            except Exception:
                pass

    return []


# ─── Nominatim fallback (OSM geocoding API, no key needed) ───────────────────
async def _fetch_nominatim(lat: float, lng: float, radius_m: int) -> list[dict]:
    """
    Nominatim structured search — reliable free fallback when Overpass is blocked.
    Uses viewbox bounding box to limit results to the search area.
    """
    min_lng, min_lat, max_lng, max_lat = _bounding_box(lat, lng, radius_m)
    viewbox = f"{min_lng},{min_lat},{max_lng},{max_lat}"

    results: list[dict] = []

    # Search for each amenity/tourism type separately
    search_terms = [
        ("restaurant", "restaurant"),
        ("fast_food",  "restaurant"),
        ("cafe",       "restaurant"),
        ("hotel",      "hotel"),
        ("motel",      "hotel"),
        ("hostel",     "hotel"),
        ("guest_house","hotel"),
    ]

    async with httpx.AsyncClient(timeout=15, headers={
        "User-Agent": "YatraSaathi/1.0 (saarthi-ai; contact@yatrasaathi.in)",
        "Accept":     "application/json",
    }) as client:
        for amenity_val, poi_type in search_terms:
            try:
                r = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={
                        "format":     "json",
                        "amenity":    amenity_val,
                        "bounded":    "1",
                        "viewbox":    viewbox,
                        "limit":      "20",
                        "addressdetails": "1",
                    },
                )
                if r.status_code != 200:
                    print(f"[POI] Nominatim HTTP {r.status_code} for amenity={amenity_val}")
                    continue

                places = r.json()
                print(f"[POI] Nominatim found {len(places)} for amenity={amenity_val}")
                for p in places:
                    plat = float(p["lat"])
                    plng = float(p["lon"])
                    name = (p.get("display_name") or "").split(",")[0].strip()
                    if not name:
                        name = amenity_val.replace("_", " ").title()

                    addr_parts = p.get("address", {})
                    address = (addr_parts.get("road") or addr_parts.get("suburb")
                               or addr_parts.get("city_district") or addr_parts.get("city", ""))

                    nl = name.lower()
                    ptype = (
                        "dhaba"  if ("dhaba" in nl or "dhabha" in nl) else
                        "hotel"  if (poi_type == "hotel" or "hotel" in nl or "lodge" in nl) else
                        "restaurant"
                    )
                    results.append({
                        "id":       p.get("place_id", f"{plat},{plng}"),
                        "name":     name,
                        "lat":      plat, "lng": plng,
                        "type":     ptype,
                        "address":  address,
                        "rating":   None,
                        "maps_url": _maps_url(plat, plng),
                    })
            except Exception as e:
                print(f"[POI] Nominatim failed for amenity={amenity_val}: {e}")

        # Also do a free-text search for "dhaba" which Nominatim handles well
        try:
            r = await client.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "format":  "json",
                    "q":       "dhaba",
                    "bounded": "1",
                    "viewbox": viewbox,
                    "limit":   "15",
                },
            )
            if r.status_code == 200:
                places = r.json()
                print(f"[POI] Nominatim 'dhaba' search: {len(places)} results")
                for p in places:
                    plat = float(p["lat"])
                    plng = float(p["lon"])
                    name = (p.get("display_name") or "").split(",")[0].strip() or "Dhaba"
                    results.append({
                        "id":       p.get("place_id", f"{plat},{plng}"),
                        "name":     name,
                        "lat":      plat, "lng": plng,
                        "type":     "dhaba",
                        "address":  "",
                        "rating":   None,
                        "maps_url": _maps_url(plat, plng),
                    })
        except Exception as e:
            print(f"[POI] Nominatim dhaba search failed: {e}")

    print(f"[POI] Nominatim total raw results: {len(results)}")
    return results


# ─── Public API ───────────────────────────────────────────────────────────────
async def fetch_nearby_pois(lat: float, lng: float, radius_m: int = 8000) -> list[dict]:
    """
    Fetch up to 15 nearby rest stops (dhabas / restaurants / hotels).
    Order: cache → Google Places → Overpass (parallel mirrors) → Nominatim.
    Deduplicates by name, sorts by distance, returns top 15.
    """
    print(f"[POI] fetch_nearby_pois(lat={lat:.4f}, lng={lng:.4f}, radius_m={radius_m})")

    # 0. Check cache first (instant response if same area within 5 min)
    cached = _cache_get(lat, lng, radius_m)
    if cached is not None:
        return cached

    raw: list[dict] = []

    # 1. Google Places (if key set)
    if GOOGLE_PLACES_KEY:
        raw = await _fetch_google(lat, lng, radius_m)

    # 2. Overpass API (all mirrors in parallel — fastest wins)
    if not raw:
        raw = await _fetch_osm_overpass(lat, lng, radius_m)

    # 3. Nominatim (free, no-key OSM fallback)
    if not raw:
        print("[POI] Falling back to Nominatim search…")
        raw = await _fetch_nominatim(lat, lng, radius_m)

    print(f"[POI] Total raw POIs: {len(raw)}")
    if not raw:
        return []

    # Deduplicate by name (keep closest per unique name)
    seen: dict[str, dict] = {}
    for poi in raw:
        key  = poi["name"].lower().strip()
        dist = _haversine(lat, lng, poi["lat"], poi["lng"])
        poi["distance_m"] = round(dist)
        if key not in seen or dist < seen[key]["distance_m"]:
            seen[key] = poi

    sorted_pois = sorted(seen.values(), key=lambda p: p["distance_m"])[:15]
    print(f"[POI] Returning {len(sorted_pois)} deduplicated POIs")

    # Cache the result for next time
    _cache_set(lat, lng, radius_m, sorted_pois)
    return sorted_pois
