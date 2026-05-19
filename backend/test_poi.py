"""Quick test of POI fetching strategies - run from backend dir.
Windows-safe: no emoji/unicode in print statements.
"""
import asyncio
import math
import urllib.parse
import httpx

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.openstreetmap.fr/oapi/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "User-Agent": "YatraSaathi/1.0 (saarthi-ai; contact@yatrasaathi.in)",
}

def bounding_box(lat, lng, radius_m):
    delta_lat = radius_m / 111_000
    delta_lng = radius_m / (111_000 * math.cos(math.radians(lat)))
    return (lng - delta_lng, lat - delta_lat, lng + delta_lng, lat + delta_lat)

async def test_overpass(lat=28.6139, lng=77.2090, radius_m=5000):
    """Test Overpass mirrors via GET request."""
    print("\n" + "="*60)
    print("Testing Overpass API mirrors (GET)...")
    print("="*60)
    query = (
        f"[out:json][timeout:25];\n"
        f"(\n"
        f'  node["amenity"="restaurant"](around:{radius_m},{lat},{lng});\n'
        f'  node["tourism"="hotel"](around:{radius_m},{lat},{lng});\n'
        f");\n"
        f"out tags 10;\n"
    )
    encoded = urllib.parse.quote(query)
    for mirror in OVERPASS_MIRRORS:
        try:
            url = f"{mirror}?data={encoded}"
            async with httpx.AsyncClient(timeout=30, headers=_HEADERS) as client:
                r = await client.get(url)
            print(f"  {mirror}: HTTP {r.status_code}")
            if r.status_code == 200:
                els = r.json().get("elements", [])
                print(f"    -> {len(els)} elements found")
                for e in els[:3]:
                    name = e.get("tags", {}).get("name", "(no name)")
                    print(f"    - {name.encode('ascii', errors='replace').decode()}")
                if els:
                    return True
            else:
                print(f"    -> Response: {r.text[:150]}")
        except Exception as e:
            print(f"  {mirror}: FAILED - {e}")
    return False

async def test_nominatim(lat=28.6139, lng=77.2090, radius_m=5000):
    """Test Nominatim search API."""
    print("\n" + "="*60)
    print("Testing Nominatim search API...")
    print("="*60)
    min_lng, min_lat, max_lng, max_lat = bounding_box(lat, lng, radius_m)
    viewbox = f"{min_lng},{min_lat},{max_lng},{max_lat}"
    total = 0
    async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
        for amenity in ["restaurant", "hotel"]:
            try:
                r = await client.get(
                    "https://nominatim.openstreetmap.org/search",
                    params={"format": "json", "amenity": amenity,
                            "bounded": "1", "viewbox": viewbox, "limit": "10"},
                )
                places = r.json() if r.status_code == 200 else []
                print(f"  [{amenity}] HTTP {r.status_code} -> {len(places)} results")
                for p in places[:2]:
                    name = p.get("display_name", "?").split(",")[0]
                    print(f"    - {name.encode('ascii', errors='replace').decode()}")
                total += len(places)
            except Exception as e:
                print(f"  [{amenity}] FAILED: {e}")
    print(f"  Total Nominatim results: {total}")
    return total > 0

async def test_backend(lat=28.6139, lng=77.2090):
    """Test the running backend /pois/nearby endpoint."""
    print("\n" + "="*60)
    print("Testing backend /pois/nearby endpoint...")
    print("="*60)
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.get(
                "http://localhost:8000/pois/nearby",
                params={"lat": lat, "lng": lng, "radius_m": 5000},
            )
        print(f"  HTTP {r.status_code}")
        data = r.json()
        if isinstance(data, list):
            print(f"  POIs returned: {len(data)}")
            for p in data[:5]:
                name = (p.get("name") or "?").encode("ascii", errors="replace").decode()
                print(f"  - {name} [{p.get('type')}] {p.get('distance_m')}m")
        else:
            print(f"  Response: {data}")
    except Exception as e:
        print(f"  Backend FAILED: {e}")
        print("  -> Start backend first: uvicorn app.main:app --reload --port 8000")

async def main():
    overpass_ok  = await test_overpass()
    nominatim_ok = await test_nominatim()
    await test_backend()

    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    print(f"  Overpass API (GET):  {'WORKING' if overpass_ok  else 'BLOCKED/UNAVAILABLE'}")
    print(f"  Nominatim API:       {'WORKING' if nominatim_ok else 'FAILED'}")
    if overpass_ok:
        print("  -> Overpass GET will serve POI results [PRIMARY]")
    elif nominatim_ok:
        print("  -> Nominatim fallback will serve POI results [FALLBACK]")
    else:
        print("  -> All free APIs failed. Add GOOGLE_PLACES_API_KEY to .env")

asyncio.run(main())
