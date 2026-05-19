/**
 * poiService.js — fetch nearby dhabas/restaurants/hotels from the backend.
 * Uses the same IP-detection logic as api.js (static imports for Metro compatibility).
 */
import axios from 'axios';
import Constants from 'expo-constants';

function getBaseUrl() {
  const hostUri =
    Constants.expoConfig?.hostUri          ??
    Constants.expoGoConfig?.debuggerHost   ??
    Constants.manifest2?.extra?.expoGo?.debuggerHost ??
    Constants.manifest?.debuggerHost       ??
    null;

  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    return `http://${hostIp}:8000`;
  }
  // Same hardcoded fallback as api.js
  return 'http://10.110.153.53:8000';
}

const BASE_URL = __DEV__ ? getBaseUrl() : 'https://api.yatrasaathi.in';

/**
 * Fetch nearby POIs from the backend.
 *
 * @param {number} anchorLat  - latitude of where the check-in happened (or current pos)
 * @param {number} anchorLng  - longitude of where the check-in happened (or current pos)
 * @param {number} driverLat  - current driver latitude (for live distance calc)
 * @param {number} driverLng  - current driver longitude
 * @param {number} radiusM    - search radius in metres (default 8000)
 * @returns {Promise<Array>}  - sorted array of POI objects
 */
export async function getNearbyPois(
  anchorLat,
  anchorLng,
  driverLat,
  driverLng,
  radiusM = 8000,
) {
  const params = {
    lat:        anchorLat,
    lng:        anchorLng,
    radius_m:   radiusM,
    driver_lat: driverLat ?? anchorLat,
    driver_lng: driverLng ?? anchorLng,
  };

  const { data } = await axios.get(`${BASE_URL}/pois/nearby`, {
    params,
    timeout: 35_000,   // Parallel Overpass is capped at 28s + buffer for Nominatim fallback
  });

  // data is an array: [{ id, name, lat, lng, type, address, rating, maps_url, distance_m }, …]
  return Array.isArray(data) ? data : [];
}
