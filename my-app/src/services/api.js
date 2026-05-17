import axios from 'axios';
import Constants from 'expo-constants';

// ─── Client Config ────────────────────────────────────────────────────────────
// Auto-detect the dev machine's IP from Expo's dev server.
// Works on physical devices (WiFi IP) and emulators alike.
function getDevBaseUrl() {
  // Try every known property across Expo SDK versions
  const hostUri =
    Constants.expoConfig?.hostUri          ??   // SDK 49+
    Constants.expoGoConfig?.debuggerHost   ??   // Expo Go
    Constants.manifest2?.extra?.expoGo?.debuggerHost ??
    Constants.manifest?.debuggerHost       ??   // SDK 48 and below
    null;

  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    const url = `http://${hostIp}:8000`;
    console.log('[Saarthi] Auto-detected backend IP:', url);
    return url;
  }

  // Hardcoded fallback — edit this if your WiFi IP is different
  const MANUAL_IP = '10.110.153.53';  // PC WiFi IP — update if network changes
  console.warn('[Saarthi] Could not auto-detect IP, using fallback:', MANUAL_IP);
  return `http://${MANUAL_IP}:8000`;
}

const BASE_URL = __DEV__ ? getDevBaseUrl() : 'https://api.yatrasaathi.in';
console.log('[Saarthi] Backend URL:', BASE_URL);

const client = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Session Endpoints ────────────────────────────────────────────────────────

/** Register a new drive session. Returns { session_id }. */
export async function startSession(vehicleId, languagePref = 'hi') {
  const { data } = await client.post('/sessions', {
    vehicle_id: vehicleId,
    language_pref: languagePref,
  });
  return data;
}

/** Mark a session as ended. */
export async function endSession(sessionId, finalState = 'completed') {
  const { data } = await client.patch(`/sessions/${sessionId}/end`, { final_state: finalState });
  return data;
}

// ─── Voice Analysis Endpoint ──────────────────────────────────────────────────

/**
 * POST /analyze-voice
 * Sends audio file + metadata. Returns FatigueLog with score + flags.
 * @param {string} audioUri     - local file URI from expo-av
 * @param {string} sessionId
 * @param {string} vehicleId
 * @param {number} latencyMs    - client-measured response latency
 * @param {string} questionText - the question that was asked
 * @param {string} lang         - language code
 * @param {number} lat          - driver latitude (for DangerBubble geo-broadcast)
 * @param {number} lng          - driver longitude
 */
export async function analyzeVoice({ audioUri, sessionId, vehicleId, latencyMs, questionText, lang, lat, lng }) {
  const formData = new FormData();
  formData.append('audio', {
    uri:  audioUri,
    name: 'checkin.m4a',
    type: 'audio/m4a',
  });
  formData.append('session_id',    sessionId);
  formData.append('vehicle_id',    vehicleId);
  formData.append('latency_ms',    String(latencyMs ?? 0));
  formData.append('question_text', questionText);
  formData.append('lang',          lang);
  formData.append('lat',           String(lat ?? 0));
  formData.append('lng',           String(lng ?? 0));

  const { data } = await client.post('/analyze-voice', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 20_000,  // Whisper can be slow
  });
  return data; // { fatigue_score, latency_flag, coherence_flag, slur_flag, suggested_poi, danger_bubble_active }
}

// ─── Geo / DangerBubble Endpoints ────────────────────────────────────────────

/** Broadcast current location to Redis geo-index. */
export async function pushLocation(vehicleId, lat, lng, fatigueScore) {
  await client.post('/geo/location', {
    vehicle_id:    vehicleId,
    lat,
    lng,
    fatigue_score: fatigueScore,
  });
}

/** Fetch fatigued drivers within radiusKm of position. */
export async function getNearbyDangers(lat, lng, radiusKm = 1) {
  const { data } = await client.get('/geo/nearby', {
    params: { lat, lng, radius_km: radiusKm },
  });
  return data; // [{ vehicle_id, distance_m, fatigue_score }]
}

// ─── WebSocket for Real-Time DangerBubble ────────────────────────────────────

/**
 * Open a persistent WebSocket to receive push DangerBubble alerts.
 * Returns the WebSocket instance so the caller can attach onmessage/onclose.
 *
 * Usage:
 *   const ws = connectDangerWS('VH-001', 28.6139, 77.2090);
 *   ws.onmessage = (e) => { const data = JSON.parse(e.data); ... };
 *   ws.onclose   = () => { // reconnect logic };
 */
export function connectDangerWS(vehicleId, lat, lng) {
  const wsBase = BASE_URL.replace(/^http/, 'ws');
  const url = `${wsBase}/ws/danger/${vehicleId}?lat=${lat}&lng=${lng}`;
  const ws = new WebSocket(url);

  // Auto-ping every 25s to keep the connection alive
  let pingInterval;
  ws.onopen = () => {
    pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 25_000);
  };
  ws.onclose = () => clearInterval(pingInterval);

  return ws;
}

/** Send updated position to the DangerBubble WebSocket. */
export function updateWSPosition(ws, lat, lng) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ lat, lng }));
  }
}
