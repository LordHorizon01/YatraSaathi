import axios from 'axios';

// ─── Client Config ────────────────────────────────────────────────────────────
// In dev, point to your local FastAPI.
// 10.0.2.2 is the magic IP for Android Emulators to reach the host's localhost.
const BASE_URL = __DEV__
  ? 'http://10.0.2.2:8000'
  : 'https://api.yatrasaathi.in';

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
 */
export async function analyzeVoice({ audioUri, sessionId, vehicleId, latencyMs, questionText, lang }) {
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
